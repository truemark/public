# AWS Config CDK Constructs

This module provides AWS CDK constructs for deploying AWS Config conformance packs, configuration recorders, and delivery channels.

## Features

- **ConformancePack**: Deploy AWS Config conformance packs at the account level
- **OrganizationConformancePack**: Deploy conformance packs across an AWS Organization
- **ConfigRecorder**: Create AWS Config configuration recorders
- **DeliveryChannel**: Create AWS Config delivery channels
- **60+ Pre-configured Compliance Frameworks**: Includes HIPAA, PCI-DSS, NIST, CIS, SOX, and many more

## Installation

```bash
npm install truemark-cdk-lib
```

## Usage

### Basic Conformance Pack Deployment

Deploy a HIPAA conformance pack to an account:

```typescript
import {Stack, StackProps} from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {ConformancePack} from 'truemark-cdk-lib/aws-config';

export class ComplianceStack extends Stack {
    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props);

        new ConformancePack(this, 'HipaaConformancePack', {
            packName: 'hipaa',
            deliveryBucketName: 'my-config-bucket',
        });
    }
}
```

### Organization-Wide Deployment

Deploy conformance packs across all accounts in an AWS Organization:

```typescript
import {OrganizationConformancePack} from 'truemark-cdk-lib/aws-config';

new OrganizationConformancePack(this, 'OrgHipaaConformancePack', {
    packName: 'hipaa',
    deliveryBucketName: 'my-org-config-bucket',
    excludedAccounts: ['123456789012'], // Optional: exclude specific accounts
});
```

### With Config Recorder and Delivery Channel

Set up complete AWS Config infrastructure:

```typescript
import {
    ConfigRecorder,
    DeliveryChannel,
    ConformancePack,
} from 'truemark-cdk-lib/aws-config';
import {Role, ServicePrincipal, ManagedPolicy} from 'aws-cdk-lib/aws-iam';
import {Bucket} from 'aws-cdk-lib/aws-s3';

// Create IAM role for Config
const configRole = new Role(this, 'ConfigRole', {
    assumedBy: new ServicePrincipal('config.amazonaws.com'),
    managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('service-role/ConfigRole'),
    ],
});

// Create S3 bucket for Config data
const configBucket = new Bucket(this, 'ConfigBucket', {
    bucketName: 'my-config-bucket',
});

// Create Config recorder
const recorder = new ConfigRecorder(this, 'ConfigRecorder', {
    roleArn: configRole.roleArn,
    recorderName: 'default',
});

// Create delivery channel
const channel = new DeliveryChannel(this, 'DeliveryChannel', {
    bucket: configBucket,
    channelName: 'default',
});

// Deploy conformance pack
const conformancePack = new ConformancePack(this, 'NistConformancePack', {
    packName: 'nist-800-171',
    deliveryBucket: configBucket,
});

// Ensure recorder is created before conformance pack
conformancePack.node.addDependency(recorder);
```

### Custom Parameters

Override default parameters in conformance packs:

```typescript
new ConformancePack(this, 'CustomizedConformancePack', {
    packName: 'pci-dss',
    deliveryBucketName: 'my-config-bucket',
    inputParameters: {
        AccessKeysRotatedParameterMaxAccessKeyAge: '45',
        IamPasswordPolicyParamMaxPasswordAge: '60',
    },
});
```

### Multiple Conformance Packs

Deploy multiple compliance frameworks:

```typescript
const frameworks = ['hipaa', 'pci-dss', 'nist-800-171', 'sox'];

frameworks.forEach((framework) => {
    new ConformancePack(this, `${framework}ConformancePack`, {
        packName: framework,
        packNamePrefix: 'compliance-',
        deliveryBucketName: 'my-config-bucket',
    });
});
```

### Custom Template

Use a custom conformance pack template:

```typescript
import * as fs from 'fs';

const customTemplate = fs.readFileSync('my-custom-pack.yaml', 'utf-8');

new ConformancePack(this, 'CustomConformancePack', {
    packName: 'custom-pack',
    templateBody: customTemplate,
    deliveryBucketName: 'my-config-bucket',
});
```

## Available Conformance Packs

### Healthcare & Privacy

- `hipaa` - HIPAA Security
- `fda-21cfr-part11` - FDA 21 CFR Part 11
- `gxp-eu-annex11` - GxP EU Annex 11
- `nist-privacy` - NIST Privacy Framework

### Financial Services

- `pci-dss` - PCI DSS
- `pci-dss-4-0-include-global` - PCI DSS 4.0 (with global resources)
- `pci-dss-4-0-without-global` - PCI DSS 4.0 (without global resources)
- `sox` - Sarbanes-Oxley (SOX)
- `ffiec` - FFIEC
- `gramm-leach-bliley` - Gramm-Leach-Bliley Act
- `nydfs` - NYDFS 23 NYCRR 500

