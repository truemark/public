import {
  ARecord,
  CnameRecord,
  HostedZone,
  IHostedZone,
  RecordTarget,
} from 'aws-cdk-lib/aws-route53';
import {Construct} from 'constructs';
import {WeightedARecord} from './weighted-a-record';
import {LatencyARecord} from './latency-a-record';
import {
  Certificate,
  CertificateValidation,
} from 'aws-cdk-lib/aws-certificatemanager';
import {Duration} from 'aws-cdk-lib';
import {toPascalCase} from '../../helpers/index';
import {LatencyCnameRecord} from './latency-cname-record';

/**
 * Properties for DomainName
 */
export interface DomainNameProps {
  /**
   * Domain name prefix.
   *
   * @default empty string
   */
  readonly prefix?: string;

  /**
   * Zone for the domain nane.
   */
  readonly zone: string | IHostedZone;

  /**
   * Flag to mark zone as private.
   *
   * @default false
   */
  readonly privateZone?: boolean;

  /**
   * VPC the zone belongs to.
   *
   * @default undefined
   */
  readonly vpcId?: string;
}

/**
 * ACM certificate options
 */
export interface CertificateOptions {
  /**
   * The identifier to use.
   *
   * @default ${this.toIdentifier()}Certificate
   */
  readonly id?: string;

  /**
   * Alternative domain names on the certificate.
   */
  readonly subjectAlternativeNames?: string[];
}

/**
 * Cname record options.
 */
export interface CnameRecordOptions {
  /**
   * The identifier to use. One is generated if not provided.
   */
  readonly id?: string;

  /**
   * The resource record cache time to live (TTL).
   */
  readonly ttl?: Duration;

  /**
   * A comment to add on the record.
   */
  readonly comment?: string;

  /**
   * The region the resource behind this cname is located.
   */
  readonly region?: string;
}

/**
 * A record options.
 */
export interface ARecordOptions {
  /**
   * The identifier to use. One is generated if not provided.
   */
  readonly id?: string;

  /**
   * The resource record cache time to live (TTL).
   */
  readonly ttl?: Duration;

  /**
   * A comment to add on the record.
   */
  readonly comment?: string;
}

/**
 * Utility class for holding domain name information and
 * doing useful things with it.
 */
export class DomainName {
  protected readonly prefix: string;
  protected readonly zone: string;
  protected hostedZone?: IHostedZone;
  protected readonly privateZone: boolean;
  protected readonly vpcId?: string;

  /**
   * Creates a new DomainName.
   *
   * @param props the properties of the domain name
   */
  constructor(props: DomainNameProps) {
    this.prefix = props.prefix ?? '';
    if (typeof props.zone === 'string') {
      this.zone = props.zone;
    } else {
      this.hostedZone = props.zone;
      this.zone = this.hostedZone.zoneName;
    }
    this.privateZone = props.privateZone ?? false;
    this.vpcId = props.vpcId;
  }

  /**
   * Returns the prefix for this domain name.
   */
  getPrefix(): string {
    return this.prefix;
  }

  /**
   * Returns true if the zone is private. False if otherwise.
   */
  inPrivateZone(): boolean {
    return this.privateZone;
  }

  /**
   * Returns the vpc ID for this zone or undefined if one does not exist
   */
  getVpcId(): string | undefined {
    return this.vpcId;
  }

  /**
   * Returns true if the props match the domain name. False if otherwise.
   *
   * @param props the props to compare
   */
  propsMatch(props: DomainNameProps): boolean {
    const propZoneStr =
      typeof props.zone === 'string' ? props.zone : props.zone.zoneName;
    return (
      this.prefix === (props.prefix ?? '') &&
      this.zone === propZoneStr &&
      this.privateZone === (props.privateZone ?? false) &&
      this.vpcId === props.vpcId
    );
  }

  /**
   * Returns the string version of this domain name.
   */
  toString(): string {
    return (this.prefix === '' ? '' : this.prefix + '.') + this.zone;
  }

  /**
   * Returns a friendly identifier for this domain name. This function replaces wildcards with _ and periods with -
   */
  toIdentifier(): string {
    return toPascalCase(
      this.toString()
        .toLowerCase()
        .replace(/\*/g, 'wildcard')
        .replace(/\./g, '-'),
    );
  }

