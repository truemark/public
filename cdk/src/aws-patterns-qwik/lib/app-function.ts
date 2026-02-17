import {Construct} from 'constructs';
import {ExtendedNodejsFunction} from '../../aws-lambda';
import {
  Architecture,
  Code,
  FunctionUrl,
  FunctionUrlAuthType,
  InvokeMode,
  Runtime,
} from 'aws-cdk-lib/aws-lambda';
import {LambdaDeploymentConfig} from 'aws-cdk-lib/aws-codedeploy';
import {Duration, Fn, RemovalPolicy} from 'aws-cdk-lib';
import {BucketDeploymentConfig, WebsiteBucket} from '../../aws-s3';
import * as path from 'path';
import {CacheControl} from 'aws-cdk-lib/aws-s3-deployment';
import {DomainName} from '../../aws-route53';
import {RetentionDays} from 'aws-cdk-lib/aws-logs';

/**
 * Configuration for the domain name to use for the AppFunction.
 */
export interface DomainConfig {
  /**
   * Prefix to use when creating DNS records for the content bucket.
   */
  readonly contentPrefix: string;
  /**
   * Prefix to use when creating DNS records for the function URL
   */
  readonly functionPrefix: string;
  /**
   * Route53 zone to create DNS records in.
   */
  readonly zone: string;
}

/**
 * Props for AppFunction
 */
export interface AppFunctionProps {
  /**
   * Path to the Qwik application.
   */
  readonly entry: string;
  /**
   * Whether to deploy using canary deployment.
   * @default false
   */
  readonly canaryDeploy: boolean;
  /**
   * Name of the CloudWatch log group to use for the function.
   */
  readonly logGroupName: string;
  /**
   * Number of days to retain logs for the function.
   * @default RetentionDays.ONE_WEEK
   */
  readonly logRetentionDays: RetentionDays;
  /**
   * Environment variables to set on the function.
   */
  readonly environment?: Record<string, string>;
  /**
   * Configuration for the domain name to use for the AppFunction.
   */
  readonly domainConfig: DomainConfig;
  /**
   * Additional content to deploy to the content bucket.
   */
  readonly additionalContent?: BucketDeploymentConfig[];
  /**
   * Memory size for the function.
   * @default 1024
   */
  readonly memorySize?: number;
}

export class AppFunction extends ExtendedNodejsFunction {
  readonly functionUrl: FunctionUrl;
  readonly contentBucket: WebsiteBucket;
  constructor(scope: Construct, id: string, props: AppFunctionProps) {
    super(scope, id, {
      code: Code.fromAsset(path.join(props.entry, 'server')),
      handler: 'entry-aws-lambda.qwikApp',
      memorySize: props.memorySize ?? 1024,
      timeout: Duration.seconds(29),
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      logConfig: {
        logGroupName: props.logGroupName,
        retention: props.logRetentionDays,
      },
      environment: {
        NODE_OPTIONS:
          '--enable-source-maps --experimental-sqlite --no-warnings',
        HOST_HEADER: 'x-forwarded-host',
        PROTOCOL_HEADER: 'x-forwarded-proto',
        ...props.environment,
      },
      createAlarms: false,
      criticalAlarmOptions: {
        maxLogCount: 0,
      },
      warningAlarmOptions: {
        maxLogCount: 0,
      },
      deploymentOptions: {
        createDeployment: true,
        includeCriticalAlarms: false,
        deploymentConfig: props.canaryDeploy
          ? LambdaDeploymentConfig.CANARY_10PERCENT_5MINUTES
          : LambdaDeploymentConfig.ALL_AT_ONCE,
      },
    });

    this.functionUrl = this.deployment!.alias.addFunctionUrl({
      authType: FunctionUrlAuthType.NONE,
      invokeMode: InvokeMode.BUFFERED,
    });

    new DomainName({
      prefix: props.domainConfig.functionPrefix,
      zone: props.domainConfig.zone,
    }).createLatencyCnameRecord(
      this,
      Fn.select(
        0,
        Fn.split('/', Fn.select(1, Fn.split('//', this.functionUrl.url))),
      ),
    );

    this.contentBucket = new WebsiteBucket(this, 'AppContent', {
      removalPolicy: RemovalPolicy.DESTROY,
    });

    new DomainName({
      prefix: props.domainConfig.contentPrefix,
      zone: props.domainConfig.zone,
    }).createLatencyCnameRecord(
      this,
      this.contentBucket.bucketWebsiteDomainName,
    );

    this.contentBucket.deploy([
      {
        source: path.join(props.entry, 'dist'),
        exclude: ['build', 'assets'],
        cacheControl: [
          CacheControl.maxAge(Duration.minutes(1)),
          CacheControl.sMaxAge(Duration.minutes(2)),
        ],
      },
      {
        source: path.join(props.entry, 'dist', 'assets'),
        prefix: 'assets',
        cacheControl: [
          CacheControl.setPublic(),
          CacheControl.maxAge(Duration.seconds(31536000)),
          CacheControl.immutable(),
        ],
      },
      {
        source: path.join(props.entry, 'dist', 'build'),
        prefix: 'build',
        cacheControl: [
          CacheControl.setPublic(),
          CacheControl.maxAge(Duration.seconds(31536000)),
          CacheControl.immutable(),
        ],
      },
      ...(props.additionalContent ?? []),
    ]);
  }
}
