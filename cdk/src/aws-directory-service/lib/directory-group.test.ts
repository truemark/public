import {Template} from 'aws-cdk-lib/assertions';
import {expect, test} from 'vitest';
import {HelperTest} from '../../helper.test';
import {DirectoryGroup} from './directory-group';

// Asserts that some IAM policy in the template grants the given action. Handles
// both string (single-action) and array (multi-action) Action values, since CDK
// collapses single-element action arrays to a string.
function policyWithAction(template: Template, action: string): void {
  const policies = template.findResources('AWS::IAM::Policy');
  const found = Object.values(policies).some((policy) => {
    const statements = policy.Properties?.PolicyDocument?.Statement ?? [];
    return statements.some((s: {Action?: string | string[]}) =>
      Array.isArray(s.Action) ? s.Action.includes(action) : s.Action === action,
    );
  });
  expect(found, `expected an IAM policy granting ${action}`).toBe(true);
}

test('Create DirectoryGroup', () => {
  const stack = HelperTest.stack();
  new DirectoryGroup(stack, 'Group', {
    directoryId: 'd-1234567890',
    groupName: 'Researchers',
  });
  const template = Template.fromStack(stack);
  policyWithAction(template, 'ds-data:CreateGroup');
});

test('DirectoryGroup with members adds memberships', () => {
  const stack = HelperTest.stack();
  new DirectoryGroup(stack, 'Group', {
    directoryId: 'd-1234567890',
    groupName: 'Researchers',
    members: ['jdoe', 'asmith'],
  });
  const template = Template.fromStack(stack);
  policyWithAction(template, 'ds-data:AddGroupMember');
});
