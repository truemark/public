import {RetentionDays} from 'aws-cdk-lib/aws-logs';
import {RemovalPolicy} from 'aws-cdk-lib';
import {IKey} from 'aws-cdk-lib/aws-kms';

/**
 * Standard log configuration for ECS services.
 */
export interface LogConfiguration {
  /** Enables logging to CloudWatch. Defaults to true.
   */
  readonly enabled?: boolean;

  /**
   * The KMS customer managed key to encrypt the log group with.
   */
  readonly encryptionKey?: IKey;

  /**
   * Name of the log group. Best practice is to not set this field.
   */
  readonly logGroupName?: string;

  /**
   * How long, in days, the log contents will be retained. Defaults to five days.
   */
  readonly retention?: RetentionDays;

  /**
   * Determine the removal policy of this log group. Defaults to destroy.
   */
  readonly removalPolicy?: RemovalPolicy;
}
