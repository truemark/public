import * as workspaces from 'aws-cdk-lib/aws-workspaces';
import type {Construct} from 'constructs';
import {
  ExtendedConstruct,
  type ExtendedConstructProps,
  StandardTags,
} from '../../aws-cdk';
import {LibStandardTags} from '../../truemark';

// Minimum volume sizes for known bundle IDs. Enforced at synthesis time.
// Keys are AWS WorkSpaces bundle IDs; values are per-bundle minimums in GiB.
const BUNDLE_CONSTRAINTS: Record<
  string,
  {minRootGib: number; minUserGib: number}
> = {
  'wsb-dc06lb363': {minRootGib: 80, minUserGib: 100}, // Performance (Rocky Linux 9)
  'wsb-0fbcfzzxj': {minRootGib: 80, minUserGib: 100}, // PowerPro (Rocky Linux 9)
  'wsb-jv52cj5j0': {minRootGib: 80, minUserGib: 50}, // Standard (Rocky Linux 9)
  'wsb-wztpvcf84': {minRootGib: 80, minUserGib: 100}, // Power (Rocky Linux 9)
  'wsb-g5rbnq51n': {minRootGib: 80, minUserGib: 50}, // Standard (Ubuntu 22.04, us-west-2)
};

/**
 * Properties for AwsWorkspacesUser.
 */
export interface AwsWorkspacesUserProps extends ExtendedConstructProps {
  /**
   * Directory ID from the AwsWorkspaces foundation construct.
   */
  readonly directoryId: string;

  /**
   * KMS key ARN from the AwsWorkspaces foundation construct for volume encryption.
   */
  readonly kmsKeyArn: string;

  /**
   * Patch group name from the AwsWorkspaces foundation construct.
   * The WorkSpace is tagged with this value so SSM Patch Manager applies the
   * HIPAA patch baseline.
   */
  readonly patchGroupName: string;

  /**
   * Username for the WorkSpace. Must already exist in the directory.
   */
  readonly userName: string;

  /**
   * WorkSpaces bundle ID (e.g., 'wsb-dc06lb363' for Rocky Linux 9 Performance).
   */
  readonly bundleId: string;

  /**
   * WorkSpaces running mode.
   *
   * @default 'AUTO_STOP'
   */
  readonly runningMode?: 'AUTO_STOP' | 'ALWAYS_ON';

  /**
   * WorkSpaces compute type.
   *
   * @default 'PERFORMANCE'
   */
  readonly computeType?:
    | 'VALUE'
    | 'STANDARD'
    | 'PERFORMANCE'
    | 'POWER'
    | 'GRAPHICS'
    | 'GRAPHICSPRO';

  /**
   * Root volume size in GiB. Must meet the bundle minimum.
   *
   * @default 80
   */
  readonly rootVolumeSizeGib?: number;

  /**
   * User volume size in GiB. Must meet the bundle minimum.
   *
   * @default 100
   */
  readonly userVolumeSizeGib?: number;

  /**
   * Enable KMS encryption on the WorkSpace root and user volumes.
   * Set to false only for a dedicated golden-image build WorkSpace — AWS WorkSpaces
   * cannot capture a custom bundle from a WorkSpace with encrypted volumes.
   *
   * @default true
   */
  readonly volumeEncryptionEnabled?: boolean;
}

/**
 * A single AWS WorkSpace for one user.
 *
 * Deploy one AwsWorkspacesUser (or a stack containing one) per user. Destroying it
 * removes only that user's WorkSpace without affecting the shared AwsWorkspaces
 * foundation (VPC, KMS, Directory, S3, SSM infrastructure).
 *
 * The WorkSpace is tagged with ManagedBy=CDK so SSM Associations defined in the
 * AwsWorkspaces infrastructure layer automatically apply to it, and with
 * Patch Group=<patchGroupName> so the HIPAA patch baseline applies.
 */
export class AwsWorkspacesUser extends ExtendedConstruct {
  static readonly DEFAULT_COMPUTE_TYPE = 'PERFORMANCE';
  static readonly DEFAULT_ROOT_VOLUME_GIB = 80;
  static readonly DEFAULT_USER_VOLUME_GIB = 100;

  readonly workspace: workspaces.CfnWorkspace;

  constructor(scope: Construct, id: string, props: AwsWorkspacesUserProps) {
    super(scope, id, {
      standardTags: StandardTags.merge(props.standardTags, LibStandardTags),
    });

    const constraints = BUNDLE_CONSTRAINTS[props.bundleId];
    if (constraints) {
      const rootGib =
        props.rootVolumeSizeGib ?? AwsWorkspacesUser.DEFAULT_ROOT_VOLUME_GIB;
      const userGib =
        props.userVolumeSizeGib ?? AwsWorkspacesUser.DEFAULT_USER_VOLUME_GIB;
      if (rootGib < constraints.minRootGib) {
        throw new Error(
          `rootVolumeSizeGib (${rootGib}) is below the minimum for bundle ${props.bundleId} (${constraints.minRootGib} GiB)`,
        );
      }
      if (userGib < constraints.minUserGib) {
        throw new Error(
          `userVolumeSizeGib (${userGib}) is below the minimum for bundle ${props.bundleId} (${constraints.minUserGib} GiB)`,
        );
      }
    }

    const runningMode = props.runningMode ?? 'AUTO_STOP';
    const computeType =
      props.computeType ?? AwsWorkspacesUser.DEFAULT_COMPUTE_TYPE;
    const volumeEncryptionEnabled = props.volumeEncryptionEnabled ?? true;

    this.workspace = new workspaces.CfnWorkspace(this, 'Workspace', {
      directoryId: props.directoryId,
      bundleId: props.bundleId,
      userName: props.userName,
      rootVolumeEncryptionEnabled: volumeEncryptionEnabled,
      userVolumeEncryptionEnabled: volumeEncryptionEnabled,
      volumeEncryptionKey: volumeEncryptionEnabled
        ? props.kmsKeyArn
        : undefined,
      workspaceProperties: {
        runningMode,
        runningModeAutoStopTimeoutInMinutes:
          runningMode === 'AUTO_STOP' ? 60 : undefined,
        rootVolumeSizeGib:
          props.rootVolumeSizeGib ?? AwsWorkspacesUser.DEFAULT_ROOT_VOLUME_GIB,
        userVolumeSizeGib:
          props.userVolumeSizeGib ?? AwsWorkspacesUser.DEFAULT_USER_VOLUME_GIB,
        computeTypeName: computeType,
      },
      tags: [
        {key: 'ManagedBy', value: 'CDK'},
        {key: 'Compliance', value: 'HIPAA'},
        {key: 'Patch Group', value: props.patchGroupName},
      ],
    });
  }
}
