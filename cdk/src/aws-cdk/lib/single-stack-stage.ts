import {Construct} from 'constructs';
import {ExtendedStack, ExtendedStackProps} from './extended-stack';
import {ExtendedStage, ExtendedStageProps} from './extended-stage';

/**
 * Constructor properties for SingleStackStage
 */
export interface WrapperStageProps<
  T extends ExtendedStack,
  P extends ExtendedStackProps,
> extends ExtendedStageProps {
  readonly id: string;
  readonly cls: new (scope: Construct, id: string, props: P) => T;
  readonly props: P;
}

/**
 * A Stage that contains a single Stack reducing the need to create
 * Stage classes for each Stack.
 */
export class SingleStackStage<
  T extends ExtendedStack,
  P extends ExtendedStackProps,
> extends ExtendedStage {
  readonly stack: T;

  constructor(scope: Construct, id: string, props: WrapperStageProps<T, P>) {
    super(scope, id, props);
    this.stack = new props.cls(this, props.id, {
      ...props.props,
    });
  }
}
