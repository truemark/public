import {
  AccessLevel,
  BehaviorOptions,
  Distribution,
  DistributionProps,
  ErrorResponse,
  GeoRestriction,
  HttpVersion,
  IOrigin,
  OriginAccessIdentity,
  PriceClass,
  SecurityPolicyProtocol,
  SSLMethod,
} from 'aws-cdk-lib/aws-cloudfront';
import {ICertificate} from 'aws-cdk-lib/aws-certificatemanager';
import {IBucket} from 'aws-cdk-lib/aws-s3';
import {Construct} from 'constructs';
import {BehaviorBuilder} from './behavior-builder';
import {DomainName} from '../../aws-route53/index';
import {CloudFrontBucket, CloudFrontBucketV2} from '../../aws-s3/index';
import {ExtendedConstruct} from '../../aws-cdk/index';
import {
  HttpOrigin,
  S3BucketOrigin,
  S3Origin,
} from 'aws-cdk-lib/aws-cloudfront-origins';

export class DistributionBuilder extends ExtendedConstruct {
  // eslint-disable-next-line  @typescript-eslint/no-explicit-any
  protected props: any = {};
  protected behaviors: Record<string, BehaviorBuilder> = {};

  constructor(scope: Construct, id: string) {
    super(scope, id);
  }

  getBehavior(path: string): BehaviorBuilder | undefined {
    return this.behaviors[path];
  }

  getBehaviorPaths(): string[] {
    return Object.keys(this.behaviors);
  }

  getOrigins(): IOrigin[] {
    return Object.values(this.behaviors).map((behavior) =>
      behavior.getOrigin(),
    );
  }

  behavior(origin: IOrigin, path?: string): BehaviorBuilder {
    return new BehaviorBuilder(this, origin, path);
  }

  /**
   * Creates a behavior from a bucket using an OriginAccessIdentity.
   *
   * @deprecated use behaviorFromBucketV2
   *
   * @param bucket the bucket
   * @param path the path for the behavior
   */
  behaviorFromBucket(bucket: IBucket, path?: string): BehaviorBuilder {
    return new BehaviorBuilder(
      this,
      new S3Origin(bucket, {
        originAccessIdentity: new OriginAccessIdentity(
          this,
          `Access${bucket.node.id}`,
          {
            comment: `S3 bucket ${bucket.bucketName}`,
          },
        ),
      }),
      path,
    );
  }

  /**
   * Creates a behavior from a bucket using an OriginAccessControl.
   *
   * @param bucket the bucket
   * @param path the path for the behavior
   * @param originAccessLevels The access levels for the origin. Default is [AccessLevel.READ]
   */
  behaviorFromBucketV2(
    bucket: IBucket,
    path?: string,
    originAccessLevels?: AccessLevel[],
  ): BehaviorBuilder {
    return new BehaviorBuilder(
      this,
      S3BucketOrigin.withOriginAccessControl(bucket, {
        originAccessLevels: originAccessLevels ?? [AccessLevel.READ],
      }),
      path,
    );
  }

  /**
   * Creates a behavior from a CloudFrontBucket.
   *
   * @deprecated use behaviorFromCloudFromBucketV2
   *
   * @param bucket the bucket
   * @param path the path for the behavior
   */
  behaviorFromCloudFromBucket(
    bucket: CloudFrontBucket,
    path?: string,
  ): BehaviorBuilder {
    return new BehaviorBuilder(this, bucket.toOrigin(), path);
  }

  /**
   * Creates a behavior from a CloudFrontBucketV2.
   *
   * @param bucket the bucket
   * @param path the path for the behavior
   */
  behaviorFromCloudFromBucketV2(
    bucket: CloudFrontBucketV2,
    path?: string,
  ): BehaviorBuilder {
    return new BehaviorBuilder(this, bucket.toOrigin(), path);
  }

  behaviorFromDomainName(
    domainName: string | DomainName,
    path?: string,
  ): BehaviorBuilder {
    return new BehaviorBuilder(
      this,
      new HttpOrigin(domainName.toString()),
      path,
    );
  }

  addBehavior(
    builder: BehaviorBuilder,
    path: string | undefined,
  ): DistributionBuilder {
    this.behaviors[path ?? ''] = builder;
    return this;
  }

  certificate(certificate?: ICertificate): DistributionBuilder {
    this.props = {
      ...this.props,
      certificate,
    };
    return this;
  }

  comment(comment?: string): DistributionBuilder {
    this.props = {
      ...this.props,
      comment,
    };
    return this;
  }

