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
  -c siemSubscriberExternalId=$(openssl rand -hex 16)
```

Supplying the subscriber context flags causes `AutoSoc` to create a
`AWS::SecurityLake::Subscriber` + `SubscriberNotification` for the SIEM
principal and export the subscriber IAM role ARN, external id, and
notification queue ARN. `AutoSocSiem` then threads those exports into the
upstream aes-siem template's `SecurityLakeRoleArn` / `SecurityLakeExternalId`
/ `SecurityLakeSubscriberSqs` parameters so es-loader starts polling the
subscriber queue on first deploy.

> **About the Security Lake queue visibility timeout.** Security Lake
> auto-provisions the subscriber Main-Queue with a 300 s
> `VisibilityTimeout`, which is **less than** aes-siem's default
> 600 s es-loader Lambda timeout. Without a patch, aes-siem's
> event-source-mapping creation is rejected and the `--all` deploy
> fails on first run. `StandardSecurityLake` fixes this automatically:
> `AutoSocStack` passes `sqsVisibilityTimeoutSeconds: 3600` on the
> subscriber, so the construct emits an `AwsCustomResource` that calls
> `sqs:SetQueueAttributes` to raise the timeout to 3600 s before
> `AutoSocSiem` is created. The `--all` workflow above therefore works
> on a cold account; no manual queue update is required. See §1 below
> for the full backstory.

### Optional SIEM context flags

Every non-secret knob the upstream aes-siem template exposes is surfaced
as a `-c` context flag. Unset flags fall through to the upstream default.

| Flag | Default | Description |
| --- | --- | --- |
| `siemEmail` | **required when `deploySiem=true`** | Address for OpenSearch SNS alerts. |
| `siemTemplateSource` | `vendored` | `vendored` packages the checked-in v2.10.6 template as a CDK S3 asset. `upstream` opts into the mutable public latest-template URL and is not reproducible. |
| `siemUpstreamTemplateFileName` | partition-specific | Optional filename override in either source mode. Commercial and China templates are selected automatically. For GovCloud, run `AES_SIEM_TEMPLATE_FILE_NAME=siem-on-amazon-opensearch-service-usgov.template pnpm run vendor:aes-siem` and set this flag to the same filename. |
| `siemDeploymentTarget` | `opensearch_managed_cluster` | Set to `opensearch_serverless` for the (experimental) Serverless path. |
| `siemDomainOrCollectionName` | `aes-siem` | OpenSearch domain or Serverless collection name. |
| `siemVpcEndpointId` | *(none, public endpoint)* | Interface VPC endpoint id (`vpce-…` / `aos-…`) that fronts OpenSearch. Setting it places es-loader into the VPC. |
| `siemAllowedSourceIpAddresses` | `10.0.0.0/8 172.16.0.0/12 192.168.0.0/16` | Space-delimited CIDR list allowed to reach OpenSearch Dashboards (initial deployment only). |
| `siemEsLoaderReservedConcurrency` | `10` | Reserved concurrency for the es-loader Lambda. |
| `siemTrustedProxyIpList` | `127.0.0.1/8 10.0.0.0/8 …` | Space-delimited list of trusted ELB/CDN/proxy IPs; enables X-Forwarded-For client-IP selection in es-loader. |
| `siemLogBucketPolicyUpdate` | `update_and_override` | Set to `keep` after the first deploy if you manage the log-bucket policy yourself. |
| `siemEnableTor` | `false` | Download the Tor exit-node IOC feed. |
| `siemEnableAbuseCh` | `false` | Download the abuse.ch Feodo blocklist IOC feed. |
| `siemIocDownloadIntervalMinutes` | `720` | IOC refresh interval (30 – 10080 min). |
| `siemControlTowerLogBucketNames` | *(empty)* | Comma-separated S3 bucket names in the Control Tower Log Archive account. |
| `siemControlTowerRoleArnForEsLoader` | *(empty)* | IAM role ARN that es-loader assumes in the Log Archive account. |
| `siemControlTowerSqsForLogBuckets` | *(empty)* | SQS ARN in the Log Archive account that fans out S3 notifications to es-loader. |
| `siemCreateSqsVpcEndpoint` / `siemCreateSsmVpcEndpoint` / `siemCreateStsVpcEndpoint` / `siemCreateS3VpcEndpoint` | `true` | When `siemVpcEndpointId` is set, create new VPC endpoints for the named service. Set `false` if the VPC already has one. |

The optional GeoLite2 license key and OTX API key are **not** CDK context
flags. `AutoSocSiem` exposes them as `NoEcho` CloudFormation parameters
named `GeoLite2LicenseKey` and `OtxApiKey`; provide them through your
deployment system's protected parameter input. They are passed to the
nested stack by reference and are not written as literals to `cdk.context.json`
or the synthesized parent template. Avoid putting secret values directly
on a shell command line where they may be retained in shell history.

## Customizing the SIEM template itself

By default `AutoSocSiem` packages the checked-in aes-siem v2.10.6 template
as a CDK S3 asset (`AesSiemTemplateSource.VENDORED`). The template is
fetched from the exact upstream release tag by the vendor script. This
keeps fresh deployments pinned even if aws-samples changes its public
latest-template S3 object.

If you need to patch the template (add resources, tweak IAM, swap Lambda
code, add a new log source, change a dashboard, etc.), vendor the template
into this repo and switch the stack to the `VENDORED` source:

```
# Refresh the pinned v2.10.6 template from its exact upstream release tag
pnpm run vendor:aes-siem

