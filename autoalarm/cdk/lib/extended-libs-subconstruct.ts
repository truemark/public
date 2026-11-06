import {ExtendedQueue, ExtendedQueueProps} from 'truemark-cdk-lib/aws-sqs';
import {Construct} from 'constructs';
import {CfnAlarm} from 'aws-cdk-lib/aws-cloudwatch';

//Interface to expose the physical name of an alarm from within the AlarmBase class
interface AlarmWithProtectedMembers {
  physicalName: string;
}

export class NoBreachingExtendedQueue extends ExtendedQueue {
  private readonly queueNameLower: string;
  private readonly id: string;
  constructor(
    scope: Construct,
    id: string,
    queueName: string,
    props: ExtendedQueueProps,
  ) {
    super(scope, id, props);

    this.queueNameLower = queueName.toLowerCase();
    this.id = id;

    //run through construct validation to force the alarms to be set to notBreaching before synth
    this.node.addValidation({
      validate: () => {
        this.setAlarmsMissingDataTreatment();
        return []; // No validation errors
      },
    });
  }

  /**
   * Sets TreatMissingData to NOT_BREACHING for all CloudWatch alarms
   * created by this queue.
   */
  private setAlarmsMissingDataTreatment(): void {
    // Get all alarms managed by ExtendedQueue
    const criticalAlarms = this.queueAlarms.getCriticalAlarms();
    const warningAlarms = this.queueAlarms.getWarningAlarms();

    //console.log('CriticalAlarm:', criticalAlarms);
    //console.log('warningAlarms:', warningAlarms);

    // Filter out alarms that are not related to this queue
    const cfnAlarms = [...criticalAlarms, ...warningAlarms].filter((alarm) => {
      // Physical Name is the same as the alarm name in the AlarmBase class
      const exposedPhysicalName = (
        alarm as unknown as AlarmWithProtectedMembers
      ).physicalName;

      // console.log('exposedPhysicalName:', exposedPhysicalName);
      // console.log('alarm.node.id:', alarm.node.id);
      // console.log('queueName prefix:', this.queueNameLower);

      const nameToCheck = (alarm.node.id || exposedPhysicalName).toLowerCase();
      const queueMatch =
        nameToCheck.includes(this.queueNameLower) ||
        nameToCheck.includes(this.id.toLowerCase());
      const metricMatch =
        nameToCheck.includes('dlq') ||
        nameToCheck.includes('deadletterqueue') ||
        nameToCheck.includes('message-count') ||
        nameToCheck.includes('message-age');

      return queueMatch && metricMatch;
    });

    // Set TreatMissingData to NOT_BREACHING for all alarm objects in the cfnAlarms array
    Object.values(cfnAlarms).forEach((alarm) => {
      const cfnAlarm = alarm.node.defaultChild as CfnAlarm;
      cfnAlarm.addPropertyOverride('TreatMissingData', 'notBreaching');
      //console.log(`Set 'notBreaching' for alarm: ${alarm.node.id}`);
    });
  }
}
