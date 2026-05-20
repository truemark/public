import {Stage, type StageProps} from 'aws-cdk-lib';
import type {Construct} from 'constructs';
import {StandardTags, type StandardTagsProps} from './standard-tags';

export interface ExtendedStageOptions {
  readonly standardTags?: StandardTagsProps;
}

export interface ExtendedStageProps extends StageProps, ExtendedStageOptions {}

export class ExtendedStage extends Stage {
  readonly standardTags: StandardTags;
  constructor(scope: Construct, id: string, props?: ExtendedStageProps) {
    super(scope, id, props);

    // Setup standard tags
    this.standardTags = new StandardTags(this, props?.standardTags);
  }
}
