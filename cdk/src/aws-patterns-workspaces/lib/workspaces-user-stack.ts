import * as cdk from 'aws-cdk-lib/core';
import type {Construct} from 'constructs';
import {
  DataClassification,
  DataSensitivity,
  ExtendedStack,
  type ExtendedStackProps,
} from '../../aws-cdk';
import {AwsWorkspacesUser} from '../../aws-workspaces';

/**
 * Props for WorkspacesUserStack.
 * Cross-stack values (directoryId, kmsKeyArn, patchGroupName) come from WorkspacesFoundationStack.
 */
export interface WorkspacesUserStackProps extends ExtendedStackProps {
  /**
   * Directory ID from WorkspacesFoundationStack.directoryId.
   */
  readonly directoryId: string;

  /**
   * KMS key ARN from WorkspacesFoundationStack.kmsKeyArn.
   * Required when volumeEncryptionEnabled is true (the default when a key is present).
   */
  readonly kmsKeyArn: string;

  /**
   * Patch group name from WorkspacesFoundationStack.patchGroupName.
   * Tags the WorkSpace so SSM Patch Manager applies the configured baseline.
   */
  readonly patchGroupName: string;

  /**
   * Username of the directory user who will own this WorkSpace.
   * Must already exist in the directory.
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
   * Enable KMS encryption on WorkSpace root and user volumes.
   * Set to false only for golden-image build WorkSpaces.
   *
   * @default true when kmsKeyArn is provided
   */
  readonly volumeEncryptionEnabled?: boolean;

  /**
   * Minutes before an AUTO_STOP WorkSpace shuts down after the last disconnect.
   * Must be a multiple of 60.
   *
   * @default 60
   */
  readonly autoStopTimeoutInMinutes?: number;
}

/**
 * Example pattern: per-user WorkSpace stack.
 *
 * Deploy one per user. Destroy it to remove only that user's WorkSpace without
 * affecting the shared WorkspacesFoundationStack.
 *
 * Usage:
 * ```typescript
 * const foundation = new WorkspacesFoundationStack(app, 'WorkspacesFoundation', {...});
 *
 * new WorkspacesUserStack(app, `Workspace-johndoe`, {
 *   env: {account: '111122223333', region: 'us-east-2'},
 *   directoryId: foundation.directoryId,
 *   kmsKeyArn: foundation.kmsKeyArn,
 *   patchGroupName: foundation.patchGroupName,
 *   userName: 'johndoe',
 *   bundleId: 'wsb-dc06lb363',  // Rocky Linux 9 Performance
 * });
 * ```
 */
export class WorkspacesUserStack extends ExtendedStack {
  constructor(
    scope: Construct,
    id: string,
    props: WorkspacesUserStackProps,
  ) {
    super(scope, id, props);

    const instance = new AwsWorkspacesUser(this, 'Workspace', {
      directoryId: props.directoryId,
      kmsKeyArn: props.kmsKeyArn,
      patchGroupName: props.patchGroupName,
      userName: props.userName,
      bundleId: props.bundleId,
      runningMode: props.runningMode,
      computeType: props.computeType,
      rootVolumeSizeGib: props.rootVolumeSizeGib,
      userVolumeSizeGib: props.userVolumeSizeGib,
      volumeEncryptionEnabled: props.volumeEncryptionEnabled,
      autoStopTimeoutInMinutes: props.autoStopTimeoutInMinutes,
    });

    this.standardTags.addSecurityTags({
      dataClassification: DataClassification.Restricted,
      dataSensitivity: DataSensitivity.PHI,
    });

    new cdk.CfnOutput(this, 'WorkspaceId', {
      value: instance.workspace.ref,
      description: `WorkSpace ID for ${props.userName}`,
    });
  }
}
