import {Template} from 'aws-cdk-lib/assertions';
import {expect, test} from 'vitest';
import {HelperTest} from '../../helper.test';
import {AutoBackup} from './autobackup-construct';

test('Every selection role can back up S3', () => {
  const stack = HelperTest.stack();
  new AutoBackup(stack, 'AutoBackup');
  const template = Template.fromStack(stack);

  template.resourceCountIs('AWS::Backup::BackupSelection', 5);
  const roles = Object.values(template.findResources('AWS::IAM::Role'));
  expect(roles).toHaveLength(5);
  for (const role of roles) {
    expect(JSON.stringify(role.Properties.ManagedPolicyArns)).toContain(
      ':iam::aws:policy/AWSBackupServiceRolePolicyForS3Backup',
    );
  }
});
