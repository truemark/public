import type {Code} from 'aws-cdk-lib/aws-lambda';
import type {Construct} from 'constructs';
import {ExtendedStack, type ExtendedStackProps} from 'truemark-cdk-lib/aws-cdk';
import {DatabaseCollector} from './database-collector-construct.js';

export interface DatabaseCollectorStackProps extends ExtendedStackProps {
  /** VPC the collector function runs in. */
  readonly vpcId: string;
  /** Subnets the collector function is placed in. */
  readonly subnetIds: string[];
  /** @default 'database-collector:' */
  readonly tagPrefix?: string;
  /** @default 'database_collector' */
  readonly databaseUser?: string;
  /** @default - 'database-collector-' followed by the region */
  readonly roleName?: string;
  /** @default 'DatabaseCollector' */
  readonly metricsNamespace?: string;
  /** @default - the zip built from ../collector */
  readonly collectorCode?: Code;
}

export class DatabaseCollectorStack extends ExtendedStack {
  constructor(
    scope: Construct,
    id: string,
    props: DatabaseCollectorStackProps,
  ) {
    super(scope, id, props);
    const collector = new DatabaseCollector(this, 'DatabaseCollector', {
      vpcId: props.vpcId,
      subnetIds: props.subnetIds,
      tagPrefix: props.tagPrefix,
      databaseUser: props.databaseUser,
      roleName: props.roleName,
      metricsNamespace: props.metricsNamespace,
      collectorCode: props.collectorCode,
    });
    this.outputParameter('Name', 'DatabaseCollector');
    this.outputParameter('RoleArn', collector.collectorRole.roleArn);
    this.outputParameter(
      'SecurityGroupId',
      collector.collectorSecurityGroup.securityGroupId,
    );
  }
}
