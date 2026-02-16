import {Construct} from 'constructs';
import {
  Certificate,
  CertificateValidation,
} from 'aws-cdk-lib/aws-certificatemanager';
import {HttpOrigin} from 'aws-cdk-lib/aws-cloudfront-origins';
import {
  AllowedMethods,
  CachedMethods,
  CachePolicy,
  Distribution,
  Function,
  FunctionCode,
  FunctionEventType,
  OriginRequestPolicy,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import {CloudFrontTarget} from 'aws-cdk-lib/aws-route53-targets';
import {ARecord, RecordTarget} from 'aws-cdk-lib/aws-route53';
import {
  ExtendedConstruct,
  ExtendedConstructProps,
  StandardTags,
} from '../../aws-cdk/index';
import {DomainName} from '../../aws-route53/index';
import {LibStandardTags} from '../../truemark';
import {DistributionBuilder} from '../../aws-cloudfront/index';

export enum RedirectType {
  Permanent = 301,
  Temporary = 302,
}

/**
 * Properties for DomainRedirect.
 */
export interface DomainRedirectProps extends ExtendedConstructProps {
  /**
   * The type of redirect to perform. Defaults to Permanent.
   *
   * @default Permanent
   */
  readonly type?: RedirectType;

  /**
   * The domain names to redirect.
   */
  readonly domainNames: DomainName[];

  /**
   * The target to redirect to. Ex. https://www.example.com
   */
  readonly target: string;

  /**
   * Comment to leave on the CloudFront distribution.
   */
  readonly comment?: string;

  /**
   * Appends the request URI to the target. Default is false.
   */
  readonly appendUri?: boolean;
}

/**
 * Creates a CloudFront distribution that redirects an entire domain to a target.
 */
export class DomainRedirect extends ExtendedConstruct {
  readonly certificate: Certificate;
  readonly distribution: Distribution;
  readonly records: ARecord[];

  constructor(scope: Construct, id: string, props: DomainRedirectProps) {
    super(scope, id, {
      standardTags: StandardTags.merge(props.standardTags, LibStandardTags),
    });

    if (props.domainNames.length < 1) {
      throw new Error('At least one domain name is required');
    }

    const certificate = new Certificate(this, 'Certificate', {
      domainName: props.domainNames[0].toString(),
      subjectAlternativeNames: props.domainNames
        .slice(1)
        .map((d) => d.toString()),
      validation: CertificateValidation.fromDnsMultiZone(
        DomainName.toZoneMap(this, props.domainNames),
      ),
    });

    const redirectType = props.type || RedirectType.Permanent;

    const redirectFunction = new Function(this, 'RedirectFunction', {
      code: FunctionCode.fromInline(`
function handler(event) {
  return {
    statusCode: ${redirectType},
    statusDescription: "${
      redirectType === RedirectType.Permanent
        ? 'Permanently Moved'
        : 'Temporarily Moved'
    }",
    headers: {
        "location": { "value": ${
          props.appendUri
            ? '"' + props.target + '" + event.request.uri'
            : '"' + props.target + '"'
        }}
    }
  }
}`),
    });

    const origin = new HttpOrigin('example.com');
    const distribution = new DistributionBuilder(this, 'Distribution')
      .comment(props.comment)
      .domainNames(...props.domainNames.map((d) => d.toString()))
      .certificate(certificate)
      .behavior(origin)
      .allowedMethods(AllowedMethods.ALLOW_GET_HEAD)
      .cachedMethods(CachedMethods.CACHE_GET_HEAD)
      .compress(true)
      .cachePolicy(CachePolicy.CACHING_OPTIMIZED)
      .viewerProtocolPolicy(ViewerProtocolPolicy.REDIRECT_TO_HTTPS)
      .originRequestPolicy(OriginRequestPolicy.ALL_VIEWER)
      .functionAssociations([
        {
          eventType: FunctionEventType.VIEWER_REQUEST,
          function: redirectFunction,
        },
      ])
      .toDistribution();

    const target = new CloudFrontTarget(distribution);
    const records = props.domainNames.map((domainName) =>
      domainName.createARecord(this, RecordTarget.fromAlias(target)),
    );

    this.certificate = certificate;
    this.distribution = distribution;
    this.records = records;
  }
}
