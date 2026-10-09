import {RemovalPolicy, Token} from 'aws-cdk-lib';
import {CfnCollectionGroup} from 'aws-cdk-lib/aws-opensearchserverless';
import {Construct, type IConstruct} from 'constructs';
import {ExtendedConstruct, type ExtendedConstructProps} from '../../aws-cdk';

export enum CollectionGeneration {
  CLASSIC = 'CLASSIC',
  NEXTGEN = 'NEXTGEN',
}

export interface CollectionGroupProps extends ExtendedConstructProps {
  /** Unique name in this account and Region; 3–32 lowercase letters, digits or hyphens. */
  readonly name: string;
  /** @default CollectionGeneration.NEXTGEN */
  readonly generation?: CollectionGeneration;
  readonly description?: string;
  /** Zero enables scale to zero for NextGen. @default 0 for NextGen, 1 for Classic */
  readonly minIndexingCapacityInOcu?: number;
  /** @default 0 for NextGen, 1 for Classic */
  readonly minSearchCapacityInOcu?: number;
  /** Shared maximum indexing capacity. @default 8 */
  readonly maxIndexingCapacityInOcu?: number;
  /** Shared maximum search capacity. @default 8 */
  readonly maxSearchCapacityInOcu?: number;
  /** NextGen requires enabled replicas. @default true */
  readonly standbyReplicas?: boolean;
  /** @default RemovalPolicy.RETAIN */
  readonly removalPolicy?: RemovalPolicy;
}

export interface ICollectionGroup extends IConstruct {
  readonly collectionGroupName: string;
  /** Unknown for name-only references. */
  readonly generation?: CollectionGeneration;
  /** Unknown for name-only references. */
  readonly standbyReplicas?: boolean;
}

export interface CollectionGroupReferenceProps {
  /** Optional known metadata; no AWS lookup is performed. */
  readonly generation?: CollectionGeneration;
  /** Optional known replica setting; omitted metadata remains unknown. */
  readonly standbyReplicas?: boolean;
}

/** Shared compute boundary for Classic or NextGen collections. */
export class CollectionGroup
  extends ExtendedConstruct
  implements ICollectionGroup
{
  /** References an existing group without creating or looking up AWS resources. */
  static fromGroupName(
    scope: Construct,
    id: string,
    name: string,
    props: CollectionGroupReferenceProps = {},
  ): ICollectionGroup {
    class Reference extends Construct implements ICollectionGroup {
      readonly collectionGroupName = name;
      readonly generation = props.generation;
      readonly standbyReplicas = props.standbyReplicas;
    }
    if (
      props.generation === CollectionGeneration.NEXTGEN &&
      props.standbyReplicas === false
    ) {
      throw new Error(
        'NextGen collection groups require enabled standby replicas.',
      );
    }
    return new Reference(scope, id);
  }

  readonly collectionGroup: CfnCollectionGroup;
  readonly collectionGroupName: string;
  readonly collectionGroupId: string;
  readonly collectionGroupArn: string;
  readonly generation: CollectionGeneration;
  readonly standbyReplicas: boolean;

  constructor(scope: Construct, id: string, props: CollectionGroupProps) {
    super(scope, id, props);
    if (
      !Token.isUnresolved(props.name) &&
      !/^[a-z][a-z0-9-]{2,31}$/.test(props.name)
    ) {
      throw new Error(
        'Collection group name must start with a lowercase letter and contain 3–32 lowercase letters, digits or hyphens.',
      );
    }
    this.generation = props.generation ?? CollectionGeneration.NEXTGEN;
    this.standbyReplicas = props.standbyReplicas ?? true;
    if (
      this.generation === CollectionGeneration.NEXTGEN &&
      !this.standbyReplicas
    ) {
      throw new Error(
        'NextGen collection groups require enabled standby replicas.',
      );
    }
    const nextGen = this.generation === CollectionGeneration.NEXTGEN;
    const capacityLimits = {
      minIndexingCapacityInOcu:
        props.minIndexingCapacityInOcu ?? (nextGen ? 0 : 1),
      minSearchCapacityInOcu: props.minSearchCapacityInOcu ?? (nextGen ? 0 : 1),
      maxIndexingCapacityInOcu: props.maxIndexingCapacityInOcu ?? 8,
      maxSearchCapacityInOcu: props.maxSearchCapacityInOcu ?? 8,
    };
    for (const [name, value] of Object.entries(capacityLimits)) {
      if (Token.isUnresolved(value)) continue;
      const minimum = name.startsWith('min');
      const valid =
        value === 2 ||
        value === 4 ||
        value === 8 ||
        (value >= 16 && value <= 1696 && value % 16 === 0) ||
        (minimum && (nextGen ? value === 0 : value === 1));
      if (!Number.isInteger(value) || !valid) {
        throw new Error(
          `${name} must be ${minimum ? `${nextGen ? 0 : 1}, ` : ''}2, 4, 8, or a multiple of 16 up to 1696.`,
        );
      }
    }
    for (const [min, max] of [
      [
        capacityLimits.minIndexingCapacityInOcu,
        capacityLimits.maxIndexingCapacityInOcu,
      ],
      [
        capacityLimits.minSearchCapacityInOcu,
        capacityLimits.maxSearchCapacityInOcu,
      ],
    ]) {
      if (!Token.isUnresolved(min) && !Token.isUnresolved(max) && min > max) {
        throw new Error('Minimum capacity must not exceed maximum capacity.');
      }
    }
    this.collectionGroupName = props.name;
    this.collectionGroup = new CfnCollectionGroup(this, 'Default', {
      name: props.name,
      description: props.description,
      generation: this.generation,
      standbyReplicas: this.standbyReplicas ? 'ENABLED' : 'DISABLED',
      capacityLimits,
    });
    this.collectionGroup.applyRemovalPolicy(
      props.removalPolicy ?? RemovalPolicy.RETAIN,
    );
    this.collectionGroupId = this.collectionGroup.attrId;
    this.collectionGroupArn = this.collectionGroup.attrArn;
  }
}
