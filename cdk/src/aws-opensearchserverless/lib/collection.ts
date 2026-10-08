import {Construct} from 'constructs';
import {ExtendedConstruct} from '../../aws-cdk';

export enum CollectionType {
  SEARCH = 'SEARCH',
  TIMESERIES = 'TIMESERIES',
  VECTORSEARCH = 'VECTORSEARCH',
}

export interface CollectionProps {
  readonly type: CollectionType;
  readonly name: string;
}

export class Collection extends ExtendedConstruct {
  constructor(scope: Construct, id: string, props: CollectionProps) {
    super(scope, id);
    console.log(props);
  }
}