### Government & Federal

- `fedramp-low` - FedRAMP Low
- `fedramp-moderate` - FedRAMP Moderate
- `fedramp-high` - FedRAMP High
- `nist-800-171` - NIST 800-171
- `nist-800-53-rev4` - NIST 800-53 Rev 4
- `nist-800-53-rev5` - NIST 800-53 Rev 5
- `nist-csf` - NIST Cybersecurity Framework
- `nist-800-181` - NIST 800-181
- `nist-800-172` - NIST 800-172
- `nist-1800-25` - NIST 1800-25
- `irs-1075` - IRS 1075
- `cjis` - CJIS

### Defense & Security

- `cmmc-level-1` through `cmmc-level-5` - CMMC Levels 1-5
- `cmmc-2.0-level-1` - CMMC 2.0 Level 1
- `cmmc-2.0-level-2` - CMMC 2.0 Level 2

### Industry Standards

- `cis` - CIS Benchmark
- `cis-aws-v1.4-level1` - CIS AWS v1.4 Level 1
- `cis-aws-v1.4-level2` - CIS AWS v1.4 Level 2
- `cis-critical-security-controls-v8-ig1/ig2/ig3` - CIS Critical Security Controls v8
- `cis-top20` - CIS Top 20

### International & Regional

- `apra-cpg-234` - APRA CPG 234 (Australia)
- `mas-trmg` - MAS TRMG (Singapore)
- `mas-notice-655` - MAS Notice 655 (Singapore)
- `rbi-basic-cyber` - RBI Basic Cyber Security Framework (India)
- `rbi-master-direction` - RBI Master Direction (India)
- `swift-csp` - SWIFT CSP
- `k-isms` - K-ISMS (Korea)
- `enisa-cybersecurity` - ENISA Cybersecurity Guide (EU)
- `ncsc-caf` - NCSC CAF (UK)
- `acsc-essential8` - ACSC Essential 8 (Australia)
- `acsc-ism` - ACSC ISM (Australia)
- `cccs-medium` - CCCS Medium (Canada)
- `nzism` - NZISM (New Zealand)
- `germany-c5` - Germany C5
- `ccn-ens-low/medium/high` - CCN ENS (Spain)
- `bnm-rmit` - BNM RMiT (Malaysia)
- `nbc-trmg` - NBC TRMG
- `abs-ccig-material` - ABS CCIG Material
- `abs-ccig-standard` - ABS CCIG Standard

### AWS Specific

- `aws-well-architected` - AWS Well-Architected Security Pillar
- `aws-control-tower` - AWS Control Tower Detective Guardrails

### Energy & Utilities

- `nerc-cip` - NERC CIP BCSI

### Other

- `cisa-cyber-essentials` - CISA Cyber Essentials

## API Reference

### ConformancePack

```typescript
interface ConformancePackProps {
    readonly packName: string;
    readonly packNamePrefix?: string;
    readonly templateBody?: string;
    readonly templateS3Uri?: string;
    readonly templateVersion?: string;
    readonly templateRepositoryUrl?: string;
    readonly inputParameters?: ConformancePackInputParameters;
    readonly deliveryBucket?: IBucket;
    readonly deliveryBucketName?: string;
    readonly deliveryS3KeyPrefix?: string;
}
```

### OrganizationConformancePack

```typescript
interface OrganizationConformancePackProps extends ConformancePackProps {
    readonly excludedAccounts?: string[];
}
```

### ConfigRecorder

```typescript
interface ConfigRecorderProps {
    readonly recorderName?: string;
    readonly roleArn: string;
    readonly recordAllSupported?: boolean;
    readonly includeGlobalResourceTypes?: boolean;
}
```

### DeliveryChannel

```typescript
interface DeliveryChannelProps {
    readonly channelName?: string;
    readonly bucket?: IBucket;
    readonly bucketName?: string;
    readonly s3KeyPrefix?: string;
    readonly snsTopicArn?: string;
}
```

## Notes

- **Template Fetching**: When `templateBody` is not provided, the construct automatically fetches the conformance pack template from the AWS Labs GitHub repository
- **Version Control**: Use `templateVersion` to specify a specific commit hash or tag from the AWS Config rules repository
- **Dependencies**: Conformance packs require an active AWS Config configuration recorder and delivery channel
- **Organization Mode**: Organization conformance packs require AWS Organizations to be enabled and must be deployed from the management account
- **S3 Permissions**: Ensure your S3 bucket has the appropriate bucket policy to allow AWS Config to write to it

## Related Resources

- [AWS Config Documentation](https://docs.aws.amazon.com/config/)
- [AWS Config Conformance Packs](https://docs.aws.amazon.com/config/latest/developerguide/conformance-packs.html)
- [AWS Config Rules Repository](https://github.com/awslabs/aws-config-rules)
