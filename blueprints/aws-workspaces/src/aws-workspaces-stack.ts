import {CfnOutput, RemovalPolicy} from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import type {Construct} from 'constructs';
import {ExtendedStack, type ExtendedStackProps} from 'truemark-cdk-lib/aws-cdk';
import {
  AwsWorkspaces,
  type AwsWorkspacesDirectoryProps,
  type AwsWorkspacesInfrastructureProps,
  type AwsWorkspacesLoggingProps,
  type AwsWorkspacesStorageProps,
  AwsWorkspacesUser,
  type AwsWorkspacesUserProps,
} from 'truemark-cdk-lib/aws-patterns-workspaces';

/**
 * Networking configuration for the blueprint foundation stack.
 * The stack creates a VPC when no existingVpcId is provided.
 */
export interface BlueprintNetworkingProps {
  /**
   * ID of an existing VPC to deploy WorkSpaces into. When omitted, a new VPC
   * with private and public subnets across 2 AZs is created.
   */
  readonly existingVpcId?: string;

  /**
   * Specific subnet IDs to use for directory registration.
   * Only meaningful when existingVpcId is provided. Defaults to the VPC's private subnets.
   */
  readonly existingSubnetIds?: string[];

  /**
   * Enable VPC flow logs when creating a new VPC.
   * Has no effect when existingVpcId is provided.
   *
   * @default true
   */
  readonly enableFlowLogs?: boolean;
}

export interface AwsWorkspacesFoundationStackProps extends ExtendedStackProps {
  readonly networking?: BlueprintNetworkingProps;
  readonly directory: AwsWorkspacesDirectoryProps;
  readonly logging?: AwsWorkspacesLoggingProps;
  readonly storage?: AwsWorkspacesStorageProps;
  readonly infrastructure?: AwsWorkspacesInfrastructureProps;
}

/**
 * Foundation stack — deploy once per environment.
 * Provisions KMS key, VPC (or looks up an existing one), S3 storage, directory,
 * and the WorkSpaces infrastructure layer (SSM, patch baseline, SSH hardening,
 * hybrid activation).
 */
export class AwsWorkspacesFoundationStack extends ExtendedStack {
  readonly foundation: AwsWorkspaces;
  /** KMS customer-managed key used for WorkSpaces volume and storage encryption. */
  readonly encryptionKey: kms.IKey;

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

    this.encryptionKey = new kms.Key(this, 'Key', {
      description: `${this.stackName} WorkSpaces encryption key`,
      enableKeyRotation: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const vpc = props.networking?.existingVpcId
      ? ec2.Vpc.fromLookup(this, 'Vpc', {vpcId: props.networking.existingVpcId})
      : new ec2.Vpc(this, 'Vpc', {
          maxAzs: 2,
          natGateways: 1,
          subnetConfiguration: [
            {
              name: 'private',
              subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
            },
            {name: 'public', subnetType: ec2.SubnetType.PUBLIC},
          ],
        });

    if (
      !props.networking?.existingVpcId &&
      (props.networking?.enableFlowLogs ?? true)
    ) {
      const flowLogGroup = new logs.LogGroup(this, 'FlowLogGroup', {
        retention: logs.RetentionDays.THREE_MONTHS,
        removalPolicy: RemovalPolicy.RETAIN,
      });
      const flowLogRole = new iam.Role(this, 'FlowLogRole', {
        assumedBy: new iam.ServicePrincipal('vpc-flow-logs.amazonaws.com'),
      });
      new ec2.FlowLog(this, 'FlowLog', {
        resourceType: ec2.FlowLogResourceType.fromVpc(vpc),
        destination: ec2.FlowLogDestination.toCloudWatchLogs(
          flowLogGroup,
          flowLogRole,
        ),
      });
    }

    const subnets = props.networking?.existingSubnetIds?.map((subnetId, i) =>
      ec2.Subnet.fromSubnetId(this, `Subnet${i}`, subnetId),
    );

    this.foundation = new AwsWorkspaces(this, 'AwsWorkspaces', {
      networking: {vpc, subnets},
      encryption: {encryptionKey: this.encryptionKey},
      directory: props.directory,
      logging: props.logging,
      storage: props.storage,
      infrastructure: props.infrastructure,
    });

    new CfnOutput(this, 'VpcId', {
      value: vpc.vpcId,
      description: 'VPC ID',
    });
    new CfnOutput(this, 'DirectoryId', {
      value: this.foundation.directoryId,
      description: 'Directory Service ID',
    });
    if (this.foundation.bucket) {
      new CfnOutput(this, 'BucketName', {
        value: this.foundation.bucket.bucketName,
        description: 'S3 storage bucket name (retained on delete)',
      });
    }
    new CfnOutput(this, 'KmsKeyArn', {
      value: this.encryptionKey.keyArn,
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
