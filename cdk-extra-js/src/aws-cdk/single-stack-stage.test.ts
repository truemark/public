import {Template} from 'aws-cdk-lib/assertions';
import {Queue} from 'aws-cdk-lib/aws-sqs';
import type {Construct} from 'constructs';
import {
  ExtendedApp,
  ExtendedStack,
  type ExtendedStackProps,
} from 'truemark-cdk-lib/aws-cdk';
import {expect, test} from 'vitest';
import {SingleStackStage} from './single-stack-stage';

interface TestStackProps extends ExtendedStackProps {
  readonly queueName: string;
}

class TestStack extends ExtendedStack {
  constructor(scope: Construct, id: string, props: TestStackProps) {
    super(scope, id, props);
    new Queue(this, 'Queue', {queueName: props.queueName});
  }
}

test('SingleStackStage creates the stack with its props', () => {
  const app = new ExtendedApp({account: '100000000000', region: 'us-east-2'});
  const stage = new SingleStackStage(app, 'TestStage', {
    id: 'TestStack',
    cls: TestStack,
    props: {queueName: 'test-queue'},
  });
  expect(stage.stack).toBeInstanceOf(TestStack);
  Template.fromStack(stage.stack).hasResourceProperties('AWS::SQS::Queue', {
    QueueName: 'test-queue',
  });
});
