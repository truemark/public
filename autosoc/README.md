# AutoSoc

This AWS CDK project deploys an Amazon Security Lake data lake (and optionally a
full OpenSearch-backed SIEM) using constructs from `truemark-cdk-lib` plus the
upstream [aes-siem CloudFormation template][aes-siem].

[aes-siem]: https://github.com/aws-samples/siem-on-amazon-opensearch-service

## Deployment modes

AutoSoc has two independently-deployable stacks:

1. **`AutoSoc`** (always on) — Amazon Security Lake data lake plus the full set
   of AWS native log sources. This is the default and runs on `cdk deploy` with
   no extra flags.
2. **`AutoSocSiem`** (opt-in via `-c deploySiem=true`) — the upstream aes-siem
   solution nested as a `AWS::CloudFormation::Stack`. Deploys an OpenSearch
   managed cluster (or Serverless), es-loader Lambda, dashboards, SNS alerting,
   GeoIP enrichment, IOC updater, and the supporting KMS/SQS/EventBridge
   plumbing documented in the upstream project. **Does not** replace the
   Security Lake data lake — the two run side-by-side.

When both stacks are deployed, the Security Lake data lake can additionally
feed OCSF Parquet into aes-siem via a Security Lake **Subscriber** (SQS
notification). To wire this up, deploy with:

```
cdk deploy --all \
  -c deploySiem=true \
  -c siemEmail=soc@example.com \
  -c siemSubscriberAccountId=$(aws sts get-caller-identity --query Account --output text) \
  -c siemSubscriberExternalId=<random-shared-secret>
```

Supplying the subscriber context flags causes `AutoSoc` to create a
`AWS::SecurityLake::Subscriber` + `SubscriberNotification` for the SIEM
principal and export the subscriber IAM role ARN, external id, and
notification queue ARN. `AutoSocSiem` then threads those exports into the
upstream aes-siem template's `SecurityLakeRoleArn` / `SecurityLakeExternalId`
/ `SecurityLakeSubscriberSqs` parameters so es-loader starts polling the
subscriber queue on first deploy.

### Optional SIEM context flags

Every realistic knob the upstream aes-siem template exposes is surfaced as
a `-c` context flag. Unset flags fall through to the upstream default.

| Flag | Default | Description |
| --- | --- | --- |
| `siemEmail` | **required when `deploySiem=true`** | Address for OpenSearch SNS alerts. |
| `siemTemplateSource` | `upstream` | `upstream` loads the public aes-siem template; `vendored` loads `autosoc/vendor/aes-siem/siem.yaml` as a CDK S3 asset (see Customizing the SIEM below). |
| `siemDeploymentTarget` | `opensearch_managed_cluster` | Set to `opensearch_serverless` for the (experimental) Serverless path. |
| `siemDomainOrCollectionName` | `aes-siem` | OpenSearch domain or Serverless collection name. |
| `siemVpcEndpointId` | *(none, public endpoint)* | Interface VPC endpoint id (`vpce-…` / `aos-…`) that fronts OpenSearch. Setting it places es-loader into the VPC. |
| `siemAllowedSourceIpAddresses` | `10.0.0.0/8 172.16.0.0/12 192.168.0.0/16` | Space-delimited CIDR list allowed to reach OpenSearch Dashboards (initial deployment only). |
| `siemEsLoaderReservedConcurrency` | `10` | Reserved concurrency for the es-loader Lambda. |
| `siemTrustedProxyIpList` | `127.0.0.1/8 10.0.0.0/8 …` | Space-delimited list of trusted ELB/CDN/proxy IPs; enables X-Forwarded-For client-IP selection in es-loader. |
| `siemLogBucketPolicyUpdate` | `update_and_override` | Set to `keep` after the first deploy if you manage the log-bucket policy yourself. |
| `siemGeoLite2LicenseKey` | *(empty, no enrichment)* | MaxMind GeoLite2 license key for IP geo enrichment inside es-loader. |
| `siemOtxApiKey` | *(empty)* | AlienVault OTX API key enabling IOC downloads. |
| `siemEnableTor` | `false` | Download the Tor exit-node IOC feed. |
| `siemEnableAbuseCh` | `false` | Download the abuse.ch Feodo blocklist IOC feed. |
| `siemIocDownloadIntervalMinutes` | `720` | IOC refresh interval (30 – 10080 min). |
| `siemControlTowerLogBucketNames` | *(empty)* | Comma-separated S3 bucket names in the Control Tower Log Archive account. |
| `siemControlTowerRoleArnForEsLoader` | *(empty)* | IAM role ARN that es-loader assumes in the Log Archive account. |
| `siemControlTowerSqsForLogBuckets` | *(empty)* | SQS ARN in the Log Archive account that fans out S3 notifications to es-loader. |
| `siemCreateSqsVpcEndpoint` / `siemCreateSsmVpcEndpoint` / `siemCreateStsVpcEndpoint` / `siemCreateS3VpcEndpoint` | `true` | When `siemVpcEndpointId` is set, create new VPC endpoints for the named service. Set `false` if the VPC already has one. |

## Customizing the SIEM template itself

By default `AutoSocSiem` references the upstream aes-siem template straight
from the AWS-owned public S3 bucket (`AesSiemTemplateSource.UPSTREAM`). You
can only pass parameters into it; you cannot change what resources it
creates or edit any of its IAM / Lambda / dashboards wiring.

