import {CfnOutput, Duration, Stack, StackProps, Stage} from 'aws-cdk-lib';
import {ParameterStore, ParameterStoreOptions} from '../../aws-ssm/index';
import {Construct} from 'constructs';
import {StringParameter} from 'aws-cdk-lib/aws-ssm';
import {
  DashboardRenderingPreference,
  DefaultDashboardFactory,
  MonitoringFacade,
} from 'cdk-monitoring-constructs';
import {StandardTags, StandardTagsProps} from './standard-tags';

/**
 * Options for ExtStack.
 */
export interface ExtendedStackOptions {
  /**
   * Prefix to be used by parameter exports to be stored in the
   * Systems Manager Parameter Store.
   *
   * @default ${stageName}/${stackId}/Exports/
   */
  readonly parameterExportsPrefix?: string;

  /**
   * Flag to determine if a default MonitoringFacade and
   * DefaultDashboardFactory should be created in this stack.
   *
   * @default true
   */
  readonly createMonitoringFacade?: boolean;

  /**
   * Prefix added to each dashboard name.
   *
   * @default stackName
   */
  readonly dashboardNamePrefix?: string;

  /**
   * Flag to determine if the default dashboard should be created.
   *
   * @default false
   */
  readonly createDashboard?: boolean;

  /**
   * Flag to determine if the summary dashboard should be created.
   *
   * @default false
   */
  readonly createSummaryDashboard?: boolean;

  /**
   * Flag to determine if the alarm dashboard should be created.
   *
   * @default false
   */
  readonly createAlarmDashboard?: boolean;

  /**
   * Rendering preference to dashboards.
   *
   * @default DashboardRenderingPreference.INTERACTIVE_ONLY
   */
  readonly dashboardRenderingPreference?: DashboardRenderingPreference;

  /**
   * Default namespace for metrics.
   */
  readonly metricNamespace?: string;

  /**
   * Default metric period
   */
  readonly metricPeriod?: Duration;

  /**
   * Prefix for generated alarms.
   *
   * @default stackName
   */
  readonly alarmNamePrefix?: string;

  /**
   * Enables alarm actions.
   *
   * @default true
   */
  readonly alarmActionsEnabled?: boolean;

  /**
   * Sets standard tags for this Stack.
   */
  readonly standardTags?: StandardTagsProps;
}

/**
 * Properties for ExtStack.
 */
export interface ExtendedStackProps extends ExtendedStackOptions, StackProps {}

/**
 * Extended version of Stack providing functionality for parameter exports and monitoring.
 */
export class ExtendedStack extends Stack {
  protected readonly parameterExports: ParameterStore;
  readonly parameterExportOptions: ParameterStoreOptions;
  readonly monitoringFacade?: MonitoringFacade;
  readonly standardTags: StandardTags;

  constructor(scope: Construct, id: string, props?: ExtendedStackProps) {
    super(scope, id, props);

    const stageName = Stage.of(this)?.stageName;

    this.parameterExportOptions = {
      prefix:
        props?.parameterExportsPrefix ??
        (stageName === undefined || stageName === null || stageName === ''
          ? ''
          : `/${stageName}`) + `/${id}/Exports/`,
      region: this.region,
    };
    this.parameterExports = new ParameterStore(
      this,
      'ParameterExports',
      this.parameterExportOptions,
    );

    if (props?.createMonitoringFacade ?? true) {
      const dashboardFactory = new DefaultDashboardFactory(
        this,
        'DashboardFactory',
        {
          dashboardNamePrefix: props?.dashboardNamePrefix ?? this.stackName,
          createAlarmDashboard: props?.createAlarmDashboard ?? false,
          createDashboard: props?.createDashboard ?? false,
          createSummaryDashboard: props?.createSummaryDashboard ?? false,
          renderingPreference:
            props?.dashboardRenderingPreference ??
            DashboardRenderingPreference.INTERACTIVE_ONLY,
        },
      );

      this.monitoringFacade = new MonitoringFacade(this, 'Monitoring', {
        metricFactoryDefaults: {
          namespace: props?.metricNamespace,
          period: props?.metricPeriod,
        },
        alarmFactoryDefaults: {
          actionsEnabled: props?.alarmActionsEnabled ?? true,
          alarmNamePrefix: this.stackName,
        },
        dashboardFactory: dashboardFactory,
      });
    }

    // Setup standard tags
    this.standardTags = new StandardTags(this, props?.standardTags);
  }

  /**
   * Helper method to exports a parameter as an SSM Parameter.
   *
   * @param name the parameter name
   * @param value the parameter value
   */
  exportParameter(name: string, value: string): StringParameter {
    return this.parameterExports.write(name, value);
  }

  /**
   * Helper method to output a parameter as a CfnOutput.
   *
   * @param name the parameter name
   * @param value the parameter value
   */
  outputParameter(name: string, value: string): CfnOutput {
    return new CfnOutput(this, name, {
      value,
    });
  }

  /**
   * Helper method to export and output a parameter.
   *
   * @param name the parameter name
   * @param value the parameter value
   */
  exportAndOutputParameter(
    name: string,
    value: string,
  ): [StringParameter, CfnOutput] {
    return [
      this.exportParameter(name, value),
      this.outputParameter(name, value),
    ];
  }
}
