import {App} from 'aws-cdk-lib';
import {Match, Template} from 'aws-cdk-lib/assertions';
import {AutoAlarmStack} from './auto-alarm-stack';
import {SERVICE_DESCRIPTORS} from './service-eventbridge-subconstruct';

/**
 * Synthesizes the AutoAlarm stack once and runs assertions against the
 * resulting CloudFormation template. Synthesis bundles the Lambda handlers
 * with esbuild, so allow a generous timeout.
 */
let template: Template;

beforeAll(() => {
  const app = new App();
  const stack = new AutoAlarmStack(app, 'AutoAlarmTest', {});
  template = Template.fromStack(stack);
}, 600_000);

describe('AutoAlarm stack', () => {
  test('creates the expected number of SQS queues', () => {
    // 15 service queues + 15 service DLQs + main handler queue + DLQ +
    // ReAlarm consumer queue + DLQ + ReAlarm tag event queue + DLQ
    // + 1 shared EventBridge rule target DLQ (standard) = 37
    template.resourceCountIs('AWS::SQS::Queue', 37);
  });

  test('every EventBridge rule has at least one target', () => {
    const rules = template.findResources('AWS::Events::Rule');
    const ruleEntries = Object.entries(rules);
    // 27 service rules + ReAlarm schedule rule + ReAlarm tag rule
    expect(ruleEntries.length).toBeGreaterThanOrEqual(27);
    for (const [logicalId, rule] of ruleEntries) {
      const targets = rule.Properties?.Targets ?? [];
      expect({logicalId, hasTargets: targets.length >= 1}).toEqual({
        logicalId,
        hasTargets: true,
      });
    }
  });

  test('every EventBridge rule target is configured with a dead-letter queue', () => {
    const rules = template.findResources('AWS::Events::Rule');
    for (const rule of Object.values(rules)) {
      for (const target of rule.Properties?.Targets ?? []) {
        expect(target.DeadLetterConfig?.Arn).toBeDefined();
      }
    }
  });

  test('main function policy includes scoped cloudwatch:PutMetricAlarm', () => {
    template.hasResourceProperties(
      'AWS::IAM::Policy',
      Match.objectLike({
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            // Mutating alarm actions scoped to AutoAlarm-managed alarm ARNs only.
            Match.objectLike({
              Action: Match.arrayWith([
                'cloudwatch:PutMetricAlarm',
                'cloudwatch:DeleteAlarms',
                'cloudwatch:TagResource',
                'cloudwatch:UntagResource',
              ]),
              Resource: Match.objectLike({
                'Fn::Join': Match.arrayWith([
                  Match.arrayWith([
                    Match.stringLikeRegexp(':alarm:AutoAlarm-\\*'),
                  ]),
                ]),
              }),
            }),
            // DescribeAlarms with AlarmNamePrefix requires alarm:* resource
            // (AWS does not support resource-level scoping for prefix-based list calls).
            // CDK collapses single-action statements to a string, not an array.
            Match.objectLike({
              Action: 'cloudwatch:DescribeAlarms',
              Resource: Match.objectLike({
                'Fn::Join': Match.arrayWith([
                  Match.arrayWith([Match.stringLikeRegexp(':alarm:\\*')]),
                ]),
              }),
            }),
            // Anomaly-detector and describe/list actions are not
            // resource-scopable and stay on '*'.
            Match.objectLike({
              Action: Match.arrayWith([
                'cloudwatch:PutAnomalyDetector',
                'cloudwatch:DeleteAnomalyDetector',
              ]),
              Resource: '*',
            }),
          ]),
        }),
      }),
    );
  });

  test('main function policy includes tag:GetResources for identity-tag alarm lookup', () => {
    template.hasResourceProperties(
      'AWS::IAM::Policy',
      Match.objectLike({
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            // tag:GetResources is not resource-scopable; used by the main
            // function to look up alarms by their identity tags.
            Match.objectLike({
              Action: 'tag:GetResources',
              Resource: '*',
            }),
          ]),
        }),
      }),
    );
  });

  test('all queues except the shared EventBridge target DLQ are FIFO', () => {
    const queues = Object.values(template.findResources('AWS::SQS::Queue'));
    const fifoQueues = queues.filter(
      (queue) => queue.Properties?.FifoQueue === true,
    );
    expect(fifoQueues.length).toBe(queues.length - 1);
  });

  test('queues with a redrive policy use maxReceiveCount 3 and 6x visibility timeout', () => {
    const queues = Object.values(template.findResources('AWS::SQS::Queue'));
    const queuesWithRedrive = queues.filter(
      (queue) => queue.Properties?.RedrivePolicy !== undefined,
    );
    // main handler queue + 15 service queues + ReAlarm consumer queue +
    // ReAlarm tag event queue
    expect(queuesWithRedrive.length).toBe(18);
    for (const queue of queuesWithRedrive) {
      expect(queue.Properties.RedrivePolicy.maxReceiveCount).toBe(3);
      // ~6x the 900s consumer Lambda timeout per AWS guidance
      expect(queue.Properties.VisibilityTimeout).toBe(5400);
    }
  });

  test('every event source mapping reports batch item failures', () => {
    const mappings = Object.values(
      template.findResources('AWS::Lambda::EventSourceMapping'),
    );
    // 15 service queues + main handler + ReAlarm consumer + ReAlarm tag event
    expect(mappings.length).toBeGreaterThanOrEqual(18);
    for (const mapping of mappings) {
      expect(mapping.Properties?.FunctionResponseTypes).toEqual([
        'ReportBatchItemFailures',
      ]);
    }
  });

  test('service event rule count matches the descriptor table', () => {
    const ruleIds = Object.keys(template.findResources('AWS::Events::Rule'));
    const serviceRuleIds = ruleIds.filter((id) =>
      id.includes('ServiceEventRules'),
    );
    const expected = SERVICE_DESCRIPTORS.reduce(
      (count, service) => count + service.rules.length,
      0,
    );
    expect(serviceRuleIds.length).toBe(expected);
  });

  test('every service event rule has exactly one SQS target with a DLQ', () => {
    const rules = template.findResources('AWS::Events::Rule');
    for (const [logicalId, rule] of Object.entries(rules)) {
      if (!logicalId.includes('ServiceEventRules')) {
        continue;
      }
      const targets = rule.Properties?.Targets ?? [];
      expect({logicalId, targetCount: targets.length}).toEqual({
        logicalId,
        targetCount: 1,
      });
      const target = targets[0];
      // Target is an SQS queue (queue ARN + FIFO SqsParameters) with a
      // dead-letter queue for undeliverable events (#234).
      expect(target.Arn?.['Fn::GetAtt']?.[1]).toBe('Arn');
      expect(target.SqsParameters?.MessageGroupId).toMatch(
        /^AutoAlarm-[a-z0-9]+$/,
      );
      expect(target.DeadLetterConfig?.Arn).toBeDefined();
    }
  });

  test('each descriptor rule synthesizes its exact event pattern, message group id, and DLQ', () => {
    for (const service of SERVICE_DESCRIPTORS) {
      for (const rule of service.rules) {
        // Array properties (including changed-tag-keys, which is derived
        // from the handler alarm configs via service-tag-keys.ts) are
        // matched exactly by the assertions module, so this also guards
        // each tag rule's changed-tag-keys list.
        template.hasResourceProperties('AWS::Events::Rule', {
          Description: rule.description,
          EventPattern: {
            'source': rule.eventPattern.source,
            'detail-type': rule.eventPattern.detailType,
            'detail': rule.eventPattern.detail,
          },
          Targets: [
            Match.objectLike({
              SqsParameters: {
                MessageGroupId: `AutoAlarm-${service.serviceName}`,
              },
              DeadLetterConfig: Match.objectLike({Arn: Match.anyValue()}),
            }),
          ],
        });
      }
    }
  });

  test('event source concurrency caps protect CloudWatch API limits', () => {
    const mappings = Object.values(
      template.findResources('AWS::Lambda::EventSourceMapping'),
    );
    const caps = mappings
      .map((mapping) => mapping.Properties?.ScalingConfig?.MaximumConcurrency)
      .filter((cap): cap is number => cap !== undefined)
      .sort((a, b) => a - b);
    // ReAlarm consumer (10), ReAlarm tag event (10), main function (20);
    // the sqs-handler fan-out router is intentionally unbounded.
    expect(caps).toEqual([10, 10, 20]);
  });
});
