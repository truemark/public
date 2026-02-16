import {IAlarmAction, TreatMissingData} from 'aws-cdk-lib/aws-cloudwatch';
import {AlarmHelper} from './alarm-helper';
import {Duration} from 'aws-cdk-lib';
import {ITopic} from 'aws-cdk-lib/aws-sns';
import {CustomAlarmThreshold} from 'cdk-monitoring-constructs';
import {StandardAlarmActionsStrategy} from './standard-alarm-actions-strategy';
import {
  AlarmCategory,
  AlarmsCategoryOptions,
  AlarmsOptions,
} from './alarms-base';

/**
 * Properties for AlarmFacade
 */
export interface AlarmFacadeProps {
  prop: string;
  threshold?: number | Duration;
  defaultThreshold?: number | Duration;
  topics?: ITopic[];
  actions?: IAlarmAction[];
  treatMissingDataOverride?: TreatMissingData;
}

/**
 * Facade to assist in generating a CustomAlarmThreshold instance.
 */
export class AlarmFacade {
  readonly actions: IAlarmAction[];

  private props: AlarmFacadeProps;

  constructor(props: AlarmFacadeProps) {
    this.props = props;
    this.actions = AlarmHelper.combineActions(props.actions, props.topics);
  }

  /**
   * Converts this AlarmFacade into a CustomAlarmThreshold instance
   */
  toCustomAlarmThreshold(): CustomAlarmThreshold | undefined {
    const threshold: undefined | number | Duration =
      this.props.threshold ?? this.props.defaultThreshold;
    if (threshold !== undefined) {
      if (
        (typeof threshold === 'number' && threshold > -1) ||
        (typeof threshold === 'object' &&
          (threshold as Duration).toSeconds() > 0)
      ) {
        return {
          [this.props.prop]:
            this.props.threshold ?? this.props.defaultThreshold,
          actionsEnabled: true,
          actionOverride: new StandardAlarmActionsStrategy({
            actions: this.actions,
          }),
        };
      }
    }
    return undefined;
  }
}

/**
 * Facade to assist in creating Record instances containing alarms.
 */
export class AlarmFacadeSet<
  O extends AlarmsCategoryOptions,
  T extends CustomAlarmThreshold,
> {
  private readonly criticalOptions?: O;
  private readonly warningOptions?: O;
  private readonly record: Record<string, T>;

  constructor(props: AlarmsOptions<O>) {
    this.criticalOptions = props.criticalAlarmOptions;
    this.warningOptions = props.warningAlarmOptions;
    this.record = {};
  }

  /**
   * Add an alarm to the record set.
   *
   * @param category category of the alarm
   * @param oprop property from the AlarmsCategoryOptions instance
   * @param tprop property from the CustomAlarmThreshold instance
   * @param defaultThreshold optional default value for the threshold
   * @param treatMissingDataOverride optional override for the treat missing data setting
   */
  addAlarm(
    category: AlarmCategory,
    oprop: keyof O,
    tprop: keyof T,
    defaultThreshold?: number | Duration | undefined,
    treatMissingDataOverride?: TreatMissingData,
  ): AlarmFacadeSet<O, T> {
    const options =
      category === AlarmCategory.Critical
        ? this.criticalOptions
        : this.warningOptions;
    const customAlarmThreshold = new AlarmFacade({
      prop: tprop as string,
      threshold: options?.[oprop] as number | Duration | undefined,
      defaultThreshold,
      topics: options?.notifyTopics,
      actions: options?.notifyActions,
      treatMissingDataOverride,
    }).toCustomAlarmThreshold();
    if (customAlarmThreshold) {
      this.record[category] = customAlarmThreshold as T;
    }
    return this;
  }

  /**
   * Adds a critical alarm to the record set.
   *
   * @param oprop property from the AlarmsCategoryOptions instance
   * @param tprop property from the CustomAlarmThreshold instance
   * @param defaultThreshold optional default value for the threshold
   * @param treatMissingDataOverride optional override for the treat missing data setting
   */
  addCriticalAlarm(
    oprop: keyof O,
    tprop: keyof T,
    defaultThreshold?: number | Duration | undefined,
    treatMissingDataOverride?: TreatMissingData,
  ): AlarmFacadeSet<O, T> {
    return this.addAlarm(
      AlarmCategory.Critical,
      oprop,
      tprop,
      defaultThreshold,
      treatMissingDataOverride,
    );
  }

  /**
   * Adds a warning alarm to the record set.
   *
   * @param oprop property from the AlarmsCategoryOptions instance
   * @param tprop property from the CustomAlarmThreshold instance
   * @param defaultThreshold optional default value for the threshold
   * @param treatMissingDataOverride optional override for the treat missing data setting
   */
  addWarningAlarm(
    oprop: keyof O,
    tprop: keyof T,
    defaultThreshold?: number | Duration | undefined,
    treatMissingDataOverride?: TreatMissingData,
  ): AlarmFacadeSet<O, T> {
    return this.addAlarm(
      AlarmCategory.Warning,
      oprop,
      tprop,
      defaultThreshold,
      treatMissingDataOverride,
    );
  }

  /**
   * Adds critical and warning alarms to the record set.
   *
   * @param oprop property from the AlarmsCategoryOptions instance
   * @param tprop property from the CustomAlarmThreshold instance
   * @param defaultCriticalThreshold optional default value for the critical threshold
   * @param defaultWarningThreshold optional default value for the warning threshold
   * @param treatMissingDataOverride optional override for the treat missing data setting
   */
  addAlarms(
    oprop: keyof O,
    tprop: keyof T,
    defaultCriticalThreshold?: number | Duration,
    defaultWarningThreshold?: number | Duration,
    treatMissingDataOverride?: TreatMissingData,
  ): AlarmFacadeSet<O, T> {
    this.addCriticalAlarm(
      oprop,
      tprop,
      defaultCriticalThreshold,
      treatMissingDataOverride,
    );
    this.addWarningAlarm(
      oprop,
      tprop,
      defaultWarningThreshold,
      treatMissingDataOverride,
    );
    return this;
  }

  /**
   * Returns the record set if alarms were created and undefined if otherwise.
   */
  toRecord(): Record<string, T> | undefined {
    return Object.keys(this.record).length > 0 ? this.record : undefined;
  }
}
