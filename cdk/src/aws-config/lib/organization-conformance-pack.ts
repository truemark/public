import {Construct} from 'constructs';
import {CfnOrganizationConformancePack} from 'aws-cdk-lib/aws-config';
import {getConformancePackTemplateUrl} from './conformance-pack-templates';
import {CustomResource, Duration} from 'aws-cdk-lib';
import {Provider} from 'aws-cdk-lib/custom-resources';
import {
  Runtime,
  Code,
  Function as LambdaFunction,
} from 'aws-cdk-lib/aws-lambda';
import {ConformancePackProps} from './conformance-pack';

/**
 * Properties for OrganizationConformancePack construct.
 */
export interface OrganizationConformancePackProps extends ConformancePackProps {
  /**
   * AWS accounts to exclude from the conformance pack.
   * @default - No excluded accounts
   */
  readonly excludedAccounts?: string[];
}

/**
 * AWS Config Organization Conformance Pack.
 *
 * This construct creates an AWS Config organization conformance pack that deploys
 * a set of AWS Config rules and remediation actions across all accounts in an
 * AWS Organization to evaluate compliance with a specific framework or standard.
 *
 * Note: This requires AWS Organizations to be set up and the management account
 * to have the necessary permissions.
 *
 * @example
 * ```ts
 * new OrganizationConformancePack(this, 'OrgHipaaConformancePack', {
 *   packName: 'hipaa',
 *   deliveryBucketName: 'my-org-config-bucket',
 *   excludedAccounts: ['123456789012'],
 * });
 * ```
 */
export class OrganizationConformancePack extends Construct {
  /**
   * The underlying CfnOrganizationConformancePack resource.
   */
  public readonly conformancePack: CfnOrganizationConformancePack;

  /**
   * The name of the organization conformance pack (with prefix if provided).
   */
  public readonly conformancePackName: string;

  /**
   * The name of the organization conformance pack (CloudFormation Ref returns the name, not ARN).
   * Use this as the logical ID for the conformance pack.
   */
  public readonly conformancePackId: string;

  constructor(
    scope: Construct,
    id: string,
    props: OrganizationConformancePackProps,
  ) {
    super(scope, id);

    this.conformancePackName = `${props.packNamePrefix ?? ''}${props.packName}`;

    // Prepare input parameters
    const inputParameters = props.inputParameters
      ? Object.entries(props.inputParameters).map(
          ([parameterName, parameterValue]) => ({
            parameterName,
            parameterValue: String(parameterValue),
          }),
        )
      : undefined;

    // Determine delivery bucket configuration
    const deliveryBucketName =
      props.deliveryBucket?.bucketName ?? props.deliveryBucketName;

    // If no template body is provided, we need to fetch it
    if (!props.templateBody) {
      // Create a custom resource to fetch the template
      const fetchTemplateLambda = new LambdaFunction(this, 'FetchTemplate', {
        runtime: Runtime.NODEJS_20_X,
        handler: 'index.handler',
        code: Code.fromInline(`
const https = require('https');

exports.handler = async (event) => {
  console.log('Request:', JSON.stringify(event, null, 2));

  if (event.RequestType === 'Delete') {
    return sendResponse(event, 'SUCCESS', {});
  }

  const url = event.ResourceProperties.TemplateUrl;

  try {
    const template = await fetchTemplate(url);
    const responseData = {
      TemplateBody: template
    };
    return sendResponse(event, 'SUCCESS', responseData);
  } catch (error) {
    console.error('Error fetching template:', error);
    return sendResponse(event, 'FAILED', {}, error.message);
  }
};

function fetchTemplate(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(data);
        } else {
          reject(new Error(\`HTTP \${res.statusCode}: \${data}\`));
        }
      });
    }).on('error', reject);
  });
}

function sendResponse(event, responseStatus, responseData, reason) {
  return {
    Status: responseStatus,
    Reason: reason || 'See CloudWatch logs',
    PhysicalResourceId: event.PhysicalResourceId || event.LogicalResourceId,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: responseData
  };
}
        `),
        timeout: Duration.seconds(30),
      });

      const provider = new Provider(this, 'FetchTemplateProvider', {
        onEventHandler: fetchTemplateLambda,
      });

      const templateUrl =
        props.templateS3Uri ??
        getConformancePackTemplateUrl(
          props.packName,
          props.templateVersion,
          props.templateRepositoryUrl,
        );

      const fetchedTemplate = new CustomResource(this, 'FetchedTemplate', {
        serviceToken: provider.serviceToken,
        properties: {
          TemplateUrl: templateUrl,
        },
      });

      this.conformancePack = new CfnOrganizationConformancePack(
        this,
        'Resource',
        {
          organizationConformancePackName: this.conformancePackName,
          templateBody: fetchedTemplate.getAttString('TemplateBody'),
          deliveryS3Bucket: deliveryBucketName,
          deliveryS3KeyPrefix: deliveryBucketName
            ? (props.deliveryS3KeyPrefix ?? 'config')
            : undefined,
          conformancePackInputParameters: inputParameters,
          excludedAccounts: props.excludedAccounts,
        },
      );

      this.conformancePack.node.addDependency(fetchedTemplate);
    } else {
      // Use provided template body directly
      this.conformancePack = new CfnOrganizationConformancePack(
        this,
        'Resource',
        {
          organizationConformancePackName: this.conformancePackName,
          templateBody: props.templateBody,
          deliveryS3Bucket: deliveryBucketName,
          deliveryS3KeyPrefix: deliveryBucketName
            ? (props.deliveryS3KeyPrefix ?? 'config')
            : undefined,
          conformancePackInputParameters: inputParameters,
          excludedAccounts: props.excludedAccounts,
        },
      );
    }

    this.conformancePackId = this.conformancePack.ref;
  }
}
