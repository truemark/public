import {Construct} from 'constructs';
import {CfnConformancePack} from 'aws-cdk-lib/aws-config';
import {IBucket} from 'aws-cdk-lib/aws-s3';
import {getConformancePackTemplateUrl} from './conformance-pack-templates';
import {CustomResource, Duration} from 'aws-cdk-lib';
import {Provider} from 'aws-cdk-lib/custom-resources';
import {
  Runtime,
  Code,
  Function as LambdaFunction,
} from 'aws-cdk-lib/aws-lambda';

/**
 * Input parameters for a conformance pack.
 */
export interface ConformancePackInputParameters {
  [key: string]: string;
}

/**
 * Properties for ConformancePack construct.
 */
export interface ConformancePackProps {
  /**
   * The name of the conformance pack. This should be one of the predefined
   * pack names from CONFORMANCE_PACK_TEMPLATES or a custom name if providing
   * a custom template.
   */
  readonly packName: string;

  /**
   * Optional prefix to add to the conformance pack name.
   * @default - No prefix
   */
  readonly packNamePrefix?: string;

  /**
   * Custom template body for the conformance pack.
   * If not provided, the template will be fetched from AWS Labs repository
   * based on the packName.
   * @default - Fetches template from AWS Labs repository
   */
  readonly templateBody?: string;

  /**
   * Template URL for the conformance pack.
   * If not provided and templateBody is not provided, it will be constructed
   * from the packName.
   * @default - Constructed from packName
   */
  readonly templateS3Uri?: string;

  /**
   * Template version to use (commit hash, tag, or 'latest').
   * Only used if templateBody is not provided.
   * @default 'latest'
   */
  readonly templateVersion?: string;

  /**
   * Base URL for the conformance pack templates repository.
   * @default 'https://raw.githubusercontent.com/awslabs/aws-config-rules'
   */
  readonly templateRepositoryUrl?: string;

  /**
   * Input parameters for the conformance pack.
   * @default - No input parameters
   */
  readonly inputParameters?: ConformancePackInputParameters;

  /**
   * S3 bucket for AWS Config delivery.
   * @default - No S3 bucket for delivery
   */
  readonly deliveryBucket?: IBucket;

  /**
   * Name of the S3 bucket for AWS Config delivery.
   * @default - No S3 bucket for delivery
   */
  readonly deliveryBucketName?: string;

  /**
   * S3 key prefix for AWS Config delivery channel.
   * @default 'config'
   */
  readonly deliveryS3KeyPrefix?: string;
}

/**
 * AWS Config Conformance Pack for account-level deployment.
 *
 * This construct creates an AWS Config conformance pack that deploys
 * a set of AWS Config rules and remediation actions to evaluate
 * compliance with a specific framework or standard.
 *
 * @example
 * ```ts
 * new ConformancePack(this, 'HipaaConformancePack', {
 *   packName: 'hipaa',
 *   deliveryBucketName: 'my-config-bucket',
 * });
 * ```
 */
export class ConformancePack extends Construct {
  /**
   * The underlying CfnConformancePack resource.
   */
  public readonly conformancePack: CfnConformancePack;

  /**
   * The name of the conformance pack (with prefix if provided).
   */
  public readonly conformancePackName: string;

  /**
   * The ARN of the conformance pack.
   */
  public readonly conformancePackArn: string;

  constructor(scope: Construct, id: string, props: ConformancePackProps) {
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

      this.conformancePack = new CfnConformancePack(this, 'Resource', {
        conformancePackName: this.conformancePackName,
        templateBody: fetchedTemplate.getAttString('TemplateBody'),
        deliveryS3Bucket: deliveryBucketName,
        deliveryS3KeyPrefix: deliveryBucketName
          ? (props.deliveryS3KeyPrefix ?? 'config')
          : undefined,
        conformancePackInputParameters: inputParameters,
      });

      this.conformancePack.node.addDependency(fetchedTemplate);
    } else {
      // Use provided template body directly
      this.conformancePack = new CfnConformancePack(this, 'Resource', {
        conformancePackName: this.conformancePackName,
        templateBody: props.templateBody,
        deliveryS3Bucket: deliveryBucketName,
        deliveryS3KeyPrefix: deliveryBucketName
          ? (props.deliveryS3KeyPrefix ?? 'config')
          : undefined,
        conformancePackInputParameters: inputParameters,
      });
    }

    this.conformancePackArn = this.conformancePack.ref;
  }
}