# Make your edits in autosoc/vendor/aes-siem/

# Deploy using the vendored copy as a CDK S3 asset (the default source)
cdk deploy AutoSocSiem -c deploySiem=true \
  -c siemEmail=soc@example.com \
  -c siemTemplateSource=vendored
```

The vendor script writes a per-template `.UPSTREAM.md` record with the
exact release URL, fetch timestamp, and template header; it keeps the
previous copy beside the template with a `.previous` suffix for diffing.
To upgrade, change `AES_SIEM_TEMPLATE_VERSION`, rerun the script for each
partition template, and inspect the delta against your patches. Do not use
`siemTemplateSource=upstream` for reproducible deployments.

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

## SIEM Deployment Gotchas (field notes)

The upstream aes-siem template and the Security Lake subscriber APIs have
a handful of sharp edges that are either undocumented or buried in the
console. These are the ones that cost us real time on the first-ever
end-to-end deployment; keep this section in mind on every new account.

### Recommended first-deploy order of operations

If you're bringing up `AutoSoc` + `AutoSocSiem` for the first time in a fresh
account, following this order avoids ~90% of the rework described below:

1. **Raise the Lambda concurrent-executions quota** (see §2). Sync but slow,
   can run while you prep the rest.
2. **Deploy `AutoSoc` with `-c createLakeFormationSlr=true` and the
   subscriber context flags in the *same* first deploy** (see §4). The
   service-linked role's retain policy is NOT retroactive.
3. **Wait for `AutoSoc` to reach `CREATE_COMPLETE`** before deploying
   `AutoSocSiem`. The subscriber Main-Queue visibility timeout is now
   patched automatically by the `AwsCustomResource` emitted by
   `StandardSecurityLake` when `sqsVisibilityTimeoutSeconds` is set
   (see §1); no manual `sqs set-queue-attributes` call is required
   anymore. The patch runs as part of `AutoSoc`, so the SIEM deploy
   just needs the parent stack to be done.
4. **Deploy `AutoSocSiem`.**
5. On the one-and-only successful create, immediately grab the `aesadmin`
   password from CloudWatch logs (see §7) and store it in your password
   manager, then shorten log retention so the plaintext ages out.
6. Add your workstation's public IP to the OpenSearch access policy
   allowlist (see §8) before trying Dashboards.

### 1. SQS visibility timeout vs Lambda timeout mismatch (now auto-patched)

- **Symptom:** aes-siem CFN rolls back; `CreateEventSourceMapping` rejects
  with "The event source mapping's function timeout must be smaller than
  or equal to the queue's visibility timeout."
- **Root cause:** Security Lake *auto-provisions* the subscriber SQS queue
  (`AmazonSecurityLake-<uuid>-Main-Queue`) with the default 300s visibility
  timeout. aes-siem's es-loader has a 600s Lambda timeout. AWS requires
  visibility ≥ function timeout.
- **Current status: fixed in-template.** `AutoSocStack` passes
  `sqsVisibilityTimeoutSeconds: 3600` on the subscriber, and
  `StandardSecurityLake` responds by emitting an `AwsCustomResource` that
  calls `sqs:SetQueueAttributes` on the Security-Lake-managed Main-Queue
  immediately after it is created. The patch is partition-aware (uses
  `${AWS::URLSuffix}` so it works in `aws-cn` / GovCloud) and runs as
  part of the `AutoSoc` deploy, before any dependent SIEM stack is
  created. No manual `aws sqs set-queue-attributes` call is required.
- **Manual fallback** (only needed for one-off recovery scenarios where
  the subscriber is recreated out of band from CFN):
  ```bash
  QUEUE_URL=$(aws sqs list-queues --region "$AWS_REGION" \
    --queue-name-prefix AmazonSecurityLake \
    --query 'QueueUrls[?contains(@, `Main-Queue`)] | [0]' --output text)
  aws sqs set-queue-attributes --region "$AWS_REGION" \
    --queue-url "$QUEUE_URL" --attributes VisibilityTimeout=3600
  ```

### 2. Lambda reserved-concurrency vs account quota

- **Symptom:** CFN rolls back with "Specified ReservedConcurrentExecutions
  for function decreases account's UnreservedConcurrentExecution below its
  minimum value of [10]."
- **Root cause:** The aes-siem template hardcodes
  `ReservedConcurrentExecutions: 1` on **9 helper Lambdas** plus
  `!Ref ReservedConcurrency` on es-loader. A fresh sandbox account's
  Lambda concurrent-executions quota defaults to 10, which is less than
  (9 helpers + es-loader reservation + AWS-enforced 10-floor).
- **Fix:** Service Quotas request to raise `Concurrent executions` on
  Lambda from 10 → 1000. Setting `-c siemEsLoaderReservedConcurrency=0`
  does **not** save you — the 9 helper reservations still blow the budget.
- **Rule of thumb:** aes-siem on a sandbox account needs quota ≥ ~20.

### 3. Security Lake subscriber `description` regex is stricter than documented

- **Symptom:** `CfnSubscriber` create fails: "description must match
  pattern `^[\w\s\-_:/,.@=+]*$`".
- **Reality:** The published charset includes `,` and `.`, but the API
  still rejects both parentheses `()` and periods `.`. The API-side
  pattern is stricter than the documented regex.
- **Fix:** Stick to word chars + spaces + `-` + `_` + `:` + `/` only. The
  working description string lives in `src/autosoc-stack.ts`.

### 4. Service-linked role retain policy is NOT retroactive

- **Symptom:** On a `cdk destroy` + redeploy of `AutoSoc`, the
  `AWSServiceRoleForLakeFormationDataAccess` SLR gets torn down, breaking
  subscriber reads on the next deploy.
- **Root cause:** CDK's `RemovalPolicy.RETAIN` only applies to a resource
  whose *current* template entry has it set. If the SLR was created on an
  earlier deploy without retain, CFN still owns it with the default
  `Delete`.
- **Fix:** Two-stage deploy.
  1. `cdk deploy AutoSoc -c createLakeFormationSlr=true` to flip the
     `DeletionPolicy: Retain` on the SLR.
  2. Redeploy with the subscriber. `cdk diff` should now show the SLR
     going from `destroy` to `orphan`, not deleted.
- **Rule:** any resource you ever want to retain must be marked retain
  **before** the first destructive change, not during it.

### 5. CDK bootstrap v27 blocks change-set error inspection

- **Symptom:** When CFN rolls back, `cdk deploy` prints only `AccessDenied`
  on `cloudformation:DescribeEvents` instead of the real failed resource.
- **Root cause:** The CDK CLI tries `DescribeEvents` under the bootstrap
  deploy role; the role on v27 bootstrap doesn't grant it. v30+ does.
- **Fix:** `npx cdk bootstrap aws://$ACCOUNT/$REGION` to upgrade. Cosmetic
  only — doesn't affect deploys — but makes failures debuggable without
  needing the console.


