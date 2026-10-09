import {App, CfnParameter, RemovalPolicy, Stack} from 'aws-cdk-lib';
import {Match, Template} from 'aws-cdk-lib/assertions';
import {
  AccountPrincipal,
  Role,
  ServicePrincipal,
  User,
} from 'aws-cdk-lib/aws-iam';
import {Key} from 'aws-cdk-lib/aws-kms';
import {expect, test} from 'vitest';
import {
  Collection,
  CollectionGeneration,
  CollectionGroup,
  CollectionType,
  ServerlessVectorAcceleration,
} from '../index';

function fixture(generation = CollectionGeneration.NEXTGEN) {
  const stack = new Stack(new App(), 'Test', {
    env: {account: '123456789012', region: 'us-east-1'},
  });
  const group = new CollectionGroup(stack, 'Group', {
    name: 'test-group',
    generation,
  });
  return {stack, group};
}

test.each(
  Object.values(ServerlessVectorAcceleration),
)('supports vector acceleration %s', (acceleration) => {
  const stack = new Stack();
  new Collection(stack, 'Vectors', {
    name: 'vectors',
    type: CollectionType.VECTORSEARCH,
    vectorOptions: {serverlessVectorAcceleration: acceleration},
  });
  Template.fromStack(stack).hasResourceProperties(
    'AWS::OpenSearchServerless::Collection',
    {
      VectorOptions: {ServerlessVectorAcceleration: acceleration},
    },
  );
});

test('omitted vector settings preserve service defaults and reject incompatible inputs', () => {
  const stack = new Stack();
  new Collection(stack, 'Vectors', {
    name: 'vectors',
    type: CollectionType.VECTORSEARCH,
  });
  Template.fromStack(stack).hasResourceProperties(
    'AWS::OpenSearchServerless::Collection',
    {
      VectorOptions: Match.absent(),
    },
  );
  expect(
    () =>
      new Collection(stack, 'Search', {
        name: 'search',
        vectorOptions: {
          serverlessVectorAcceleration: ServerlessVectorAcceleration.ENABLED,
        },
      }),
  ).toThrow(/VECTORSEARCH/);
  expect(
    () =>
      new Collection(stack, 'Invalid', {
        name: 'invalid',
        type: CollectionType.VECTORSEARCH,
        vectorOptions: {
          serverlessVectorAcceleration:
            'INVALID' as ServerlessVectorAcceleration,
        },
      }),
  ).toThrow(/ENABLED, DISABLED or ALLOWED/);
});

test.each([
  CollectionGeneration.CLASSIC,
  CollectionGeneration.NEXTGEN,
])('encryptionKey supports both key choices for %s', (generation) => {
  const {stack, group} = fixture(generation);
  const key = new Key(stack, 'Key');
  new Collection(stack, 'Owned', {name: 'owned-data', collectionGroup: group});
  new Collection(stack, 'Customer', {
    name: 'customer-data',
    collectionGroup: group,
    encryptionKey: key,
  });
  const template = inspectTemplate(stack);
  template.hasResourceProperties('AWS::OpenSearchServerless::SecurityPolicy', {
    Type: 'encryption',
    Policy: Match.serializedJson({
      AWSOwnedKey: true,
      KmsARN: Match.absent(),
      Rules: [
        {ResourceType: 'collection', Resource: ['collection/owned-data']},
      ],
    }),
  });
  template.hasResourceProperties('AWS::OpenSearchServerless::SecurityPolicy', {
    Type: 'encryption',
    Policy: Match.serializedJson({
      AWSOwnedKey: false,
      KmsARN: `<${stack.getLogicalId(key.node.defaultChild as import('aws-cdk-lib').CfnResource)}.Arn>`,
      Rules: [
        {ResourceType: 'collection', Resource: ['collection/customer-data']},
      ],
    }),
  });
});

