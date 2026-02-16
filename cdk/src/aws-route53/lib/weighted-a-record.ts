import {ARecord, ARecordProps, CfnRecordSet} from 'aws-cdk-lib/aws-route53';
import {Construct} from 'constructs';
import {Stack} from 'aws-cdk-lib';

/**
 * Options for WeightedARecord
 */
export interface WeightedARecordOptions {
  /**
   * Weight for the record
   *
   * @default 0
   */
  readonly weight?: number;

  /**
   * The identifier to use for the record.
   *
   * @default Stack.of(this).region
   */
  readonly setIdentifier?: string;

  /**
   * ID of the health check to apply to this record.
   */
  readonly healthCheckId?: string;
}

/**
 * Properties for WeightedARecord.
 */
export interface WeightedARecordProps
  extends ARecordProps, WeightedARecordOptions {}

/**
 * An extended ARecord that performs weight based routing.
 */
export class WeightedARecord extends ARecord {
  /**
   * Creates a new WeightedARecord.
   */
  constructor(scope: Construct, id: string, props: WeightedARecordProps) {
    super(scope, id, props);
    const rs = this.node.defaultChild as CfnRecordSet;
    rs.weight = props.weight ?? 0;
    rs.setIdentifier = props.setIdentifier ?? Stack.of(this).region;
    rs.healthCheckId = props.healthCheckId;
  }
}
