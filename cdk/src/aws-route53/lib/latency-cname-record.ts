import {Stack} from 'aws-cdk-lib';
import {
  CfnRecordSet,
  CnameRecord,
  CnameRecordProps,
} from 'aws-cdk-lib/aws-route53';
import {Construct} from 'constructs';

/**
 * Options for LatencyCnameRecord.
 */
export interface LatencyCnameRecordOptions {
  /**
   * The region to use for the record. Default is the region of the stack.
   */
  readonly region?: string;

  /**
   * The identifier to use for the record. Default is the region of the stack.
   */
  readonly setIdentifier?: string;

  /**
   * ID of the health check to apply to this record.
   */
  readonly healthCheckId?: string;
}

/**
 * Properties for LatencyCnameRecord.
 */
export interface LatencyCnameRecordProps
  extends CnameRecordProps, LatencyCnameRecordOptions {}

/**
 * An extended CnameRecord that performs latency based routing.
 */
export class LatencyCnameRecord extends CnameRecord {
  /**
   * Creates a new LatencyCnameRecord.
   */
  constructor(scope: Construct, id: string, props: LatencyCnameRecordProps) {
    super(scope, id, props);
    const rs = this.node.defaultChild as CfnRecordSet;
    rs.region = props.region ?? Stack.of(this).region;
    rs.setIdentifier = props.setIdentifier ?? Stack.of(this).region;
    rs.healthCheckId = props.healthCheckId;
  }
}