### 6. Failed aes-siem deploys leave orphans every retry

Several aes-siem resources are created outside the CFN delete path and
survive a stack rollback:

- 3 S3 buckets: `aes-siem-<account>-log`, `aes-siem-<account>-geo`,
  `aes-siem-<account>-snapshot`
- KMS CMK plus alias `alias/aes-siem-key` (the CMK goes into 7-day
  pending deletion, which blocks alias reuse)
- A `REVIEW_IN_PROGRESS` or `ROLLBACK_COMPLETE` stub CFN stack

The next retry immediately fails with "bucket already exists" / "alias
already exists". Full cleanup sequence to run before each retry:

```bash
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REGION=${AWS_REGION:-us-east-1}

# 1. Stub stack
aws cloudformation delete-stack --stack-name AutoSocSiem --region "$REGION"
aws cloudformation wait stack-delete-complete --stack-name AutoSocSiem \
  --region "$REGION" 2>/dev/null || true

# 2. KMS alias + schedule orphan key for deletion.
#    IMPORTANT: resolve the alias target first; `delete-alias` removes
#    the alias entry so `list-aliases` can no longer map back to the CMK.
#    If the alias is deleted before the lookup, the key is leaked and
#    only shows up as `arn:…:key/<uuid>` in `aws kms list-keys`.
KEY_ID=$(aws kms list-aliases --region "$REGION" \
  --query "Aliases[?AliasName=='alias/aes-siem-key'].TargetKeyId" --output text)
aws kms delete-alias --alias-name alias/aes-siem-key --region "$REGION" 2>/dev/null || true
if [ -n "$KEY_ID" ]; then
  aws kms schedule-key-deletion --key-id "$KEY_ID" \
    --pending-window-in-days 7 --region "$REGION"
fi

# 3. S3 buckets.
#    `aws s3 rb --force` only deletes current-version objects; it does
#    NOT purge noncurrent versions or delete markers from a versioned
#    bucket. Versioning is on for aes-siem's log/geo/snapshot buckets,
#    so without the explicit `delete-objects` loop the bucket stays
#    non-empty, `rb` fails with "BucketNotEmpty", and the names remain
#    occupied — the next deploy will immediately fail with
#    "BucketAlreadyOwnedByYou". The loop below enumerates every
#    version + delete marker (handles pagination via `--output text`
#    streaming) and removes them before deleting the bucket.
for b in log geo snapshot; do
  bucket="aes-siem-${ACCOUNT}-${b}"
  aws s3api head-bucket --bucket "$bucket" --region "$REGION" 2>/dev/null || continue
  echo "Purging ${bucket}"
  while :; do
    objects=$(aws s3api list-object-versions --bucket "$bucket" --region "$REGION" \
      --max-items 1000 \
      --query '{Objects: (Versions || `[]`)[].{Key:Key,VersionId:VersionId}}' \
      --output json 2>/dev/null)
    markers=$(aws s3api list-object-versions --bucket "$bucket" --region "$REGION" \
      --max-items 1000 \
      --query '{Objects: (DeleteMarkers || `[]`)[].{Key:Key,VersionId:VersionId}}' \
      --output json 2>/dev/null)
    for payload in "$objects" "$markers"; do
      count=$(echo "$payload" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["Objects"]))')
      if [ "$count" -gt 0 ]; then
        aws s3api delete-objects --bucket "$bucket" --region "$REGION" --delete "$payload" >/dev/null
      fi
    done
    remaining=$(aws s3api list-object-versions --bucket "$bucket" --region "$REGION" \
      --max-items 1 --query 'length((Versions || `[]`)[]) + length((DeleteMarkers || `[]`)[])' \
      --output text)
    [ "$remaining" = "0" ] && break
  done
  aws s3api delete-bucket --bucket "$bucket" --region "$REGION"
done
```

