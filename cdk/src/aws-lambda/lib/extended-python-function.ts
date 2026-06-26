import {
  PythonFunction,
  type PythonFunctionProps,
} from '@aws-cdk/aws-lambda-python-alpha';
import {LoggingFormat} from 'aws-cdk-lib/aws-lambda';
import type {Construct} from 'constructs';
import type {DeployedFunctionOptions} from './extended-function';
import {FunctionAlarms, type FunctionAlarmsOptions} from './function-alarms';
import {FunctionDeployment} from './function-deployment';
import {
  configureLogGroupForFunction,
  type FunctionLogOptions,
} from './function-log-options';

/**
 * Properties for PythonFunctionAlpha
 */
export interface ExtendedPythonFunctionProps
  extends PythonFunctionProps,
    FunctionAlarmsOptions,
    DeployedFunctionOptions,
    FunctionLogOptions {}

/**
 * Extended version of the alpha PythonFunction that supports alarms and deployments.
 */
export class ExtendedPythonFunction extends PythonFunction {
  readonly alarms: FunctionAlarms;
  readonly deployment?: FunctionDeployment;

  constructor(
    scope: Construct,
    id: string,
    props: ExtendedPythonFunctionProps,
  ) {
    const logGroup = configureLogGroupForFunction(scope, id, props);

    super(scope, id, {
      logGroup,
      ...props,
      loggingFormat: props.loggingFormat ?? LoggingFormat.JSON,
    });

    this.alarms = new FunctionAlarms(this, 'Alarms', {
      ...props,
      function: this,
      logGroup: this.logGroup,
    });

    if (props.deploymentOptions?.createDeployment ?? false) {
      this.deployment = new FunctionDeployment(this, 'Deployment', {
        ...props.deploymentOptions,
        function: this,
      });
      if (props.deploymentOptions?.includeCriticalAlarms ?? false) {
        this.deployment.addAlarms(...this.alarms.getCriticalAlarms());
      }
      if (props.deploymentOptions?.includeWarningAlarms ?? false) {
        this.deployment.addAlarms(...this.alarms.getWarningAlarms());
      }
    }
  }
}
