import type {SecretValue} from 'aws-cdk-lib';
import * as directoryservice from 'aws-cdk-lib/aws-directoryservice';
import type * as ec2 from 'aws-cdk-lib/aws-ec2';
import type {Construct} from 'constructs';
import {
  ExtendedConstruct,
  type ExtendedConstructProps,
  StandardTags,
} from '../../aws-cdk';
import {LibStandardTags} from '../../truemark';

/**
 * Size of a Simple AD directory. Small supports up to 500 users; Large up to 5,000.
 */
export type SimpleAdSize = 'Small' | 'Large';

/**
 * Properties for SimpleAd.
 */
export interface SimpleAdProps extends ExtendedConstructProps {
  /**
   * Fully qualified domain name for the directory. Example: 'corp.example.com'.
   */
  readonly domainName: string;

  /**
   * Admin password for the directory. Should come from Secrets Manager.
   * Use SecretValue.secretsManager() — do not use unsafePlainText in production.
   */
  readonly password: SecretValue;

  /**
   * VPC the directory controllers are deployed into.
   */
  readonly vpc: ec2.IVpc;

  /**
   * Subnets the directory controllers are placed in. At least two subnets in
   * different Availability Zones are required; only the first two are used.
   */
  readonly subnets: ec2.ISubnet[];

  /**
   * Size of the directory.
   *
   * @default 'Small'
   */
  readonly size?: SimpleAdSize;

  /**
   * Short NetBIOS name for the directory. Example: 'CORP'.
   *
   * @default - derived by AWS from the domain name
   */
  readonly shortName?: string;

  /**
   * A description for the directory.
   *
   * @default - no description
   */
  readonly description?: string;

  /**
   * Whether to enable single sign-on for the directory.
   *
   * @default false
   */
  readonly enableSso?: boolean;
}

/**
 * Creates a Simple AD directory.
 *
 * Wraps the L1 {@link directoryservice.CfnSimpleAD} with TrueMark standard tagging
 * and validation. Simple AD is a Samba-based, lower-cost directory and does not
 * support RADIUS MFA or the Directory Service Data API.
 */
export class SimpleAd extends ExtendedConstruct {
  /**
   * The underlying CloudFormation Simple AD resource.
   */
  readonly simpleAd: directoryservice.CfnSimpleAD;

  /**
   * The directory ID, e.g. 'd-xxxxxxxxxx'.
   */
  readonly directoryId: string;

  constructor(scope: Construct, id: string, props: SimpleAdProps) {
    super(scope, id, {
      standardTags: StandardTags.merge(props.standardTags, LibStandardTags),
    });

    if (props.subnets.length < 2) {
      throw new Error(
        'At least 2 subnets in different AZs are required for Simple AD',
      );
    }

    this.simpleAd = new directoryservice.CfnSimpleAD(this, 'Resource', {
      name: props.domainName,
      // unsafeUnwrap is required — CfnSimpleAD expects a plain string, not a SecretValue token
      password: props.password.unsafeUnwrap(),
      size: props.size ?? 'Small',
      vpcSettings: {
        vpcId: props.vpc.vpcId,
        subnetIds: props.subnets.slice(0, 2).map((subnet) => subnet.subnetId),
      },
      shortName: props.shortName,
      description: props.description,
      enableSso: props.enableSso ?? false,
    });
    this.directoryId = this.simpleAd.ref;
  }
}