### 7. `deploy_es` only generates the `aesadmin` password on *domain create*

- **Symptom:** Nested stack output shows `DashboardsAdminID=NOT_CREATED`
  and `DashboardsPassword=MASKED` even on a successful deploy.
- **Root cause:** aes-siem's `deploy_es/index.py` only generates the FGAC
  master-user password on the initial domain-create path. If a prior
  rolled-back attempt left the `aes-siem` OpenSearch domain behind, the
  custom resource short-circuits and never writes the password anywhere —
  not Secrets Manager, not SSM. The password was logged to CloudWatch on
  the single invocation that actually created the domain.
- **Recovery (preferred):** Fish it out of CloudWatch:
  ```bash
  aws logs describe-log-groups --region "$AWS_REGION" \
    --log-group-name-prefix /aws/lambda/aes-siem-deploy \
    --query 'logGroups[].logGroupName' --output text
  # Note the group name (recent versions: `/aws/lambda/aes-siem-deploy-aes`)

  aws logs filter-log-events --region "$AWS_REGION" \
    --log-group-name /aws/lambda/aes-siem-deploy-aes \
    --filter-pattern 'PASSWORD' \
    --query 'events[].message' --output text | tail -5
  # Prints:  [INFO] ... ID: aesadmin, PASSWORD: <plaintext>
  ```
- **Hygiene immediately after recovery:**
  ```bash
  aws logs put-retention-policy --region "$AWS_REGION" \
    --log-group-name /aws/lambda/aes-siem-deploy-aes --retention-in-days 1
  ```
  Then rotate the password in Dashboards: *Security → Internal users →
  aesadmin → Edit*.
