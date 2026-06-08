import {CfnOutput} from 'aws-cdk-lib';
import type {Construct} from 'constructs';
import {ExtendedStack, type ExtendedStackProps} from 'truemark-cdk-lib/aws-cdk';
import {
  AwsWorkspaces,
  type AwsWorkspacesDirectoryProps,
  type AwsWorkspacesInfrastructureProps,
  type AwsWorkspacesLoggingProps,
  type AwsWorkspacesNetworkingProps,
  type AwsWorkspacesStorageProps,
  AwsWorkspacesUser,
  type AwsWorkspacesUserProps,
} from 'truemark-cdk-lib/aws-patterns-workspaces';

export interface AwsWorkspacesFoundationStackProps extends ExtendedStackProps {
  readonly networking?: AwsWorkspacesNetworkingProps;
  readonly directory: AwsWorkspacesDirectoryProps;
  readonly logging?: AwsWorkspacesLoggingProps;
  readonly storage?: AwsWorkspacesStorageProps;
  readonly infrastructure?: AwsWorkspacesInfrastructureProps;
}

/**
 * Foundation stack — deploy once per environment.
 * Provisions VPC, KMS key, S3 storage, directory, and the WorkSpaces
 * infrastructure layer (SSM, patch baseline, SSH hardening, hybrid activation).
 */
export class AwsWorkspacesFoundationStack extends ExtendedStack {
  readonly foundation: AwsWorkspaces;

  constructor(
    scope: Construct,
    id: string,
    props: AwsWorkspacesFoundationStackProps,
  ) {
    super(scope, id, props);
    this.addMetadata('Version', process.env.npm_package_version);
    this.addMetadata('Name', process.env.npm_package_name);
    this.addMetadata(
      'URL',
      'https://github.com/truemark/public/tree/main/blueprints/aws-workspaces',
    );

    this.foundation = new AwsWorkspaces(this, 'AwsWorkspaces', {
      networking: props.networking,
      directory: props.directory,
      logging: props.logging,
      storage: props.storage,
      infrastructure: props.infrastructure,
    });

    new CfnOutput(this, 'VpcId', {
      value: this.foundation.vpc.vpcId,
      description: 'VPC ID',
    });
    new CfnOutput(this, 'DirectoryId', {
      value: this.foundation.directoryId,
      description: 'Directory Service ID',
    });
    new CfnOutput(this, 'BucketName', {
      value: this.foundation.bucket.bucketName,
      description: 'S3 storage bucket name (retained on delete)',
    });
    new CfnOutput(this, 'KmsKeyArn', {
      value: this.foundation.encryptionKey.keyArn,
      description: 'KMS encryption key ARN',
    });
    new CfnOutput(this, 'PatchGroupName', {
      value: this.foundation.patchGroupName,
      description: 'SSM patch group name for tagging WorkSpaces',
    });
  }
}

export interface AwsWorkspacesUserStackProps
  extends ExtendedStackProps,
    AwsWorkspacesUserProps {}

/**
 * Per-user stack — deploy one per WorkSpace user.
 * Destroy to remove only that user's WorkSpace without affecting the foundation.
 */
export class AwsWorkspacesUserStack extends ExtendedStack {
  constructor(
    scope: Construct,
    id: string,
    props: AwsWorkspacesUserStackProps,
  ) {
    super(scope, id, props);

    const user = new AwsWorkspacesUser(this, 'AwsWorkspacesUser', props);

    new CfnOutput(this, 'WorkspaceId', {
      value: user.workspace.ref,
      description: 'WorkSpace ID',
    });
  }
}
