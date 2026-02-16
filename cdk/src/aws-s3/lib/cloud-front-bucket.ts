import {Construct} from 'constructs';
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  CorsRule,
} from 'aws-cdk-lib/aws-s3';
import {OriginAccessIdentity} from 'aws-cdk-lib/aws-cloudfront';
import {
  BucketDeployment,
  CacheControl,
  ISource,
  Source,
} from 'aws-cdk-lib/aws-s3-deployment';
import {Duration, RemovalPolicy} from 'aws-cdk-lib';
import {
  ExtendedConstruct,
  ExtendedConstructProps,
  StandardTags,
} from '../../aws-cdk/index';
import {LibStandardTags} from '../../truemark';
import {S3Origin} from 'aws-cdk-lib/aws-cloudfront-origins';
import {Grant, IGrantable} from 'aws-cdk-lib/aws-iam';
import * as iam from 'aws-cdk-lib/aws-iam';

/**
 * Properties for CloudFrontBucket.
 *
 * @deprecated use ExtendedBucket instead
 */
export interface CloudFrontBucketProps extends ExtendedConstructProps {
  /**
   * Policy to apply when the bucket is removed from this stack.
   * @default RemovalPolicy.RETAIN
   */
  readonly removalPolicy?: RemovalPolicy;

  /**
   * Whether all objects should be automatically deleted when the bucket is removed from the stack or when the stack is deleted.
   * Requires the removalPolicy to be set to RemovalPolicy.DESTROY. Default is false.
   *
   * @default false
   */
  readonly autoDeleteObjects?: boolean;

  /**
   * Whether this bucket should have versioning turned on or not. Default is false.
   *
   * @default false
   */
  readonly versioned?: boolean;

  /**
   * Whether this bucket should have transfer acceleration turned on or not. Default is false.
   *
   * @default false
   */
  readonly transferAcceleration?: boolean;

  /**
   * Optional bucket name. If not provided, a name will be generated.
   */
  readonly bucketName?: string;

  /**
   * The CORS configuration of this bucket.
   *
   * @see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-s3-bucket-cors.html
   *
   * @default - No CORS configuration.
   */
  readonly cors?: CorsRule[];
}

/**
 * Simple Construct for creating buckets that will be accessed directly by CloudFront as an Origin.
 *
 * @deprecated use CloudFrontBucketV2
 */
export class CloudFrontBucket extends ExtendedConstruct {
  private deployCount = 0;

  readonly bucket: Bucket;
  readonly bucketName: string;
  readonly bucketArn: string;
  readonly originAccessIdentity: OriginAccessIdentity;
  readonly originAccessIdentityId: string;

  private nextDeployCount(): string {
    const current = this.deployCount++;
    return current === 0 ? '' : `${current}`;
  }

  constructor(scope: Construct, id: string, props?: CloudFrontBucketProps) {
    super(scope, id, {
      standardTags: StandardTags.merge(props?.standardTags, LibStandardTags),
    });

    const removalPolicy = props?.removalPolicy ?? RemovalPolicy.RETAIN;
    const autoDeleteObjects =
      (props?.autoDeleteObjects ?? false) &&
      removalPolicy === RemovalPolicy.DESTROY;

    this.bucket = new Bucket(this, 'Default', {
      encryption: BucketEncryption.S3_MANAGED, // CloudFront cannot use KMS with S3
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy,
      autoDeleteObjects,
      versioned: props?.versioned ?? false,
      transferAcceleration: props?.transferAcceleration ?? false,
      bucketName: props?.bucketName,
      cors: props?.cors,
    });
    this.bucketName = this.bucket.bucketName;
    this.bucketArn = this.bucket.bucketArn;
    this.originAccessIdentity = new OriginAccessIdentity(this, 'Access', {
      comment: `S3 bucket ${this.bucket.bucketName}`,
    });
    this.originAccessIdentityId =
      this.originAccessIdentity.originAccessIdentityId;
    this.bucket.grantRead(this.originAccessIdentity);
  }

