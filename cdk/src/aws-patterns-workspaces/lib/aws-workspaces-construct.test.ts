import * as path from 'path';
import {SecretValue} from 'aws-cdk-lib';
import {Match, Template} from 'aws-cdk-lib/assertions';
import {test, expect} from 'vitest';
import {HelperTest} from '../../helper.test';
import {AwsWorkspaces} from './aws-workspaces-construct';

function makeTemplate(extraProps: Record<string, unknown> = {}) {
  const stack = HelperTest.stack();
  new AwsWorkspaces(stack, 'TestWorkspaces', {
    directory: {existingDirectoryId: 'd-1234567890'},
    ...extraProps,
  });
  return Template.fromStack(stack);
}

// ============================================================
// KMS encryption
// ============================================================

test('new KMS key created with rotation by default', () => {
  const template = makeTemplate();
  template.hasResourceProperties('AWS::KMS::Key', {EnableKeyRotation: true});
});

test('no new KMS key when existingKeyArn provided', () => {
  const template = makeTemplate({
    encryption: {
      existingKeyArn:
        'arn:aws:kms:us-east-2:100000000000:key/00000000-0000-0000-0000-000000000000',
    },
  });
  template.resourceCountIs('AWS::KMS::Key', 0);
});

test('KMS key policy allows CloudWatch Logs service principal', () => {
  const template = makeTemplate();
  // CDK resolves the region token when account/region are known at synth time
  template.hasResourceProperties('AWS::KMS::Key', {
    KeyPolicy: Match.objectLike({
      Statement: Match.arrayWith([
        Match.objectLike({
          Sid: 'AllowCloudWatchLogs',
          Principal: Match.objectLike({
            Service: Match.stringLikeRegexp('logs\\..*\\.amazonaws\\.com'),
          }),
        }),
      ]),
    }),
  });
});

// ============================================================
// Networking
// ============================================================

test('VPC created when existingVpcId not provided', () => {
  const template = makeTemplate();
  template.resourceCountIs('AWS::EC2::VPC', 1);
});

test('no VPC when existingVpcId provided', () => {
  const template = makeTemplate({
    networking: {existingVpcId: 'vpc-12345678'},
  });
  template.resourceCountIs('AWS::EC2::VPC', 0);
});

test('isolated subnets created for new VPC', () => {
  const template = makeTemplate();
  template.hasResourceProperties('AWS::EC2::Subnet', {
    MapPublicIpOnLaunch: false,
  });
});

test('flow logs created for new VPC', () => {
  const template = makeTemplate();
  template.resourceCountIs('AWS::EC2::FlowLog', 2);
});

test('no flow logs when using existing VPC', () => {
  const template = makeTemplate({
    networking: {existingVpcId: 'vpc-12345678'},
  });
  template.resourceCountIs('AWS::EC2::FlowLog', 0);
});

// ============================================================
// Storage
// ============================================================

test('storage bucket has RETAIN removal policy', () => {
  const template = makeTemplate();
  const buckets = template.findResources('AWS::S3::Bucket');
  const retainBuckets = Object.values(buckets).filter(
    (b) => (b as {DeletionPolicy?: string}).DeletionPolicy === 'Retain',
  );
  expect(retainBuckets.length).toBeGreaterThanOrEqual(1);
});

test('storage bucket uses KMS encryption and object lock', () => {
  const template = makeTemplate();
  template.hasResourceProperties('AWS::S3::Bucket', {
    BucketEncryption: {
      ServerSideEncryptionConfiguration: [
        {ServerSideEncryptionByDefault: {SSEAlgorithm: 'aws:kms'}},
      ],
    },
    ObjectLockEnabled: true,
  });
});

test('access log bucket uses S3-managed encryption', () => {
  const template = makeTemplate();
  template.hasResourceProperties('AWS::S3::Bucket', {
    BucketEncryption: {
      ServerSideEncryptionConfiguration: [
        {ServerSideEncryptionByDefault: {SSEAlgorithm: 'AES256'}},
      ],
    },
  });
});

test('existing storage bucket imported when existingBucketName provided', () => {
  // When both storage buckets are imported AND an existing VPC is used (no flow log bucket),
  // no S3 Bucket resources should be created.
  const stack = HelperTest.stack();
  new AwsWorkspaces(stack, 'TestWorkspaces', {
    directory: {existingDirectoryId: 'd-1234567890'},
    networking: {existingVpcId: 'vpc-12345678'},
    storage: {
      existingBucketName: 'my-existing-bucket',
      existingAccessLogBucketName: 'my-existing-log-bucket',
    },
  });
  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::S3::Bucket', 0);
});

// ============================================================
// WorkSpaces default role
// ============================================================

