import {AlarmFacade} from '../index';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import {HelperTest} from '../../helper.test';
import {Duration} from 'aws-cdk-lib';

test('Create AlarmFacade', () => {
  const stack = HelperTest.stack();
  const topic = new sns.Topic(stack, 'TestTopic');
  const action = new actions.SnsAction(new sns.Topic(stack, 'TestActionTopic'));
  const facade = new AlarmFacade({
    prop: 'TestProp',
    threshold: 1,
    defaultThreshold: 10,
    topics: [topic],
    actions: [action],
  });
  expect(facade.actions.length).toBe(2);
  // eslint-disable-next-line  @typescript-eslint/no-explicit-any
  const threshold: any = facade.toCustomAlarmThreshold();
  expect(threshold?.actionsEnabled).toBe(true);
  expect(threshold?.['TestProp']).toBe(1);
});

test('Create AlarmFacade Default Number Threshold', () => {
  const facade = new AlarmFacade({
    prop: 'TestProp',
    threshold: undefined,
    defaultThreshold: 0,
  });
  // eslint-disable-next-line  @typescript-eslint/no-explicit-any
  const threshold: any = facade.toCustomAlarmThreshold();
  expect(threshold?.actionsEnabled).toBe(true);
  expect(threshold?.['TestProp']).toBe(0);
});

test('Create AlarmFacade Default Duration Threshold', () => {
  const facade = new AlarmFacade({
    prop: 'TestProp',
    threshold: undefined,
    defaultThreshold: Duration.hours(1),
  });
  // eslint-disable-next-line  @typescript-eslint/no-explicit-any
  const threshold: any = facade.toCustomAlarmThreshold();
  expect(threshold?.actionsEnabled).toBe(true);
  expect(threshold?.['TestProp']).toStrictEqual(Duration.hours(1));
});

test('Create AlarmFacade Disable Number Threshold', () => {
  const facade = new AlarmFacade({
    prop: 'TestProp',
    threshold: -1,
    defaultThreshold: 0,
  });
  const threshold = facade.toCustomAlarmThreshold();
  expect(threshold).toBeUndefined();
});

test('Create AlarmFacade Disable Duration Threshold', () => {
  const facade = new AlarmFacade({
    prop: 'TestProp',
    threshold: Duration.hours(0),
    defaultThreshold: Duration.hours(1),
  });
  const threshold = facade.toCustomAlarmThreshold();
  expect(threshold).toBeUndefined();
});

test('Create Undefined AlarmFacade', () => {
  const facade = new AlarmFacade({
    prop: 'TestProp',
    threshold: undefined,
    defaultThreshold: undefined,
  });
  const threshold = facade.toCustomAlarmThreshold();
  expect(threshold).toBeUndefined();
});

// TODO Need to add tests for AlarmFacadeSet
