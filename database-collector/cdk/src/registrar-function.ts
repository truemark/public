import * as path from 'node:path';
import {Runtime} from 'aws-cdk-lib/aws-lambda';
import type {Construct} from 'constructs';
import {ExtendedNodejsFunction} from 'truemark-cdk-lib/aws-lambda';

export interface RegistrarFunctionProps {
  readonly environment: Record<string, string>;
}

/**
 * Function that keeps one collection schedule per tagged database. It only
 * calls AWS APIs, so it runs outside the VPC.
 */
export class RegistrarFunction extends ExtendedNodejsFunction {
  constructor(scope: Construct, id: string, props: RegistrarFunctionProps) {
    super(scope, id, {
      runtime: Runtime.NODEJS_24_X,
      entry: path.join(
        import.meta.dirname,
        '..',
        '..',
        'registrar',
        'src',
        'registrar.ts',
      ),
      handler: 'handler',
      esm: true,
      memorySize: 512,
      environment: props.environment,
    });
  }
}
