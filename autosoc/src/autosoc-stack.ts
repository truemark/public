import type {Construct} from 'constructs';
import {ExtendedStack, type ExtendedStackProps} from 'truemark-cdk-lib/aws-cdk';
import {
  AwsLogSourceName,
  StandardSecurityLake,
} from 'truemark-cdk-lib/aws-securitylake';

export class AutoSocStack extends ExtendedStack {
  constructor(scope: Construct, id: string, props: ExtendedStackProps) {
    super(scope, id, props);
    this.addMetadata('Version', process.env.npm_package_version);
    this.addMetadata('Name', process.env.npm_package_name);
    this.addMetadata(
      'URL',
      'https://github.com/truemark/public/tree/main/autosoc',
    );
    const createLakeFormationSlr =
      this.node.tryGetContext('createLakeFormationSlr') === true ||
      this.node.tryGetContext('createLakeFormationSlr') === 'true';
    new StandardSecurityLake(this, 'SecurityLake', {
      createLakeFormationServiceLinkedRole: createLakeFormationSlr,
      logSources: [
        {sourceName: AwsLogSourceName.CLOUD_TRAIL_MGMT},
        {sourceName: AwsLogSourceName.LAMBDA_EXECUTION},
        {sourceName: AwsLogSourceName.S3_DATA},
        {sourceName: AwsLogSourceName.SH_FINDINGS},
        {sourceName: AwsLogSourceName.VPC_FLOW},
        {sourceName: AwsLogSourceName.ROUTE53},
        {sourceName: AwsLogSourceName.EKS_AUDIT},
        {sourceName: AwsLogSourceName.WAF},
      ],
    });
  }
}
