import {Lazy, Names, RemovalPolicy, Stack, Token} from 'aws-cdk-lib';
import type {IInterfaceVpcEndpoint} from 'aws-cdk-lib/aws-ec2';
import {AccountPrincipal, Grant, type IGrantable} from 'aws-cdk-lib/aws-iam';
import type {IKey} from 'aws-cdk-lib/aws-kms';
import {
  CfnAccessPolicy,
  CfnCollection,
  CfnSecurityPolicy,
  type CfnVpcEndpoint,
} from 'aws-cdk-lib/aws-opensearchserverless';
import type {Construct} from 'constructs';
import {ExtendedConstruct, type ExtendedConstructProps} from '../../aws-cdk';
import {
  CollectionGeneration,
  CollectionGroup,
  type ICollectionGroup,
} from './collection-group';
import {CollectionIndex, type CollectionIndexProps} from './collection-index';

export enum CollectionType {
  SEARCH = 'SEARCH',
  TIMESERIES = 'TIMESERIES',
  VECTORSEARCH = 'VECTORSEARCH',
}

export enum ServerlessVectorAcceleration {
  ENABLED = 'ENABLED',
  DISABLED = 'DISABLED',
  ALLOWED = 'ALLOWED',
}

export interface CollectionVectorOptions {
  /** GPU acceleration setting for vector indexing. @default AWS service default */
  readonly serverlessVectorAcceleration?: ServerlessVectorAcceleration;
}

export interface CollectionNetworkAccess {
  /** Requires IAM and data access grants even when enabled. @default false */
  readonly allowFromPublic?: boolean;
  /** VPC endpoint IDs: standard aoss-data interface endpoints for NextGen, managed AOSS endpoints for Classic. */
  readonly sourceVpcEndpoints?: (
    | string
    | IInterfaceVpcEndpoint
    | CfnVpcEndpoint
  )[];
  /** AWS services allowed private API access, such as bedrock.amazonaws.com. */
  readonly sourceServices?: string[];
  /** Expose Dashboards to the same public or VPC sources. @default false */
  readonly enableDashboards?: boolean;
}

export interface CollectionProps extends ExtendedConstructProps {
  readonly name: string;
  /** Collection type. @default CollectionType.SEARCH */
  readonly type?: CollectionType;
  /** Explicit or imported group. @default Standalone Classic collection */
  readonly collectionGroup?: ICollectionGroup;
  readonly description?: string;
  /** @default AWS owned key */
  readonly encryptionKey?: IKey;
  /** Only supported for VECTORSEARCH collections. @default AWS service defaults */
  readonly vectorOptions?: CollectionVectorOptions;
  /** @default No network policy is created; manage network access externally */
  readonly networkAccess?: CollectionNetworkAccess;
  /** Defaults to known group metadata, true for standalone Classic, or omitted for unknown groups. */
  readonly standbyReplicas?: boolean;
  /** @default false */
  readonly deletionProtection?: boolean;
  /** Applies to the collection and owned policies. @default RemovalPolicy.RETAIN */
  readonly removalPolicy?: RemovalPolicy;
}

export type CollectionDataPermission =
  | 'aoss:CreateCollectionItems'
  | 'aoss:DeleteCollectionItems'
  | 'aoss:UpdateCollectionItems'
  | 'aoss:DescribeCollectionItems'
  | 'aoss:*';
export type IndexDataPermission =
  | 'aoss:ReadDocument'
  | 'aoss:WriteDocument'
  | 'aoss:CreateIndex'
  | 'aoss:DeleteIndex'
  | 'aoss:UpdateIndex'
  | 'aoss:DescribeIndex'
  | 'aoss:*';
export interface CollectionDataAccess {
  readonly collectionPermissions?: CollectionDataPermission[];
  readonly indexPermissions?: IndexDataPermission[];
  /** An index name or prefix ending in *. @default '*' */
  readonly indexPattern?: string;
}

