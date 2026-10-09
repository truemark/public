import {App, RemovalPolicy, Stack} from 'aws-cdk-lib';
import {Match, Template} from 'aws-cdk-lib/assertions';
import {User} from 'aws-cdk-lib/aws-iam';
import {expect, test} from 'vitest';
import {Collection, CollectionIndex} from '../index';

test('indexes are opt-in, preserve user schemas and depend on collection and existing data grants', () => {
  const stack = new Stack();
  const collection = new Collection(stack, 'Collection', {name: 'documents'});
  collection.grantFullAccess(new User(stack, 'User'));
  const schema = JSON.stringify({
    mappings: {properties: {title: {type: 'text'}}},
  });
  const index = new CollectionIndex(stack, 'Index', {
    collection,
    indexName: 'products',
    indexSchema: schema,
  });
  const template = Template.fromStack(stack);
  template.hasResource('AWS::OpenSearchServerless::CollectionIndex', {
    Properties: {
      Id: {'Fn::GetAtt': [stack.getLogicalId(collection.collection), 'Id']},
      IndexName: 'products',
      IndexSchema: schema,
    },
    DependsOn: Match.arrayWith([
      stack.getLogicalId(collection.dataAccessPolicy!),
      stack.getLogicalId(collection.collection),
    ]),
    DeletionPolicy: 'Retain',
    UpdateReplacePolicy: 'Retain',
  });
  expect(index.collection).toBe(collection);
});

test('supports omitted schema and explicit index destruction', () => {
  const stack = new Stack();
  const collection = new Collection(stack, 'Collection', {name: 'documents'});
  new CollectionIndex(stack, 'Index', {
    collection,
    indexName: 'products',
    removalPolicy: RemovalPolicy.DESTROY,
  });
  Template.fromStack(stack).hasResource(
    'AWS::OpenSearchServerless::CollectionIndex',
    {
      Properties: {IndexSchema: Match.absent()},
      DeletionPolicy: 'Delete',
      UpdateReplacePolicy: 'Delete',
    },
  );
});

test('rejects invalid names and indexes in a different Region', () => {
  const app = new App();
  const stack = new Stack(app, 'Collections', {
    env: {account: '123456789012', region: 'us-west-2'},
  });
  const collection = new Collection(stack, 'Collection', {name: 'documents'});
  for (const indexName of ['Invalid', '_hidden', '', 'a'.repeat(256)]) {
    expect(
      () => new CollectionIndex(new Stack(), 'Index', {collection, indexName}),
    ).toThrow(/Index name/);
  }
  const other = new Stack(app, 'Other', {
    env: {account: '123456789012', region: 'us-east-1'},
  });
  expect(
    () =>
      new CollectionIndex(other, 'Index', {collection, indexName: 'products'}),
  ).toThrow(/same Region/);
});

test('addIndex serializes schema objects and orders grants added afterwards', () => {
  const stack = new Stack();
  const collection = new Collection(stack, 'Collection', {name: 'documents'});
  const schema = {mappings: {properties: {title: {type: 'text'}}}};
  const first = collection.addIndex('Products', {
    indexName: 'products',
    indexSchema: schema,
  });
  collection.addIndex('Orders', {indexName: 'orders'});
  collection.grantFullAccess(new User(stack, 'User'));
  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::OpenSearchServerless::CollectionIndex', 2);
  template.hasResourceProperties('AWS::OpenSearchServerless::CollectionIndex', {
    IndexName: 'products',
    IndexSchema: Match.serializedJson(schema),
  });
  expect(
    template.toJSON().Resources[stack.getLogicalId(first.index)].DependsOn,
  ).toEqual(
    expect.arrayContaining([stack.getLogicalId(collection.dataAccessPolicy!)]),
  );
});

test('direct indexes created before grants depend on the deferred data access policy', () => {
  const stack = new Stack();
  const collection = new Collection(stack, 'Collection', {name: 'documents'});
  const first = new CollectionIndex(stack, 'Products', {
    collection,
    indexName: 'products',
  });
  const second = new CollectionIndex(stack, 'Orders', {
    collection,
    indexName: 'orders',
  });
  expect(collection.dataAccessPolicy).toBeUndefined();
  collection.grantFullAccess(new User(stack, 'User'));
  const template = Template.fromStack(stack);
  for (const index of [first, second]) {
    expect(
      template.toJSON().Resources[stack.getLogicalId(index.index)].DependsOn,
    ).toEqual(
      expect.arrayContaining([
        stack.getLogicalId(collection.collection),
        stack.getLogicalId(collection.dataAccessPolicy!),
      ]),
    );
  }
});
