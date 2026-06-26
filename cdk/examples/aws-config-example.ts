/**
 * Example: Deploying AWS Config Conformance Packs
 *
 * This example demonstrates how to deploy AWS Config conformance packs
 * for compliance monitoring using the TrueMark CDK library.
 */

import {Stack, StackProps} from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {
  ConformancePack,
  OrganizationConformancePack,
  ConfigRecorder,
  DeliveryChannel,
} from '../src/aws-config';
import {Role, ServicePrincipal, ManagedPolicy} from 'aws-cdk-lib/aws-iam';
import {Bucket, BlockPublicAccess, BucketEncryption} from 'aws-cdk-lib/aws-s3';

/**
 * Example 1: Basic Conformance Pack Deployment
 * Deploys a HIPAA conformance pack to an AWS account
 */
export class BasicConformancePackStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Deploy HIPAA conformance pack
    new ConformancePack(this, 'HipaaConformancePack', {
      packName: 'hipaa',
      deliveryBucketName: 'my-config-bucket',
    });
  }
}

/**
 * Example 2: Complete AWS Config Setup
 * Sets up AWS Config with recorder, delivery channel, and conformance packs
 */
export class CompleteConfigSetupStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Create IAM role for AWS Config
    const configRole = new Role(this, 'ConfigRole', {
      assumedBy: new ServicePrincipal('config.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('service-role/ConfigRole'),
      ],
    });

    // Create S3 bucket for AWS Config data
    const configBucket = new Bucket(this, 'ConfigBucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
    });

    // Grant AWS Config permissions to write to the bucket
    configBucket.grantWrite(new ServicePrincipal('config.amazonaws.com'));

    // Create configuration recorder
    const recorder = new ConfigRecorder(this, 'ConfigRecorder', {
      roleArn: configRole.roleArn,
      recorderName: 'default',
      recordAllSupported: true,
      includeGlobalResourceTypes: true,
    });

    // Create delivery channel
    new DeliveryChannel(this, 'DeliveryChannel', {
      bucket: configBucket,
      channelName: 'default',
      s3KeyPrefix: 'config',
    });

    // Deploy NIST 800-171 conformance pack
    const nistPack = new ConformancePack(this, 'Nist800171Pack', {
      packName: 'nist-800-171',
      packNamePrefix: 'compliance-',
      deliveryBucket: configBucket,
    });

    // Ensure recorder is created before conformance pack
    nistPack.node.addDependency(recorder);
  }
}

/**
 * Example 3: Multiple Conformance Packs
 * Deploys multiple compliance frameworks
 */
export class MultipleConformancePacksStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const frameworks = [
      'hipaa',
      'pci-dss',
      'nist-800-171',
      'sox',
      'cis-aws-v1.4-level1',
    ];

    // Deploy multiple conformance packs
    frameworks.forEach((framework) => {
      new ConformancePack(this, `${framework}Pack`, {
        packName: framework,
        packNamePrefix: 'compliance-',
        deliveryBucketName: 'my-config-bucket',
      });
    });
  }
}

/**
 * Example 4: Organization-Wide Deployment
 * Deploys conformance packs across all accounts in an AWS Organization
 */
export class OrganizationConformancePackStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Deploy HIPAA across the organization
    new OrganizationConformancePack(this, 'OrgHipaaConformancePack', {
      packName: 'hipaa',
      deliveryBucketName: 'my-org-config-bucket',
      excludedAccounts: [
        '123456789012', // Development account
        '234567890123', // Sandbox account
      ],
    });

    // Deploy PCI-DSS for production accounts
    new OrganizationConformancePack(this, 'OrgPciDssConformancePack', {
      packName: 'pci-dss',
      packNamePrefix: 'prod-',
      deliveryBucketName: 'my-org-config-bucket',
    });
  }
}

/**
 * Example 5: Customized Conformance Pack
 * Deploys a conformance pack with custom parameters
 */
export class CustomizedConformancePackStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    new ConformancePack(this, 'CustomPciDssConformancePack', {
      packName: 'pci-dss',
      deliveryBucketName: 'my-config-bucket',
      inputParameters: {
        // Override access key rotation period to 45 days
        AccessKeysRotatedParameterMaxAccessKeyAge: '45',
        // Override password max age to 60 days
        IamPasswordPolicyParamMaxPasswordAge: '60',
        // Override password minimum length to 14 characters
        IamPasswordPolicyParamMinimumPasswordLength: '14',
      },
    });
  }
}

/**
 * Example 6: Using Specific Template Version
 * Deploys a conformance pack with a specific template version
 */
export class VersionedConformancePackStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    new ConformancePack(this, 'VersionedConformancePack', {
      packName: 'hipaa',
      templateVersion: 'v1.0.0', // Use a specific git tag
      deliveryBucketName: 'my-config-bucket',
    });
  }
}

// Example App
// Uncomment to use:
// const app = new App();

// Then uncomment the stack you want to deploy
// new BasicConformancePackStack(app, 'BasicConformancePackStack');
// new CompleteConfigSetupStack(app, 'CompleteConfigSetupStack');
// new MultipleConformancePacksStack(app, 'MultipleConformancePacksStack');
// new OrganizationConformancePackStack(app, 'OrganizationConformancePackStack');
// new CustomizedConformancePackStack(app, 'CustomizedConformancePackStack');
// new VersionedConformancePackStack(app, 'VersionedConformancePackStack');
