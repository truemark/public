import {ARecord, ARecordProps, CfnRecordSet} from 'aws-cdk-lib/aws-route53';
import {Construct} from 'constructs';
import {Stack} from 'aws-cdk-lib';

/**
 * Options for LatencyARecord.
 */
export interface LatencyARecordOptions {
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
 * Properties for LatencyARecord.
 */
export interface LatencyARecordProps
  extends ARecordProps, LatencyARecordOptions {}

/**
 * An extended ARecord that performs latency based routing.
 */
export class LatencyARecord extends ARecord {
  /**
   * Creates a new LatencyARecord.
   */
  constructor(scope: Construct, id: string, props: LatencyARecordProps) {
    super(scope, id, props);
    const rs = this.node.defaultChild as CfnRecordSet;
    rs.region = props.region ?? Stack.of(this).region;
    rs.setIdentifier = props.setIdentifier ?? Stack.of(this).region;
    rs.healthCheckId = props.healthCheckId;
  }
}
