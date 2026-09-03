import {Duration, RemovalPolicy} from 'aws-cdk-lib';
import {Match, Template} from 'aws-cdk-lib/assertions';
import {SecurityGroup, Vpc} from 'aws-cdk-lib/aws-ec2';
import {Role, ServicePrincipal} from 'aws-cdk-lib/aws-iam';
import {AuroraPostgresEngineVersion, ParameterGroup} from 'aws-cdk-lib/aws-rds';
import {expect, test} from 'vitest';
import {HelperTest} from '../../helper.test';
import {StandardPostgresAuroraServerlessCluster} from '../index';

const DB_CLUSTER = 'AWS::RDS::DBCluster';
const DB_INSTANCE = 'AWS::RDS::DBInstance';
const SECRET = 'AWS::SecretsManager::Secret';
const DB_PROXY = 'AWS::RDS::DBProxy';

function network() {
  const stack = HelperTest.stack();
  // natGateways: 0 gives the VPC isolated subnets, the construct's default placement.
  return {stack, vpc: new Vpc(stack, 'Vpc', {maxAzs: 2, natGateways: 0})};
}

test('Create cluster with defaults', () => {
  const {stack, vpc} = network();
  const cluster = new StandardPostgresAuroraServerlessCluster(stack, 'Db', {
    vpc,
  });
  const template = Template.fromStack(stack);

  template.resourceCountIs(DB_CLUSTER, 1);
  template.resourceCountIs(DB_INSTANCE, 2); // writer + one reader
  template.resourceCountIs(SECRET, 1);
  template.hasResourceProperties(DB_CLUSTER, {
    Engine: 'aurora-postgresql',
    ServerlessV2ScalingConfiguration: {MinCapacity: 0.5, MaxCapacity: 4},
    StorageEncrypted: true,
    StorageType: 'aurora',
    BackupRetentionPeriod: 7,
    DeletionProtection: true,
    EnableCloudwatchLogsExports: ['postgresql'],
  });
  template.hasResource(DB_CLUSTER, {
    DeletionPolicy: 'Retain',
    UpdateReplacePolicy: 'Retain',
  });
  template.hasResourceProperties(DB_INSTANCE, {
    DBInstanceClass: 'db.serverless',
    PubliclyAccessible: false,
    PromotionTier: 1, // reader scales with the writer
  });
  template.hasResourceProperties('Custom::LogRetention', {
    RetentionInDays: 30,
  });
  expect(cluster.secret).toBeDefined();
  expect(cluster.clusterEndpoint).toBeDefined();
  expect(template.toJSON()).toMatchSnapshot();
});

test('Create cluster with explicit settings', () => {
  const {stack, vpc} = network();
  new StandardPostgresAuroraServerlessCluster(stack, 'Db', {
    vpc,
    engineVersion: AuroraPostgresEngineVersion.VER_16_13,
    minCapacity: 2,
    maxCapacity: 32,
    readers: 2,
    readersInFailoverTier: false,
    databaseName: 'payroll',
    backupRetention: Duration.days(14),
    deletionProtection: false,
    removalPolicy: RemovalPolicy.DESTROY,
    enablePerformanceInsights: true,
    ioOptimized: true,
  });
  const template = Template.fromStack(stack);

  template.resourceCountIs(DB_INSTANCE, 3);
  template.hasResourceProperties(DB_CLUSTER, {
    EngineVersion: '16.13',
    ServerlessV2ScalingConfiguration: {MinCapacity: 2, MaxCapacity: 32},
    DatabaseName: 'payroll',
    BackupRetentionPeriod: 14,
    DeletionProtection: false,
    StorageType: 'aurora-iopt1',
  });
  template.hasResource(DB_CLUSTER, {DeletionPolicy: 'Delete'});
  // Cluster-level Performance Insights renders on the cluster resource.
  template.hasResourceProperties(DB_CLUSTER, {
    PerformanceInsightsEnabled: true,
  });
  template.hasResourceProperties(DB_INSTANCE, {
    PromotionTier: 2, // readers outside the failover tier
  });
  expect(template.toJSON()).toMatchSnapshot();
});

test('Wire automatic pause when minCapacity is 0', () => {
  const {stack, vpc} = network();
  new StandardPostgresAuroraServerlessCluster(stack, 'Db', {
    vpc,
    minCapacity: 0,
    maxCapacity: 8,
    secondsUntilAutoPause: 600,
  });
  Template.fromStack(stack).hasResourceProperties(DB_CLUSTER, {
    ServerlessV2ScalingConfiguration: {
      MinCapacity: 0,
      MaxCapacity: 8,
      SecondsUntilAutoPause: 600,
    },
  });
});