interface DataAccessRule {
  ResourceType: 'collection' | 'index';
  Resource: string[];
  Permission: string[];
}

/** Collection security and data boundary. Supports standalone Classic and grouped Classic/NextGen. */
export class Collection extends ExtendedConstruct {
  readonly collection: CfnCollection;
  readonly collectionGroup?: ICollectionGroup;
  readonly collectionName: string;
  readonly collectionId: string;
  readonly collectionArn: string;
  readonly collectionEndpoint: string;
  /** Available only for known Classic collections; omitted for NextGen or unknown generation. */
  readonly dashboardEndpoint?: string;
  readonly type: CollectionType;
  readonly encryptionPolicy: CfnSecurityPolicy;
  readonly networkPolicy?: CfnSecurityPolicy;
  private readonly removalPolicy: RemovalPolicy;
  private accessPolicy?: CfnAccessPolicy;
  private readonly indexes: CollectionIndex[] = [];
  private readonly accessStatements: {
    Rules: DataAccessRule[];
    Principal: string[];
  }[] = [];

  /** Created on the first data access grant. */
  get dataAccessPolicy(): CfnAccessPolicy | undefined {
    return this.accessPolicy;
  }

  constructor(scope: Construct, id: string, props: CollectionProps) {
    super(scope, id, props);
    const group = props.collectionGroup;
    const maxNameLength =
      !group || group.generation === CollectionGeneration.CLASSIC ? 32 : 64;
    if (
      !Token.isUnresolved(props.name) &&
      (!/^[a-z][a-z0-9-]{2,}$/.test(props.name) ||
        props.name.length > maxNameLength)
    ) {
      throw new Error(
        `Collection name must start with a lowercase letter and contain 3–${maxNameLength} lowercase letters, digits or hyphens.`,
      );
    }
    this.type = props.type ?? CollectionType.SEARCH;
    if (props.vectorOptions && this.type !== CollectionType.VECTORSEARCH) {
      throw new Error('Vector options require a VECTORSEARCH collection.');
    }
    const acceleration = props.vectorOptions?.serverlessVectorAcceleration;
    if (
      acceleration !== undefined &&
      !Token.isUnresolved(acceleration) &&
      !Object.values(ServerlessVectorAcceleration).includes(acceleration)
    ) {
      throw new Error(
        'Serverless vector acceleration must be ENABLED, DISABLED or ALLOWED.',
      );
    }
    const standbyReplicas =
      props.standbyReplicas ??
      group?.standbyReplicas ??
      (group ? undefined : true);
    if (
      group?.generation === CollectionGeneration.NEXTGEN &&
      standbyReplicas === false
    ) {
      throw new Error('NextGen collections require enabled standby replicas.');
    }
    if (
      group?.standbyReplicas !== undefined &&
      standbyReplicas !== group.standbyReplicas
    ) {
      throw new Error(
        'Collection standby replicas must match its collection group.',
      );
    }
    if (group) {
      const stack = Stack.of(this);
      const groupStack = Stack.of(group);
      for (const [dimension, value, groupValue] of [
        ['account', stack.account, groupStack.account],
        ['Region', stack.region, groupStack.region],
      ]) {
        if (
          !Token.isUnresolved(value) &&
          !Token.isUnresolved(groupValue) &&
          value !== groupValue
        ) {
          throw new Error(
            `Collection and group must be in the same ${dimension}.`,
          );
        }
      }
    }
    this.removalPolicy = props.removalPolicy ?? RemovalPolicy.RETAIN;
    this.collectionName = props.name;
    this.collectionGroup = group;
    const resource = `collection/${props.name}`;
    this.encryptionPolicy = new CfnSecurityPolicy(this, 'EncryptionPolicy', {
      name: this.policyName('enc'),
      type: 'encryption',
      policy: Stack.of(this).toJsonString({
        Rules: [{ResourceType: 'collection', Resource: [resource]}],
        AWSOwnedKey: !props.encryptionKey,
        ...(props.encryptionKey ? {KmsARN: props.encryptionKey.keyArn} : {}),
      }),
    });
    if (props.networkAccess) {
      const network = props.networkAccess;
      const publicAccess = network.allowFromPublic ?? false;
      const endpoints = (network.sourceVpcEndpoints ?? []).map((endpoint) =>
        typeof endpoint === 'string'
          ? endpoint
          : 'vpcEndpointId' in endpoint
            ? endpoint.vpcEndpointId
            : endpoint.ref,
      );
      const services = network.sourceServices ?? [];
      if (publicAccess && (endpoints.length || services.length)) {
        throw new Error(
          'Public access cannot be combined with private sources because AWS ignores those restrictions.',
        );
      }
      if (!publicAccess && !endpoints.length && !services.length) {
        throw new Error(
          'Private network access requires a VPC endpoint or AWS service source.',
        );
      }
      if (network.enableDashboards && !publicAccess && !endpoints.length) {
        throw new Error('Private Dashboards access requires a VPC endpoint.');
      }
      const rules = [{ResourceType: 'collection', Resource: [resource]}];
      if (network.enableDashboards)
        rules.push({ResourceType: 'dashboard', Resource: [resource]});
      this.networkPolicy = new CfnSecurityPolicy(this, 'NetworkPolicy', {
        name: this.policyName('net'),
        type: 'network',
        policy: Stack.of(this).toJsonString([
          {
            Rules: rules,
            AllowFromPublic: publicAccess,
            ...(endpoints.length ? {SourceVPCEs: endpoints} : {}),
            ...(services.length ? {SourceServices: services} : {}),
          },
        ]),
      });
      this.networkPolicy.applyRemovalPolicy(this.removalPolicy);
    }
    this.collection = new CfnCollection(this, 'Default', {
      name: props.name,
      type: this.type,
      description: props.description,
      collectionGroupName: group?.collectionGroupName,
      standbyReplicas:
        standbyReplicas === undefined
          ? undefined
          : standbyReplicas
            ? 'ENABLED'
            : 'DISABLED',
      deletionProtection: props.deletionProtection ? 'ENABLED' : 'DISABLED',
      vectorOptions:
        acceleration === undefined
          ? undefined
          : {
              serverlessVectorAcceleration: acceleration,
            },
    });
    this.collection.addDependency(this.encryptionPolicy);
    if (group instanceof CollectionGroup)
      this.collection.addDependency(group.collectionGroup);
    if (this.networkPolicy) this.collection.addDependency(this.networkPolicy);
    this.collection.applyRemovalPolicy(this.removalPolicy);
    this.encryptionPolicy.applyRemovalPolicy(this.removalPolicy);
    this.collectionId = this.collection.attrId;
    this.collectionArn = this.collection.attrArn;
    this.collectionEndpoint = this.collection.attrCollectionEndpoint;
    this.dashboardEndpoint =
      !group || group.generation === CollectionGeneration.CLASSIC
        ? this.collection.attrDashboardEndpoint
        : undefined;
  }