// Inspect JSON policy strings with token references preserved as identifiable placeholders.
function inspectTemplate(stack: Stack): Template {
  const json = Template.fromStack(stack).toJSON();
  const resolveString = (input: unknown): string => {
    if (typeof input === 'string') return input;
    const value = input as {
      'Fn::Join'?: [string, unknown[]];
      'Fn::GetAtt'?: string[];
      Ref?: string;
    };
    if (value['Fn::Join']) {
      const [separator, parts] = value['Fn::Join'];
      return parts.map(resolveString).join(separator);
    }
    if (value['Fn::GetAtt']) return `<${value['Fn::GetAtt'].join('.')}>`;
    if (value.Ref) return `<${value.Ref}>`;
    throw new Error(`Unexpected string expression: ${JSON.stringify(value)}`);
  };
  for (const resource of Object.values(json.Resources) as {
    Type: string;
    Properties: {Policy: unknown};
  }[]) {
    if (
      [
        'AWS::OpenSearchServerless::SecurityPolicy',
        'AWS::OpenSearchServerless::AccessPolicy',
      ].includes(resource.Type)
    ) {
      resource.Properties.Policy = resolveString(resource.Properties.Policy);
    }
  }
  return Template.fromJSON(json);
}

test('NextGen is explicit on the native L1 and defaults to zero minimum compute', () => {
  const {stack} = fixture();
  const template = inspectTemplate(stack);
  template.hasResourceProperties('AWS::OpenSearchServerless::CollectionGroup', {
    Name: 'test-group',
    Generation: 'NEXTGEN',
    StandbyReplicas: 'ENABLED',
    CapacityLimits: {
      MinIndexingCapacityInOcu: 0,
      MinSearchCapacityInOcu: 0,
      MaxIndexingCapacityInOcu: 8,
      MaxSearchCapacityInOcu: 8,
    },
  });
  template.hasResource('AWS::OpenSearchServerless::CollectionGroup', {
    DeletionPolicy: 'Retain',
    UpdateReplacePolicy: 'Retain',
  });
});

test('Classic groups default to nonzero minimum compute and support disabled replicas', () => {
  const stack = new Stack();
  const group = new CollectionGroup(stack, 'Group', {
    name: 'classic-group',
    generation: CollectionGeneration.CLASSIC,
    standbyReplicas: false,
  });
  new Collection(stack, 'Collection', {
    name: 'classic-data',
    type: CollectionType.TIMESERIES,
    collectionGroup: group,
  });
  const template = inspectTemplate(stack);
  template.hasResourceProperties('AWS::OpenSearchServerless::CollectionGroup', {
    Generation: 'CLASSIC',
    StandbyReplicas: 'DISABLED',
    CapacityLimits: {
      MinIndexingCapacityInOcu: 1,
      MinSearchCapacityInOcu: 1,
      MaxIndexingCapacityInOcu: 8,
      MaxSearchCapacityInOcu: 8,
    },
  });
  template.hasResourceProperties('AWS::OpenSearchServerless::Collection', {
    Type: 'TIMESERIES',
    StandbyReplicas: 'DISABLED',
    CollectionGroupName: 'classic-group',
  });
});

test('original name/type inputs create a standalone Classic collection without a group', () => {
  const stack = new Stack();
  const collection = new Collection(stack, 'Collection', {
    name: 'classic-data',
    type: CollectionType.SEARCH,
  });
  const template = inspectTemplate(stack);
  template.resourceCountIs('AWS::OpenSearchServerless::CollectionGroup', 0);
  template.hasResourceProperties('AWS::OpenSearchServerless::Collection', {
    Name: 'classic-data',
    Type: 'SEARCH',
    CollectionGroupName: Match.absent(),
  });
  expect(collection.networkPolicy).toBeUndefined();
  expect(collection.dataAccessPolicy).toBeUndefined();
});

test('multiple collections share compute and explicitly depend on their group and policies', () => {
  const {stack, group} = fixture();
  const first = new Collection(stack, 'First', {
    name: 'first-data',
    collectionGroup: group,
    networkAccess: {allowFromPublic: true},
  });
  new Collection(stack, 'Second', {
    name: 'second-data',
    collectionGroup: group,
    networkAccess: {sourceVpcEndpoints: ['vpce-example']},
  });
  const template = inspectTemplate(stack);
  template.resourceCountIs('AWS::OpenSearchServerless::CollectionGroup', 1);
  template.resourceCountIs('AWS::OpenSearchServerless::Collection', 2);
  template.resourceCountIs('AWS::OpenSearchServerless::AccessPolicy', 0);
  expect(
    template.toJSON().Resources[stack.getLogicalId(first.collection)].DependsOn,
  ).toEqual(
    expect.arrayContaining([
      stack.getLogicalId(group.collectionGroup),
      stack.getLogicalId(first.encryptionPolicy),
      stack.getLogicalId(first.networkPolicy!),
    ]),
  );
  expect(first.collectionArn).toBe(first.collection.attrArn);
  expect(first.collectionEndpoint).toBe(
    first.collection.attrCollectionEndpoint,
  );
  template.hasResourceProperties('AWS::OpenSearchServerless::SecurityPolicy', {
    Type: 'encryption',
    Policy: Match.serializedJson({
      AWSOwnedKey: true,
      Rules: [
        {ResourceType: 'collection', Resource: ['collection/first-data']},
      ],
    }),
  });
  template.hasResourceProperties('AWS::OpenSearchServerless::SecurityPolicy', {
    Type: 'network',
    Policy: Match.serializedJson([
      {
        AllowFromPublic: true,
        Rules: [
          {ResourceType: 'collection', Resource: ['collection/first-data']},
        ],
      },
    ]),
  });
});

