import {Match, Template} from 'aws-cdk-lib/assertions';
import {expect, test} from 'vitest';
import {HelperTest} from '../../helper.test';
import {AwsWorkspacesUser} from './aws-workspaces-user-construct';

const TEST_KMS_KEY_ARN =
  'arn:aws:kms:us-east-2:100000000000:key/00000000-0000-0000-0000-000000000000';
const TEST_DIRECTORY_ID = 'd-1234567890';
const TEST_PATCH_GROUP = 'TestStack-workspaces';
const TEST_BUNDLE_ID = 'wsb-dc06lb363'; // Performance (Rocky Linux 9) — constrained bundle

function makeTemplate(extraProps: Record<string, unknown> = {}) {
  const stack = HelperTest.stack();
  new AwsWorkspacesUser(stack, 'TestUser', {
    directoryId: TEST_DIRECTORY_ID,
    kmsKeyArn: TEST_KMS_KEY_ARN,
    patchGroupName: TEST_PATCH_GROUP,
    userName: 'testuser',
    bundleId: TEST_BUNDLE_ID,
    ...extraProps,
  });
  return Template.fromStack(stack);
}

// ============================================================
// WorkSpace resource
// ============================================================

test('CfnWorkspace resource created', () => {
  const template = makeTemplate();
  template.resourceCountIs('AWS::WorkSpaces::Workspace', 1);
});

test('WorkSpace user name set correctly', () => {
  const template = makeTemplate({userName: 'john.doe'});
  template.hasResourceProperties('AWS::WorkSpaces::Workspace', {
    UserName: 'john.doe',
  });
});

test('WorkSpace directory ID set correctly', () => {
  const template = makeTemplate();
  template.hasResourceProperties('AWS::WorkSpaces::Workspace', {
    DirectoryId: TEST_DIRECTORY_ID,
  });
});

test('WorkSpace bundle ID set correctly', () => {
  const template = makeTemplate();
  template.hasResourceProperties('AWS::WorkSpaces::Workspace', {
    BundleId: TEST_BUNDLE_ID,
  });
});

// ============================================================
// Volume encryption
// ============================================================

test('volume encryption enabled by default', () => {
  const template = makeTemplate();
  template.hasResourceProperties('AWS::WorkSpaces::Workspace', {
    RootVolumeEncryptionEnabled: true,
    UserVolumeEncryptionEnabled: true,
    VolumeEncryptionKey: TEST_KMS_KEY_ARN,
  });
});

test('volume encryption disabled when volumeEncryptionEnabled is false', () => {
  const template = makeTemplate({volumeEncryptionEnabled: false});
  template.hasResourceProperties('AWS::WorkSpaces::Workspace', {
    RootVolumeEncryptionEnabled: false,
    UserVolumeEncryptionEnabled: false,
  });
  // Encryption key must not be set when encryption is disabled
  const workspaces = template.findResources('AWS::WorkSpaces::Workspace');
  const ws = Object.values(workspaces)[0] as {
    Properties: Record<string, unknown>;
  };
  expect(ws.Properties.VolumeEncryptionKey).toBeUndefined();
});

// ============================================================
// Default compute and volume properties
// ============================================================

test('default compute type is PERFORMANCE', () => {
  const template = makeTemplate();
  template.hasResourceProperties('AWS::WorkSpaces::Workspace', {
    WorkspaceProperties: {
      ComputeTypeName: 'PERFORMANCE',
    },
  });
});

test('custom compute type accepted', () => {
  const template = makeTemplate({computeType: 'STANDARD'});
  template.hasResourceProperties('AWS::WorkSpaces::Workspace', {
    WorkspaceProperties: {
      ComputeTypeName: 'STANDARD',
    },
  });
});

test('default running mode is AUTO_STOP with 60-minute timeout', () => {
  const template = makeTemplate();
  template.hasResourceProperties('AWS::WorkSpaces::Workspace', {
    WorkspaceProperties: {
      RunningMode: 'AUTO_STOP',
      RunningModeAutoStopTimeoutInMinutes: 60,
    },
  });
});

