import {
  AliasRecordTargetConfig,
  IAliasRecordTarget,
  IHostedZone,
  IRecordSet,
  RecordTarget,
} from 'aws-cdk-lib/aws-route53';

class AliasRecordTargetWrapper implements IAliasRecordTarget {
  readonly target: IAliasRecordTarget;
  readonly evaluateTargetHealth?: boolean;

  constructor(target: IAliasRecordTarget, evaluateTargetHealth?: boolean) {
    this.target = target;
    this.evaluateTargetHealth = evaluateTargetHealth;
  }

  bind(record: IRecordSet, zone?: IHostedZone): AliasRecordTargetConfig {
    return {
      ...this.target.bind(record, zone),
      evaluateTargetHealth: this.evaluateTargetHealth,
    } as ExtendedAliasRecordTargetConfig;
  }
}

interface ExtendedAliasRecordTargetConfig extends AliasRecordTargetConfig {
  readonly evaluateTargetHealth?: boolean;
}

/**
 * Extends the RecordTarget class providing the ability to set evaluateTargetHealth for alias records.
 */
export class ExtendedRecordTarget extends RecordTarget {
  protected constructor(
    values?: string[],
    aliasTarget?: IAliasRecordTarget,
    evaluateTargetHealth?: boolean,
  ) {
    super(
      values,
      aliasTarget
        ? new AliasRecordTargetWrapper(aliasTarget, evaluateTargetHealth)
        : undefined,
    );
  }

  /**
   * Creates a new RecordTarget from an alias.
   *
   * @param aliasTarget the alias to target
   * @param evaluateTargetHealth determines if Route53 should evaluate target health
   */
  static fromAlias(
    aliasTarget: IAliasRecordTarget,
    evaluateTargetHealth?: boolean,
  ): RecordTarget {
    return new ExtendedRecordTarget(
      undefined,
      aliasTarget,
      evaluateTargetHealth,
    );
  }
}