  /** Creates an optional child index with a user-defined schema. */
  addIndex(
    id: string,
    props: Omit<CollectionIndexProps, 'collection'>,
  ): CollectionIndex {
    const index = new CollectionIndex(this, id, {collection: this, ...props});
    this.indexes.push(index);
    return index;
  }

  /** Describe indexes and read documents, optionally restricted to an index prefix. */
  grantRead(grantee: IGrantable, indexPattern = '*'): Grant {
    return this.grantDataAccess(grantee, {
      collectionPermissions: ['aoss:DescribeCollectionItems'],
      indexPermissions: ['aoss:ReadDocument', 'aoss:DescribeIndex'],
      indexPattern,
    });
  }

  /** Read/write documents in existing indexes; index administration is granted separately. */
  grantReadWrite(grantee: IGrantable, indexPattern = '*'): Grant {
    return this.grantDataAccess(grantee, {
      collectionPermissions: ['aoss:DescribeCollectionItems'],
      indexPermissions: [
        'aoss:ReadDocument',
        'aoss:WriteDocument',
        'aoss:DescribeIndex',
      ],
      indexPattern,
    });
  }

  /** All collection alias/template and index operations, including index deletion. */
  grantFullAccess(grantee: IGrantable): Grant {
    return this.grantDataAccess(grantee, {
      collectionPermissions: ['aoss:*'],
      indexPermissions: ['aoss:*'],
    });
  }

