import {IAlarmAction, TreatMissingData} from 'aws-cdk-lib/aws-cloudwatch';
import {ITopic} from 'aws-cdk-lib/aws-sns';
import {SnsAction} from 'aws-cdk-lib/aws-cloudwatch-actions';
import {CustomAlarmThreshold} from 'cdk-monitoring-constructs';
import {Duration} from 'aws-cdk-lib';
import {AlarmFacadeSet} from './alarm-facade';
import {AlarmsCategoryOptions, AlarmsOptions} from './alarms-base';

export class AlarmHelper {
  /**
   * Helper function to combine an array if IAlarmAction and ITopic objects into a single IAlarmAction array.
   *
   * @param actions the actions
   * @param topics the topics
   */
  static combineActions(
    actions?: IAlarmAction[],
    topics?: ITopic[],
  ): IAlarmAction[] {
    const combined: IAlarmAction[] = [];
    actions?.forEach((action) => combined.push(action));
    topics?.forEach((topic) => combined.push(new SnsAction(topic)));
    return combined;
  }

  /**
   * Helper function to generate categorized alarms.
   *
   * @param options the AlarmsOptions instance
   * @param oprop property from the AlarmsCategoryOptions instance
   * @param tprop property from the CustomAlarmThreshold instance
   * @param defaultCriticalThreshold optional default value for the critical threshold
   * @param defaultWarningThreshold optional default value for the warning threshold
   * @param treatMissingDataOverride optional override for the treat missing data setting
   */
  static toRecord<
    O extends AlarmsCategoryOptions,
    T extends CustomAlarmThreshold,
  >(
    options: AlarmsOptions<O>,
    oprop: keyof O,
    tprop: keyof T,
    defaultCriticalThreshold?: number | Duration,
    defaultWarningThreshold?: number | Duration,
    treatMissingDataOverride?: TreatMissingData,
  ): Record<string, T> | undefined {
    return new AlarmFacadeSet<O, T>(options)
      .addAlarms(
        oprop,
        tprop,
        defaultCriticalThreshold,
        defaultWarningThreshold,
        treatMissingDataOverride,
      )
      .toRecord();
  }
}
