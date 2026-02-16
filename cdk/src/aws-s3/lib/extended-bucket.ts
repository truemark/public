import {RemovalPolicy} from 'aws-cdk-lib';
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  BucketProps,
  ObjectOwnership,
} from 'aws-cdk-lib/aws-s3';
import {Construct} from 'constructs';
import {
  BucketDeployment,
  CacheControl,
  ISource,
  Source,
} from 'aws-cdk-lib/aws-s3-deployment';
import {
  IOrigin,
  OriginAccessIdentity,
  S3OriginAccessControl,
  Signing,
} from 'aws-cdk-lib/aws-cloudfront';

/**
 * Properties for convenience deploy method in ExtendedBucket.
 */
export interface BucketDeploymentConfig {
  /**
   * The amount of memory (in MiB) to allocate to the AWS Lambda function which
   * replicates the files from the CDK bucket to the destination bucket.
   *
   * If you are deploying large files, you will need to increase this number
   * accordingly.
   *
   * @default 512
   */
  readonly memoryLimit?: number;

  /**
   * The paths or sources to deploy.
   */
  readonly source: string | string[] | ISource | ISource[];

  /**
   * Prefix to add to the deployment path in the bucket.
   */
  readonly prefix?: string;

  /**
   * Paths to exclude from the deployment.
   */
  readonly exclude?: string | string[];

  /**
   * Paths to include in the deployment. If specified, only these paths will be deployed.
   * If exclude is also specified, the intersection of the two sets will be deployed.
   */
  readonly include?: string | string[];

  /**
   * Additional Cache-Control directives to set. Default is none.
   */
  readonly cacheControl?: CacheControl[];

  /**
   * Whether to prune objects that exist in the bucket but not in the assets. Default is false.
   */
  readonly prune?: boolean;
}

export type ExtendedBucketProps = BucketProps;

/**
 * Extension of Bucket with preset defaults that include, disallowing public access,
 * enforcing bucket owner object ownership, S3 managed encryption, and auto deletion
 * of objects when removal policy is set to DESTROY. Also includes convenience methods
 * for things like S3 deployments.
 */
export class ExtendedBucket extends Bucket {
  protected deployCount = 0;
  public originAccessControl: S3OriginAccessControl | undefined = undefined;
  public originAccessIdentity: OriginAccessIdentity | undefined = undefined;
  public origin: IOrigin | undefined = undefined;
  constructor(scope: Construct, id: string, props: ExtendedBucketProps) {
    super(scope, id, {
      // Do not allow public access
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      // Disables ACLs on the bucket and we use policies to define access
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      // CloudFront cannot use KMS with S3
      encryption: BucketEncryption.S3_MANAGED,
      // Automatically delete contents if removal policy is set to DESTROY
      autoDeleteObjects: props.removalPolicy === RemovalPolicy.DESTROY,
      ...props,
    });
  }

  protected nextDeployCount(): string {
    const current = this.deployCount++;
    return current === 0 ? '' : `${current}`;
  }

  /**
   * Deploys files to the bucket.
   *
   * @param config the deployment configurations
   */
  deploy(config: BucketDeploymentConfig | BucketDeploymentConfig[]) {
    const configs = Array.isArray(config) ? config : [config];
    for (const c of configs) {
      const sources = (Array.isArray(c.source) ? c.source : [c.source]).map(
        (s) => (typeof s === 'string' ? Source.asset(s) : s),
      );
      const exclude = c.exclude
        ? Array.isArray(c.exclude)
          ? c.exclude
          : [c.exclude]
        : undefined;
      const include = c.include
        ? Array.isArray(c.include)
          ? c.include
          : [c.include]
        : undefined;
      new BucketDeployment(this, `Deploy${this.nextDeployCount()}`, {
        sources,
        destinationBucket: this,
        destinationKeyPrefix: c.prefix,
        prune: c.prune,
        cacheControl: c.cacheControl,
        exclude,
        include,
        memoryLimit: c.memoryLimit ?? 512,
      });
    }
  }

  /**
   * Helper method to return a CloudFront Origin Access Control for this bucket.
   * On repeated calls to this function, the same origin access control will be returned.
   *
   * @deprecated use addOriginAccessIdentity instead
   *
   * @param signing Set how CloudFront signs requests. Default is Signing.SIGV4_NO_OVERRIDE.
   */
  addOriginAccessControl(signing?: Signing): S3OriginAccessControl {
    if (!this.originAccessControl) {
      this.originAccessControl = new S3OriginAccessControl(
        this,
        'OriginAccessControl',
        {
          signing: signing ?? Signing.SIGV4_NO_OVERRIDE,
        },
      );
    }
    return this.originAccessControl;
  }

  /**
   * Helper method to return a CloudFront Origin Access Identity for this bucket.
   * On repeated calls to this function, the same origin access identity will be returned.
   *
   * @param comment Optional comment to add to the OAI.
   */
  addOriginAccessIdentity(comment?: string): OriginAccessIdentity {
    if (!this.originAccessIdentity) {
      this.originAccessIdentity = new OriginAccessIdentity(
        this,
        'OriginAccessIdentity',
        {
          comment,
        },
      );
    }
    return this.originAccessIdentity;
  }
}
