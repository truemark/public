import * as process from 'node:process';
import {GoFunction, type GoFunctionProps} from '@aws-cdk/aws-lambda-go-alpha';
import {Duration} from 'aws-cdk-lib';
import {Architecture, LoggingFormat, Runtime} from 'aws-cdk-lib/aws-lambda';
import type {Construct} from 'constructs';
import type {DeployedFunctionOptions} from './extended-function';
import {FunctionAlarms, type FunctionAlarmsOptions} from './function-alarms';
import {FunctionDeployment} from './function-deployment';
import {
  configureLogGroupForFunction,
  type FunctionLogOptions,
} from './function-log-options';

/**
 * Properties for ExtendedGoFunction.
 */
export interface ExtendedGoFunctionProps
  extends GoFunctionProps,
    FunctionAlarmsOptions,
    DeployedFunctionOptions,
    FunctionLogOptions {}

/**
 * Extended version of the GoFunction that supports alarms and deployments.
 */
export class ExtendedGoFunction extends GoFunction {
  readonly alarms: FunctionAlarms;
  readonly deployment?: FunctionDeployment;

  constructor(scope: Construct, id: string, props: ExtendedGoFunctionProps) {
    const logGroup = configureLogGroupForFunction(scope, id, props);

    super(scope, id, {
      logGroup,
      architecture: Architecture.ARM_64,
      memorySize: 768,
      timeout: Duration.seconds(30),
      runtime: Runtime.PROVIDED_AL2023,
      ...props,
      loggingFormat: props.loggingFormat ?? LoggingFormat.JSON,
      bundling: {
        environment: {
          GOOS: process.env.GOOS || 'linux',
          GOARCH: process.env.GOARCH || 'arm64',
          ...props.environment,
        },
        ...props.bundling,
      },
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
