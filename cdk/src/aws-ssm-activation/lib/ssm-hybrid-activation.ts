import {CustomResource, Duration, Stack} from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import type * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cr from 'aws-cdk-lib/custom-resources';
import type {Construct} from 'constructs';
import {
  ExtendedConstruct,
  type ExtendedConstructProps,
  StandardTags,
} from '../../aws-cdk';
import {LibStandardTags} from '../../truemark';

/**
 * Properties for SsmHybridActivation.
 */
export interface SsmHybridActivationProps extends ExtendedConstructProps {
  /**
   * IAM role name for the SSM hybrid activation.
   * Instances that register with this activation assume this role.
   * Must be unique within the account.
   */
  readonly roleName: string;

  /**
   * Parameter Store path prefix where the activation ID, region, and code are stored.
   * Example: `/myapp/ssm-activation`
   */
  readonly paramPrefix: string;

  /**
   * Human-readable description for the activation, used in the SSM console.
   */
  readonly description: string;

  /**
   * Tags applied to the SSM hybrid activation. Per the SSM CreateActivation API,
   * tags assigned to an activation are automatically applied to each managed
   * instance (mi-*) that registers with it — server-side, at registration time.
   *
   * When set, ssm:AddTagsToResource is granted to the activation Lambda role.
   *
   * @default - no tags applied to the activation
   */
  readonly activationTags?: {[key: string]: string};

  /**
   * Maximum number of instances that can register using this activation per deploy cycle.
   * The activation is rotated on every deploy.
   *
   * @default 50
   */
  readonly registrationLimit?: number;

  /**
   * KMS key used to encrypt the SecureString activation code parameter.
   * When omitted, the AWS-managed SSM key (alias/aws/ssm) is used.
   *
   * @default - AWS-managed SSM key
   */
  readonly encryptionKey?: kms.IKey;
}

// Lambda handler (Python 3.12) — creates/rotates an SSM hybrid activation and stores
// the ActivationId, region, and ActivationCode (SecureString) in Parameter Store.
// Consolidated into one handler so cr.Provider can use a dedicated Lambda, avoiding the
// cr.AwsCustomResource stack-level singleton that shares the execution role with every
// other AwsCustomResource in the same stack.
const HANDLER_CODE = `
import boto3
import datetime
import os
from botocore.exceptions import ClientError

def handler(event, context):
    request_type = event['RequestType']
    props = event['ResourceProperties']
    physical_id = event.get('PhysicalResourceId', 'INITIAL')
    ssm = boto3.client('ssm')
    param_prefix = props['ParamPrefix']

    if request_type == 'Delete':
        if physical_id and physical_id != 'INITIAL':
            try:
                ssm.delete_activation(ActivationId=physical_id)
            except ClientError as e:
                if e.response['Error']['Code'] not in ('InvalidActivation', 'InvalidActivationId'):
                    raise
        for suffix in ['/id', '/region', '/code']:
            try:
                ssm.delete_parameter(Name=param_prefix + suffix)
            except ClientError as e:
                if e.response['Error']['Code'] != 'ParameterNotFound':
                    raise
        return {'PhysicalResourceId': physical_id}

    # Update: delete the old activation before creating a new one (rotation).
    if request_type == 'Update' and physical_id and physical_id != 'INITIAL':
        try:
            ssm.delete_activation(ActivationId=physical_id)
        except ClientError as e:
            if e.response['Error']['Code'] not in ('InvalidActivation', 'InvalidActivationId'):
                raise

    expiry = datetime.datetime.utcnow() + datetime.timedelta(days=29)
    create_kwargs = {
        'Description': props['Description'],
        'IamRole': props['IamRole'],
        'RegistrationLimit': int(props.get('RegistrationLimit', '50')),
        'ExpirationDate': expiry,
    }
    tags = props.get('Tags')
    if tags:
        create_kwargs['Tags'] = tags

    result = ssm.create_activation(**create_kwargs)
    activation_id = result['ActivationId']
    activation_code = result['ActivationCode']

    ssm.put_parameter(
        Name=param_prefix + '/id',
        Value=activation_id,
        Type='String',
        Description='SSM hybrid activation ID',
        Overwrite=True,
    )
    ssm.put_parameter(
        Name=param_prefix + '/region',
        Value=os.environ.get('AWS_REGION', ''),
        Type='String',
        Description='AWS region for SSM hybrid activation',
        Overwrite=True,
    )

    put_code_kwargs = dict(
        Name=param_prefix + '/code',
        Value=activation_code,
        Type='SecureString',
        Description='SSM hybrid activation code',
        Overwrite=True,
    )
    key_id = props.get('KeyId')
    if key_id:
        put_code_kwargs['KeyId'] = key_id
    ssm.put_parameter(**put_code_kwargs)

    return {'PhysicalResourceId': activation_id}
`;

