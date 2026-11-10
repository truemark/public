import {Match, Template} from 'aws-cdk-lib/assertions';
import {Code, Function, Runtime} from 'aws-cdk-lib/aws-lambda';
import {LogGroup} from 'aws-cdk-lib/aws-logs';
import {expect, test} from 'vitest';
import {HelperTest, ResourceType} from '../../helper.test';
import {FunctionAlarms} from './function-alarms';

function streamFunction(stack: ReturnType<typeof HelperTest.stack>) {
  return new Function(stack, 'StreamFn', {
    runtime: Runtime.NODEJS_24_X,
    handler: 'index.handler',
    code: Code.fromInline('exports.handler = async () => {};'),
  });
}

test('iterator-age alarm is created when isIterator is true', () => {
  const stack = HelperTest.stack();
  new FunctionAlarms(stack, 'Alarms', {
    function: streamFunction(stack),
    logGroup: new LogGroup(stack, 'LogGroup'),
    isIterator: true,
    criticalAlarmOptions: {
      maxIteratorAge: 300000,
    },
  });
  const template = Template.fromStack(stack);
  // cdk-monitoring-constructs renders the iterator-age alarm as a metric-math
  // alarm over the IteratorAge metric with the configured threshold.
  template.hasResourceProperties(ResourceType.CLOUDWATCH_ALARM, {
    Threshold: 300000,
    Metrics: Match.arrayWith([
      Match.objectLike({
        MetricStat: Match.objectLike({
          Metric: Match.objectLike({MetricName: 'IteratorAge'}),
        }),
      }),
    ]),
  });
});

test('maxIteratorAge works when isIterator is left unset', () => {
  const stack = HelperTest.stack();
  // Unset must keep the cdk-monitoring-constructs default of true, so stacks
  // that configured maxIteratorAge before isIterator existed still synth.
  new FunctionAlarms(stack, 'Alarms', {
    function: streamFunction(stack),
    logGroup: new LogGroup(stack, 'LogGroup'),
    criticalAlarmOptions: {
      maxIteratorAge: 300000,
    },
  });
  Template.fromStack(stack).hasResourceProperties(
    ResourceType.CLOUDWATCH_ALARM,
    {
      Threshold: 300000,
      Metrics: Match.arrayWith([
        Match.objectLike({
          MetricStat: Match.objectLike({
            Metric: Match.objectLike({MetricName: 'IteratorAge'}),
          }),
        }),
      ]),
    },
  );
});

test('maxIteratorAge with isIterator false throws', () => {
  const stack = HelperTest.stack();
  const fn = streamFunction(stack);
  const logGroup = new LogGroup(stack, 'LogGroup');
  expect(() => {
    new FunctionAlarms(stack, 'Alarms', {
      function: fn,
      logGroup,
      isIterator: false,
      criticalAlarmOptions: {
        maxIteratorAge: 300000,
      },
    });
  }).toThrow(/isIterator/);
});
