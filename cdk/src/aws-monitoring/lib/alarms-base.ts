import {Stack} from 'aws-cdk-lib';
import type {AlarmBase, IAlarmAction} from 'aws-cdk-lib/aws-cloudwatch';
import type {ITopic} from 'aws-cdk-lib/aws-sns';
import type {MonitoringFacade} from 'cdk-monitoring-constructs';
import {Construct} from 'constructs';
import type {ExtendedStack} from '../../aws-cdk/index';

export enum AlarmCategory {
  CRITICAL = 'Critical',
  WARNING = 'Warning',
}

export interface AlarmsCategoryOptions {
  /**
   * Topics to send alarm notifications
   */
  readonly notifyTopics?: ITopic[];

  /**
   * Actions to send alarm notifications
   */
  readonly notifyActions?: IAlarmAction[];
}

/**
 * Options shared by all Alarms constructs. Each construct adds its own
 * criticalAlarmOptions and warningAlarmOptions.
 */
export interface AlarmsOptions {
  /**
   * Main entry point for monitoring.
   */
  readonly monitoringFacade?: MonitoringFacade;

  /**
   * Add widgets to alarm dashboard.
   *
   * @default true
   */
  readonly addToAlarmDashboard?: boolean;

  /**
   * Add widgets to detailed dashboard.
   *
   * @default true
   */
  readonly addToDetailDashboard?: boolean;

  /**
   * Add widgets to summary dashboard.
   *
   * @default true
   */
  readonly addToSummaryDashboard?: boolean;

  /**
   * Prefix for generated alarms.
   *
   * @default Stack.of(this).stackName
   */
  readonly alarmNamePrefix?: string;
}

/**
 * Base class for all Alarms constructs.
 */
export abstract class AlarmsBase extends Construct {
  /**
   * The MonitoringFacade instance either passed in or generated.
   */
  readonly monitoringFacade?: MonitoringFacade;

  protected constructor(scope: Construct, id: string, props: AlarmsOptions) {
    super(scope, id);

    if (props.monitoringFacade !== undefined) {
      this.monitoringFacade = props.monitoringFacade;
    } else {
      const stack = Stack.of(this);
      if ('monitoringFacade' in stack) {
        const mf = (stack as ExtendedStack).monitoringFacade;
        if (mf !== undefined) {
          this.monitoringFacade = mf;
        }
      }
    }
    if (this.monitoringFacade === undefined) {
      throw new Error(
        'MonitoringFacade must be provided as a constructor property or as monitoringFacade property on parent Stack',
      );
    }
  }

  getAlarms(category: AlarmCategory): AlarmBase[] {
    if (this.monitoringFacade === undefined) {
      throw new Error(
        'MonitoringFacade must be provided as a constructor property or as monitoringFacade property on parent Stack',
      );
    }
    return [
      ...this.monitoringFacade
        .createdAlarmsWithDisambiguator(category)
        .map((awa) => awa.alarm)
        .values(),
    ];
  }

  /**
   * The critical alarms created by this construct.
   */
  get criticalAlarms(): AlarmBase[] {
    return this.getAlarms(AlarmCategory.CRITICAL);
  }

  /**
   * The warning alarms created by this construct.
   */
  get warningAlarms(): AlarmBase[] {
    return this.getAlarms(AlarmCategory.WARNING);
  }
}