test('vector collections support KMS, token VPC endpoint IDs, service sources and opt-in Dashboards', () => {
  const stack = new Stack();
  const group = new CollectionGroup(stack, 'Group', {
    name: 'vector-group',
    minSearchCapacityInOcu: 2,
    maxSearchCapacityInOcu: 16,
  });
  const key = new Key(stack, 'Key');
  const endpoint = new CfnParameter(stack, 'Endpoint');
  const collection = new Collection(stack, 'Collection', {
    name: 'vectors',
    type: CollectionType.VECTORSEARCH,
    collectionGroup: group,
    encryptionKey: key,
    deletionProtection: true,
    networkAccess: {
      sourceVpcEndpoints: [endpoint.valueAsString],
      sourceServices: ['bedrock.amazonaws.com'],
      enableDashboards: true,
    },
  });
  const template = inspectTemplate(stack);
  template.hasResourceProperties('AWS::OpenSearchServerless::Collection', {
    Type: 'VECTORSEARCH',
    DeletionProtection: 'ENABLED',
  });
  template.hasResourceProperties('AWS::OpenSearchServerless::SecurityPolicy', {
    Type: 'encryption',
    Policy: Match.serializedJson({
      AWSOwnedKey: false,
      KmsARN: `<${stack.getLogicalId(key.node.defaultChild as import('aws-cdk-lib').CfnResource)}.Arn>`,
      Rules: [{ResourceType: 'collection', Resource: ['collection/vectors']}],
    }),
  });
  template.hasResourceProperties('AWS::OpenSearchServerless::SecurityPolicy', {
    Type: 'network',
    Policy: Match.serializedJson([
      {
        AllowFromPublic: false,
        SourceVPCEs: ['<Endpoint>'],
        SourceServices: ['bedrock.amazonaws.com'],
        Rules: [
          {ResourceType: 'collection', Resource: ['collection/vectors']},
          {ResourceType: 'dashboard', Resource: ['collection/vectors']},
        ],
      },
    ]),
  });
  template.hasResource('AWS::OpenSearchServerless::Collection', {
    DeletionPolicy: 'Retain',
  });
  expect(
    template.toJSON().Resources[stack.getLogicalId(collection.encryptionPolicy)]
      .DeletionPolicy,
  ).toBe('Retain');
});