test('workspaces_DefaultRole created when workspacesDefaultRoleExists is false', () => {
  const template = makeTemplate();
  template.hasResourceProperties('AWS::IAM::Role', {
    RoleName: 'workspaces_DefaultRole',
    AssumeRolePolicyDocument: {
      Statement: [
        {
          Action: 'sts:AssumeRole',
          Effect: 'Allow',
          Principal: {Service: 'workspaces.amazonaws.com'},
        },
      ],
    },
  });
});

test('workspaces_DefaultRole uses only managed policies (no inline policies)', () => {
  const template = makeTemplate();
  // The role should have managed policies attached but no inline PolicyDocument
  template.hasResourceProperties('AWS::IAM::Role', {
    RoleName: 'workspaces_DefaultRole',
    ManagedPolicyArns: Match.arrayWith([
      Match.objectLike({
        'Fn::Join': Match.arrayWith([
          Match.arrayWith([
            Match.stringLikeRegexp('AmazonWorkSpacesServiceAccess'),
          ]),
        ]),
      }),
    ]),
  });
  const roles = template.findResources('AWS::IAM::Role', {
    Properties: {RoleName: 'workspaces_DefaultRole'},
  });
  const role = Object.values(roles)[0] as {Properties: Record<string, unknown>};
  expect(role.Properties['Policies']).toBeUndefined();
});

test('no workspaces_DefaultRole when workspacesDefaultRoleExists is true', () => {
  const template = makeTemplate({
    infrastructure: {workspacesDefaultRoleExists: true},
  });
  const roles = template.findResources('AWS::IAM::Role', {
    Properties: {RoleName: 'workspaces_DefaultRole'},
  });
  expect(Object.keys(roles).length).toBe(0);
});

// ============================================================
// Directory registration — always-present custom resource
// ============================================================

test('directory registration policy created even without infrastructure props', () => {
  const template = makeTemplate();
  template.hasResourceProperties('AWS::IAM::ManagedPolicy', {
    PolicyDocument: Match.objectLike({
      Statement: Match.arrayWith([
        Match.objectLike({
          Sid: 'AllowWorkspacesDirectoryRegistration',
          Action: Match.arrayWith([
            'workspaces:RegisterWorkspaceDirectory',
            'workspaces:DeregisterWorkspaceDirectory',
          ]),
        }),
      ]),
    }),
  });
});

test('custom resource role created for directory registration', () => {
  const template = makeTemplate();
  template.hasResourceProperties('AWS::IAM::Role', {
    AssumeRolePolicyDocument: {
      Statement: [
        {
          Action: 'sts:AssumeRole',
          Effect: 'Allow',
          Principal: {Service: 'lambda.amazonaws.com'},
        },
      ],
    },
  });
});

// ============================================================
// Infrastructure block
// ============================================================

test('no patch baseline without infrastructure props', () => {
  const template = makeTemplate();
  template.resourceCountIs('AWS::SSM::PatchBaseline', 0);
});

test('patch baseline created with infrastructure props', () => {
  const template = makeTemplate({infrastructure: {}});
  template.resourceCountIs('AWS::SSM::PatchBaseline', 1);
});

test('patch baseline uses default OS when operatingSystem not specified', () => {
  const template = makeTemplate({infrastructure: {}});
  template.hasResourceProperties('AWS::SSM::PatchBaseline', {
    OperatingSystem: 'AMAZON_LINUX_2023',
  });
});

test('patch baseline uses custom OS when operatingSystem specified', () => {
  const template = makeTemplate({
    infrastructure: {operatingSystem: 'ROCKY_LINUX'},
  });
  template.hasResourceProperties('AWS::SSM::PatchBaseline', {
    OperatingSystem: 'ROCKY_LINUX',
  });
});

test('patch baseline has HIPAA-compliant approval rules', () => {
  const template = makeTemplate({infrastructure: {}});
  template.hasResourceProperties('AWS::SSM::PatchBaseline', {
    ApprovalRules: {
      PatchRules: Match.arrayWith([
        Match.objectLike({
          ApproveAfterDays: 7,
          ComplianceLevel: 'CRITICAL',
        }),
      ]),
    },
  });
});

test('SSM hybrid activation role created with infrastructure props', () => {
  const template = makeTemplate({infrastructure: {}});
  template.hasResourceProperties('AWS::IAM::Role', {
    AssumeRolePolicyDocument: {
      Statement: [
        {
          Action: 'sts:AssumeRole',
          Effect: 'Allow',
          Principal: {Service: 'ssm.amazonaws.com'},
        },
      ],
    },
  });
});

test('infrastructure policy includes SSM activation permissions', () => {
  const template = makeTemplate({infrastructure: {}});
  template.hasResourceProperties('AWS::IAM::ManagedPolicy', {
    PolicyDocument: Match.objectLike({
      Statement: Match.arrayWith([
        Match.objectLike({
          Sid: 'AllowSsmActivation',
          Action: Match.arrayWith([
            'ssm:CreateActivation',
            'ssm:DeleteActivation',
          ]),
        }),
      ]),
    }),
  });
});

