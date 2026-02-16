import {test} from 'vitest';
import * as path from 'path';
import {Template} from 'aws-cdk-lib/assertions';
import {App, ResourceEnvironment, Stack, Stage} from 'aws-cdk-lib';
import {ExtendedApp, ExtendedStack, ExtendedStage} from './aws-cdk/index';

export enum ResourceType {
  CODEPIPELINE = 'AWS::CodePipeline::Pipeline',
  CLOUDWATCH_ALARM = 'AWS::CloudWatch::Alarm',
  CLOUDWATCH_LOG_GROUP = 'AWS::Logs::LogGroup',
  LAMBDA_FUNCTION = 'AWS::Lambda::Function',
  DYNAMODB_TABLE = 'AWS::DynamoDB::Table',
  DYNAMODB_GLOBAL_TABLE = 'AWS::DynamoDB::GlobalTable',
  SSM_PARAMETER = 'AWS::SSM::Parameter',
  S3_BUCKET = 'AWS::S3::Bucket',
  OAM_LINK = 'AWS::Oam::Link',
}

export class HelperTest {
  static readonly DEFAULT_REGION = 'us-east-2';
  static readonly DEFAULT_ACCOUNT = '100000000000';

  static app() {
    return new ExtendedApp({
      account: this.DEFAULT_ACCOUNT,
      region: this.DEFAULT_REGION,
    });
  }

  static stage(app?: App, id?: string): Stage {
    return new ExtendedStage(app ?? this.app(), id ?? 'TestStage');
  }

  static stack(scope?: App | Stage, id?: string): Stack {
    return new ExtendedStack(scope ?? this.app(), id ?? 'TestStack');
  }

  static resolveTestFiles(childPath?: string): string {
    const dir = path.join(__dirname, '..', 'test-files');
    return path.resolve(
      childPath === undefined ? dir : path.join(dir, childPath),
    );
  }

  static logResources(
    template: Template,
    type: string | ResourceType,
    props?: object,
  ) {
    console.log(template.findResources(type, props));
  }

  static logTemplate(template: Template) {
    console.log(JSON.stringify(template, null, '  '));
  }

  static env(): ResourceEnvironment {
    return {
      account: HelperTest.DEFAULT_ACCOUNT,
      region: HelperTest.DEFAULT_REGION,
    };
  }
}

test('Empty Test', () => {
  // Do nothing
});
