import {Construct} from 'constructs';
import {
  BlockPublicAccess,
  CorsRule,
  RedirectTarget,
  RoutingRule,
} from 'aws-cdk-lib/aws-s3';
import {
  DomainName,
  LatencyARecord,
  WeightedARecord,
} from '../../aws-route53/index';
import {ARecord, IHostedZone, RecordTarget} from 'aws-cdk-lib/aws-route53';
import {BucketWebsiteTarget} from 'aws-cdk-lib/aws-route53-targets';
import {RemovalPolicy, Duration} from 'aws-cdk-lib';
import {CacheControl} from 'aws-cdk-lib/aws-s3-deployment';
import {Grant, IGrantable} from 'aws-cdk-lib/aws-iam';
import * as iam from 'aws-cdk-lib/aws-iam';
import {ExtendedConstruct} from '../../aws-cdk/index';
import {BucketDeploymentConfig, ExtendedBucket} from './extended-bucket';

/**
 * Domain name properties for a bucket based website.
 */
export interface WebsiteDomainNameProps {
  /**
   * Domain name prefix for the site.
   */
  readonly prefix?: string;

  /**
   * Base domain name of the site.
   */
  readonly zone: string | IHostedZone;

  /**
   * Weather to create latency based routing record. Default is true.
   */
  readonly latency?: boolean;
}

/**
 * Properties for WebsiteBucket.
 */
export interface WebsiteBucketProps {
  /**
   * Policy to apply when the bucket is removed from this stack.
   * Setting this to RemovalPolicy.DESTROY will also auto delete objects.
   *
   * @default RemovalPolicy.RETAIN
   */
  readonly removalPolicy?: RemovalPolicy;

  /**
   * Optional domain name properties for the bucket based website.
   */
  readonly domainName?: WebsiteDomainNameProps;

  /**
   * The index document for the site. Default is 'index.html'.
   */
  readonly websiteIndexDocument?: string;

  /**
   * The error document for the site. Default is 'error.html'.
   */
  readonly websiteErrorDocument?: string;

  /**
   * Redirect all requests to another host. This could be another domain or a specific URL.
   */
  readonly websiteRedirect?: RedirectTarget;

  /**
   * Routing rules for the website.
   */
  readonly websiteRoutingRules?: RoutingRule[];

  /**
   * Cors rules
   */
  readonly cors?: CorsRule[];
}

/**
 * Simple Construct for creating buckets that will be accessed directly as a website.
 */
export class WebsiteBucket extends ExtendedConstruct {
  readonly bucket: ExtendedBucket;
  readonly bucketName: string;
  readonly bucketArn: string;
  readonly bucketWebsiteUrl: string;
  readonly bucketWebsiteDomainName: string;
  readonly record?: ARecord | WeightedARecord | LatencyARecord;

  constructor(scope: Construct, id: string, props?: WebsiteBucketProps) {
    super(scope, id);

    const domainName =
      props?.domainName === undefined
        ? undefined
        : new DomainName({
            prefix: props.domainName.prefix,
            zone: props.domainName.zone,
          });

    this.bucket = new ExtendedBucket(this, 'Default', {
      bucketName: domainName?.toString(),
      blockPublicAccess: new BlockPublicAccess({
        blockPublicAcls: true,
        blockPublicPolicy: false,
        ignorePublicAcls: true,
        restrictPublicBuckets: false,
      }),
      publicReadAccess: true,
      websiteIndexDocument: props?.websiteIndexDocument ?? 'index.html',
      websiteErrorDocument: props?.websiteErrorDocument ?? 'error.html',
      websiteRedirect: props?.websiteRedirect,
      websiteRoutingRules: props?.websiteRoutingRules,
      removalPolicy: props?.removalPolicy ?? RemovalPolicy.RETAIN,
      autoDeleteObjects: props?.removalPolicy === RemovalPolicy.DESTROY,
      cors: props?.cors,
    });
    this.bucketName = this.bucket.bucketName;
    this.bucketArn = this.bucket.bucketArn;
    this.bucketWebsiteUrl = this.bucket.bucketWebsiteUrl;
    this.bucketWebsiteDomainName = this.bucket.bucketWebsiteDomainName;

    if (domainName !== undefined) {
      const recordTarget = RecordTarget.fromAlias(
        new BucketWebsiteTarget(this.bucket),
      );
      if (props?.domainName?.latency ?? true) {
        domainName.createLatencyARecord(this, recordTarget);
      } else {
        domainName.createARecord(this, recordTarget);
      }
    }
  }

  /**
   * See `ExtendedBucket.deploy. This method adds a default max-age of 15 days and s-maxage of 7 days.
   *
   * @param config the deployment configurations
   */
  deploy(config: BucketDeploymentConfig | BucketDeploymentConfig[]) {
    const configs = Array.isArray(config) ? config : [config];
    for (const c of configs) {
      this.bucket.deploy({
        ...c,
        cacheControl: c.cacheControl ?? [
          CacheControl.maxAge(Duration.minutes(15)),
          CacheControl.sMaxAge(Duration.days(7)),
        ],
      });
    }
  }

  /**
   * Grant read permissions for this bucket and it's contents to an IAM
   * principal (Role/Group/User).
   *
   * If encryption is used, permission to use the key to decrypt the contents
   * of the bucket will also be granted to the same principal.
   *
   * @param identity The principal
   * @param objectsKeyPattern Restrict the permission to a certain key pattern (default '*')
   */
  // eslint-disable-next-line  @typescript-eslint/no-explicit-any
  grantRead(identity: IGrantable, objectsKeyPattern?: any): Grant {
    return this.bucket.grantRead(identity, objectsKeyPattern);
  }

