import type {IAlarmAction} from 'aws-cdk-lib/aws-cloudwatch';
import {SnsAction} from 'aws-cdk-lib/aws-cloudwatch-actions';
import type {ITopic} from 'aws-cdk-lib/aws-sns';

/**
 * Helper methods for working with alarms.
 */
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
}
