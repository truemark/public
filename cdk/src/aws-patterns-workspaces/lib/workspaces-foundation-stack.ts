import * as cdk from 'aws-cdk-lib/core';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as kms from 'aws-cdk-lib/aws-kms';
import type {SecretValue} from 'aws-cdk-lib';
import type {Construct} from 'constructs';
import {
  DataClassification,
  DataSensitivity,
  ExtendedStack,
  type ExtendedStackProps,
} from '../../aws-cdk';
import {AwsWorkspaces} from '../../aws-workspaces';

/**
 * Props for WorkspacesFoundationStack.
 */
export interface WorkspacesFoundationStackProps extends ExtendedStackProps {
  /**
   * Existing VPC to deploy WorkSpaces into.
   * When omitted a minimal VPC (private + public subnets, 2 AZs) is created.
   * Use the standard-network construct to manage the VPC externally.
   */
  readonly existingVpcId?: string;

  /**
   * Specific subnet IDs to use for directory registration.
   * Only meaningful when existingVpcId is set. Defaults to the VPC's private subnets.
   */
  readonly existingSubnetIds?: string[];

  /**
   * Existing Directory Service ID.
   * Required when createManagedAd is false or omitted.
   */
  readonly existingDirectoryId?: string;

  /**
   * Create an AWS Managed Microsoft AD alongside the WorkSpaces foundation.
   *
   * @default false
   */
  readonly createManagedAd?: boolean;

  /**
   * Domain name for the Managed AD. Required when createManagedAd is true.
   */
  readonly adDomainName?: string;

  /**
   * Admin password for the Managed AD. Should come from Secrets Manager.
   * Required when createManagedAd is true.
   */
  readonly adAdminPassword?: SecretValue;

  /**
   * Import an existing KMS CMK by ARN instead of creating a new one.
   * When omitted, a new key is created and rotated automatically.
   */
  readonly existingKmsKeyArn?: string;

  /**
   * Set to true if workspaces_DefaultRole already exists in the account.
   *
   * @default false
   */
  readonly workspacesDefaultRoleExists?: boolean;

  /**
   * Custom name for the storage S3 bucket.
   */
  readonly bucketName?: string;

  /**
   * Import an existing storage S3 bucket by name.
   */
  readonly existingBucketName?: string;
}

/**
 * Example pattern: long-lived WorkSpaces foundation stack.
 *
 * Deploys the shared infrastructure for an AWS WorkSpaces environment:
 * VPC (or lookup of an existing VPC), KMS encryption, optional AWS Managed AD,
 * WorkSpaces IAM role, directory registration, S3 storage, and an SSM patch baseline.
 *
 * Deploy once per environment. Individual WorkSpaces live in separate
 * WorkspacesUserStack instances — destroy those freely without touching this stack.
 *
 * Usage:
 * ```typescript
 * const foundation = new WorkspacesFoundationStack(app, 'WorkspacesFoundation', {
 *   env: {account: '111122223333', region: 'us-east-2'},
 *   existingVpcId: 'vpc-0123456789abcdef0',
 *   existingDirectoryId: 'd-1234567890',
 *   existingKmsKeyArn: 'arn:aws:kms:us-east-2:111122223333:key/...',
 * });
 * ```
 */
export class WorkspacesFoundationStack extends ExtendedStack {
  /**
   * Directory ID — pass to WorkspacesUserStack.
   */
  readonly directoryId: string;

  /**
   * KMS key ARN — pass to WorkspacesUserStack for volume encryption.
   */
  readonly kmsKeyArn: string;

  /**
   * Patch group name — pass to WorkspacesUserStack for SSM patch targeting.
   */
  readonly patchGroupName: string;

  constructor(
    scope: Construct,
    id: string,
    props: WorkspacesFoundationStackProps,
  ) {
    super(scope, id, props);

    // KMS — import existing key or create a new CMK with annual rotation.
    const encryptionKey: kms.IKey = props.existingKmsKeyArn
      ? kms.Key.fromKeyArn(this, 'EncryptionKey', props.existingKmsKeyArn)
      : new kms.Key(this, 'EncryptionKey', {
          description: `${this.stackName} WorkSpaces encryption key`,
          enableKeyRotation: true,
          removalPolicy: cdk.RemovalPolicy.RETAIN,
        });

    this.kmsKeyArn = encryptionKey.keyArn;

    // VPC — look up an existing one or create a minimal private+public VPC.
    const vpc = props.existingVpcId
      ? ec2.Vpc.fromLookup(this, 'Vpc', {vpcId: props.existingVpcId})
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

    const subnets = props.existingSubnetIds?.map((subnetId, i) =>
      ec2.Subnet.fromSubnetId(this, `Subnet${i}`, subnetId),
    );

    const workspaces = new AwsWorkspaces(this, 'Workspaces', {
      encryption: {encryptionKey},
      networking: {vpc, subnets},
      directory: {
        existingDirectoryId: props.existingDirectoryId,
        createManagedAd: props.createManagedAd,
        adDomainName: props.adDomainName,
        adAdminPassword: props.adAdminPassword,
      },
      storage: {
        bucketName: props.bucketName,
        existingBucketName: props.existingBucketName,
      },
      infrastructure: {
        workspacesDefaultRoleExists: props.workspacesDefaultRoleExists,
      },
    });

    this.directoryId = workspaces.directoryId;
    this.patchGroupName = workspaces.patchGroupName;

    // Standard TrueMark security tags
    this.standardTags.addSecurityTags({
      dataClassification: DataClassification.Restricted,
      dataSensitivity: DataSensitivity.PHI,
    });

    new cdk.CfnOutput(this, 'DirectoryId', {
      value: this.directoryId,
      exportName: `${this.stackName}-DirectoryId`,
    });
    new cdk.CfnOutput(this, 'KmsKeyArn', {
      value: this.kmsKeyArn,
      exportName: `${this.stackName}-KmsKeyArn`,
    });
    new cdk.CfnOutput(this, 'PatchGroupName', {
      value: this.patchGroupName,
      exportName: `${this.stackName}-PatchGroupName`,
    });
    new cdk.CfnOutput(this, 'VpcId', {
      value: vpc.vpcId,
      exportName: `${this.stackName}-VpcId`,
    });
  }
}
