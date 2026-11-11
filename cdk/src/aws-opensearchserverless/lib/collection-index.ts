import {RemovalPolicy, Stack, Token} from 'aws-cdk-lib';
import {CfnCollectionIndex} from 'aws-cdk-lib/aws-opensearchserverless';
import type {Construct} from 'constructs';
import {ExtendedConstruct, type ExtendedConstructProps} from '../../aws-cdk';
import type {Collection} from './collection';

export interface CollectionIndexProps extends ExtendedConstructProps {
  readonly collection: Collection;
  readonly indexName: string;
  /** User-defined index schema. Objects are serialized with CDK token-aware JSON. @default AWS service default */
  readonly indexSchema?: string | Readonly<Record<string, unknown>>;
  /** @default RemovalPolicy.RETAIN */
  readonly removalPolicy?: RemovalPolicy;
}

/** Optional index resource; collections do not create indexes automatically. */
export class CollectionIndex extends ExtendedConstruct {
  readonly index: CfnCollectionIndex;
  readonly collection: Collection;
  readonly collectionId: string;
  readonly indexName: string;

  constructor(scope: Construct, id: string, props: CollectionIndexProps) {
    super(scope, id, props);
    if (
      !Token.isUnresolved(props.indexName) &&
      (!/^[a-z][a-z0-9_-]*$/.test(props.indexName) ||
        props.indexName.length > 255)
    ) {
      throw new Error(
        'Index name must start with a lowercase letter and contain 1–255 lowercase letters, digits, underscores or hyphens.',
      );
    }
    const stack = Stack.of(this);
    const collectionStack = Stack.of(props.collection);
    for (const [dimension, value, collectionValue] of [
      ['account', stack.account, collectionStack.account],
      ['Region', stack.region, collectionStack.region],
    ]) {
      if (
        !Token.isUnresolved(value) &&
        !Token.isUnresolved(collectionValue) &&
        value !== collectionValue
      ) {
        throw new Error(
          `Index and collection must be in the same ${dimension}.`,
        );
      }
    }
    this.collection = props.collection;
    this.collectionId = props.collection.collectionId;
    this.indexName = props.indexName;
    this.index = new CfnCollectionIndex(this, 'Default', {
      id: this.collectionId,
      indexName: props.indexName,
      indexSchema:
        typeof props.indexSchema === 'string' || props.indexSchema === undefined
          ? props.indexSchema
          : Stack.of(this).toJsonString(props.indexSchema),
    });
    this.index.addDependency(props.collection.collection);
    this.index.applyRemovalPolicy(props.removalPolicy ?? RemovalPolicy.RETAIN);
    props.collection.registerIndex(this);
  }
}