  /** Adds data policy permissions and collection-scoped IAM APIAccessAll to a role or user. */
  grantDataAccess(grantee: IGrantable, access: CollectionDataAccess): Grant {
    const principal = grantee.grantPrincipal;
    const fragment = principal.policyFragment;
    const principals = fragment.principalJson.AWS;
    if (
      principal instanceof AccountPrincipal ||
      !principals ||
      principals.length !== 1 ||
      Object.keys(fragment.conditions).length ||
      (!Token.isUnresolved(principals[0]) &&
        !/^arn:[^:]+:iam::\d{12}:(role|user)\/.+/.test(principals[0]))
    ) {
      throw new Error(
        'Data access grants require a single IAM role or user principal without conditions.',
      );
    }
    if (
      principal.principalAccount &&
      !Token.isUnresolved(principal.principalAccount) &&
      !Token.isUnresolved(Stack.of(this).account) &&
      principal.principalAccount !== Stack.of(this).account
    ) {
      throw new Error(
        'Data access principals must be in the collection account.',
      );
    }
    const indexPattern = access.indexPattern ?? '*';
    if (
      !Token.isUnresolved(indexPattern) &&
      (!indexPattern ||
        indexPattern.includes('/') ||
        !/^[^*]+\*?$|^\*$/.test(indexPattern))
    ) {
      throw new Error(
        'Index pattern must be a name or prefix ending in *, without slashes.',
      );
    }
    const rules: DataAccessRule[] = [];
    if (access.collectionPermissions?.length)
      rules.push({
        ResourceType: 'collection',
        Resource: [`collection/${this.collectionName}`],
        Permission: [...access.collectionPermissions],
      });
    if (access.indexPermissions?.length)
      rules.push({
        ResourceType: 'index',
        Resource: [`index/${this.collectionName}/${indexPattern}`],
        Permission: [...access.indexPermissions],
      });
    if (!rules.length)
      throw new Error('At least one data access permission is required.');
    this.accessStatements.push({Rules: rules, Principal: [principals[0]]});
    if (!this.accessPolicy) {
      this.accessPolicy = new CfnAccessPolicy(this, 'DataAccessPolicy', {
        name: this.policyName('data'),
        type: 'data',
        policy: Lazy.string({
          produce: () => Stack.of(this).toJsonString(this.accessStatements),
        }),
      });
      this.accessPolicy.applyRemovalPolicy(this.removalPolicy);
      for (const index of this.indexes)
        index.index.addDependency(this.accessPolicy);
    }
    return Grant.addToPrincipal({
      grantee,
      actions: ['aoss:APIAccessAll'],
      resourceArns: [this.collectionArn],
    });
  }

  /** IAM Dashboards access; also requires a data grant and enabled network access. */
  grantDashboardsAccess(grantee: IGrantable): Grant {
    return Grant.addToPrincipal({
      grantee,
      actions: ['aoss:DashboardsAccessAll'],
      resourceArns: [
        Stack.of(this).formatArn({
          service: 'aoss',
          resource: 'dashboards',
          resourceName: 'default',
        }),
      ],
    });
  }

  private policyName(prefix: string): string {
    return `${prefix}-${Names.uniqueResourceName(this, {maxLength: 27, allowedSpecialCharacters: '-'}).toLowerCase()}`;
  }
}