  /**
   * Returns the zone associated with this domain name.
   */
  getZone(): string {
    return this.zone;
  }

  /**
   * Returns the route53 hosted zone associated with this domain name.
   * This method is safe to call repeatedly, the lookup will only be done once.
   *
   * @param scope the scope to use if a lookup is required
   * @param id an optional ID if a lookup is required; one is generated if not provided
   */
  getHostedZone(scope: Construct, id?: string): IHostedZone {
    if (this.hostedZone === undefined) {
      this.hostedZone = HostedZone.fromLookup(
        scope,
        id ?? `${this.toIdentifier()}-zone`,
        {
          domainName: this.zone,
          privateZone: this.privateZone,
          vpcId: this.vpcId,
        },
      );
    }
    return this.hostedZone;
  }

  private scrubIdentifier(identifier: string): string {
    return /^\d/.test(identifier) ? 'x' + identifier : identifier;
  }

  createCnameRecord(
    scope: Construct,
    domainName: string,
    options?: CnameRecordOptions,
  ): CnameRecord {
    return new CnameRecord(
      scope,
      options?.id ?? `${this.scrubIdentifier(this.toIdentifier())}CnameRecord`,
      {
        zone: this.getHostedZone(scope),
        recordName: this.toString(),
        domainName,
        region: options?.region,
      },
    );
  }

  createLatencyCnameRecord(
    scope: Construct,
    domainName: string,
    options?: CnameRecordOptions,
  ): LatencyCnameRecord {
    return new LatencyCnameRecord(
      scope,
      options?.id ?? `${this.scrubIdentifier(this.toIdentifier())}CnameRecord`,
      {
        zone: this.getHostedZone(scope),
        recordName: this.toString(),
        domainName,
        ttl: options?.ttl,
        comment: options?.comment,
      },
    );
  }

  /**
   * Creates a Route53 ARecord for this domain name.
   *
   * @param scope the scope to create the record in
   * @param target the target of the record
   * @param options additional options for creating the record
   */
  createARecord(
    scope: Construct,
    target: RecordTarget,
    options?: ARecordOptions,
  ): ARecord {
    return new ARecord(
      scope,
      options?.id ?? `${this.scrubIdentifier(this.toIdentifier())}ARecord`,
      {
        zone: this.getHostedZone(scope),
        recordName: this.toString(),
        target,
        ttl: options?.ttl,
        comment: options?.comment,
      },
    );
  }

  /**
   * Creates a weighted Route53 record for this domain name.
   *
   * @param scope the scope to create the record in
   * @param target the target of the record
   * @param weight the initial weight
   * @param options additional options for creating the record
   */
  createWeightedARecord(
    scope: Construct,
    target: RecordTarget,
    weight: number,
    options?: ARecordOptions,
  ): WeightedARecord {
    return new WeightedARecord(
      scope,
      options?.id ?? `${this.scrubIdentifier(this.toIdentifier())}ARecord`,
      {
        zone: this.getHostedZone(scope),
        recordName: this.toString(),
        target,
        weight,
        ttl: options?.ttl,
        comment: options?.comment,
      },
    );
  }

  /**
   * Creates a latency Route53 record for this domain name.
   *
   * @param scope the scope to create the record in
   * @param target the target of the record
   * @param options additional options for creating the record
   */
  createLatencyARecord(
    scope: Construct,
    target: RecordTarget,
    options?: ARecordOptions,
  ): LatencyARecord {
    return new LatencyARecord(
      scope,
      options?.id ?? `${this.scrubIdentifier(this.toIdentifier())}ARecord`,
      {
        zone: this.getHostedZone(scope),
        recordName: this.toString(),
        target,
        ttl: options?.ttl,
        comment: options?.comment,
      },
    );
  }

  /**
   * Creates an ACM certificate for the domain name.
   *
   * @param scope the scope to create the record in
   * @param opts additional options
   */
  createCertificate(scope: Construct, opts?: CertificateOptions): Certificate {
    return new Certificate(
      scope,
      opts?.id ?? `${this.toIdentifier()}Certificate`,
      {
        domainName: this.toString(),
        validation: CertificateValidation.fromDns(this.getHostedZone(scope)),
        subjectAlternativeNames: opts?.subjectAlternativeNames,
      },
    );
  }