  /**
   * Grant write permissions to this bucket to an IAM principal.
   *
   * If encryption is used, permission to use the key to encrypt the contents
   * of written files will also be granted to the same principal.
   *
   * Before CDK version 1.85.0, this method granted the `s3:PutObject*` permission that included `s3:PutObjectAcl`,
   * which could be used to grant read/write object access to IAM principals in other accounts.
   * If you want to get rid of that behavior, update your CDK version to 1.85.0 or later,
   * and make sure the `@aws-cdk/aws-s3:grantWriteWithoutAcl` feature flag is set to `true`
   * in the `context` key of your cdk.json file.
   * If you've already updated, but still need the principal to have permissions to modify the ACLs,
   * use the `grantPutAcl` method.
   *
   * @param identity The principal
   * @param objectsKeyPattern Restrict the permission to a certain key pattern (default '*')
   * @param allowedActionPatterns Restrict the permissions to certain list of action patterns
   */
  grantWrite(
    identity: IGrantable,
    // eslint-disable-next-line  @typescript-eslint/no-explicit-any
    objectsKeyPattern?: any,
    allowedActionPatterns?: string[],
  ): Grant {
    return this.bucket.grantWrite(
      identity,
      objectsKeyPattern,
      allowedActionPatterns,
    );
  }

  /**
   * Grants s3:PutObject* and s3:Abort* permissions for this bucket to an IAM principal.
   *
   * If encryption is used, permission to use the key to encrypt the contents
   * of written files will also be granted to the same principal.
   * @param identity The principal
   * @param objectsKeyPattern Restrict the permission to a certain key pattern (default '*')
   */
  // eslint-disable-next-line  @typescript-eslint/no-explicit-any
  grantPut(identity: IGrantable, objectsKeyPattern?: any): Grant {
    return this.bucket.grantPut(identity, objectsKeyPattern);
  }

  /**
   * Grant the given IAM identity permissions to modify the ACLs of objects in the given Bucket.
   *
   * If your application has the '@aws-cdk/aws-s3:grantWriteWithoutAcl' feature flag set,
   * calling `grantWrite` or `grantReadWrite` no longer grants permissions to modify the ACLs of the objects;
   * in this case, if you need to modify object ACLs, call this method explicitly.
   *
   * @param identity The principal
   * @param objectsKeyPattern Restrict the permission to a certain key pattern (default '*')
   */
  grantPutAcl(identity: IGrantable, objectsKeyPattern?: string): Grant {
    return this.bucket.grantPutAcl(identity, objectsKeyPattern);
  }

  /**
   * Grants s3:DeleteObject* permission to an IAM principal for objects
   * in this bucket.
   *
   * @param identity The principal
   * @param objectsKeyPattern Restrict the permission to a certain key pattern (default '*')
   */
  // eslint-disable-next-line  @typescript-eslint/no-explicit-any
  grantDelete(identity: IGrantable, objectsKeyPattern?: any): Grant {
    return this.bucket.grantDelete(identity, objectsKeyPattern);
  }

  /**
   * Grants read/write permissions for this bucket and it's contents to an IAM
   * principal (Role/Group/User).
   *
   * If an encryption key is used, permission to use the key for
   * encrypt/decrypt will also be granted.
   *
   * Before CDK version 1.85.0, this method granted the `s3:PutObject*` permission that included `s3:PutObjectAcl`,
   * which could be used to grant read/write object access to IAM principals in other accounts.
   * If you want to get rid of that behavior, update your CDK version to 1.85.0 or later,
   * and make sure the `@aws-cdk/aws-s3:grantWriteWithoutAcl` feature flag is set to `true`
   * in the `context` key of your cdk.json file.
   * If you've already updated, but still need the principal to have permissions to modify the ACLs,
   * use the `grantPutAcl` method.
   *
   * @param identity The principal
   * @param objectsKeyPattern Restrict the permission to a certain key pattern (default '*')
   */
  // eslint-disable-next-line  @typescript-eslint/no-explicit-any
  grantReadWrite(identity: IGrantable, objectsKeyPattern?: any): Grant {
    return this.bucket.grantReadWrite(identity, objectsKeyPattern);
  }

  /**
   * Adds a statement to the resource policy for a principal (i.e.
   * account/role/service) to perform actions on this bucket and/or its
   * contents. Use `bucketArn` and `arnForObjects(keys)` to obtain ARNs for
   * this bucket or objects.
   *
   * Note that the policy statement may or may not be added to the policy.
   * For example, when an `IBucket` is created from an existing bucket,
   * it's not possible to tell whether the bucket already has a policy
   * attached, let alone to re-use that policy to add more statements to it.
   * So it's safest to do nothing in these cases.
   *
   * @param permission the policy statement to be added to the bucket's
   * policy.
   * @returns metadata about the execution of this method. If the policy
   * was not added, the value of `statementAdded` will be `false`. You
   * should always check this value to make sure that the operation was
   * actually carried out. Otherwise, synthesis and deploy will terminate
   * silently, which may be confusing.
   */
  addToResourcePolicy(
    permission: iam.PolicyStatement,
  ): iam.AddToResourcePolicyResult {
    return this.bucket.addToResourcePolicy(permission);
  }
}
