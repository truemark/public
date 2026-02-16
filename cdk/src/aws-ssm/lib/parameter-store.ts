import {Stack} from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {StringParameter} from 'aws-cdk-lib/aws-ssm';
import {ParameterReader} from './parameter-reader';

/**
 * Properties for ParameterStore
 */
export interface ParameterStoreOptions {
  readonly prefix?: string;
  readonly suffix?: string;
  readonly region?: string;
}

/**
 * Utility construct to ease reading and writing parameters with cross-region read support.
 */
export class ParameterStore extends Construct {
  /**
   * The region in which to access the parameters.
   */
  readonly region: string;

  /**
   * The prefix on parameters read and written by this store.
   */
  readonly prefix: string;

  /**
   * The prefix used on identifiers.
   */
  readonly identifierPrefix: string;

  /**
   * The suffix on parameters read and written by this store.
   */
  readonly suffix: string;

  /**
   * The suffix used on identifiers.
   */
  readonly identifierSuffix: string;

  constructor(scope: Construct, id: string, props?: ParameterStoreOptions) {
    super(scope, id);
    this.prefix = props?.prefix ?? '';
    this.identifierPrefix =
      this.prefix.replace(/\//, '-') + (this.prefix === '' ? '' : '-');
    this.suffix = props?.suffix ?? '';
    this.identifierSuffix =
      (this.suffix === '' ? '' : '-') + this.suffix.replace(/\//, '-');
    this.region = props?.region ?? Stack.of(this).region;
  }

  regionMatch(): boolean {
    return this.region === Stack.of(this).region;
  }

  protected readLocal(name: string): string {
    return StringParameter.valueForStringParameter(
      this,
      this.prefix + name + this.suffix,
    );
  }

  protected readRemote(name: string): string {
    return new ParameterReader(
      this,
      this.identifierPrefix + name + this.identifierSuffix,
      {
        parameterName: this.prefix + name + this.suffix,
        region: this.region,
      },
    ).getStringValue();
  }

  /**
   * Reads an SSM parameter from a local or remote region.
   *
   * @param name the name of the parameter to read
   */
  read(name: string): string {
    return this.regionMatch() ? this.readLocal(name) : this.readRemote(name);
  }

  /**
   * Creates a new SSM parameter in the local region.
   *
   * @param name the name of the parameter
   * @param value the value to store
   */
  write(name: string, value: string): StringParameter {
    if (!this.regionMatch()) {
      throw new Error('Cannot write to a different region');
    }
    return new StringParameter(
      this,
      this.identifierPrefix + name + this.identifierSuffix,
      {
        parameterName: this.prefix + name + this.suffix,
        stringValue: value,
      },
    );
  }
}