  defaultRootObject(defaultRootObject?: string): DistributionBuilder {
    this.props = {
      ...this.props,
      defaultRootObject,
    };
    return this;
  }

  domainNames(...domainNames: (string | DomainName)[]): DistributionBuilder {
    const domainNameStrs = domainNames.map((domainName) =>
      domainName.toString(),
    );
    this.props = {
      ...this.props,
      domainNames: domainNameStrs,
    };
    return this;
  }

  domainName(domainName: string | DomainName): DistributionBuilder {
    const domainNames: string[] = this.props.domainNames ?? [];
    domainNames.push(domainName.toString());
    this.props = {
      ...this.props,
      domainNames,
    };
    return this;
  }

  enabled(enabled?: boolean): DistributionBuilder {
    this.props = {
      ...this.props,
      enabled,
    };
    return this;
  }

  enableIpv6(enableIpv6?: boolean): DistributionBuilder {
    this.props = {
      ...this.props,
      enableIpv6,
    };
    return this;
  }

  enableLogging(enableLogging?: boolean): DistributionBuilder {
    this.props = {
      ...this.props,
      enableLogging,
    };
    return this;
  }

  geoRestriction(geoRestriction?: GeoRestriction): DistributionBuilder {
    this.props = {
      ...this.props,
      geoRestriction,
    };
    return this;
  }

  httpVersion(httpVersion?: HttpVersion): DistributionBuilder {
    this.props = {
      ...this.props,
      httpVersion,
    };
    return this;
  }

  logBucket(logBucket?: IBucket): DistributionBuilder {
    this.props = {
      ...this.props,
      logBucket,
    };
    return this;
  }

  logIncludesCookies(logIncludesCookies?: boolean): DistributionBuilder {
    this.props = {
      ...this.props,
      logIncludesCookies,
    };
    return this;
  }

  logFilePrefix(logFilePrefix?: string): DistributionBuilder {
    this.props = {
      ...this.props,
      logFilePrefix,
    };
    return this;
  }

  priceClass(priceClass?: PriceClass): DistributionBuilder {
    this.props = {
      ...this.props,
      priceClass,
    };
    return this;
  }

  webAclId(webAclId?: string): DistributionBuilder {
    this.props = {
      ...this.props,
      webAclId,
    };
    return this;
  }

  errorResponses(errorResponses?: ErrorResponse[]): DistributionBuilder {
    this.props = {
      ...this.props,
      errorResponses,
    };
    return this;
  }

  errorResponse(errorResponse: ErrorResponse): DistributionBuilder {
    const errorResponses: ErrorResponse[] = this.props.errorResponses ?? [];
    errorResponses.push(errorResponse);
    this.props = {
      ...this.props,
      errorResponses,
    };
    return this;
  }

  minimumProtocolVersion(
    minimumProtocolVersion?: SecurityPolicyProtocol,
  ): DistributionBuilder {
    this.props = {
      ...this.props,
      minimumProtocolVersion,
    };
    return this;
  }

  sslSupportMethod(sslSupportMethod?: SSLMethod): DistributionBuilder {
    this.props = {
      ...this.props,
      sslSupportMethod,
    };
    return this;
  }

  build(): DistributionProps {
    if (this.behaviors[''] === undefined) {
      throw new Error('Default behavior with no path is required');
    }

    if (this.props.enableIpv6 === undefined) {
      this.enableIpv6(true);
    }

    if (this.props.httpVersion === undefined) {
      this.httpVersion(HttpVersion.HTTP2_AND_3);
    }

    if (this.props.priceClass === undefined) {
      this.priceClass(PriceClass.PRICE_CLASS_100);
    }

    if (this.props.minimumProtocolVersion === undefined) {
      this.minimumProtocolVersion(SecurityPolicyProtocol.TLS_V1_2_2021);
    }

    const defaultBehavior = this.behaviors[''].buildBehavior();
    const additionalBehaviors: Record<string, BehaviorOptions> = Object.values(
      this.behaviors,
    )
      .filter((behavior) => behavior.path !== undefined)
      .reduce(
        (behaviors, behavior) => {
          behaviors[behavior.path ?? ''] = behavior.buildBehavior();
          return behaviors;
        },
        {} as Record<string, BehaviorOptions>,
      );

    return {
      ...this.props,
      defaultBehavior,
      additionalBehaviors,
    };
  }

  toDistribution(): Distribution {
    return new Distribution(this, 'Default', this.build());
  }
}