- **Fallback (if logs are expired):** Reset the FGAC master directly:
  ```bash
  read -s NEW_PASS   # >=8 chars, upper, lower, digit, special
  aws opensearch update-domain-config --region "$AWS_REGION" \
    --domain-name aes-siem \
    --advanced-security-options \
      "MasterUserOptions={MasterUserName=aesadmin,MasterUserPassword=$NEW_PASS}"
  ```
  Takes ~1 min to propagate, no downtime.


### 8. Dashboards IP allowlist defaults to RFC1918 only

- **Symptom:** The Dashboards URL returns:
  ```
  {"Message":"User: anonymous is not authorized to perform: es:ESHttpGet
   because no resource-based policy allows the es:ESHttpGet action"}
  ```
  — and you never see a login prompt.
- **Root cause:** aes-siem's default OpenSearch access policy only allows
  `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` (intended for a
  VPN/bastion workflow). FGAC login runs *after* the resource policy
  allows the request, so you don't even get to type credentials.
- **Rule:** "no resource-based policy allows" is **always** the IP
  allowlist, not a credentials or user-DB problem.
- **Fix:** Append your current public /32 to the allowlist:
  ```bash
  MY_IP=$(curl -s https://checkip.amazonaws.com)
  ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
  aws opensearch update-domain-config --region "$AWS_REGION" \
    --domain-name aes-siem \
    --access-policies "{\"Version\":\"2012-10-17\",\"Statement\":[\
  {\"Effect\":\"Allow\",\"Principal\":{\"AWS\":\"arn:aws:iam::${ACCOUNT}:root\"},\
  \"Action\":\"es:*\",\"Resource\":\"arn:aws:es:${AWS_REGION}:${ACCOUNT}:domain/aes-siem/*\"},\
  {\"Effect\":\"Allow\",\"Principal\":{\"AWS\":\"*\"},\"Action\":\"es:*\",\
  \"Resource\":\"arn:aws:es:${AWS_REGION}:${ACCOUNT}:domain/aes-siem/*\",\
  \"Condition\":{\"IpAddress\":{\"aws:SourceIp\":[\
  \"10.0.0.0/8\",\"172.16.0.0/12\",\"192.168.0.0/16\",\"${MY_IP}/32\"]}}}]}"
  ```
  Returns `Processing`; takes ~1-2 min to propagate.

### 9. A fast deploy is NOT proof the SIEM works

- **Observation:** First-time aes-siem creates normally take 15-25 min
  (OpenSearch domain provisioning dominates). If `cdk deploy` returns in
  under 5 min, either (a) the domain already existed from a prior
  retained attempt and only the ESM + a few IAM policies were new, or
  (b) a nested stack is still `CREATE_IN_PROGRESS` under a parent that
  misleadingly shows `CREATE_COMPLETE`.
- **Validation signals that actually prove it works** (run all of these,
  don't trust just `CREATE_COMPLETE`):
  ```bash
  # Both outer and nested stacks truly complete
  aws cloudformation describe-stacks --stack-name AutoSocSiem \
    --region "$AWS_REGION" --query 'Stacks[0].StackStatus'
  aws cloudformation list-stack-resources --stack-name AutoSocSiem \
    --region "$AWS_REGION" \
    --query 'StackResourceSummaries[?ResourceType==`AWS::CloudFormation::Stack`].[LogicalResourceId,ResourceStatus]' \
    --output table

  # Event-source-mapping on the subscriber SQS, state=Enabled
  aws lambda list-event-source-mappings --function-name aes-siem-es-loader \
    --region "$AWS_REGION" \
    --query 'EventSourceMappings[].{Arn:EventSourceArn,State:State}' --output table

  # es-loader env has the subscriber role + external id
  aws lambda get-function-configuration --function-name aes-siem-es-loader \
    --region "$AWS_REGION" \
    --query 'Environment.Variables.{Role:SECURITY_LAKE_ROLE_ARN,Ext:SECURITY_LAKE_EXTERNAL_ID,Endpoint:ENDPOINT}'

  # Real ingestion - look for OCSF Parquet keys being processed
  aws logs tail /aws/lambda/aes-siem-es-loader --region "$AWS_REGION" \
    --since 15m --filter-pattern '"logtype":"securitylake"' \
    --format short | head -20
  ```
  The last command should show log lines like:
  ```
  Invoked es-loader s3_key=aws/S3_DATA/2.0/region=.../eventDay=.../*.gz.parquet
  ```