test('read/write grants accumulate scoped data rules and collection-scoped IAM access', () => {
  const {stack, group} = fixture();
  const collection = new Collection(stack, 'Collection', {
    name: 'documents',
    collectionGroup: group,
  });
  const reader = new Role(stack, 'Reader', {
    assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
  });
  const writer = new User(stack, 'Writer');
  collection.grantRead(reader, 'logs-*');
  collection.grantReadWrite(writer, 'orders');
  const template = inspectTemplate(stack);
  template.resourceCountIs('AWS::OpenSearchServerless::AccessPolicy', 1);
  template.hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: {
      Statement: [
        {
          Action: 'aoss:APIAccessAll',
          Effect: 'Allow',
          Resource: {
            'Fn::GetAtt': [stack.getLogicalId(collection.collection), 'Arn'],
          },
        },
      ],
      Version: '2012-10-17',
    },
  });
  template.hasResourceProperties('AWS::OpenSearchServerless::AccessPolicy', {
    Type: 'data',
    Policy: Match.serializedJson([
      {
        Principal: [
          `<${stack.getLogicalId(reader.node.defaultChild as import('aws-cdk-lib').CfnResource)}.Arn>`,
        ],
        Rules: [
          {
            ResourceType: 'collection',
            Resource: ['collection/documents'],
            Permission: ['aoss:DescribeCollectionItems'],
          },
          {
            ResourceType: 'index',
            Resource: ['index/documents/logs-*'],
            Permission: ['aoss:ReadDocument', 'aoss:DescribeIndex'],
          },
        ],
      },
      {
        Principal: [
          `<${stack.getLogicalId(writer.node.defaultChild as import('aws-cdk-lib').CfnResource)}.Arn>`,
        ],
        Rules: [
          {
            ResourceType: 'collection',
            Resource: ['collection/documents'],
            Permission: ['aoss:DescribeCollectionItems'],
          },
          {
            ResourceType: 'index',
            Resource: ['index/documents/orders'],
            Permission: [
              'aoss:ReadDocument',
              'aoss:WriteDocument',
              'aoss:DescribeIndex',
            ],
          },
        ],
      },
    ]),
  });
  template.hasResource('AWS::OpenSearchServerless::AccessPolicy', {
    DeletionPolicy: 'Retain',
  });
});

test('full access and Dashboards permissions require separate explicit grants', () => {
  const {stack, group} = fixture();
  const collection = new Collection(stack, 'Collection', {
    name: 'documents',
    collectionGroup: group,
    networkAccess: {allowFromPublic: true, enableDashboards: true},
  });
  const admin = new Role(stack, 'Admin', {
    assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
  });
  collection.grantFullAccess(admin);
  collection.grantDashboardsAccess(admin);
  const template = inspectTemplate(stack);
  template.hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: {
      Statement: Match.arrayWith([
        {
          Action: 'aoss:DashboardsAccessAll',
          Effect: 'Allow',
          Resource: stack.resolve(
            stack.formatArn({
              service: 'aoss',
              resource: 'dashboards',
              resourceName: 'default',
            }),
          ),
        },
      ]),
    },
  });
  template.hasResourceProperties('AWS::OpenSearchServerless::AccessPolicy', {
    Policy: Match.serializedJson([
      {
        Principal: Match.anyValue(),
        Rules: [
          {
            ResourceType: 'collection',
            Resource: ['collection/documents'],
            Permission: ['aoss:*'],
          },
          {
            ResourceType: 'index',
            Resource: ['index/documents/*'],
            Permission: ['aoss:*'],
          },
        ],
      },
    ]),
  });
});

test.each([
  -1,
  1,
  3,
  12,
  1700,
  NaN,
])('rejects invalid NextGen minimum capacity %s', (capacity) => {
  expect(
    () =>
      new CollectionGroup(new Stack(), 'Group', {
        name: 'valid-group',
        minIndexingCapacityInOcu: capacity,
      }),
  ).toThrow(/minIndexingCapacityInOcu/);
});

test('Classic cannot scale to zero and NextGen cannot disable replicas', () => {
  expect(
    () =>
      new CollectionGroup(new Stack(), 'Group', {
        name: 'classic-group',
        generation: CollectionGeneration.CLASSIC,
        minSearchCapacityInOcu: 0,
      }),
  ).toThrow(/minSearchCapacityInOcu/);
  expect(
    () =>
      new CollectionGroup(new Stack(), 'Group', {
        name: 'nextgen-group',
        standbyReplicas: false,
      }),
  ).toThrow(/replicas/);
});

test('validates range ordering and maximums while accepting capacity/name tokens', () => {
  const stack = new Stack();
  expect(
    () =>
      new CollectionGroup(stack, 'ZeroMax', {
        name: 'valid-group',
        maxSearchCapacityInOcu: 0,
      }),
  ).toThrow(/maxSearchCapacityInOcu/);
  expect(
    () =>
      new CollectionGroup(stack, 'BadRange', {
        name: 'valid-group',
        minSearchCapacityInOcu: 16,
      }),
  ).toThrow(/Minimum/);
  const capacity = new CfnParameter(stack, 'Capacity', {type: 'Number'});
  const name = new CfnParameter(stack, 'Name');
  expect(
    () =>
      new CollectionGroup(stack, 'Tokens', {
        name: name.valueAsString,
        maxSearchCapacityInOcu: capacity.valueAsNumber,
      }),
  ).not.toThrow();
});

