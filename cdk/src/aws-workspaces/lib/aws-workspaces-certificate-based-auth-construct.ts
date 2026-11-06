import {CustomResource, Duration} from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
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
 * Properties for AwsWorkspacesCertificateBasedAuth.
 */
export interface AwsWorkspacesCertificateBasedAuthProps
  extends ExtendedConstructProps {
  /**
   * ID of the WorkSpaces directory to configure certificate-based auth on.
   */
  readonly directoryId: string;

  /**
   * ARN of the ACM Private Certificate Authority used to issue WorkSpaces
   * client certificates. The CA must already exist and be in ACTIVE state
   * before deployment.
   */
  readonly certificateAuthorityArn: string;
}

const HANDLER_CODE = `
import boto3
from botocore.exceptions import ClientError

def handler(event, context):
    request_type = event['RequestType']
    props = event['ResourceProperties']
    directory_id = props['DirectoryId']
    workspaces = boto3.client('workspaces')

    if request_type == 'Delete':
        try:
            workspaces.modify_certificate_based_auth_properties(
                ResourceId=directory_id,
                CertificateBasedAuthProperties={'Status': 'DISABLED'},
                PropertiesToDelete=[
                    'CERTIFICATE_BASED_AUTH_PROPERTIES_CERTIFICATE_AUTHORITY_ARN'
                ],
            )
        except ClientError as e:
            if e.response['Error']['Code'] not in (
                'ResourceNotFoundException',
                'InvalidResourceStateException',
            ):
                raise
        return {'PhysicalResourceId': directory_id}

    workspaces.modify_certificate_based_auth_properties(
        ResourceId=directory_id,
        CertificateBasedAuthProperties={
            'CertificateAuthorityArn': props['CertificateAuthorityArn'],
            'Status': 'ENABLED',
        },
    )
    return {'PhysicalResourceId': directory_id}
`;

/**
 * Configures certificate-based authentication on a WorkSpaces directory.
 *
 * Enables smart card or device certificate login via an ACM Private CA.
 * Requires an ACM Private CA and an AWS Managed Microsoft AD directory.
 *
 * Uses a dedicated Lambda provider (not cr.AwsCustomResource) to ensure the
 * construct's IAM role is isolated from other custom resources in the stack.
 *
 * Callers must add an explicit dependency on the directory registration:
 * ```typescript
 * certAuth.node.addDependency(directoryRegistration);
 * ```
 *
 * Can be used independently of AwsWorkspaces when certificate-based auth
 * configuration is needed in another context.
 */
export class AwsWorkspacesCertificateBasedAuth extends ExtendedConstruct {
  constructor(
    scope: Construct,
    id: string,
    props: AwsWorkspacesCertificateBasedAuthProps,
  ) {
    super(scope, id, {
      standardTags: StandardTags.merge(props.standardTags, LibStandardTags),
    });

    const role = new iam.Role(this, 'Role', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSLambdaBasicExecutionRole',
        ),
        new iam.ManagedPolicy(this, 'Policy', {
          statements: [
            new iam.PolicyStatement({
              sid: 'AllowModifyCertBasedAuth',
              effect: iam.Effect.ALLOW,
              actions: ['workspaces:ModifyCertificateBasedAuthProperties'],
              resources: ['*'],
            }),
          ],
        }),
      ],
    });

    const onEventHandler = new lambda.Function(this, 'Fn', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      role,
      timeout: Duration.seconds(60),
      code: lambda.Code.fromInline(HANDLER_CODE),
    });

    const provider = new cr.Provider(this, 'Provider', {onEventHandler});

    new CustomResource(this, 'Resource', {
      serviceToken: provider.serviceToken,
      resourceType: 'Custom::WorkspacesCertificateBasedAuth',
      properties: {
        DirectoryId: props.directoryId,
        CertificateAuthorityArn: props.certificateAuthorityArn,
      },
    });
  }
}
