import {StandardQueue} from '../index';
import {Template} from 'aws-cdk-lib/assertions';
import {HelperTest} from '../../helper.test';
import {QueueEncryption} from 'aws-cdk-lib/aws-sqs';

test('Standard Queue Test', () => {
  const stack = HelperTest.stack();
  const test1Queue = new StandardQueue(stack, 'Test1', {
    encryption: QueueEncryption.SQS_MANAGED,
  });
  expect(test1Queue.encryption).toEqual(QueueEncryption.SQS_MANAGED);
  new StandardQueue(stack, 'Test2');
  const template = Template.fromStack(stack);
  template.hasResourceProperties('AWS::SQS::Queue', {});
  // HelperTest.logResources(template, 'AWS::CloudWatch::Alarm');
  // console.log(template.findResources("AWS::CloudWatch::Alarm"));
  // console.log(
  //   JSON.stringify(template.findResources('AWS::SQS::Queue'), null, 2),
  // );
});
