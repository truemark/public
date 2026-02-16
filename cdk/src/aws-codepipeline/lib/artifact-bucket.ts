import {BlockPublicAccess, Bucket} from 'aws-cdk-lib/aws-s3';
import {IKey} from 'aws-cdk-lib/aws-kms';
import {Construct} from 'constructs';
import {RemovalPolicy} from 'aws-cdk-lib';
import {AccountPrincipal, Effect, PolicyStatement} from 'aws-cdk-lib/aws-iam';

/**
 * Properties for ArtifactBucket.
 */
export interface ArtifactBucketProps {
  /**
   * By default, CDK will create KMS keys for cross account deployments. This
   * can be costly if you have a large number of pipelines. This property
   * allows a common key to be shared across pipelines.
   */
  readonly encryptionKey: IKey;

  /**
   * List of AWS account IDs that should have access to this bucket.
   */
  readonly accountIds?: string[];
}

/**
 * An S3 bucket for storing artifacts in a pipeline. The created bucket will
 * automatically be destroyed along with its contents when the CDK stack
 * containing it is destroyed. This is not presently the CDK default.
 */
export class ArtifactBucket extends Bucket {
  constructor(scope: Construct, id: string, props: ArtifactBucketProps) {
    super(scope, id, {
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryptionKey: props.encryptionKey,
    });
    if (props.accountIds !== undefined) {
      this.addToResourcePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['s3:Get*', 's3:List*'],
          principals: props.accountIds.map((id) => new AccountPrincipal(id)),
          resources: [this.arnForObjects('*'), this.bucketArn],
        }),
      );
    }
  }
}
