import {Construct} from 'constructs';
import {
  CfnConfigurationRecorder,
  CfnDeliveryChannel,
} from 'aws-cdk-lib/aws-config';
import {IBucket} from 'aws-cdk-lib/aws-s3';

/**
 * Properties for ConfigRecorder construct.
 */
export interface ConfigRecorderProps {
  /**
   * The name for the AWS Config configuration recorder.
   * @default 'default'
   */
  readonly recorderName?: string;

  /**
   * IAM role ARN for AWS Config configuration recorder.
   * This role must have permissions to record configuration changes.
   */
  readonly roleArn: string;

  /**
   * Whether to record all supported resource types.
   * @default true
   */
  readonly recordAllSupported?: boolean;

  /**
   * Whether to include global resource types.
   * @default true
   */
  readonly includeGlobalResourceTypes?: boolean;
}

/**
 * AWS Config Configuration Recorder.
 *
 * This construct creates an AWS Config configuration recorder that records
 * configuration changes for AWS resources.
 */
export class ConfigRecorder extends Construct {
  /**
   * The underlying CfnConfigurationRecorder resource.
   */
  public readonly recorder: CfnConfigurationRecorder;

  /**
   * The name of the configuration recorder.
   */
  public readonly recorderName: string;

  constructor(scope: Construct, id: string, props: ConfigRecorderProps) {
    super(scope, id);

    // Validate recordAllSupported configuration
    if (props.recordAllSupported === false) {
      throw new Error(
        'When recordAllSupported is false, you must specify which resource types to record. ' +
          'This is not yet supported by this construct. Please use recordAllSupported: true ' +
          'or use CfnConfigurationRecorder directly with custom recordingGroup configuration.',
      );
    }

    this.recorderName = props.recorderName ?? 'default';

    this.recorder = new CfnConfigurationRecorder(this, 'Resource', {
      name: this.recorderName,
      roleArn: props.roleArn,
      recordingGroup: {
        allSupported: props.recordAllSupported ?? true,
        includeGlobalResourceTypes: props.includeGlobalResourceTypes ?? true,
      },
    });
  }
}

/**
 * Properties for DeliveryChannel construct.
 */
export interface DeliveryChannelProps {
  /**
   * The name for the AWS Config delivery channel.
   * @default 'default'
   */
  readonly channelName?: string;

  /**
   * S3 bucket for AWS Config delivery channel.
   * Either bucket or bucketName must be provided.
   */
  readonly bucket?: IBucket;

  /**
   * Name of the S3 bucket for AWS Config delivery channel.
   * Either bucket or bucketName must be provided.
   */
  readonly bucketName?: string;

  /**
   * S3 key prefix for AWS Config delivery channel.
   * @default 'config'
   */
  readonly s3KeyPrefix?: string;

  /**
   * The SNS topic ARN to send notifications to.
   * @default - No SNS notifications
   */
  readonly snsTopicArn?: string;
}

/**
 * AWS Config Delivery Channel.
 *
 * This construct creates an AWS Config delivery channel that delivers
 * configuration snapshots and configuration history files to an S3 bucket.
 */
export class DeliveryChannel extends Construct {
  /**
   * The underlying CfnDeliveryChannel resource.
   */
  public readonly channel: CfnDeliveryChannel;

  /**
   * The name of the delivery channel.
   */
  public readonly channelName: string;

  constructor(scope: Construct, id: string, props: DeliveryChannelProps) {
    super(scope, id);

    if (!props.bucket && !props.bucketName) {
      throw new Error('Either bucket or bucketName must be provided');
    }

    this.channelName = props.channelName ?? 'default';
    const bucketName = props.bucket?.bucketName ?? props.bucketName!;

    this.channel = new CfnDeliveryChannel(this, 'Resource', {
      name: this.channelName,
      s3BucketName: bucketName,
      s3KeyPrefix: props.s3KeyPrefix ?? 'config',
      snsTopicArn: props.snsTopicArn,
    });
  }
}
