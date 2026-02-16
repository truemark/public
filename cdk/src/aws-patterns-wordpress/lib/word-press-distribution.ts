import {Construct} from 'constructs';
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  HttpVersion,
  IOrigin,
  OriginRequestCookieBehavior,
  OriginRequestHeaderBehavior,
  OriginRequestPolicy,
  OriginRequestQueryStringBehavior,
  PriceClass,
  SecurityPolicyProtocol,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import {Duration} from 'aws-cdk-lib';
import {Certificate, ICertificate} from 'aws-cdk-lib/aws-certificatemanager';
import {ARecord, IHostedZone, RecordTarget} from 'aws-cdk-lib/aws-route53';
import {CloudFrontTarget} from 'aws-cdk-lib/aws-route53-targets';
import {DomainName} from '../../aws-route53/index';
import {DistributionBuilder} from '../../aws-cloudfront/index';

/**
 * Domain name properties.
 */
export interface WordPressDomainNameProps {
  /**
   * Domain name
   */
  readonly domainName: string;

  /**
   * Zone for the domain name.
   */
  readonly hostedZone?: string | IHostedZone;
}

/**
 * Properties for WordPressDistribution.
 */
export interface WordPressDistributionProps {
  /**
   * Origin to send requests to.
   */
  readonly origin: IOrigin;

  /**
   * Domain names mapped to this distribution.
   */
  readonly domainNames: WordPressDomainNameProps[];

  /**
   * The certificate to use on the distribution.
   * If one is not provided, one is created using the domainNames provided.
   */
  readonly certificate?: ICertificate;

  /**
   * Create DNS records for the distribution.
   *
   * @default - true
   */
  readonly createDnsRecords?: boolean;

  /**
   * HTTP versions to allow
   *
   * @default - HttpVersion.HTTP2_AND_3
   */
  readonly httpVersion?: HttpVersion;

  /**
   * Security protocol to enforce.
   *
   * @default - SecurityPolicyProtocol.TLS_V1_2_2021
   */
  readonly minimumProtocolVersion?: SecurityPolicyProtocol;

  /**
   * Enables IPv6
   *
   * @default - true
   */
  readonly enableIpv6?: boolean;

  /**
   * Price class to use.
   *
   * @default - PriceClass.PRICE_CLASS_ALL
   */
  readonly priceClass?: PriceClass;

  /**
   * Max TTL to apply to the default behavior.
   *
   * @default - Duration.days(1)
   */
  readonly defaultMaxTtl?: Duration;

  /**
   * Max TTL to apply to the static behaviors.
   *
   * @default - Duration.days(1)
   */
  readonly staticMaxTtl?: Duration;

  /**
   * Max TTL to apply to the dynamic behaviors.
   *
   * @default - Duration.seconds(0)
   */
  readonly dynamicMaxTtl?: Duration;
}

/**
 * Creates a new CloudFront distribution for WordPress.
 */
export class WordPressDistribution extends Construct {
  readonly distribution: Distribution;
  readonly dnsRecords: ARecord[];

  constructor(scope: Construct, id: string, props: WordPressDistributionProps) {
    super(scope, id);

    const hostedDomainNames: DomainName[] = [];
    props.domainNames.forEach((name) => {
      if (name.hostedZone !== undefined) {
        hostedDomainNames.push(
          DomainName.fromFqdn(name.domainName, name.hostedZone),
        );
      }
    });

    let certificate: ICertificate | Certificate | undefined = props.certificate;
    if (certificate === undefined) {
      certificate = DomainName.createCertificate(
        this,
        'Certificate',
        hostedDomainNames,
      );
    }

    const originRequestPolicy = new OriginRequestPolicy(this, 'AllViewerPlus', {
      cookieBehavior: OriginRequestCookieBehavior.all(),
      headerBehavior: OriginRequestHeaderBehavior.all(
        'CloudFront-Forwarded-Proto',
      ),
      queryStringBehavior: OriginRequestQueryStringBehavior.all(),
    });

    const builder = new DistributionBuilder(this, 'Default')
      .httpVersion(props.httpVersion ?? HttpVersion.HTTP2_AND_3)
      .minimumProtocolVersion(
        props.minimumProtocolVersion ?? SecurityPolicyProtocol.TLS_V1_2_2021,
      )
      .enableIpv6(props.enableIpv6 ?? true)
      .priceClass(props.priceClass ?? PriceClass.PRICE_CLASS_ALL)
      .domainNames(
        ...props.domainNames.map((domainName) => domainName.domainName),
      )
      .certificate(certificate)

      .behavior(props.origin)
      .viewerProtocolPolicy(ViewerProtocolPolicy.REDIRECT_TO_HTTPS)
      .compress(true)
      .allowedMethods(AllowedMethods.ALLOW_ALL)
      .originRequestPolicy(originRequestPolicy)
      .cachePolicy(CachePolicy.CACHING_DISABLED)

      .behavior(props.origin, '/wp-includes/*')
      .viewerProtocolPolicy(ViewerProtocolPolicy.REDIRECT_TO_HTTPS)
      .compress(true)
      .allowedMethods(AllowedMethods.ALLOW_GET_HEAD_OPTIONS)
      .originRequestPolicy(originRequestPolicy)
      .cachePolicy(CachePolicy.CACHING_DISABLED)

      .behavior(props.origin, '/wp-content/*')
      .viewerProtocolPolicy(ViewerProtocolPolicy.REDIRECT_TO_HTTPS)
      .compress(true)
      .allowedMethods(AllowedMethods.ALLOW_GET_HEAD_OPTIONS)
      .originRequestPolicy(originRequestPolicy)
      .cachePolicy(CachePolicy.CACHING_DISABLED)

      .behavior(props.origin, '/wp-login.php')
      .viewerProtocolPolicy(ViewerProtocolPolicy.REDIRECT_TO_HTTPS)
      .compress(true)
      .allowedMethods(AllowedMethods.ALLOW_ALL)
      .originRequestPolicy(originRequestPolicy)
      .cachePolicy(CachePolicy.CACHING_DISABLED)

      .behavior(props.origin, '/wp-admin/*')
      .viewerProtocolPolicy(ViewerProtocolPolicy.REDIRECT_TO_HTTPS)
      .compress(true)
      .allowedMethods(AllowedMethods.ALLOW_ALL)
      .originRequestPolicy(originRequestPolicy)
      .cachePolicy(CachePolicy.CACHING_DISABLED);

    const distribution = builder.toDistribution();

    const dnsRecords: ARecord[] = [];
    if (props.createDnsRecords ?? true) {
      const recordTarget = RecordTarget.fromAlias(
        new CloudFrontTarget(distribution),
      );
      hostedDomainNames.forEach((name) => {
        dnsRecords.push(name.createARecord(this, recordTarget));
      });
    }

    this.distribution = distribution;
    this.dnsRecords = dnsRecords;
  }
}
