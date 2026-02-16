import {
  Architecture,
  DockerImageFunction,
  DockerImageFunctionProps,
  LoggingFormat,
} from 'aws-cdk-lib/aws-lambda';
import {Construct} from 'constructs';
import {FunctionAlarms, FunctionAlarmsOptions} from './function-alarms';
import {RetentionDays} from 'aws-cdk-lib/aws-logs';
import {FunctionDeployment} from './function-deployment';
import {Duration} from 'aws-cdk-lib';
import {DeployedFunctionOptions} from './extended-function';

export interface ExtendedDockerImageFunctionProps
  extends
    DockerImageFunctionProps,
    FunctionAlarmsOptions,
    DeployedFunctionOptions {}

export class ExtendedDockerImageFunction extends DockerImageFunction {
  readonly alarms: FunctionAlarms;
  readonly deployment?: FunctionDeployment;

  constructor(
    scope: Construct,
    id: string,
    props: ExtendedDockerImageFunctionProps,
  ) {
    super(scope, id, {
      logRetention: RetentionDays.THREE_DAYS, // change default from INFINITE
      architecture: Architecture.ARM_64, // change default from X86_64
      memorySize: 768, // change from default 128
      timeout: Duration.seconds(30), // change default from 3
      ...props,
      loggingFormat: props.loggingFormat ?? LoggingFormat.JSON,
    });
    this.alarms = new FunctionAlarms(this, 'Alarms', {
      function: this,
      logGroup: this.logGroup,
      ...props,
    });
    if (props.deploymentOptions?.createDeployment ?? true) {
      this.deployment = new FunctionDeployment(this, 'Deployment', {
        ...props.deploymentOptions,
        function: this,
      });
      if (props.deploymentOptions?.includeCriticalAlarms ?? true) {
        this.deployment.addAlarms(...this.alarms.getCriticalAlarms());
      }
      if (props.deploymentOptions?.includeWarningAlarms ?? false) {
        this.deployment.addAlarms(...this.alarms.getWarningAlarms());
      }
    }
  }
}
