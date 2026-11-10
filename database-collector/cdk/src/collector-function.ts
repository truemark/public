import * as fs from 'node:fs';
import * as path from 'node:path';
import {Duration} from 'aws-cdk-lib';
import type {ISecurityGroup, IVpc, SubnetSelection} from 'aws-cdk-lib/aws-ec2';
import type {IRole} from 'aws-cdk-lib/aws-iam';
import {
  Alias,
  Architecture,
  Code,
  Runtime,
  SnapStartConf,
} from 'aws-cdk-lib/aws-lambda';
import type {Construct} from 'constructs';
import {ExtendedFunction} from 'truemark-cdk-lib/aws-lambda';

/** Deployment package produced by `pnpm build` in ../collector. */
const COLLECTOR_ZIP = path.join(
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
    });

    this.alias = new Alias(this, 'LiveAlias', {
      aliasName: 'live',
      version: this.currentVersion,
    });
  }

  private static defaultCode(): Code {
    if (!fs.existsSync(COLLECTOR_ZIP)) {
      throw new Error(
        `${COLLECTOR_ZIP} does not exist. Run "pnpm build" in database-collector/collector first.`,
      );
    }
    return Code.fromAsset(COLLECTOR_ZIP);
  }
}
