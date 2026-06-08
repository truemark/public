import * as fs from 'node:fs';
import * as path from 'node:path';
import {Duration} from 'aws-cdk-lib';
import {
  Architecture,
  type FunctionOptions,
  Runtime,
  RuntimeFamily,
  Tracing,
} from 'aws-cdk-lib/aws-lambda';
import {RetentionDays} from 'aws-cdk-lib/aws-logs';
import type {Construct} from 'constructs';
import {ShellHelper} from '../../helpers/index';
import type {DeployedFunctionOptions} from './extended-function';
import type {FunctionAlarmsOptions} from './function-alarms';
import type {FunctionLogOptions} from './function-log-options';
import {
  StandardFunction,
  type StandardFunctionOptions,
} from './standard-function';

/**
 * Properties for BundledPythonFunction.
 */
export interface BundledPythonFunctionProps
  extends FunctionOptions,
    FunctionAlarmsOptions,
    DeployedFunctionOptions,
    StandardFunctionOptions,
    FunctionLogOptions {
  /**
   * The path (relative to entry) to the index file containing the exported handler.
   *
   * @default 'index.py'
   */
  readonly index?: string;

  /**
   * The name of the exported handler in the index file.
   *
   * @default 'handler'
   */
  readonly handler?: string;

  /**
   * The runtime environment. Only runtimes of the Python family are supported.
   *
   * @default Runtime.PYTHON_3_14
   */
  readonly runtime?: Runtime;
}

/**
 * Python based Lambda Function
 */
export class StandardPythonFunction extends StandardFunction {
  static isLocalBundlingSupported(): boolean {
    return ShellHelper.pythonVersion() !== null;
  }

  /**
   * Creates a new Lambda Function
   */
  constructor(scope: Construct, id: string, props: BundledPythonFunctionProps) {
    const runtime = props.runtime ?? Runtime.PYTHON_3_14;
    if (runtime.family !== RuntimeFamily.PYTHON) {
      throw new Error('Runtime must be a Python runtime');
    }

    const handler =
      (props.index ?? 'index.py').replace('.py', '') +
      '.' +
      (props.handler ?? 'handler');
    // TODO This isn't working
    const defaultBundlingScript = fs.readFileSync(
      path.join(path.dirname(fs.realpathSync(__filename)), 'bundle-python.sh'),
      'utf-8',
    );

    super(scope, id, {
      // defaults which may be overridden by ...props
      tracing: Tracing.PASS_THROUGH,
      logRetention: RetentionDays.THREE_DAYS,
      architecture: Architecture.ARM_64,
      memorySize: 768,
      timeout: Duration.seconds(30),
      ...props,
      bundlingEnvironment: {
        PIP_PROGRESS_BAR: 'off',
        PIP_DISABLE_PIP_VERSION_CHECK: '1',
        ...props.bundlingEnvironment,
      },
      runtime,
      handler,
      defaultBundlingScript,
      defaultBundlingImage: runtime.bundlingImage,
      isLocalBundlingSupported: StandardPythonFunction.isLocalBundlingSupported,
    });
  }
}