  /**
   * Helper method to deploy local assets to the created bucket. Ths function assumes
   * CloudFront invalidation requests will be sent for mutable files to serve new content.
   * For more complicated deployments, use BucketDeployment directly.
   *
   * @param paths the paths to the local assets
   * @param maxAge the length of time to browsers will cache files; default is Duration.minutes(15)
   * @param sMaxAge the length of time CloudFront will cache files; default is Duration.days(7)
   * @param prune true to prune old files; default is false
   */
  deployPaths(
    paths: string[],
    maxAge?: Duration,
    sMaxAge?: Duration,
    prune?: boolean,
  ): BucketDeployment {
    return new BucketDeployment(this, `Deploy${this.nextDeployCount()}`, {
      sources: paths.map((path) => Source.asset(path)),
      destinationBucket: this.bucket,
      prune: prune ?? false,
      cacheControl: [
        CacheControl.setPublic(),
        CacheControl.maxAge(maxAge ?? Duration.minutes(15)),
        CacheControl.sMaxAge(sMaxAge ?? Duration.days(7)),
      ],
    });
  }

  /**
   * Helper method to deploy local assets to the created bucket. Ths function assumes
   * CloudFront invalidation requests will be sent for mutable files to serve new content.
   * For more complicated deployments, use BucketDeployment directly.
   *
   * @param path the path to the local assets
   * @param maxAge the length of time to browsers will cache files; default is Duration.minutes(15)
   * @param sMaxAge the length of time CloudFront will cache files; default is Duration.days(7)
   * @param prune true to prune old files; default is false
   */
  deployPath(
    path: string,
    maxAge?: Duration,
    sMaxAge?: Duration,
    prune?: boolean,
  ): BucketDeployment {
    return this.deployPaths([path], maxAge, sMaxAge, prune);
  }

  /**
   * Helper method to assets to the created bucket. This function assumes CloudFront invalidation
   * requests will be sent for mutable files to serve new content.
   * For more complicated deployments, use BucketDeployment directly.
   *
   * @param sources the sources to deploy
   * @param maxAge the length of time to browsers will cache files; default is Duration.minutes(15)
   * @param sMaxAge the length of time CloudFront will cache files; default is Duration.days(7)
   * @param prune true to prune old files; default is false
   */
  deploySources(
    sources: ISource[],
    maxAge?: Duration,
    sMaxAge?: Duration,
    prune?: boolean,
  ): BucketDeployment {
    return new BucketDeployment(this, `Deploy${this.nextDeployCount()}`, {
      sources: sources,
      destinationBucket: this.bucket,
      prune: prune ?? false,
      cacheControl: [
        CacheControl.setPublic(),
        CacheControl.maxAge(maxAge ?? Duration.minutes(15)),
        CacheControl.sMaxAge(sMaxAge ?? Duration.days(7)),
      ],
    });
  }

  /**
   * Helper method to assets to the created bucket. This function assumes CloudFront invalidation
   * requests will be sent for mutable files to serve new content.
   * For more complicated deployments, use BucketDeployment directly.
   *
   * @param source the source to deploy
   * @param maxAge the length of time to browsers will cache files; default is Duration.minutes(15)
   * @param sMaxAge the length of time CloudFront will cache files; default is Duration.days(7)
   * @param prune true to prune old files; default is false
   */
  deploySource(
    source: ISource,
    maxAge?: Duration,
    sMaxAge?: Duration,
    prune?: boolean,
  ): BucketDeployment {
    return this.deploySources([source], maxAge, sMaxAge, prune);
  }

  /**
   * Helper method to return a CloudFront Origin for this bucket.
   */
  toOrigin(): S3Origin {
    return new S3Origin(this.bucket, {
      originAccessIdentity: this.originAccessIdentity,
    });
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
  grantRead(identity: IGrantable, objectsKeyPattern?: unknown): Grant {
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
    objectsKeyPattern?: unknown,
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
  grantPut(identity: IGrantable, objectsKeyPattern?: unknown): Grant {
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
  grantDelete(identity: IGrantable, objectsKeyPattern?: unknown): Grant {
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
  grantReadWrite(identity: IGrantable, objectsKeyPattern?: unknown): Grant {
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
