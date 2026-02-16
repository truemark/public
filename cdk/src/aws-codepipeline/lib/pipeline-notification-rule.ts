import {
  INotificationRuleTarget,
  NotificationRule,
} from 'aws-cdk-lib/aws-codestarnotifications';
import {Construct} from 'constructs';
import {
  IPipeline,
  PipelineNotificationEvents,
} from 'aws-cdk-lib/aws-codepipeline';
import {SlackChannelConfiguration} from 'aws-cdk-lib/aws-chatbot';
import {ISlackChannelConfiguration} from 'aws-cdk-lib/aws-chatbot';
import {ITopic, Topic} from 'aws-cdk-lib/aws-sns';

/**
 * Properties for PipelineNotificationRule.
 */
export interface PipelineNotificationRuleProps {
  /**
   * The events to notify on.
   *
   * @see https://docs.aws.amazon.com/dtconsole/latest/userguide/concepts.html#events-ref-pipeline
   * @default PipelineNotificationRule.DEFAULT_EVENTS
   */
  readonly events?: string[];

  /**
   * Pipeline source for the events.
   */
  readonly source: IPipeline;
}

/**
 * Configures notifications for a pipeline to a ChatOps Slack channel.
 */
export class PipelineNotificationRule extends Construct {
  static readonly ACTION_EXECUTION_EVENTS = [
    PipelineNotificationEvents.ACTION_EXECUTION_SUCCEEDED,
    PipelineNotificationEvents.ACTION_EXECUTION_FAILED,
    PipelineNotificationEvents.ACTION_EXECUTION_CANCELED,
    PipelineNotificationEvents.ACTION_EXECUTION_STARTED,
  ];

  static readonly STAGE_EXECUTION_EVENTS = [
    PipelineNotificationEvents.STAGE_EXECUTION_STARTED,
    PipelineNotificationEvents.STAGE_EXECUTION_SUCCEEDED,
    PipelineNotificationEvents.STAGE_EXECUTION_RESUMED,
    PipelineNotificationEvents.STAGE_EXECUTION_CANCELED,
    PipelineNotificationEvents.STAGE_EXECUTION_FAILED,
  ];

  static readonly PIPELINE_EXECUTION_EVENTS = [
    PipelineNotificationEvents.PIPELINE_EXECUTION_FAILED,
    PipelineNotificationEvents.PIPELINE_EXECUTION_CANCELED,
    PipelineNotificationEvents.PIPELINE_EXECUTION_STARTED,
    PipelineNotificationEvents.PIPELINE_EXECUTION_RESUMED,
    PipelineNotificationEvents.PIPELINE_EXECUTION_SUCCEEDED,
    PipelineNotificationEvents.PIPELINE_EXECUTION_SUPERSEDED,
  ];

  static readonly MANUAL_APPROVAL_EVENTS = [
    PipelineNotificationEvents.MANUAL_APPROVAL_NEEDED,
    PipelineNotificationEvents.MANUAL_APPROVAL_FAILED,
    PipelineNotificationEvents.MANUAL_APPROVAL_SUCCEEDED,
  ];

  static readonly ALL_NOTIFICATION_EVENTS = [
    ...PipelineNotificationRule.ACTION_EXECUTION_EVENTS,
    ...PipelineNotificationRule.STAGE_EXECUTION_EVENTS,
    ...PipelineNotificationRule.PIPELINE_EXECUTION_EVENTS,
    ...PipelineNotificationRule.MANUAL_APPROVAL_EVENTS,
  ];

  static readonly DEFAULT_EVENTS = [
    ...PipelineNotificationRule.PIPELINE_EXECUTION_EVENTS,
    ...PipelineNotificationRule.MANUAL_APPROVAL_EVENTS,
  ];

  readonly notificationRule: NotificationRule;
  readonly targets: INotificationRuleTarget[] = [];

  constructor(
    scope: Construct,
    id: string,
    props: PipelineNotificationRuleProps,
  ) {
    super(scope, id);
    this.notificationRule = new NotificationRule(this, 'Rule', {
      source: props.source,
      events: props.events ?? PipelineNotificationRule.DEFAULT_EVENTS,
    });
  }

  addSlackChannelArn(
    id: string,
    slackChannelArn: string,
  ): ISlackChannelConfiguration {
    const slackChannel =
      SlackChannelConfiguration.fromSlackChannelConfigurationArn(
        this,
        id,
        slackChannelArn,
      );
    this.notificationRule.addTarget(slackChannel);
    return slackChannel;
  }

  addSlackChannel(slackChannel: ISlackChannelConfiguration) {
    this.targets.push(slackChannel);
    this.notificationRule.addTarget(slackChannel);
  }

  addTopicArn(id: string, topicArn: string): ITopic {
    const topic = Topic.fromTopicArn(this, id, topicArn);
    this.notificationRule.addTarget(topic);
    return topic;
  }

  addTopic(topic: ITopic) {
    this.targets.push(topic);
    this.notificationRule.addTarget(topic);
  }
}
