# AutoSiem

This AWS CDK project deploys a full OpenSearch-backed SIEM using the
upstream [aes-siem CloudFormation template][aes-siem], optionally fed by a
cross-account Amazon Security Lake subscriber.

`autosiem` is the companion package to [`autosoc`][autosoc], which
provisions the Amazon Security Lake data lake. The two are **independent
CDK apps/stacks**, typically deployed into **different AWS accounts** —
`autosoc` into a log-archive account, `autosiem` into a security-audit
account — matching how Security Lake subscribers are meant to work
(an external account reading from the log-archive account's data lake).
There is no CloudFormation cross-stack export/`Fn::ImportValue` link
between them; see "Wiring up the Security Lake subscriber" below for how
the hand-off works.

[aes-siem]: https://github.com/aws-samples/siem-on-amazon-opensearch-service
[autosoc]: https://github.com/truemark/public/tree/main/autosoc

## Deploying standalone (no Security Lake ingestion)

`AutoSocSiem` is a single top-level CDK stack that nests the upstream
aes-siem template as a `AWS::CloudFormation::Stack` child resource. It
deploys an OpenSearch managed cluster (or Serverless), es-loader Lambda,
dashboards, SNS alerting (if `siemEmail` is set — see below), GeoIP
enrichment, IOC updater, and the supporting KMS/SQS/EventBridge plumbing
documented in the upstream project — all on its own, with no dependency
on Security Lake or `autosoc` at all:

```
cdk deploy AutoSocSiem -c siemEmail=soc@example.com
```

## Wiring up the Security Lake subscriber

To additionally have aes-siem ingest OCSF Parquet objects produced by an
`autosoc` Security Lake data lake (typically in a different account),
first deploy `autosoc` with the subscriber context flags set to this
account:

```
# In the autosoc package, deployed in the log-archive account
cdk deploy AutoSocSecurityLake \
  -c siemSubscriberAccountId=$(aws sts get-caller-identity --profile security-audit --query Account --output text) \
  -c siemSubscriberExternalId=$(openssl rand -hex 16)
```

(That inline `get-caller-identity` needs a `security-audit`-profile
credential — the account that will assume the subscriber role — separate
from the credentials `cdk deploy` itself runs under for the log-archive
account. Substitute whatever profile name you've configured for
`security-audit` if it differs.)

Once `AutoSocSecurityLake` reaches `CREATE_COMPLETE`/`UPDATE_COMPLETE`, read its three
`CfnOutput`s:

```bash
aws cloudformation describe-stacks --stack-name AutoSocSecurityLake --region "$REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`SecurityLakeSubscriberRoleArn` || OutputKey==`SecurityLakeSubscriberExternalId` || OutputKey==`SecurityLakeSubscriberNotificationQueueArn`]'
```

Then pass those three values into the `autosiem` deploy (in the
security-audit account) as context flags:

```
# In the autosiem package, deployed in the security-audit account
cdk deploy AutoSocSiem \
  -c siemEmail=soc@example.com \
  -c siemSecurityLakeSubscriberRoleArn=arn:aws:iam::<log-archive-acct>:role/AmazonSecurityLake-... \
  -c siemSecurityLakeSubscriberExternalId=<the same external id used above> \
  -c siemSecurityLakeSubscriberSqsArn=arn:aws:sqs:<region>:<log-archive-acct>:AmazonSecurityLake-...-Main-Queue
```

`AutoSocSiemStack` threads these three values into the nested aes-siem
template's `SecurityLakeRoleArn` / `SecurityLakeExternalId` /
`SecurityLakeSubscriberSqs` parameters, so es-loader starts polling the
subscriber queue on first deploy. The subscriber role in the log-archive
account must trust the security-audit account's es-loader execution role
to assume it (Security Lake's own subscriber-role trust policy handles
this automatically based on the `principal` you passed to `autosoc`).

> **About the Security Lake queue visibility timeout.** Security Lake
> auto-provisions the subscriber Main-Queue with a 300 s
> `VisibilityTimeout`, which is **less than** aes-siem's default
> 600 s es-loader Lambda timeout. Without a patch, aes-siem's
> event-source-mapping creation is rejected and the deploy fails on
> first run. `autosoc`'s `StandardSecurityLake` construct fixes this
> automatically: `AutoSocSecurityLakeStack` passes
> `sqsVisibilityTimeoutSeconds: 3600`
> on the subscriber, so the construct emits an `AwsCustomResource` that
> calls `sqs:SetQueueAttributes` to raise the timeout to 3600 s as part
> of the `autosoc` deploy, before you ever copy the queue ARN into
> `autosiem`. No manual queue update is required on your part. See §1
> below for the full backstory.

### Migrating from the old sibling/nested layouts

This package has gone through two prior architectures:

1. **Original:** SIEM deployed as a separate, sibling top-level
   `AutoSocSiemStack` alongside `AutoSocStack`, wired together via
   CloudFormation cross-stack exports/`Fn::ImportValue`. (This design and
   its stack are long gone — the class name is coincidentally identical to
   today's `AutoSocSiemStack` below after the `AutoSiem` → `AutoSocSiem`
   rename; the two are otherwise unrelated.)
2. **Interim:** SIEM nested *inside* the single `AutoSoc` stack as a CDK
   construct (`AutoSocSiemConstruct`), to fix a Security Lake
   queue-visibility-timeout race that cross-stack exports couldn't solve
   reliably.
3. **Current:** SIEM lives in this separate `autosiem` package, deployed
   as the standalone `AutoSocSiem` stack, typically in its own AWS
   account, wired to `autosoc`'s Security Lake subscriber via
   manually-copied `CfnOutput` values (see above) rather than CDK
   construct references or CloudFormation exports.

Switching between any of these layouts is a **new top-level stack name**
as far as CloudFormation is concerned (the original sibling
`AutoSocSiemStack` → nested `Siem` construct inside `AutoSoc` →
standalone `AutoSocSiem`), so none of these migrations are automatic:

1. The upstream aes-siem template hard-codes ~22 physical resource names
   (e.g. `aes-siem-resource-validator`, `aes-siem-es-loader` — see
   "Failed aes-siem deploys leave orphans every retry" below for the
   full list). Deploying a *new* stack/construct containing the
   aes-siem template while an *old* one still exists will collide with
   those same physical names and fail.
2. Before adopting a new layout, either keep the old stack/construct
   definition running during a transition window, or explicitly destroy
   it first. For the original sibling layout, its actual stack id was
   `AutoSocSiem` (the class is named `AutoSocSiemStack`, but the CDK app
   instantiated it as `new AutoSocSiemStack(app, 'AutoSocSiem', ...)` —
   `cdk destroy AutoSocSiemStack` doesn't match any real stack and does
   nothing). From that stack's original account/Region, run
   `aws cloudformation delete-stack --stack-name AutoSocSiem --region
   "$REGION"`, then `aws cloudformation wait stack-delete-complete
   --stack-name AutoSocSiem --region "$REGION"`. For the interim layout,
   remove the nested `Siem` construct from `AutoSoc` and redeploy.
   **Destroying the stack does not delete the OpenSearch domain or its
   data** — upstream's own delete handler only removes the EventBridge
   rules it uses for polling, leaving the domain itself fully intact but
   orphaned outside CloudFormation's management. That means no data
   loss, but it also means the orphaned domain's physical resource names
   (see point 1 above) will collide with a fresh deploy — delete the
   orphaned domain manually first (or snapshot/migrate it if you want to
   carry its data into the new stack) before deploying the new
   `AutoSocSiem` stack.
3. There is no automated data-migration path between layouts; OpenSearch
   indices, dashboards, and IOC state are not carried over automatically.

### Optional SIEM context flags

Every non-secret knob the upstream aes-siem template exposes is surfaced
as a `-c` context flag. Unset flags fall through to the upstream default.

| Flag | Default | Description |
| --- | --- | --- |
| `siemEmail` | *(empty — no SNS alerting)* | Address for OpenSearch SNS alerts. Optional, matching the upstream template's own optional `SnsEmail` parameter: when omitted, no SNS topic/subscription is created at all. |
| `siemSecurityLakeSubscriberRoleArn` | *(empty — no Security Lake ingestion)* | IAM role ARN from `autosoc`'s `SecurityLakeSubscriberRoleArn` CfnOutput. |
| `siemSecurityLakeSubscriberExternalId` | *(empty)* | External id from `autosoc`'s `SecurityLakeSubscriberExternalId` CfnOutput. |
| `siemSecurityLakeSubscriberSqsArn` | *(empty)* | SQS queue ARN from `autosoc`'s `SecurityLakeSubscriberNotificationQueueArn` CfnOutput. |
| `siemTemplateSource` | `upstream` | `upstream` (default) pulls AWS's live, mutable latest-template URL — a plain `cdk deploy AutoSocSiem` always uses the current AWS-published template with no local file needed. Pass `vendored` to package the checked-in, pinned v2.10.6 template as a CDK S3 asset instead — this is how you customize the template or get reproducible deploys. |
| `siemUpstreamTemplateFileName` | partition-specific | Optional filename override in either source mode. Commercial and China templates are selected automatically. For GovCloud, run `AES_SIEM_TEMPLATE_FILE_NAME=siem-on-amazon-opensearch-service-usgov.template pnpm run vendor:aes-siem` and set this flag to the same filename. |
| `siemDeploymentTarget` | `opensearch_managed_cluster` | Set to `opensearch_serverless` for the (experimental) Serverless path. |
| `siemDomainOrCollectionName` | `aes-siem` | OpenSearch domain or Serverless collection name. |
| `siemVpcEndpointId` | *(none, public endpoint)* | Interface VPC endpoint id (`vpce-…` / `aos-…`) that fronts OpenSearch. Setting it places es-loader into the VPC. Requires an **existing** OpenSearch domain to anchor the endpoint against — see gotcha #12 below if you don't have one. |
| `siemVpcSubnetIds` | *(none)* | Comma-separated subnet ids to place the OpenSearch domain and es-loader into directly, bypassing `siemVpcEndpointId`'s existing-domain requirement. **Requires `siemTemplateSource=vendored`** — see gotcha #12. |
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
| `siemCreateSqsVpcEndpoint` / `siemCreateSsmVpcEndpoint` / `siemCreateStsVpcEndpoint` / `siemCreateS3VpcEndpoint` | `false` | When `siemVpcEndpointId` is set, assumes the target VPC already has SQS/SSM/STS/S3 interface endpoints (e.g. provisioned by separate networking automation) and does not create new ones. Set `true` per-service only if this stack's VPC genuinely has none yet — AWS rejects a second interface endpoint with `PrivateDnsEnabled` for a service already present in the VPC, so leaving this `true` against a VPC that already has the endpoint fails the deploy. |

The optional GeoLite2 license key and OTX API key are **not** CDK context
flags. `AutoSocSiemStack` declares them directly as its own top-level
`NoEcho` CloudFormation parameters named `GeoLite2LicenseKey` and
`OtxApiKey` (unlike the earlier nested-construct layout, there is no
enclosing construct id to prefix these logical ids with); provide them
through your deployment system's protected parameter input, e.g.:

```bash
aws cloudformation deploy --stack-name AutoSocSiem \
  --template-file cdk.out/AutoSocSiem.template.json \
  --parameter-overrides GeoLite2LicenseKey="$GEOLITE2_KEY" OtxApiKey="$OTX_KEY" \
  --capabilities CAPABILITY_NAMED_IAM
```

They are passed to the nested aes-siem stack by reference and are not
written as literals to `cdk.context.json` or the synthesized template.
Avoid putting secret values directly on a shell command line where they
may be retained in shell history.

## Customizing the SIEM template itself

By default (`AesSiemTemplateSource.UPSTREAM`, the default when
`siemTemplateSource` is unset) `AutoSocSiemStack` points the nested
stack directly at AWS's live, mutable `aes-siem-<region>.s3.amazonaws.com`
template URL — a plain `cdk deploy AutoSocSiem` always deploys whatever AWS
currently publishes, with no local file involved and nothing to vendor
ahead of time. Note this also means a later redeploy can pick up a newer
upstream release even if nothing in this repo changed, and that the raw
upstream template does **not** mark `GeoLite2LicenseKey`/`OtxApiKey`
`NoEcho`, so either value is visible via `DescribeStacks`/console on the
nested stack if you supply it at deploy time (see the warnings
`AutoSocSiemStack` emits when this source is selected).

If you need to patch the template (add resources, tweak IAM, swap Lambda
code, add a new log source, change a dashboard, etc.), or you want a
reproducible/pinned/secret-masked deployment instead of tracking AWS's
latest release, vendor the template into this repo and switch to the
`VENDORED` source:

```
# Fetch the pinned v2.10.6 template from its exact upstream release tag
pnpm run vendor:aes-siem

# Make your edits in autosiem/vendor/aes-siem/

# Deploy using the vendored copy as a CDK S3 asset instead of the live
# upstream URL
cdk deploy AutoSocSiem -c siemTemplateSource=vendored
```

The vendor script writes a per-template `.UPSTREAM.md` record with the
exact release URL, fetch timestamp, and template header; it keeps the
previous copy beside the template with a `.previous` suffix for diffing.
To upgrade, change `AES_SIEM_TEMPLATE_VERSION`, rerun the script for each
partition template, and inspect the delta against your patches. The
vendored template also has `NoEcho: true` patched onto its
`GeoLite2LicenseKey` / `OtxApiKey` parameters (see
`scripts/vendor-aes-siem.sh`), so switching to `VENDORED` is the
recommended path if you plan to actually set either value.

Anything you *add alongside* the nested stack (new SNS targets, extra
CloudWatch dashboards, Lambdas that watch an OpenSearch index, etc.) can
go straight into `AutoSocSiemStack` (or `AutoSocSiemStack`, which it embeds)
as additional CDK constructs — no vendoring required.

## What gets deployed

- A nested `AWS::CloudFormation::Stack` running the upstream aes-siem
  template: OpenSearch managed cluster or Serverless collection,
  es-loader Lambda, GeoIP enrichment, IOC downloader, dashboards, and the
  supporting KMS/SQS/EventBridge/SNS plumbing documented in the upstream
  project.
- If `siemSecurityLakeSubscriberRoleArn`/`*ExternalId`/`*SqsArn` are
  supplied, es-loader additionally polls the referenced Security Lake
  subscriber SQS queue and assumes the referenced role to read OCSF
  Parquet objects.

This package does **not** create any Security Lake resources itself —
`autosoc` owns the data lake, log sources, and subscriber.

## How to Deploy

Bootstrap the account for CDK (if not already done):

```
cdk bootstrap \
"aws://$(aws sts get-caller-identity --query 'Account' --output text)/${AWS_DEFAULT_REGION}" \
--cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess
```

Deploy standalone:

```
cdk deploy AutoSocSiem -c siemEmail=soc@example.com
```

Or with Security Lake ingestion wired up (see above for how to obtain
the three `siemSecurityLake*` values from an `autosoc` deploy):

```
cdk deploy AutoSocSiem \
  -c siemEmail=soc@example.com \
  -c siemSecurityLakeSubscriberRoleArn=... \
  -c siemSecurityLakeSubscriberExternalId=... \
  -c siemSecurityLakeSubscriberSqsArn=...
```

## SIEM Deployment Gotchas (field notes)

The upstream aes-siem template and the Security Lake subscriber APIs have
a handful of sharp edges that are either undocumented or buried in the
console. These are the ones that cost us real time on the first-ever
end-to-end deployment; keep this section in mind on every new account.

### Recommended first-deploy order of operations

If you're bringing up `AutoSocSiem` with Security Lake ingestion for the
first time in a fresh account pair, following this order avoids ~90% of
the rework described below:

1. **Raise the Lambda concurrent-executions quota** in the `autosiem`
   account (see §2). Sync but slow, can run while you prep the rest.
2. **Deploy `autosoc` first**, with `-c createLakeFormationSlr=true` (if
   needed) and the subscriber context flags, in the log-archive account.
   The subscriber Main-Queue visibility timeout is patched automatically
   by the `AwsCustomResource` emitted by `StandardSecurityLake` (see §1)
   as part of that deploy — confirm `AutoSocSecurityLake` reaches
   `CREATE_COMPLETE`/`UPDATE_COMPLETE` before moving on.
3. **Copy the three `SecurityLakeSubscriber*` CfnOutputs** from `AutoSocSecurityLake`
   into the `autosiem` deploy's `-c siemSecurityLake*` flags, then deploy
   `AutoSocSiem` in the security-audit account.
4. On the one-and-only successful create, immediately grab the `aesadmin`
   password from CloudWatch logs (see §7) and store it in your password
   manager, then shorten log retention so the plaintext ages out.
5. Add your workstation's public IP to the OpenSearch access policy
   allowlist (see §8) before trying Dashboards.

### 1. SQS visibility timeout vs Lambda timeout mismatch (now auto-patched)

- **Symptom:** aes-siem CFN rolls back; `CreateEventSourceMapping` rejects
  with "The event source mapping's function timeout must be smaller than
  or equal to the queue's visibility timeout."
- **Root cause:** Security Lake *auto-provisions* the subscriber SQS queue
  (`AmazonSecurityLake-<uuid>-Main-Queue`) with the default 300s visibility
  timeout. aes-siem's es-loader has a 600s Lambda timeout. AWS requires
  visibility ≥ function timeout.
- **Current status: fixed in `autosoc`.** `AutoSocSecurityLakeStack` passes
  `sqsVisibilityTimeoutSeconds: 3600` on the subscriber, and
  `StandardSecurityLake` responds by emitting an `AwsCustomResource` that
  calls `sqs:SetQueueAttributes` on the Security-Lake-managed Main-Queue
  immediately after it is created. The patch is partition-aware (uses
  `${AWS::URLSuffix}` so it works in `aws-cn` / GovCloud) and runs as
  part of the `autosoc` deploy, before you ever copy the queue ARN into
  `autosiem`. No manual `aws sqs set-queue-attributes` call is required
  as long as you wait for `AutoSocSecurityLake` to reach
  `CREATE_COMPLETE`/`UPDATE_COMPLETE` before deploying `autosiem`.
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
- **Fix:** Stick to word chars + spaces + `-` + `_` + `:` + `/` only. This
  is an `autosoc` concern (the subscriber lives in `autosoc`'s
  `src/autosoc-stack.ts`, not here) — see `autosoc/README.md` §3 for the
  working description string and full details.

### 4. Service-linked role retain policy is NOT retroactive (autosoc concern)

The Lake Formation service-linked role lives in `autosoc`, not here — see
`autosoc/README.md` §4 for the full writeup. Short version: mark it
`-c createLakeFormationSlr=true` on `autosoc`'s *first* deploy that needs
it to stay retained; the retain policy is not retroactive on an SLR
created in an earlier, non-retained deploy.

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

Since `AutoSocSiem` is `aes-siem`'s own nested stack's *parent* (aes-siem
runs as a child `AWS::CloudFormation::Stack` of `AutoSocSiem` itself), a
failed aes-siem create rolls `AutoSocSiem` back to
`UPDATE_ROLLBACK_COMPLETE` / `ROLLBACK_COMPLETE` rather than leaving a
separate orphaned stub stack — there is no extra `delete-stack` step to
run for the nested resource. The leaked S3 buckets and KMS alias/key are
unaffected by nesting (they're created by aes-siem's own custom
resources, outside the CFN delete path either way) and still need manual
cleanup before each retry.

**If the failure was `AutoSocSiem`'s very first (create) deployment**,
CloudFormation leaves the stack itself in `ROLLBACK_COMPLETE`, which —
unlike `UPDATE_ROLLBACK_COMPLETE` on an existing stack — cannot be
updated in place; CloudFormation rejects any `UpdateStack`/`cdk deploy`
call against a stack in `ROLLBACK_COMPLETE`. You must delete the failed
`AutoSocSiem` stack first, then redeploy:

```bash
aws cloudformation delete-stack --stack-name AutoSocSiem --region "$REGION"
aws cloudformation wait stack-delete-complete --stack-name AutoSocSiem --region "$REGION"
```

Only *after* that stack deletion (and the manual S3/KMS cleanup below)
should you retry `pnpm cdk deploy AutoSocSiem`. If instead `AutoSocSiem` was
already successfully deployed and a later update fails, wait for
`UPDATE_ROLLBACK_COMPLETE`, inspect and fix the failure, and redeploy without
deleting the stack. Do not run the cleanup below on resources restored by rollback;
only remove resources verified to be orphaned and no longer in use.

```bash
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REGION=${AWS_REGION:-us-east-1}

# 1. KMS alias + schedule orphan key for deletion.
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

# 2. S3 buckets.
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
  # Both outer (AutoSocSiem) and nested (aes-siem) stacks truly complete
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

### 10. The raw GitHub template ships unresolved `%%...%%` build placeholders

- **Symptom:** every Lambda `Code` block in the raw upstream template
  (fetched straight from `deployment/*.template` on GitHub) contains
  literal `%%BUCKET_NAME%%` and `%%SOLUTION_NAME%%/%%VERSION%%` tokens.
  Deploying that file as-is asks CloudFormation to source Lambda code from
  a bucket literally named `%%BUCKET_NAME%%`, which fails immediately.
- **Root cause:** upstream's own `deployment/build-s3-dist.sh` packaging
  script substitutes these placeholders before publishing a deployable
  template; the raw GitHub source is a *build input*, not a deploy-ready
  artifact.
- **Current status: fixed in `vendor-aes-siem.sh`.** The script now
  resolves `%%BUCKET_NAME%%` to `!Sub 'aes-siem-${AWS::Region}'` (matching
  upstream's own published per-Region templates, e.g.
  `https://aes-siem-us-east-1.s3.us-east-1.amazonaws.com/siem-on-amazon-opensearch-service.template`)
  and `%%SOLUTION_NAME%%/%%VERSION%%` to
  `siem-on-amazon-opensearch-service/v<AES_SIEM_TEMPLATE_VERSION>`,
  immediately after the version-pin check and before the `NoEcho` patch.
  This runs automatically on every `pnpm run vendor:aes-siem`; the
  checked-in vendored templates already have the substitution applied.

### 11. `vendor-aes-siem.sh` now auto-generates its own patch provenance

- **Symptom:** the generated `.UPSTREAM.md` used to list only the
  upstream URL/release/fetch timestamp, while the two patches the script
  actually applies (`NoEcho` + placeholder resolution) were documented by
  hand in gotchas #9/#10 above. Every re-vendor overwrote `.UPSTREAM.md`
  without those notes, so the checked-in file could drift from what the
  script truly does.
- **Fix:** `vendor-aes-siem.sh` now accumulates a `PATCHES` array as it
  applies each patch and renders it into a **"Patches applied by
  `vendor-aes-siem.sh` on top of the raw GitHub source"** section of the
  generated `.UPSTREAM.md`, so the file is always in sync with the
  script's actual behavior. Nothing to do on your end — this is automatic
  on every `pnpm run vendor:aes-siem`.

### 12. `VpcEndpointId` requires a pre-existing OpenSearch domain — use `siemVpcSubnetIds` instead

- **Symptom:** you want OpenSearch and es-loader placed in an existing VPC,
  but you have no existing OpenSearch domain anywhere in the account and
  don't want to create one just to unlock VPC placement.
- **Root cause:** `VpcEndpointId` is not a generic PrivateLink interface
  endpoint you pick from the EC2 console's "AWS services" list — it's an
  id from AWS's "VPC endpoints for Amazon OpenSearch Service domains"
  feature (`aws opensearch create-vpc-endpoint --domain-arn <existing> ...`),
  which requires an *already-existing* domain's ARN to anchor against.
  Confirmed by reading the shipped Lambda source
  (`resource_validator_handler` in `deploy_es.zip`): it calls
  `opensearch_client.describe_vpc_endpoints(VpcEndpointIds=[VPCE_ID])` — an
  OpenSearch-specific API, not `ec2:DescribeVpcEndpoints` — purely to read
  back the `VpcId`/`SubnetIds` of whatever existing domain the endpoint was
  created against, then reuses those same subnets for the *new* domain this
  stack creates. No existing domain means no way to mint that endpoint.
- **Fix:** `siemVpcSubnetIds` reproduces upstream's own alternative
  mechanism — their separate native CDK app
  (`source/cdk/mysiem/aos_deployment.py`, `vpc_type=import`) injects subnet
  ids directly as Lambda environment variables
  (`AOS_SUBNET_IDS`/`AOS_SECURITY_GROUP_ID`) at synth time, completely
  bypassing the `describe_vpc_endpoints` lookup and its existing-domain
  requirement. `scripts/vendor-aes-siem.sh` patches the same mechanism onto
  the vendored template (new `AosSubnetIds` parameter, `HasAosSubnetIds`
  condition OR'd into `IsInVpc`, and the two env vars wired into the
  resource-validator and domain-deployment Lambdas) rather than forking any
  of upstream's Python application code. The domain's security group reuses
  the template's existing `AesSiemVpcSecurityGroup2nd` (already scoped to
  `tcp/443` from the VPC's own CIDR blocks, today only wired to the
  SQS/SSM/STS VPC endpoints) — no separate security group id to supply.
- **Requires `siemTemplateSource=vendored`** — `AosSubnetIds` is a
  `truemark` patch, not present in the raw upstream template;
  `AutoSocSiemStack` throws at synth if `vpcSubnetIds` is set without it,
  rather than surfacing as an opaque CloudFormation deploy-time error.
- **`siemVpcEndpointId` and `siemVpcSubnetIds` are independent** — use
  whichever fits: `siemVpcEndpointId` if you already have a domain (any
  domain, not necessarily this one) to anchor an endpoint against;
  `siemVpcSubnetIds` if you don't.
- **Known limitation:** `aes_domain_handler` (the Lambda that actually
  creates the domain) only ever uses the first subnet
  (`AOS_SUBNET_IDS.split(',')[0]`) for the domain's own `VPCOptions` —
  this is upstream's own hardcoded behavior, not something this patch
  changes. The domain itself is effectively single-AZ regardless of how
  many subnet ids you pass; the other subnets only matter for the
  VPC-placed Lambdas (`es-loader`, `configure-aes`, `index-metrics-exporter`),
  which do get placed across all of them.