test('ALWAYS_ON mode has no auto-stop timeout', () => {
  const template = makeTemplate({runningMode: 'ALWAYS_ON'});
  const workspaces = template.findResources('AWS::WorkSpaces::Workspace');
  const ws = Object.values(workspaces)[0] as {
    Properties: {WorkspaceProperties: Record<string, unknown>};
  };
  expect(
    ws.Properties.WorkspaceProperties.RunningModeAutoStopTimeoutInMinutes,
  ).toBeUndefined();
});

// ============================================================
// Tags
// ============================================================

test('ManagedBy=CDK tag applied', () => {
  const template = makeTemplate();
  template.hasResourceProperties('AWS::WorkSpaces::Workspace', {
    Tags: Match.arrayWith([{Key: 'ManagedBy', Value: 'CDK'}]),
  });
});

test('Compliance=HIPAA tag applied', () => {
  const template = makeTemplate();
  template.hasResourceProperties('AWS::WorkSpaces::Workspace', {
    Tags: Match.arrayWith([{Key: 'Compliance', Value: 'HIPAA'}]),
  });
});

test('Patch Group tag set to patchGroupName', () => {
  const template = makeTemplate({patchGroupName: 'my-patch-group'});
  template.hasResourceProperties('AWS::WorkSpaces::Workspace', {
    Tags: Match.arrayWith([{Key: 'Patch Group', Value: 'my-patch-group'}]),
  });
});

// ============================================================
// BUNDLE_CONSTRAINTS enforcement
// ============================================================

test('throws when rootVolumeSizeGib is below bundle minimum', () => {
  const stack = HelperTest.stack();
  expect(() => {
    new AwsWorkspacesUser(stack, 'TestUser', {
      directoryId: TEST_DIRECTORY_ID,
      kmsKeyArn: TEST_KMS_KEY_ARN,
      patchGroupName: TEST_PATCH_GROUP,
      userName: 'testuser',
      bundleId: TEST_BUNDLE_ID, // wsb-dc06lb363 requires minRootGib: 80
      rootVolumeSizeGib: 50, // below minimum
    });
  }).toThrow(/rootVolumeSizeGib/);
});

test('throws when userVolumeSizeGib is below bundle minimum', () => {
  const stack = HelperTest.stack();
  expect(() => {
    new AwsWorkspacesUser(stack, 'TestUser', {
      directoryId: TEST_DIRECTORY_ID,
      kmsKeyArn: TEST_KMS_KEY_ARN,
      patchGroupName: TEST_PATCH_GROUP,
      userName: 'testuser',
      bundleId: TEST_BUNDLE_ID, // wsb-dc06lb363 requires minUserGib: 100
      userVolumeSizeGib: 50, // below minimum
    });
  }).toThrow(/userVolumeSizeGib/);
});

test('no error for unconstrained bundle IDs', () => {
  const stack = HelperTest.stack();
  expect(() => {
    new AwsWorkspacesUser(stack, 'TestUser', {
      directoryId: TEST_DIRECTORY_ID,
      kmsKeyArn: TEST_KMS_KEY_ARN,
      patchGroupName: TEST_PATCH_GROUP,
      userName: 'testuser',
      bundleId: 'wsb-unknown-bundle', // not in BUNDLE_CONSTRAINTS — any size accepted
      rootVolumeSizeGib: 10,
      userVolumeSizeGib: 10,
    });
  }).not.toThrow();
});

test('accepts volumes at exactly the bundle minimum', () => {
  const stack = HelperTest.stack();
  expect(() => {
    new AwsWorkspacesUser(stack, 'TestUser', {
      directoryId: TEST_DIRECTORY_ID,
      kmsKeyArn: TEST_KMS_KEY_ARN,
      patchGroupName: TEST_PATCH_GROUP,
      userName: 'testuser',
      bundleId: TEST_BUNDLE_ID, // min: 80 root, 100 user
      rootVolumeSizeGib: 80,
      userVolumeSizeGib: 100,
    });
  }).not.toThrow();
});
