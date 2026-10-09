# AutoSoc

This AWS CDK project deploys an Amazon Security Lake data lake and enables the
standard AWS-native log sources using the `StandardSecurityLake` L2 construct
from `truemark-cdk-lib`.

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

Some log sources (for example `CLOUD_TRAIL_MGMT`, `ROUTE53`, `S3_DATA`,
`LAMBDA_EXECUTION`) also require that the corresponding AWS service is already
emitting events (for example, a CloudTrail trail is enabled) in the accounts
listed on each source.

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
