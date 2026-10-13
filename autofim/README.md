# autofim

CDK app that deploys the **File Integrity Monitoring (FIM)** reference
solution from the AWS Security Blog post
["File integrity monitoring with AWS Systems Manager and Amazon Security
Lake"](https://aws.amazon.com/blogs/security/file-integrity-monitoring-with-aws-systems-manager-and-amazon-security-lake/)
([aws-samples/sample-inventory-monitor-fim](https://github.com/aws-samples/sample-inventory-monitor-fim)).

This is a CDK port of the upstream CloudFormation template; the deploy
flow is just `pnpm cdk deploy AutoFim` — there is no `deploy.sh` /
S3 upload step. The Lambda handler has `helpers.py` inlined and swaps
`python-dateutil` for `datetime.fromisoformat`, so there is **no Lambda
layer and no Docker required** to synthesise.

## Architecture

```
  EC2 (tag FIM-Enabled=true, SSM Agent)
    -> SSM Inventory  (AWS-GatherSoftwareInventory)
    -> SSM Resource Data Sync
    -> S3  (fim-inventory-<account>-<region>, versioned)
    -> S3 ObjectCreated event
    -> Lambda fim-change-detector  (diffs current vs previous version)
    -> Security Hub  (ASFF finding; Types = "Software and Configuration
                     Checks/File Integrity Monitoring")
    -> Security Lake (via the AWS Security Hub source enabled by the
                     sibling AutoSoc stack)   -> OCSF 2004 Detection
```

## Prerequisites

- **AWS Security Hub** enabled in the target Region.
- **AutoSoc** deployed in the same account/Region so the Security
  Hub -> Security Lake ingestion path exists (`SH_FINDINGS` log source).
- EC2 instances to be monitored must:
  - Have the SSM Agent installed and online in Fleet Manager.
  - Carry an IAM instance profile with `AmazonSSMManagedInstanceCore`.
  - Be tagged with `FIM-Enabled=true` (configurable via context).

## Deploy

```bash
cd autofim
pnpm install
pnpm cdk deploy AutoFim \
  -c fimMonitoredPath=/etc/paymentapp/ \
  -c fimCriticalFilePatterns='^/etc/paymentapp/config.*$'
```

Default values live in `cdk.json`. Available context flags:

| context key | default | meaning |
| --- | --- | --- |
| `fimMonitoredPath` | `/etc/paymentapp/` | File system path collected by SSM Inventory |
| `fimCriticalFilePatterns` | `^/etc/paymentapp/config.*$` | Comma-separated regex list of files that generate findings |
| `fimFindingSeverity` | `MEDIUM` | Security Hub finding severity label |
| `fimInventorySchedule` | `rate(30 minutes)` | SSM association schedule |
| `fimInventoryTagKey` | `FIM-Enabled` | EC2 tag key used for targeting |
| `fimInventoryTagValue` | `true` | EC2 tag value used for targeting |

## Trigger a test finding

1. Launch an EC2 instance with the SSM instance profile and tag
   `FIM-Enabled=true`.
2. `sudo mkdir -p /etc/paymentapp && sudo touch /etc/paymentapp/config.yaml`.
3. Wait for the next SSM Inventory run (default: 30 min) — one snapshot
   lands in the inventory bucket.
4. `sudo sh -c 'echo "key: changed" >> /etc/paymentapp/config.yaml'` and
   wait for the next SSM Inventory run.
5. Second snapshot triggers the Lambda, which emits a Security Hub
   finding. The finding then propagates to Security Lake as an OCSF
   2004 Detection Finding and is queryable via Athena.

## Resources deployed

- `AWS::S3::Bucket` x2 — `fim-logs-*` (server-access-log destination
  for the inventory bucket; versioned, SSE-S3, 365-day lifecycle
  expiration with 90-day noncurrent-version cleanup; Object Lock is
  intentionally **disabled** because S3 forbids access-log delivery to
  Object-Lock-enabled destinations) and `fim-inventory-*` (versioned,
  SSM-writable).
- `AWS::SQS::Queue` — `fim-change-detector-dlq`, 14-day retention.
- `AWS::Lambda::Function` — `fim-change-detector` (Python 3.12,
  reserved concurrency 10, DLQ wired).
- `AWS::SSM::ResourceDataSync` — streams inventory JSONL into the
  inventory bucket.
- `AWS::SSM::Association` — `AWS-GatherSoftwareInventory` with the
  `files` parameter pointing at `fimMonitoredPath`.
- IAM policies scoped to the single Security Hub product ARN and the
  inventory bucket.

## Test

```bash
pnpm test
```

## Gotchas

Three real deltas from the upstream AWS blog/sample caught during the
first end-to-end deployment.

### 1. `AWS:File` inventory `Pattern` must be a list, not a string

- **Symptom:** The SSM association execution fails with
  `ExecutionSummary` containing:
  ```
  json: cannot unmarshal string into Go struct field filterObj.Pattern of type []string
  ```
- **Root cause:** The SSM agent's `AWS:File` inventory plugin schema
  requires `Pattern` to be a JSON array of strings. The upstream
  CloudFormation sample ships `Pattern: "*"` as a bare string, which
  happens to serialize differently through plain CFN YAML than through
  CDK's `JSON.stringify`. CDK surfaces the mismatch; the sample hides it.
- **Fix in this stack:** `Pattern: ['*']` in the `files` parameter of the
  `AWS::SSM::Association` (see `src/autofim-stack.ts`).

### 2. `AWS::SSM::ResourceDataSync` requires an explicit dependency on the bucket **policy**, not just the bucket

- **Symptom:** CFN rolls back with the completely uninformative:
  ```
  Resource handler returned message: "Invalid request provided: AWS::SSM::ResourceDataSync"
  ```
- **Root cause:** SSM runs a pre-flight write-test against the inventory
  bucket when creating the sync. If the `BucketPolicy` statement granting
  `ssm.amazonaws.com → s3:PutObject` is not attached yet, the write test
  fails and CFN masks it as a generic validation error with no hint
  about the real cause. CDK's automatic dependency graph tracks the
  bucket construct but not its implicit `BucketPolicy` child.
- **Fix in this stack:**
  ```ts
  this.resourceDataSync.node.addDependency(this.inventoryBucket);
  if (this.inventoryBucket.policy) {
    this.resourceDataSync.node.addDependency(this.inventoryBucket.policy);
  }
  ```
  The upstream CFN template avoids this by declaring
  `DependsOn: InventoryBucketPolicy` inline on the YAML resource.

### 3. Security Hub must be enabled before any FIM finding can import

- **Symptom:** The Lambda runs cleanly, builds the ASFF payload, and
  then fails on `securityhub:BatchImportFindings` with:
  ```
  AccessDeniedException ... with an explicit deny in a resource-based policy
  ```
  "Explicit deny" is misleading. The real cause is that the
  `product/<account>/default` ARN does not exist until Security Hub is
  enabled in that account+Region.
- **Root cause:** The IAM identity policy we grant is correct; what is
  missing is the per-account Security Hub subscription. The upstream
  sample lists this as a prereq but does not enforce or check it. This
  stack cannot flip it either — enabling Security Hub is a billable,
  account-scoped opt-in that should remain an operator decision.
- **Fix (one time per account+Region, before the Lambda ever runs):**
  ```bash
  aws securityhub enable-security-hub --region <region> --no-enable-default-standards
  ```
  No redeploy needed; the next Lambda invocation succeeds. If you turn
  Security Hub on *after* FIM findings have already been attempted,
  re-trigger a change on the monitored file (or wait for the next SSM
  Inventory interval) to produce a new finding.

## Attribution

Lambda source adapted from
[aws-samples/sample-inventory-monitor-fim](https://github.com/aws-samples/sample-inventory-monitor-fim)
(MIT-0).