/**
 * Creates and rotates an SSM hybrid activation for on-premises or non-EC2 instance registration.
 *
 * Instances registered via hybrid activation appear in SSM as managed instances (mi-*).
 * On first use, run the SSM registration script on the instance, fetching credentials from
 * Parameter Store using paramPrefix. Redeploy the parent stack to rotate the activation
 * (activations expire after 30 days).
 *
 * The activation ID and region are stored as standard String parameters.
 * The activation code is stored as a SecureString parameter.
 */
export class SsmHybridActivation extends ExtendedConstruct {
  /**
   * IAM role assigned to instances registered via this hybrid activation.
   * Attach additional managed policies to grant permissions required by
   * State Manager associations running on hybrid-activated instances.
   */
  readonly hybridActivationRole: iam.Role;

  /**
   * Parameter Store path prefix where activation credentials are stored.
   * Activation ID, region, and encrypted code are stored under this prefix.
   */
  readonly paramPrefix: string;

  constructor(scope: Construct, id: string, props: SsmHybridActivationProps) {
    super(scope, id, {
      standardTags: StandardTags.merge(props.standardTags, LibStandardTags),
    });

    const stack = Stack.of(this);
    this.paramPrefix = props.paramPrefix;

    // SSM service role — instances registered via this activation assume this role.
    this.hybridActivationRole = new iam.Role(this, 'HybridActivationRole', {
      roleName: props.roleName,
      assumedBy: new iam.ServicePrincipal('ssm.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'AmazonSSMManagedInstanceCore',
        ),
      ],
    });

    const policyStatements: iam.PolicyStatement[] = [
      new iam.PolicyStatement({
        sid: 'AllowSsmActivation',
        effect: iam.Effect.ALLOW,
        actions: props.activationTags
          ? [
              'ssm:CreateActivation',
              'ssm:DeleteActivation',
              'ssm:AddTagsToResource',
            ]
          : ['ssm:CreateActivation', 'ssm:DeleteActivation'],
        resources: ['*'],
      }),
      new iam.PolicyStatement({
        sid: 'AllowPassHybridActivationRole',
        effect: iam.Effect.ALLOW,
        actions: ['iam:PassRole'],
        resources: [this.hybridActivationRole.roleArn],
      }),
      new iam.PolicyStatement({
        sid: 'AllowSsmActivationParam',
        effect: iam.Effect.ALLOW,
        actions: ['ssm:PutParameter', 'ssm:DeleteParameter'],
        resources: [
          `arn:aws:ssm:${stack.region}:${stack.account}:parameter${props.paramPrefix}/*`,
        ],
      }),
    ];

    if (props.encryptionKey) {
      policyStatements.push(
        new iam.PolicyStatement({
          sid: 'AllowKmsForActivationParam',
          effect: iam.Effect.ALLOW,
          actions: [
            'kms:Encrypt',
            'kms:GenerateDataKey',
            'kms:Decrypt',
            'kms:DescribeKey',
          ],
          resources: [props.encryptionKey.keyArn],
        }),
      );
    }

    const lambdaRole = new iam.Role(this, 'Role', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSLambdaBasicExecutionRole',
        ),
        new iam.ManagedPolicy(this, 'Policy', {statements: policyStatements}),
      ],
    });

    // Use cr.Provider (dedicated Lambda per instance) rather than cr.AwsCustomResource
    // (stack-level singleton) to ensure this construct's IAM role is actually used.
    const onEventHandler = new lambda.Function(this, 'Fn', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      role: lambdaRole,
      timeout: Duration.seconds(60),
      code: lambda.Code.fromInline(HANDLER_CODE),
    });

    const provider = new cr.Provider(this, 'Provider', {
      onEventHandler,
    });

    const activationTagList = props.activationTags
      ? Object.entries(props.activationTags).map(([Key, Value]) => ({
          Key,
          Value,
        }))
      : undefined;

    new CustomResource(this, 'Activation', {
      serviceToken: provider.serviceToken,
      resourceType: 'Custom::SsmHybridActivation',
      properties: {
        Description: props.description,
        IamRole: this.hybridActivationRole.roleName,
        RegistrationLimit: String(props.registrationLimit ?? 50),
        ParamPrefix: props.paramPrefix,
        ...(activationTagList ? {Tags: activationTagList} : {}),
        ...(props.encryptionKey ? {KeyId: props.encryptionKey.keyArn} : {}),
        // Nonce ensures CloudFormation sees a change on every deploy, rotating the activation.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Nonce: (new Date() as any).toISOString(),
      },
    });
  }
}
