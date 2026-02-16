import {Construct} from 'constructs';
import {Bucket, BucketEncryption, IBucket} from 'aws-cdk-lib/aws-s3';
import {
  Distribution,
  Function,
  FunctionCode,
  FunctionEventType,
  HttpVersion,
  OriginAccessIdentity,
  PriceClass,
  SecurityPolicyProtocol,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import {OriginGroup, S3Origin} from 'aws-cdk-lib/aws-cloudfront-origins';
import {
  Certificate,
  CertificateValidation,
  ICertificate,
} from 'aws-cdk-lib/aws-certificatemanager';
import {ARecord, RecordTarget} from 'aws-cdk-lib/aws-route53';
import {CloudFrontTarget} from 'aws-cdk-lib/aws-route53-targets';
import {
  BucketDeployment,
  CacheControl,
  Source,
} from 'aws-cdk-lib/aws-s3-deployment';
import {
  BundlingOptions,
  DockerImage,
  Duration,
  RemovalPolicy,
} from 'aws-cdk-lib';
import {DomainName, DomainNameProps} from '../../aws-route53/index';
import {
  ExtendedConstruct,
  ExtendedConstructProps,
  StandardTags,
} from '../../aws-cdk/index';
import {LibStandardTags} from '../../truemark';

export enum SourceType {
  Custom = 'Custom',
  Hugo = 'Hugo',
  NpmDist = 'NpmDist',
  Static = 'Static',
}

/**
 * Properties for WebsiteDomainName.
 */
export interface WebsiteDomainNameProps extends DomainNameProps {
  /**
   * Whether to create a Route53 record for this domain name. Default is true.
   *
   * @default - true
   */
  readonly createRecord?: boolean;
}

export interface WebsiteProps extends ExtendedConstructProps {
  /**
   * Bucket to use to store website content. If one is not provided, one will be generated.
   */
  readonly bucket?: IBucket;

  /**
   * Bucket to use if the primary bucket fails. If one is not provided a fallback is not setup.
   */
  readonly fallbackBucket?: IBucket;

  /**
   * The ARN to the ACM Certificate to use on the CloudFront distribution. If one is not
   * provided and domainNames is populated, one will be generated.
   */
  readonly certificateArn?: string;

  /**
   * The domain names to be serviced. The first domain name in the list is treated as the apex domain.
   */
  readonly domainNames?: WebsiteDomainNameProps[];

  /**
   * Redirect traffic to the first domain in the list of domainNames. Defaults to true.
   *
   * @default - true
   */
  readonly redirectToApexDomain?: boolean;

  /**
   * Price class for the CloudFront distribution.
   *
   * @default - PriceClass.PRICE_CLASS_100
   */
  readonly priceClass?: PriceClass;

  /**
   * Minimum protocol version to allow.
   *
   * @default SecurityPolicyProtocol.TLS_V1_2_2021,
   */
  readonly minimumProtocolVersion?: SecurityPolicyProtocol;

  /**
   * Minimum HTTP version to allow.
   *
   * @default HttpVersion.HTTP1_1
   */
  readonly httpVersion?: HttpVersion;

  /**
   * Cache-control max age.
   *
   * @default Duration.minutes(60)
   */
  readonly maxAge?: Duration;

  /**
   * The source type of the website.
   *
   * @default SourceType.Static
   */
  readonly sourceType?: SourceType;

  /**
   * The directory where the website sources are located.
   */
  readonly sourceDirectory: string;

  /**
   * Custom bundling options to use to bundle website sources. The sourceType
   * must be set to SourceType.Custom.
   */
  readonly sourceBundlingOptions?: BundlingOptions;
}

export class Website extends ExtendedConstruct {
  /**
   * The default bundling options for SourceType.Hugo.
   */
  static readonly HUGO_BUNDLING_OPTIONS: BundlingOptions = {
    image: DockerImage.fromRegistry('public.ecr.aws/truemark/hugo:latest'),
    command: ['-d', '/asset-output'],
  };

  /**
   * The default bundling options for SourceType.NpmDist. It"s expected that "npm run dist" command
   * will place files in ${CDK_BUNDLING_OUTPUT_DIR}. Example: "ng build --output-path=/asset-output"
   */
  static readonly NPM_DIST_BUNDLING_OPTIONS: BundlingOptions = {
    image: DockerImage.fromRegistry('node:16-alpine'),
    command: [
      // TODO Figure out how to cache .npmcache
      'sh',
      '-c',
      [
        'mkdir -p .npmcache',
        'npm ci --cache .npmcache --prefer-offline',
        'npm run dist',
      ].join(' && '),
    ],
  };

  readonly bucket: IBucket;
  readonly fallbackBucket?: IBucket;
  readonly originAccessIdentity: OriginAccessIdentity;
  readonly apexDomain: string;
  readonly viewerRequestFunction: Function;
  readonly distribution: Distribution;
  readonly distributionUrl: string;
  readonly aRecords: ARecord[];
  readonly deployment: BucketDeployment;
  readonly fallbackDeployment?: BucketDeployment;

  constructor(scope: Construct, id: string, props: WebsiteProps) {
    super(scope, id, {
      standardTags: StandardTags.merge(props.standardTags, LibStandardTags),
    });

    const domainNames = DomainName.fromProps(props.domainNames);

    let certificate: ICertificate | undefined = undefined;
    if (props.certificateArn !== undefined) {
      certificate = Certificate.fromCertificateArn(
        this,
        'Certificate',
        props.certificateArn,
      );
    } else if (domainNames.length > 0) {
      certificate = new Certificate(this, 'Certificate', {
        domainName: domainNames[0].toString(),
        subjectAlternativeNames: DomainName.toStrings(domainNames).slice(1),
        validation: CertificateValidation.fromDnsMultiZone(
          DomainName.toZoneMap(this, domainNames),
        ),
      });
    }

    this.bucket =
      props.bucket ??
      new Bucket(this, 'Bucket', {
        encryption: BucketEncryption.S3_MANAGED,
        removalPolicy: RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
      });
    this.fallbackBucket = props.fallbackBucket;

    this.originAccessIdentity = new OriginAccessIdentity(this, 'Access');
    this.bucket.grantRead(this.originAccessIdentity);
    if (this.fallbackBucket) {
      this.fallbackBucket.grantRead(this.originAccessIdentity);
    }

    this.apexDomain = domainNames.length > 0 ? domainNames[0].toString() : '';

    this.viewerRequestFunction = new Function(this, 'ViewerRequestFunction', {
      code: FunctionCode.fromInline(
        `
function handler(event) {
  var host = event.request.headers.host.value;
  var uri = event.request.uri;
  var matchApex = MATCH_APEX;
  if (matchApex && host !== "APEX_DOMAIN") {
    return {
      statusCode: 301,
      statusDescription: "Permanently moved",
      headers: {
        "location": { "value": "https://APEX_DOMAIN" + uri }
      }
    }
  }
  if (uri.endsWith("/")) {
    event.request.uri = uri + "index.html";
  }
  return event.request;
}`
          .replace(/APEX_DOMAIN/g, this.apexDomain)
          .replace(
            /MATCH_APEX/g,
            this.apexDomain !== '' && (props.redirectToApexDomain ?? true)
              ? 'true'
              : 'false',
          ),
      ),
    });

    const bucketOrigin = new S3Origin(this.bucket, {
      originAccessIdentity: this.originAccessIdentity,
    });

    const fallbackBucketOrigin =
      this.fallbackBucket === undefined
        ? undefined
        : new S3Origin(this.fallbackBucket, {
            originAccessIdentity: this.originAccessIdentity,
          });

    const defaultOrigin =
      fallbackBucketOrigin === undefined
        ? bucketOrigin
        : new OriginGroup({
            primaryOrigin: bucketOrigin,
            fallbackOrigin: fallbackBucketOrigin,
          });

    this.distribution = new Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: defaultOrigin,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        functionAssociations: [
          {
            function: this.viewerRequestFunction,
            eventType: FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 404,
          responsePagePath: '/404.html',
        },
      ],
      httpVersion: props.httpVersion ?? HttpVersion.HTTP1_1,
      minimumProtocolVersion:
        props.minimumProtocolVersion ?? SecurityPolicyProtocol.TLS_V1_2_2021,
      defaultRootObject: 'index.html',
      certificate,
      domainNames: DomainName.toStrings(domainNames),
      enableIpv6: true,
      priceClass: props.priceClass ?? PriceClass.PRICE_CLASS_100,
    });

    this.distributionUrl = `https://${
      this.apexDomain !== ''
        ? this.apexDomain
        : this.distribution.distributionDomainName
    }`;

    this.aRecords = [];

    for (const domainNameProps of props.domainNames ?? []) {
      if (domainNameProps.createRecord ?? true) {
        const domainName = DomainName.findDomainName(
          domainNameProps,
          domainNames,
        );
        if (domainName !== undefined) {
          this.aRecords.push(
            domainName.createARecord(
              this,
              RecordTarget.fromAlias(new CloudFrontTarget(this.distribution)),
            ),
          );
        }
      }
    }

    let bundlingOptions: BundlingOptions | undefined = undefined;

    if (props.sourceType === SourceType.Custom) {
      if (!props.sourceBundlingOptions) {
        throw new Error(
          'sourceBundlingOptions is required if source type is Custom',
        );
      }
      bundlingOptions = props.sourceBundlingOptions;
    }

    if (props.sourceType === SourceType.Static) {
      if (props.sourceBundlingOptions) {
        throw new Error(
          'Cannot use sourceBundlingOptions with source type Static',
        );
      }
    }

    if (props.sourceType === SourceType.Hugo) {
      bundlingOptions = Website.HUGO_BUNDLING_OPTIONS;
      if (props.sourceBundlingOptions) {
        throw new Error(
          'Cannot use sourceBundlingOptions with source type Hugo',
        );
      }
    } else if (props.sourceType === SourceType.NpmDist) {
      bundlingOptions = Website.NPM_DIST_BUNDLING_OPTIONS;
      if (props.sourceBundlingOptions) {
        throw new Error(
          'Cannot use sourceBundlingOptions with source type NpmDist',
        );
      }
    }

    const source = Source.asset(props.sourceDirectory, {
      bundling: bundlingOptions,
    });

    this.deployment = new BucketDeployment(this, 'Assets', {
      sources: [source],
      destinationBucket: this.bucket,
      distribution: this.distribution,
      cacheControl: [CacheControl.maxAge(props.maxAge ?? Duration.minutes(60))],
      prune: false,
    });

    if (this.fallbackBucket) {
      this.fallbackDeployment = new BucketDeployment(this, 'FallbackAssets', {
        sources: [source],
        destinationBucket: this.fallbackBucket,
        cacheControl: [
          CacheControl.maxAge(props.maxAge ?? Duration.minutes(60)),
        ],
        prune: false,
      });
    }
  }
}
