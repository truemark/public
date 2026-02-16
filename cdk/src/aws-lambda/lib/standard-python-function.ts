import {
  Architecture,
  FunctionOptions,
  Runtime,
  RuntimeFamily,
  Tracing,
} from 'aws-cdk-lib/aws-lambda';
import {Construct} from 'constructs';
import {Duration} from 'aws-cdk-lib';
import {RetentionDays} from 'aws-cdk-lib/aws-logs';
import {ShellHelper} from '../../helpers/index';
import {StandardFunction, StandardFunctionOptions} from './standard-function';
import {DeployedFunctionOptions} from './extended-function';
import {FunctionAlarmsOptions} from './function-alarms';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Properties for BundledPythonFunction.
 */
export interface BundledPythonFunctionProps
  extends
    FunctionOptions,
    FunctionAlarmsOptions,
    DeployedFunctionOptions,
    StandardFunctionOptions {
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
   * @default Runtime.PYTHON_3_9
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
    const runtime = props.runtime ?? Runtime.PYTHON_3_9;
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