test.each([
  {},
  {allowFromPublic: true, sourceVpcEndpoints: ['vpce-example']},
  {sourceServices: ['bedrock.amazonaws.com'], enableDashboards: true},
])('rejects contradictory or unusable network access %j', (networkAccess) => {
  const {stack, group} = fixture();
  expect(
    () =>
      new Collection(stack, 'Collection', {
        name: 'documents',
        collectionGroup: group,
        networkAccess,
      }),
  ).toThrow();
});

test('rejects mismatched known group replica settings', () => {
  const {stack, group} = fixture();
  expect(
    () =>
      new Collection(stack, 'BadReplicas', {
        name: 'documents',
        standbyReplicas: false,
        collectionGroup: group,
      }),
  ).toThrow(/replicas/);
});

test('rejects invalid names, unsupported principals, empty grants and unsafe index patterns', () => {
  const {stack, group} = fixture();
  expect(
    () =>
      new CollectionGroup(stack, 'BadGroup', {
        name: 'INVALID',
      }),
  ).toThrow(/name/);
  expect(
    () => new Collection(stack, 'BadCollection', {name: 'bad/name'}),
  ).toThrow(/name/);
  const collection = new Collection(stack, 'Collection', {
    name: 'documents',
    collectionGroup: group,
  });
  const user = new User(stack, 'User');
  expect(() =>
    collection.grantRead(new ServicePrincipal('lambda.amazonaws.com')),
  ).toThrow(/IAM role or user/);
  expect(() =>
    collection.grantRead(new AccountPrincipal('123456789012')),
  ).toThrow(/IAM role or user/);
  expect(() => collection.grantDataAccess(user, {})).toThrow(/permission/);
  expect(() => collection.grantRead(user, '../*')).toThrow(/Index pattern/);
  expect(() => collection.grantRead(user, '*-suffix')).toThrow(/Index pattern/);
});

test('explicit destroy applies to collections, groups and owned policies', () => {
  const stack = new Stack();
  const group = new CollectionGroup(stack, 'Group', {
    name: 'dev-group',
    removalPolicy: RemovalPolicy.DESTROY,
  });
  const collection = new Collection(stack, 'Collection', {
    name: 'dev-data',
    collectionGroup: group,
    removalPolicy: RemovalPolicy.DESTROY,
    networkAccess: {sourceServices: ['bedrock.amazonaws.com']},
  });
  collection.grantFullAccess(new User(stack, 'User'));
  const template = inspectTemplate(stack);
  for (const type of [
    'Collection',
    'CollectionGroup',
    'SecurityPolicy',
    'AccessPolicy',
  ]) {
    template.hasResource(`AWS::OpenSearchServerless::${type}`, {
      DeletionPolicy: 'Delete',
      UpdateReplacePolicy: 'Delete',
    });
  }
});

test('groups can span stacks in the same environment with explicit stack ordering', () => {
  const app = new App();
  const env = {account: '123456789012', region: 'us-east-1'};
  const groupStack = new Stack(app, 'Groups', {env});
  const group = new CollectionGroup(groupStack, 'Group', {
    name: 'shared-group',
  });
  const collectionStack = new Stack(app, 'Collections', {env});
  new Collection(collectionStack, 'Collection', {
    name: 'documents',
    collectionGroup: group,
  });
  Template.fromStack(collectionStack);
  expect(collectionStack.dependencies).toContain(groupStack);
  const otherRegion = new Stack(app, 'OtherRegion', {
    env: {...env, region: 'us-west-2'},
  });
  expect(
    () =>
      new Collection(otherRegion, 'Collection', {
        name: 'documents',
        collectionGroup: group,
      }),
  ).toThrow(/same Region/);
});

test.each([
  CollectionGeneration.CLASSIC,
  CollectionGeneration.NEXTGEN,
])('Dashboards output uses only supported attributes for %s', (generation) => {
  const {stack, group} = fixture(generation);
  const collection = new Collection(stack, 'Collection', {
    name: 'documents',
    collectionGroup: group,
  });
  if (generation === CollectionGeneration.NEXTGEN) {
    expect(collection.dashboardEndpoint).toBeUndefined();
  } else {
    expect(stack.resolve(collection.dashboardEndpoint)).toEqual({
      'Fn::GetAtt': [
        stack.getLogicalId(collection.collection),
        'DashboardEndpoint',
      ],
    });
  }
});