  /**
   * Converts an array of DomainNameProps to DomainName. This function will return an empty array
   * if domainNameProps is undefined.
   *
   * @param domainNameProps the DomainNameProps objects to convert
   */
  static fromProps(domainNameProps?: DomainNameProps[]): DomainName[] {
    return domainNameProps === undefined
      ? []
      : domainNameProps.map((p) => new DomainName(p));
  }

  /**
   * Creates an instance of DomainName from a fully qualified domain name and a zone.
   *
   * @param fqdn the fully qualified domain name
   * @param zone the zone
   * @param privateZone whether the zone is private
   * @param vpcId the VPC ID
   */
  static fromFqdn(
    fqdn: string,
    zone: IHostedZone | string,
    privateZone?: boolean,
    vpcId?: string,
  ): DomainName {
    const prefix = fqdn
      .replace(typeof zone === 'string' ? zone : zone.zoneName, '')
      .replace(/\.$/, '');
    return new DomainName({
      prefix,
      zone,
      privateZone,
      vpcId,
    });
  }

  /**
   * Converts an array of DomainName objects to an array of strings. This function will return an
   * empty array if domainNames is undefined.
   *
   * @param domainNames the DomainName objects to convert
   */
  static toStrings(domainNames?: DomainName[]): string[] {
    return domainNames === undefined
      ? []
      : domainNames.map((d) => d.toString());
  }

  /**
   * Converts an array of DomainNameProps to an array of strings. This function will
   * return an empty array if domainNameProps is undefined.
   *
   * @param domainNameProps the DomainNameProps objects to convert
   */
  static toStringsFromProps(domainNameProps?: DomainNameProps[]): string[] {
    return domainNameProps === undefined
      ? []
      : DomainName.toStrings(DomainName.fromProps(domainNameProps));
  }

  /**
   * Converts an array of DomainName objects to a map where the key is the domain name string and the value
   * is an IHostedZone. This method will return an empty map if domainNames is undefined. This function
   * is useful when used in conjunction with functions like CertificateValidation.fromDnsMultiZone.
   *
   * @param scope the scope used if a zone lookup is required
   * @param domainNames the DomainName objects to convert
   */
  static toZoneMap(
    scope: Construct,
    domainNames?: DomainName[],
  ): {[domainName: string]: IHostedZone} {
    const map: {[key: string]: IHostedZone} = {};
    if (domainNames !== undefined) {
      domainNames.forEach((d) => {
        map[d.toString()] = d.getHostedZone(scope);
      });
    }
    return map;
  }

  /**
   * Converts an array of DomainNameProps objects to a map where the key is the domain name string and the
   * value is an IHostedZone. This method will return an empty map if domainNameProps is undefined. This
   * function is useful when used in conjunction with functions like CertificateValidation.fromDnsMultiZone.
   *
   * @param scope the scope used if a zone lookup is required
   * @param domainNameProps the DomainNameProps objects to convert
   */
  static toZoneMapFromProps(
    scope: Construct,
    domainNameProps: DomainNameProps[],
  ): {[domainName: string]: IHostedZone} {
    return DomainName.toZoneMap(scope, DomainName.fromProps(domainNameProps));
  }

  /**
   * Finds the domain name matching the given properties in an array of DomainName objects.
   *
   * @param props the properties to compare
   * @param domainNames the domain names to search
   * @return the matching domain name or undefined
   */
  static findDomainName(
    props: DomainNameProps,
    domainNames?: DomainName[],
  ): DomainName | undefined {
    for (const domainName of domainNames ?? []) {
      if (domainName.propsMatch(props)) {
        return domainName;
      }
    }
    return undefined;
  }

  /**
   * Create a certificate from an array of DomainName objects.
   *
   * @param scope the scope to use
   * @param id the identifier to use in the scope for the certificate
   * @param domainNames the domain names to use in the certificate
   */
  static createCertificate(
    scope: Construct,
    id: string,
    domainNames: DomainName[],
  ): Certificate {
    return new Certificate(scope, id, {
      domainName: domainNames[0].toString(),
      subjectAlternativeNames: domainNames
        .slice(1)
        .map((name) => name.toString()),
      validation: CertificateValidation.fromDnsMultiZone(
        DomainName.toZoneMap(scope, domainNames),
      ),
    });
  }
}
