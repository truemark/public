import {Construct} from 'constructs';
import {ExtendedConstruct} from '../../aws-cdk';

export interface CollectionIndexProps {
  readonly openSearchEndpoint: string;
  readonly indexName: string;
}

export class CollectionIndex extends ExtendedConstruct {
  constructor(scope: Construct, id: string, props: CollectionIndexProps) {
    super(scope, id);
    console.log(props);
  }
}