test('SSM activation ID and region parameters created with infrastructure', () => {
  const template = makeTemplate({infrastructure: {}});
  const params = template.findResources('AWS::SSM::Parameter');
  const paramValues = Object.values(params).map((p) =>
    JSON.stringify((p as Record<string, unknown>).Properties),
  );
  const hasActivationId = paramValues.some((v) => v.includes('/id'));
  const hasActivationRegion = paramValues.some((v) => v.includes('/region'));
  expect(hasActivationId).toBe(true);
  expect(hasActivationRegion).toBe(true);
});

// ============================================================
// Packages / SSM Association
// ============================================================

test('no SSM association without packages prop', () => {
  const template = makeTemplate({infrastructure: {}});
  template.resourceCountIs('AWS::SSM::Association', 0);
});

test('packages association created with package list', () => {
  const template = makeTemplate({
    infrastructure: {packages: {packages: ['curl', 'git']}},
  });
  template.resourceCountIs('AWS::SSM::Association', 1);
  template.hasResourceProperties('AWS::SSM::Association', {
    Name: 'AWS-RunShellScript',
    Targets: [{Key: 'tag:ManagedBy', Values: ['CDK']}],
  });
});

test('packages association generated command includes package names', () => {
  const template = makeTemplate({
    infrastructure: {packages: {packages: ['curl', 'git']}},
  });
  const associations = template.findResources('AWS::SSM::Association');
  const assocJson = JSON.stringify(Object.values(associations)[0]);
  expect(assocJson).toContain('curl');
  expect(assocJson).toContain('git');
});

test('packages association created with scriptPath', () => {
  const template = makeTemplate({
    infrastructure: {
      packages: {scriptPath: path.join(__dirname, 'test-script.sh')},
    },
  });
  template.resourceCountIs('AWS::SSM::Association', 1);
  template.hasResourceProperties('AWS::SSM::Association', {
    Name: 'AWS-RunShellScript',
  });
});

test('scriptPath content is embedded in the association', () => {
  const template = makeTemplate({
    infrastructure: {
      packages: {scriptPath: path.join(__dirname, 'test-script.sh')},
    },
  });
  const associations = template.findResources('AWS::SSM::Association');
  const assocJson = JSON.stringify(Object.values(associations)[0]);
  // The test-script.sh contains 'test script' — it should appear in the commands parameter
  expect(assocJson).toContain('test script');
});

// ============================================================
// SSH hardening Lambda
// ============================================================

test('no SSH hardening Lambda without infrastructure props', () => {
  const template = makeTemplate();
  const lambdas = template.findResources('AWS::Lambda::Function');
  const hasRevokeSsh = Object.values(lambdas).some((fn) =>
    JSON.stringify(fn).includes('DescribeSecurityGroups'),
  );
  expect(hasRevokeSsh).toBe(false);
});

test('SSH hardening Lambda created with infrastructure props', () => {
  const template = makeTemplate({infrastructure: {}});
  const lambdas = template.findResources('AWS::Lambda::Function');
  const hasRevokeSsh = Object.values(lambdas).some((fn) =>
    JSON.stringify(fn).includes('DescribeSecurityGroups'),
  );
  expect(hasRevokeSsh).toBe(true);
});

// ============================================================
// MFA
// ============================================================

test('no MFA policy statement without mfa props', () => {
  const template = makeTemplate({infrastructure: {}});
  const policies = template.findResources('AWS::IAM::ManagedPolicy');
  const hasMfa = Object.values(policies).some((p) =>
    JSON.stringify(p).includes('AllowDirectoryMfa'),
  );
  expect(hasMfa).toBe(false);
});

test('MFA policy statement added when mfa provided', () => {
  const template = makeTemplate({
    infrastructure: {
      mfa: {
        radiusServers: ['10.0.0.1'],
        sharedSecret: SecretValue.unsafePlainText('test-secret'),
      },
    },
  });
  template.hasResourceProperties('AWS::IAM::ManagedPolicy', {
    PolicyDocument: Match.objectLike({
      Statement: Match.arrayWith([
        Match.objectLike({
          Sid: 'AllowDirectoryMfa',
          Action: Match.arrayWith([
            'ds:EnableRadius',
            'ds:DisableRadius',
            'ds:UpdateRadius',
          ]),
        }),
      ]),
    }),
  });
});

// ============================================================
// CloudWatch logging
// ============================================================

test('WorkSpaces CloudWatch log group created by default', () => {
  const template = makeTemplate();
  const logGroups = template.findResources('AWS::Logs::LogGroup');
  const hasWorkspacesLog = Object.values(logGroups).some((lg) =>
    JSON.stringify(lg).includes('/aws/workspaces/'),
  );
  expect(hasWorkspacesLog).toBe(true);
});
