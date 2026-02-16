import {
  AutoRollbackConfig,
  ILambdaApplication,
  ILambdaDeploymentConfig,
  LambdaDeploymentConfig,
  LambdaDeploymentGroup,
} from 'aws-cdk-lib/aws-codedeploy';
import {Construct} from 'constructs';
import {Alias, IFunction, Function} from 'aws-cdk-lib/aws-lambda';
import {IAlarm} from 'aws-cdk-lib/aws-cloudwatch';
import {Grant, IGrantable, IRole} from 'aws-cdk-lib/aws-iam';

export interface FunctionDeploymentOptions {
  /**
   * The reference to the CodeDeploy Lambda Application that this Deployment Group belongs to.
   *
   * @default - One will be created for you.
   */
  readonly application?: ILambdaApplication;

  /**
   * The physical, human-readable name of the CodeDeploy Deployment Group.
   *
   * @default - An auto-generated name will be used.
   */
  readonly deploymentGroupName?: string;

  /**
   * Deployment configuration to use when deploying this lambda.
   *
   * @default LambdaDeploymentConfig.CANARY_10PERCENT_5MINUTES
   */
  readonly deploymentConfig?: ILambdaDeploymentConfig;

  /**
   * CloudWatch alarms to associate with the deployment.
   */
  readonly alarms?: IAlarm[];

  /**
   * The service Role of this Deployment Group.
   *
   * @default - A new Role will be created.
   */
  readonly role?: IRole;

  /**
   * The Lambda function to run before traffic routing starts.
   *
   * @default - None.
   */
  readonly preHook?: IFunction;

  /**
   * The Lambda function to run after traffic routing starts.
   *
   * @default - None.
   */
  readonly postHook?: IFunction;

  /**
   * Whether to continue a deployment even if fetching the alarm status from CloudWatch failed.
   *
   * @default false
   */
  readonly ignorePollAlarmsFailure?: boolean;

  /**
   * The auto-rollback configuration for this Deployment Group.
   *
   * @default - default AutoRollbackConfig.
   */
  readonly autoRollback?: AutoRollbackConfig;

  /**
   * Name of the alias to create for deployments.
   *
   * @default 'deploy'
   */
  readonly aliasName?: string;
}

/**
 * Properties for FunctionDeployment
 */
export interface FunctionDeploymentProps extends FunctionDeploymentOptions {
  /**
   * The function to deploy.
   */
  readonly function: Function;
}

/**
 * Creates an Alias and LambdaDeploymentGroup with reasonable defaults.
 */
export class FunctionDeployment extends Construct {
  /**
   * The alias created for the deployment.
   */
  readonly alias: Alias;

  /**
   * The deployment group created for the Lambda Function.
   */
  readonly deploymentGroup: LambdaDeploymentGroup;

  constructor(scope: Construct, id: string, props: FunctionDeploymentProps) {
    super(scope, id);

    this.alias = new Alias(this, 'Alias', {
      aliasName: props.aliasName ?? 'deploy',
      version: props.function.currentVersion,
    });

    this.deploymentGroup = new LambdaDeploymentGroup(this, 'Group', {
      ...props,
      alias: this.alias,
      deploymentConfig:
        props.deploymentConfig ??
        LambdaDeploymentConfig.CANARY_10PERCENT_5MINUTES,
    });
  }

  /**
   * Associates an additional alarm with this Deployment Group.
   *
   * @param alarm the alarm to associate
   */
  addAlarm(alarm: IAlarm): void {
    this.deploymentGroup.addAlarm(alarm);
  }

  /**
   * Associates additional alarms with this Deployment Group.
   *
   * @param alarms the alarms to associate
   */
  addAlarms(...alarms: IAlarm[]): void {
    alarms.forEach((alarm) => this.deploymentGroup.addAlarm(alarm));
  }

  /**
   * Associate a function to run before deployment begins.
   *
   * @param preHook the function to associate
   */
  addPreHook(preHook: IFunction): void {
    this.deploymentGroup.addPreHook(preHook);
  }

  /**
   * Associate a function to run after deployment completes.
   *
   * @param postHook the function to associate
   */
  addPostHook(postHook: IFunction): void {
    this.deploymentGroup.addPostHook(postHook);
  }

  /**
   * Grant a principal permission to codedeploy:PutLifecycleEventHookExecutionStatus on this deployment group resource.
   *
   * @param grantee resource to grant permission to
   */
  grantPutLifecycleEventHookExecutionStatus(grantee: IGrantable): Grant {
    return this.deploymentGroup.grantPutLifecycleEventHookExecutionStatus(
      grantee,
    );
  }
}