test('existing group references inherit generation without creating a group', () => {
  const stack = new Stack();
  const group = CollectionGroup.fromGroupName(
    stack,
    'Existing',
    'existing-group',
    {
      generation: CollectionGeneration.NEXTGEN,
    },
  );
  new Collection(stack, 'Collection', {
    name: 'documents',
    collectionGroup: group,
  });
  const template = inspectTemplate(stack);
  template.resourceCountIs('AWS::OpenSearchServerless::CollectionGroup', 0);
  template.hasResourceProperties('AWS::OpenSearchServerless::Collection', {
    CollectionGroupName: 'existing-group',
  });
});

test('name-only references do not invent metadata or replica settings', () => {
  const stack = new Stack();
  const group = CollectionGroup.fromGroupName(
    stack,
    'Reference',
    'existing-group',
  );
  expect(group.generation).toBeUndefined();
  expect(group.standbyReplicas).toBeUndefined();
  const collection = new Collection(stack, 'Collection', {
    name: 'vectors',
    type: CollectionType.VECTORSEARCH,
    collectionGroup: group,
  });
  expect(collection.dashboardEndpoint).toBeUndefined();
  const template = inspectTemplate(stack);
  template.resourceCountIs('AWS::OpenSearchServerless::CollectionGroup', 0);
  template.hasResourceProperties('AWS::OpenSearchServerless::Collection', {
    Type: 'VECTORSEARCH',
    CollectionGroupName: 'existing-group',
    StandbyReplicas: Match.absent(),
  });
});

test('unknown group metadata allows caller replica settings', () => {
  const stack = new Stack();
  const group = CollectionGroup.fromGroupName(
    stack,
    'Reference',
    'existing-classic',
  );
  new Collection(stack, 'Collection', {
    name: 'documents',
    collectionGroup: group,
    standbyReplicas: false,
  });
  inspectTemplate(stack).hasResourceProperties(
    'AWS::OpenSearchServerless::Collection',
    {StandbyReplicas: 'DISABLED'},
  );
});

test.each([
  'role',
  'user',
])('rejects owned cross-stack %s grants before creating policies', (kind) => {
  const app = new App();
  const env = {account: '123456789012', region: 'us-west-2'};
  const collections = new Stack(app, 'Collections', {env});
  const principals = new Stack(app, 'Principals', {env});
  const collection = new Collection(collections, 'Collection', {
    name: 'documents',
  });
  const principal =
    kind === 'role'
      ? new Role(principals, 'Role', {
          assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
        })
      : new User(principals, 'User');
  expect(() =>
    collection.grantRead({grantPrincipal: principal.grantPrincipal}),
  ).toThrow(/owned by another stack.*circular/);
  expect(collection.dataAccessPolicy).toBeUndefined();
  const assembly = app.synth();
  Template.fromJSON(
    assembly.getStackArtifact(collections.artifactId).template,
  ).resourceCountIs('AWS::OpenSearchServerless::AccessPolicy', 0);
  Template.fromJSON(
    assembly.getStackArtifact(principals.artifactId).template,
  ).resourceCountIs('AWS::IAM::Policy', 0);
  expect(collections.dependencies).not.toContain(principals);
  expect(principals.dependencies).not.toContain(collections);
});

test('allows cross-stack references to existing roles with literal ARNs', () => {
  const app = new App();
  const env = {account: '123456789012', region: 'us-west-2'};
  const collections = new Stack(app, 'Collections', {env});
  const principals = new Stack(app, 'Principals', {env});
  const collection = new Collection(collections, 'Collection', {
    name: 'documents',
  });
  const role = Role.fromRoleArn(
    principals,
    'ExistingRole',
    'arn:aws:iam::123456789012:role/existing-reader',
  );
  collection.grantRead(role);
  const assembly = app.synth();
  Template.fromJSON(
    assembly.getStackArtifact(collections.artifactId).template,
  ).hasResourceProperties('AWS::OpenSearchServerless::AccessPolicy', {
    Policy: Match.serializedJson([
      {
        Principal: ['arn:aws:iam::123456789012:role/existing-reader'],
        Rules: Match.anyValue(),
      },
    ]),
  });
  expect(collections.dependencies).not.toContain(principals);
  expect(principals.dependencies).toContain(collections);
});