test('Accept the 256 ACU ceiling', () => {
  const {stack, vpc} = network();
  new StandardPostgresAuroraServerlessCluster(stack, 'Db', {
    vpc,
    minCapacity: 8,
    maxCapacity: 256,
  });
  Template.fromStack(stack).hasResourceProperties(DB_CLUSTER, {
    ServerlessV2ScalingConfiguration: {MinCapacity: 8, MaxCapacity: 256},
  });
});

test('Reject invalid capacity, reader and auto-pause settings', () => {
  const {stack, vpc} = network();
  const create =
    (
      id: string,
      props: Partial<
        ConstructorParameters<typeof StandardPostgresAuroraServerlessCluster>[2]
      >,
    ) =>
    () =>
      new StandardPostgresAuroraServerlessCluster(stack, id, {vpc, ...props});
  expect(create('A', {minCapacity: 4, maxCapacity: 2})).toThrow(
    /must not exceed/,
  );
  expect(create('B', {maxCapacity: 512})).toThrow(/at most 256/);
  expect(create('C', {minCapacity: 1.25})).toThrow(/half-step/);
  expect(create('D', {readers: 1.5})).toThrow(/non-negative integer/);
  expect(create('E', {minCapacity: 0.5, secondsUntilAutoPause: 600})).toThrow(
    /requires minCapacity to be 0/,
  );
  expect(create('F', {minCapacity: 0, secondsUntilAutoPause: 60})).toThrow(
    /between 300 and 86400/,
  );
});

test('Reject parameterGroup combined with parameters', () => {
  const {stack, vpc} = network();
  const group = ParameterGroup.fromParameterGroupName(
    stack,
    'Existing',
    'default.aurora-postgresql17',
  );
  expect(
    () =>
      new StandardPostgresAuroraServerlessCluster(stack, 'Db', {
        vpc,
        parameterGroup: group,
        parameters: {shared_preload_libraries: 'pg_stat_statements'},
      }),
  ).toThrow(/cannot be combined/);
});

test('Apply parameters through a construct-created parameter group', () => {
  const {stack, vpc} = network();
  new StandardPostgresAuroraServerlessCluster(stack, 'Db', {
    vpc,
    parameters: {shared_preload_libraries: 'pg_stat_statements'},
  });
  Template.fromStack(stack).hasResourceProperties(
    'AWS::RDS::DBClusterParameterGroup',
    {Parameters: {shared_preload_libraries: 'pg_stat_statements'}},
  );
});

test('Module exports only implemented constructs', async () => {
  const exported = Object.keys(await import('../index'));
  expect(exported).toContain('StandardPostgresAuroraServerlessCluster');
  for (const stub of [
    'StandardPostgresAuroraCluster',
    'StandardPostgresCluster',
    'StandardPostgresInstance',
  ]) {
    expect(exported).not.toContain(stub);
  }
});

test('allowFrom opens the database port to peers', () => {
  const {stack, vpc} = network();
  const app = new SecurityGroup(stack, 'App', {vpc});
  new StandardPostgresAuroraServerlessCluster(stack, 'Db', {
    vpc,
    allowFrom: [app],
  });
  // The port is a token that resolves to the cluster endpoint port.
  Template.fromStack(stack).hasResourceProperties(
    'AWS::EC2::SecurityGroupIngress',
    {
      IpProtocol: 'tcp',
      FromPort: Match.anyValue(),
      ToPort: Match.anyValue(),
      SourceSecurityGroupId: Match.anyValue(),
    },
  );
});

test('Add proxy and grants through the IDatabaseCluster facade', () => {
  const {stack, vpc} = network();
  const cluster = new StandardPostgresAuroraServerlessCluster(stack, 'Db', {
    vpc,
  });
  const role = new Role(stack, 'Fn', {
    assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
  });
  const proxy = cluster.addProxy('Proxy', {
    vpc,
    secrets: [cluster.secret!],
    iamAuth: true,
    requireTLS: true,
  });
  proxy.grantConnect(role);
  cluster.grantConnect(role, 'app_user');
  const template = Template.fromStack(stack);

  template.resourceCountIs(DB_PROXY, 1);
  template.hasResourceProperties(DB_PROXY, {
    EngineFamily: 'POSTGRESQL',
    RequireTLS: true,
    Auth: [Match.objectLike({IAMAuth: 'REQUIRED'})],
  });
  template.hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: Match.objectLike({
      Statement: Match.arrayWith([
        Match.objectLike({Action: 'rds-db:connect'}),
      ]),
    }),
  });
  expect(template.toJSON()).toMatchSnapshot();
});
