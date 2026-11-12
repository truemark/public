import {Template} from 'aws-cdk-lib/assertions';
import {expect, test} from 'vitest';
import {HelperTest, ResourceType} from '../../helper.test';
import {CdkPipeline, NodePackageManager} from '../index';

test('Test CdkPipeline', () => {
  const stack = HelperTest.stack();
  new CdkPipeline(stack, 'Test', {
    keyArn:
      'arn:aws:kms:us-east-2:000000000000:key/00000000-0000-0000-0000-000000000000',
    connectionArn:
      'arn:aws:codestar-connections:us-east-2:000000000000:connection/00000000-0000-0000-0000-000000000000',
    repository: 'SomeOwner/SomeRepo',
    branch: 'SomeBranch',
  });
  const template = Template.fromStack(stack);
  template.resourceCountIs(ResourceType.CODEPIPELINE, 1);
});

test('Test CdkPipeline pnpm synth uses lockfile CLI without release-age cooldown', () => {
  const stack = HelperTest.stack();
  new CdkPipeline(stack, 'Test', {
    keyArn:
      'arn:aws:kms:us-east-2:000000000000:key/00000000-0000-0000-0000-000000000000',
    connectionArn:
      'arn:aws:codestar-connections:us-east-2:000000000000:connection/00000000-0000-0000-0000-000000000000',
    repository: 'SomeOwner/SomeRepo',
    branch: 'SomeBranch',
    packageManager: NodePackageManager.PNPM,
  });
  const projects = Object.values(
    Template.fromStack(stack).findResources('AWS::CodeBuild::Project'),
  ).map((resource) => resource.Properties);
  const releaseAgeVariable = {
    Name: 'PNPM_CONFIG_MINIMUM_RELEASE_AGE',
    Type: 'PLAINTEXT',
    Value: '0',
  };

  const synth = projects.filter((p) =>
    JSON.stringify(p.Source.BuildSpec).includes('cdk synth'),
  );
  expect(synth).toHaveLength(1);
  const synthBuildSpec = JSON.stringify(synth[0].Source.BuildSpec);
  expect(synthBuildSpec).toContain('pnpm exec cdk synth TestStack');
  expect(synthBuildSpec).not.toContain('pnpx');
  expect(synth[0].Environment.EnvironmentVariables).toContainEqual(
    releaseAgeVariable,
  );

  // The override is scoped to the synth build: self-mutation (and asset
  // publishing, when present) must not inherit it.
  const others = projects.filter((p) => p !== synth[0]);
  expect(others.length).toBeGreaterThan(0);
  for (const project of others) {
    expect(project.Environment.EnvironmentVariables ?? []).not.toContainEqual(
      expect.objectContaining({Name: releaseAgeVariable.Name}),
    );
  }
});
