import {Construct} from 'constructs';
import {CfnOutput} from 'aws-cdk-lib';
import {ExtendedStack, ExtendedStackProps} from 'truemark-cdk-lib/aws-cdk';
import {
  AwsWorkspaces,
  AwsWorkspacesProps,
} from 'truemark-cdk-lib/aws-patterns-workspaces';

export interface AwsWorkspacesStackProps
  extends ExtendedStackProps, AwsWorkspacesProps {}

export class AwsWorkspacesStack extends ExtendedStack {
  constructor(scope: Construct, id: string, props: AwsWorkspacesStackProps) {
    super(scope, id, props);
    this.addMetadata('Version', process.env.npm_package_version);
    this.addMetadata('Name', process.env.npm_package_name);
    this.addMetadata(
      'URL',
      'https://github.com/truemark/public/tree/main/blueprints/aws-workspaces',
    );
    const ws = new AwsWorkspaces(this, 'AwsWorkspaces', props);
    new CfnOutput(this, 'VpcId', {
      value: ws.vpc.vpcId,
      description: 'VPC ID',
    });
    new CfnOutput(this, 'DirectoryId', {
      value: ws.directoryId,
      description: 'Directory Service ID',
    });
    new CfnOutput(this, 'BucketName', {
      value: ws.bucket.bucketName,
      description: 'S3 storage bucket name (retained on delete)',
    });
    new CfnOutput(this, 'KmsKeyArn', {
      value: ws.encryptionKey.keyArn,
      description: 'KMS encryption key ARN',
    });
    if (ws.workspace) {
      new CfnOutput(this, 'WorkspaceId', {
        value: ws.workspace.ref,
        description: 'WorkSpace ID',
      });
    }
  }
}