If you need to patch the template (add resources, tweak IAM, swap Lambda
code, add a new log source, change a dashboard, etc.), vendor the template
into this repo and switch the stack to the `VENDORED` source:

```
# One-time: download the pinned upstream template into autosoc/vendor/aes-siem/
pnpm run vendor:aes-siem

# Make your edits in autosoc/vendor/aes-siem/siem.yaml

# Deploy using the vendored copy as a CDK S3 asset
cdk deploy AutoSocSiem -c deploySiem=true \
  -c siemEmail=soc@example.com \
  -c siemTemplateSource=vendored
```

The vendor script also writes `UPSTREAM.md` recording the source URL,
fetch timestamp, and template header; and keeps the previous copy as
`siem.yaml.previous` for diffing. Re-run it any time upstream ships a new
version to pull the latest and inspect the delta against your patches.

Anything you *add alongside* the nested stack (new SNS targets, extra
CloudWatch dashboards, Lambdas that watch an OpenSearch index, etc.) can
go straight into `AutoSocSiemStack` as additional CDK constructs — no
vendoring required.

## What gets deployed

- An Amazon Security Lake `CfnDataLake` in the target Region.
- A `MetaStoreManagerRole` IAM role (service principal
  `lambda.amazonaws.com`) with the AWS managed policy
  `service-role/AmazonSecurityLakeMetastoreManager` attached. This role is
  assumed by the Security Lake metastore manager Lambda to manage the AWS Glue
  metastore.
- `CfnAwsLogSource` entries for each of the following AWS log sources,
  created sequentially via `DependsOn` as required by Security Lake:
  - `CLOUD_TRAIL_MGMT`
  - `LAMBDA_EXECUTION`
  - `S3_DATA`
  - `SH_FINDINGS`
  - `VPC_FLOW`
  - `ROUTE53`
  - `EKS_AUDIT`
  - `WAF`

Encryption, lifecycle, and cross-Region replication are left at Security Lake
defaults. Pass additional props to `StandardSecurityLake` in
`src/autosoc-stack.ts` to customize.

## Prerequisites

Security Lake requires the service-linked role
`AWSServiceRoleForLakeFormationDataAccess` to exist in the account before the
data lake can be created. If it does not already exist, you have two options:

Option A — create it once per account via the CLI (recommended if you're not
sure):

```
aws iam create-service-linked-role \
  --aws-service-name lakeformation.amazonaws.com
```

Option B — let the stack create it by deploying with the
`createLakeFormationSlr=true` context flag:

```
cdk deploy -c createLakeFormationSlr=true
```

> Only use Option B when you are certain the SLR does not already exist in
> the account; otherwise the stack will fail with
> `AWSServiceRoleForLakeFormationDataAccess has been taken in this account`.

> The SLR is created with a `Retain` deletion/update-replace policy, so
> dropping the `-c createLakeFormationSlr=true` flag on a subsequent deploy
> safely orphans the CloudFormation resource rather than deleting the
> account-singleton role.

### Log source prerequisites

Per the [AWS Security Lake user guide][internal-sources], Security Lake pulls
from the AWS services directly through an **independent, duplicated event
stream** — you do **not** need to separately enable VPC Flow Logs, Route 53
Resolver query logging, EKS control-plane logs, WAFv2 logging, or Security
Hub finding delivery for Security Lake to receive them. The one exception is
CloudTrail management events, which Security Lake does not emit on your
behalf.

| Source | Needs separate configuration? |
| --- | --- |
| `CLOUD_TRAIL_MGMT` | **Yes.** Requires at least one CloudTrail multi-Region trail capturing read + write management events; without it the source stays empty. |
| `LAMBDA_EXECUTION` / `S3_DATA` | No. Security Lake streams Lambda and S3 **data events** independently of any CloudTrail trail. |
| `ROUTE53` | No. Pulled directly from Route 53 Resolver. |
| `VPC_FLOW` | No. Pulled directly from the VPC service. |
| `SH_FINDINGS` | No for ingestion — but you must still have Security Hub enabled in the Region and have at least one provider (standards, GuardDuty, Inspector, Macie, etc.) producing findings, otherwise there is nothing to collect. |
| `EKS_AUDIT` | No. Pulled directly from the EKS control plane. |
| `WAF` | No. Pulled directly from WAFv2. |

If you don't need CloudTrail management events, remove
`AwsLogSourceName.CLOUD_TRAIL_MGMT` from the `logSources` array in
`src/autosoc-stack.ts` to avoid an unused source entry.

The IAM principal running `cdk deploy` additionally needs the Glue, IAM, and
S3 permissions documented in [Verify permissions][internal-sources] to add
sources to the data lake.

[internal-sources]: https://docs.aws.amazon.com/security-lake/latest/userguide/internal-sources.html

## How to Deploy

Bootstrap the account for CDK (if not already done):

```
cdk bootstrap \
"aws://$(aws sts get-caller-identity --query 'Account' --output text)/${AWS_DEFAULT_REGION}" \
--cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess
```

Deploy:

```
cdk deploy
```

## Important Notes

- Only one Security Lake data lake can exist per Region per account.
- If a Security Lake data lake has already been created in the account/Region
  (via console, API, or another stack), this stack's `CfnDataLake` resource
  will fail to create. Delete the existing data lake or import it before
  deploying.
- Enabling a log source for an account that is not already configured in
  Security Lake as a contributing account can fail. Edit the `logSources`
  array in `src/autosoc-stack.ts` to match what your account is ready to
  ingest.
