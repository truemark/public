import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {Duration} from 'aws-cdk-lib';
import type {ISecurityGroup, IVpc, SubnetSelection} from 'aws-cdk-lib/aws-ec2';
import type {IRole} from 'aws-cdk-lib/aws-iam';
import {
  Alias,
  Architecture,
  Code,
  LoggingFormat,
  Runtime,
  SnapStartConf,
} from 'aws-cdk-lib/aws-lambda';
import type {Construct} from 'constructs';
import {ExtendedFunction} from 'truemark-cdk-lib/aws-lambda';

/** Deployment package produced by `pnpm build` in ../collector. */
const COLLECTOR_ZIP = join(
  import.meta.dirname,
  '..',
  '..',
  'collector',
  'build',
  'distributions',
  'collector.zip',
);

export interface CollectorFunctionProps {
  readonly role: IRole;
  readonly vpc: IVpc;
  readonly vpcSubnets: SubnetSelection;
  readonly securityGroups: ISecurityGroup[];
  /**
   * CloudWatch namespace the collected metrics are published under. An empty
   * string writes the same structured logs without publishing metrics.
   */
  readonly metricsNamespace: string;
  /** Bucket custom query sets are read from. */
  readonly querySetBucketName: string;
  /** SSM Parameter Store path custom query sets are read from. */
  readonly querySetParameterPath: string;
  /**
   * Overrides the deployment package.
   *
   * @default - the zip built from ../collector
   */
  readonly code?: Code;
}

/**
 * Java function that connects to one database per invocation over JDBC and
 * writes its metrics as structured logs.
 *
 * SnapStart only applies to published versions, so callers must invoke
 * {@link alias} and never the unqualified function.
 */
export class CollectorFunction extends ExtendedFunction {
  /** Alias pointing at the current SnapStart-enabled version. */
  readonly alias: Alias;

  constructor(scope: Construct, id: string, props: CollectorFunctionProps) {
    super(scope, id, {
      // Must match the toolchain version in ../collector/build.gradle.kts
      runtime: Runtime.JAVA_25,
      architecture: Architecture.ARM_64,
      handler: 'io.truemark.databasecollector.Handler::handleRequest',
      code: props.code ?? CollectorFunction.defaultCode(),
      snapStart: SnapStartConf.ON_PUBLISHED_VERSIONS,
      memorySize: 1024,
      // Collections run once per minute, so one must finish before the next.
      timeout: Duration.seconds(50),
      role: props.role,
      vpc: props.vpc,
      vpcSubnets: props.vpcSubnets,
      securityGroups: props.securityGroups,
      // Each line the function writes is already a JSON document in the
      // CloudWatch embedded metric format, which must reach the log
      // unwrapped for CloudWatch to extract the metrics.
      loggingFormat: LoggingFormat.TEXT,
      environment: {
        METRICS_NAMESPACE: props.metricsNamespace,
        QUERY_SET_BUCKET: props.querySetBucketName,
        QUERY_SET_PARAMETER_PATH: props.querySetParameterPath,
      },
    });

    this.alias = new Alias(this, 'LiveAlias', {
      aliasName: 'live',
      version: this.currentVersion,
      // EventBridge Scheduler invokes the alias asynchronously. A retried or
      // queued collection would land in a later minute and duplicate that
      // minute's metrics, so failed or delayed events are dropped instead.
      retryAttempts: 0,
      maxEventAge: Duration.seconds(60),
    });
  }

  private static defaultCode(): Code {
    if (!existsSync(COLLECTOR_ZIP)) {
      throw new Error(
        `${COLLECTOR_ZIP} does not exist. Run "pnpm build" in database-collector/collector first.`,
      );
    }
    return Code.fromAsset(COLLECTOR_ZIP);
  }
}
