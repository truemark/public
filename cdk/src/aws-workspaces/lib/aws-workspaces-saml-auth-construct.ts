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
 * Properties for AwsWorkspacesSamlAuth.
 */
export interface AwsWorkspacesSamlAuthProps extends ExtendedConstructProps {
  /**
   * ID of the WorkSpaces directory to configure SAML authentication on.
   */
  readonly directoryId: string;

  /**
   * The URL to the identity provider's SAML assertion consumer service (ACS)
   * endpoint. WorkSpaces redirects users here to initiate SAML authentication.
   */
  readonly userAccessUrl: string;

  /**
   * The name of the parameter used to pass the relay state in the SAML request.
   *
   * @default 'RelayState'
   */
  readonly relayStateParameterName?: string;

  /**
   * Whether directory login is available as a fallback when SAML authentication
   * fails. Use ENABLED_WITH_DIRECTORY_LOGIN_FALLBACK during IdP testing to
   * retain access if the SAML configuration is misconfigured.
   *
   * @default 'ENABLED'
   */
  readonly status?: 'ENABLED' | 'ENABLED_WITH_DIRECTORY_LOGIN_FALLBACK';
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
            workspaces.modify_saml_properties(
                ResourceId=directory_id,
                SamlProperties={'Status': 'DISABLED'},
            )
        except ClientError as e:
            if e.response['Error']['Code'] not in (
                'ResourceNotFoundException',
                'InvalidResourceStateException',
            ):
                raise
        return {'PhysicalResourceId': directory_id}

    workspaces.modify_saml_properties(
        ResourceId=directory_id,
        SamlProperties={
            'UserAccessUrl': props['UserAccessUrl'],
            'RelayStateParameterName': props['RelayStateParameterName'],
            'Status': props['Status'],
        },
    )
    return {'PhysicalResourceId': directory_id}
`;

/**
 * Configures SAML 2.0 federated authentication on a WorkSpaces directory.
 *
 * Delegates workspace login to an external identity provider. The IdP must be
 * configured to issue SAML assertions targeting the WorkSpaces service.
 *
 * Uses a dedicated Lambda provider (not cr.AwsCustomResource) to ensure the
 * construct's IAM role is isolated from other custom resources in the stack.
 *
 * Callers must add an explicit dependency on the directory registration:
 * ```typescript
 * samlAuth.node.addDependency(directoryRegistration);
 * ```
 *
 * Can be used independently of AwsWorkspaces when SAML configuration is
 * needed in another context.
 */
export class AwsWorkspacesSamlAuth extends ExtendedConstruct {
  constructor(
    scope: Construct,
    id: string,
    props: AwsWorkspacesSamlAuthProps,
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
              sid: 'AllowModifySamlProperties',
              effect: iam.Effect.ALLOW,
              actions: ['workspaces:ModifySamlProperties'],
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
      resourceType: 'Custom::WorkspacesSamlAuth',
      properties: {
        DirectoryId: props.directoryId,
        UserAccessUrl: props.userAccessUrl,
        RelayStateParameterName:
          props.relayStateParameterName ?? 'RelayState',
        Status: props.status ?? 'ENABLED',
      },
    });
  }
}
