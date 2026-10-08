# AutoAlarm Post-Refactor Surface Test Plan

> **Audience:** a Claude Code agent with access to the **TrueMark MCP gateway** (AWS read/inventory, CloudWatch logs/metrics/alarms, and break-glass write/deploy/Lambda-invoke).
> **Goal:** after a refactor, exercise **every surface** of AutoAlarm by tagging/untagging resources to create and destroy alarms, by creating and destroying real resources to test the resource-lifecycle path, by driving a **custom-tag alarm into ALARM** to test alarm creation **and the EventBridge → Kinesis Firehose delivery path**, and by reading **all CloudWatch logs** to confirm logging behaves as expected.
> **Primary region:** `us-west-2`. **CloudFront only:** `us-east-1` (its tag/CloudTrail events are delivered only there).

---

## 0. How to use this document

Work top to bottom. Section 1 (Safety) is non-negotiable and governs everything else. Section 2 establishes the baseline you teardown back to. Sections 4–10 are the actual test passes. Section 11 is teardown. Section 12 is the pass/fail scorecard to fill in.

Throughout, discover TrueMark MCP tools with `search_tools` → `get_tool_schema` → `invoke_tool`. Use the CloudWatch MCP (`describe_log_groups`, `execute_log_insights_query`, `get_active_alarms`, `get_alarm_history`, `get_metric_data`) for verification.

---

## 0.5 Gateway role — do this before any AWS operation

All AWS write and read operations in this test run through **`AwsApiMcp___call_aws`** (the TrueMark gateway's AWS CLI bridge). The gateway runtime transparently assumes **`TrueMarkMcpGatewaySurfaceTestRole`** (account `999776382415`) — the agent does **not** call `sts:AssumeRole` itself; that happens inside the runtime.

**Required on every `AwsApiMcp___call_aws` call:** append `--profile surfacetest` to activate the pre-configured surface-test credentials. Example:

```
aws ec2 describe-instances --region us-west-2 --profile surfacetest
aws sqs create-queue --queue-name my-test-queue --region us-west-2 --profile surfacetest
```

**Verify at the start of §2:** confirm the caller identity is `TrueMarkMcpGatewaySurfaceTestRole`:

```
aws sts get-caller-identity --profile surfacetest
```

If the returned ARN does not contain `TrueMarkMcpGatewaySurfaceTestRole`, stop immediately and report the error — do not proceed under a different identity.

---

## 1. SAFETY GUARDRAILS — read first, enforce always

These rules exist because the test runs against a live AWS account and because two AutoAlarm behaviors are intentionally broad.

### 1.1 Destroy only what the agent created
- **Never delete, stop, or destructively reconfigure any pre-existing AWS resource.** The only resources you may destroy are ones **you created during this run**.
- Stamp every created resource with two markers at creation time:
  - `autoalarm-test:run-id=<RUN_ID>` (a UUID/timestamp you generate at start)
  - `Name=autoalarm-test-<surface>-<RUN_ID>`
- Maintain an **inventory file** (`./.autoalarm-test/inventory-<RUN_ID>.json`) listing every resource ARN/ID you create and every alarm name AutoAlarm creates for it. **Teardown reads only from this inventory** — if it is not in the inventory, you do not touch it.

### 1.2 For tag-only (pre-existing) resources, restore exactly
- For slow/expensive surfaces you tag pre-existing resources instead of creating them (see §3). Before tagging, **record the resource's original tag set**. During teardown, remove only the `autoalarm:*` and `autoalarm-test:*` keys **you added**, and restore any pre-existing `autoalarm:*` tag value you overwrote. Never blanket-clear tags.

### 1.3 Alarm deletion safety
- Before deleting any alarm, confirm **both**: (a) the name matches `AutoAlarm-*`, **and** (b) it maps to a test resource id recorded in your inventory. Deleting an `AutoAlarm-*` alarm whose resource id is not in your inventory is forbidden.
- AutoAlarm should delete alarms itself when you set `autoalarm:enabled=false` or remove the enable tag. Prefer letting AutoAlarm delete; only delete alarms directly during teardown for orphans tied to your test resource ids.

### 1.4 ReAlarm caution (account-wide behavior)
- **By default ReAlarm resets _every_ CloudWatch alarm in the account that is in `ALARM` state**, not just AutoAlarm's. Two consequences:
  - Any test alarm you intentionally drive to `ALARM` may be reset by the scheduled ReAlarm (every 120 min) — account for this in timing.
  - To prevent interference during a focused test, set `autoalarm:re-alarm-enabled=false` on test alarms you don't want reset.
- Do **not** manually invoke the ReAlarm producer against the whole account casually; in §7 it is invoked deliberately and its account-wide effect is expected and noted.

### 1.5 Cost / blast radius
- Use the smallest instance/queue/domain sizes. Tear down promptly. Never create resources in production VPCs or with production-looking names — always the `autoalarm-test-*` naming.

---

## 2. Pre-flight: discover the deployment and capture a baseline

1. **Confirm identity & region.** `get_me`-equivalent / STS caller identity; confirm account is the intended **test** account and region is `us-west-2`.
2. **Locate the stack and its components** (via TrueMark MCP inventory tools):
   - AutoAlarm Lambda functions (main handler; ReAlarm producer, consumer, tag-event handler; SQS handler).
   - Their **CloudWatch log groups** — discover with `describe_log_groups` (prefix `/aws/lambda/` + filter on `AutoAlarm`/`autoalarm`). Record exact names; do not hardcode.
   - The **per-service SQS queues and their `-Failed` DLQs**: `AutoAlarm-Alb`, `AutoAlarm-Cloudfront`, `AutoAlarm-Ec2`, `AutoAlarm-Ecs`, `AutoAlarm-Lambda`, `AutoAlarm-Logs`, `AutoAlarm-OpenSearchRule`, `AutoAlarm-Rds`, `AutoAlarm-RdsCluster`, `AutoAlarm-Route53resolver`, `AutoAlarm-Sqs`, `AutoAlarm-Sfn`, `AutoAlarm-TargetGroup`, `AutoAlarm-TransitGateway`, `AutoAlarm-Vpn` (each has a `*-Failed` DLQ).
   - The **EventBridge rules** routing each service's tag/state/CloudTrail events.
   - The **Kinesis Firehose delivery stream** that ingests EventBridge events, and its destination (e.g., S3 bucket). Record stream name + destination — needed for §6 delivery verification.
   - Whether a **`prometheusWorkspaceId`** context/env was set at deploy (determines whether §8 applies).
3. **Baseline snapshots** (store in `./.autoalarm-test/baseline-<RUN_ID>.json`):
   - All existing `AutoAlarm-*` alarms (names + state). This is what teardown must return to.
   - DLQ approximate message counts (should be ~0).
   - Current depth of the Firehose destination (so new records are attributable).
4. Record `RUN_ID` and a UTC `START_TIME` (used as the lower bound for all log/metric queries).

---

## 3. Surface matrix — what to test and how to instantiate it

AutoAlarm is fully event-driven. Each surface is triggered by **tag-change events** and/or **CloudTrail create/delete events**. "Create method" reflects the **cheap-real / tag-only-slow** strategy.

| # | Surface | EventBridge trigger(s) | Create method | Resource identifier in alarm name |
|---|---------|------------------------|---------------|-----------------------------------|
| 1 | **EC2** instance | `aws.tag` Tag Change (instance) + EC2 Instance State-change | **Create real** (t-class, smallest) | instance id |
| 2 | **SQS** queue | CloudTrail `CreateQueue`/`DeleteQueue`/`TagQueue`/`UntagQueue` | **Create real** | queue name |
| 3 | **CloudWatch Log Group** | CloudTrail `CreateLogGroup`/`DeleteLogGroup`/`TagResource`/`UntagResource` | **Create real** | log group name |
| 4 | **Step Functions** state machine | `aws.tag` (stateMachine) + CloudTrail `CreateStateMachine`/`DeleteStateMachine` | **Create real** (trivial state machine) | state machine name |
| 5 | **ECS** | CloudTrail create/delete + `TagResource`/`UntagResource` | **Create real** (empty cluster) | cluster/service id |
| 6 | **Target Group** | `aws.tag` (targetgroup) + CloudTrail `CreateTargetGroup`/`DeleteTargetGroup` | **Create real** (note: TG metrics require ALB association) | target group id |
| 7 | **ALB** | `aws.tag` (loadbalancer) + CloudTrail `CreateLoadBalancer`/`DeleteLoadBalancer` | Create real **only if** a test VPC/subnets exist; else tag-only | LB id |
| 8 | **CloudFront** distribution | `aws.cloudfront` `CreateDistribution`/`DeleteDistribution` + `aws.tag` (distribution) | **Tag-only**, and **in `us-east-1`** | distribution id |
| 9 | **OpenSearch** domain | `aws.tag` (domain) + `aws.es` `CreateDomain`/`DeleteDomain` | **Tag-only** (slow/expensive) | domain name |
| 10 | **RDS** instance | `aws.tag` (db) + `aws.rds` `CreateDBInstance`/`DeleteDBInstance` | **Tag-only** | db id |
| 11 | **RDS Cluster** | `aws.tag` (cluster) + `aws.rds` `CreateDBCluster`/`DeleteDBCluster` | **Tag-only** | cluster id |
| 12 | **Route53 Resolver** endpoint | `aws.tag` (resolver-endpoint) + `aws.route53resolver` `CreateResolverEndpoint`/`DeleteResolverEndpoint` | **Tag-only** | endpoint id |
| 13 | **Transit Gateway** | `aws.tag` (transit-gateway) + `aws.ec2` `CreateTransitGateway`/`DeleteTransitGateway` | **Tag-only** | tgw id |
| 14 | **VPN** connection | `aws.tag` (vpn-connection) + `aws.ec2` `CreateVpnConnection`/`DeleteVpnConnection` | **Tag-only** | vpn id |
| 15 | **Lambda** function | `aws.tag` (function) + CloudTrail `CreateFunction`/`DeleteFunction` (legacy `…20150331` **and** current `…20150331v2` — Lambda's current events carry the `v2` suffix, verified via a live CloudTrail record) | **Create real** (trivial inline-Node function) | function name |

> **Lambda surface note:** only one default alarm is created — `Errors` (Sum, critical threshold `1`, 60s/1 period, `defaultCreate: true`). So `autoalarm:enabled=true` alone yields `AutoAlarm-Lambda-<fn>-Errors-Critical`; there is **no** Warning alarm by default and no other metric. Custom case (B) reconfigures via `autoalarm:errors=<8-field value>`; nullish case (C) is `autoalarm:errors=-/-/…` (both thresholds `-`) → the errors alarm is removed. To drive ALARM (for §6-style checks), invoke the function so it throws once.

> **Surfaces worth extra scrutiny post-refactor:** **ECS** and **CloudWatch Log Group** appear in the handler/config code but are *not* in the README's "Supported Services" list — confirm they actually create/destroy alarms as expected. Also re-verify the recently-fixed areas: **main-handler batch processing**, **alarm-deletion-safety**, and **resource-id-extraction** (see §9).

---

## 4. Tag schema reference (how you trigger each behavior)

- **Enable:** `autoalarm:enabled=true` → creates all default alarms for the resource. **Required.**
- **Disable:** `autoalarm:enabled=false` **or remove the tag** → deletes all AutoAlarm-managed alarms (default + custom) for that resource.
- **EC2 target selection:** `autoalarm:target=cloudwatch` | `prometheus` (see §8).
- **ReAlarm:** `autoalarm:re-alarm-enabled=false` (opt out); `autoalarm:re-alarm-minutes=<5..1440>` (custom interval; out-of-range is invalid and removes any per-alarm schedule).
- **Custom alarm tag value** — 8 `/`-separated fields:
  `warnThreshold / critThreshold / periodSec / evalPeriods / statistic / datapointsToAlarm / comparisonOperator / treatMissingData`
  Example: `autoalarm:cpu=66/89/120/15/Average/12/GreaterThanOrEqualToThreshold/breaching`
- **Nullish `-`:** a `-` in the warn or crit threshold position disables *that* threshold's alarm. If **both** warn and crit are `-`, **no alarm** is created for that metric.

**Expected alarm name patterns** (verify with these):
- Static: `AutoAlarm-<SERVICE>-<identifier>-<MetricName>-<Warning|Critical>`
- Anomaly: `AutoAlarm-<SERVICE>-<identifier>-<MetricName>-anomaly-<Warning|Critical>`
- (Storage-path variants insert `-<storagePath>-` before the classification.)

---

## 5. Core test pattern — run for each surface in §3

For each surface, execute cases **A–G**. After each tag mutation, **poll** (don't fixed-sleep): re-list `AutoAlarm-<SERVICE>-<id>-*` alarms every ~15s up to a 3–5 min ceiling before declaring fail (event → EventBridge → SQS → Lambda has latency).

- **A. Enable → create.** Set `autoalarm:enabled=true`. Assert the service's **default** alarms now exist with the expected names. Record them in inventory.
- **B. Custom reconfigure.** Set one custom metric tag (e.g. `autoalarm:cpu=70/90/60/5/Average/5/GreaterThanThreshold/missing`). Assert the corresponding alarm's threshold/period/eval-periods/comparison/missing-data **updated** to match (read alarm definition; don't just check existence).
- **C. Nullish.** Set the same metric tag with both thresholds `-` (e.g. `autoalarm:cpu=-/-/60/5/Average/5/GreaterThanThreshold/missing`). Assert that metric's alarms are **removed**.
- **D. Disable via `false`.** Set `autoalarm:enabled=false`. Assert **all** managed alarms for the resource are deleted.
- **E. Re-enable, then untag.** Set `=true` (alarms return), then **remove** the `autoalarm:enabled` tag entirely. Assert all managed alarms are deleted (removal path, distinct from `=false`).
- **F. Deletion-safety isolation.** While the resource's alarms exist, confirm that disabling/deleting it left the **baseline** alarms (§2) and any *other* test resources' alarms **untouched**. (Critical for the prefix-collision fix — see §9.)

Then the **resource-lifecycle** cases (the "newly created / destroyed resource" requirement) — run on the **cheap-real** surfaces (EC2, SQS, Log Group, Step Functions, ECS, Target Group, Lambda):

- **G1. Create-with-tag.** Create the resource **already carrying** `autoalarm:enabled=true`. Assert alarms are auto-created off the **creation** event (no manual tagging step).
- **G2. Destroy.** Delete the (agent-created) resource. Assert AutoAlarm auto-deletes its alarms off the **deletion** event, and that nothing else was affected.

> For **tag-only** surfaces (CloudFront, OpenSearch, RDS, RDS Cluster, Route53 Resolver, TGW, VPN): run A–F against a pre-existing resource. Document G1/G2 as **manual** steps (the create/destroy of, e.g., an RDS instance) rather than executing them, unless a disposable test instance already exists — and if you do create one, it goes in the inventory and gets torn down.

---

## 6. Alert TRIGGER + DELIVERY test (EventBridge → Kinesis Firehose)

AutoAlarm alarms intentionally carry **no alarm actions** — delivery is observed by routing the CloudWatch **alarm-state-change** EventBridge event into a **Kinesis Firehose**. This test confirms an alarm is both **created** and that its state change is **delivered** through the Firehose.

Use **EC2** as the delivery canary (cheap, controllable, real metrics).

1. On the test EC2 instance set a custom tag whose threshold **breaches immediately** so the alarm goes to `ALARM` within one period — e.g.
   `autoalarm:cpu=0/0/60/1/Average/1/GreaterThanOrEqualToThreshold/missing`
   (CPU ≥ 0 is always true; 60s period, 1 datapoint → fastest possible breach). If the metric path can't be forced this way, fall back to driving real load, **not** to `SetAlarmState` (we want a genuine metric-driven transition for the delivery test).
2. Assert the alarm was **created** (name + definition) and then transitions to **`ALARM`** — confirm via `get_alarm_history` (StateUpdate to ALARM) and `get_active_alarms`.
3. **Delivery verification (the Firehose path):**
   - Confirm the alarm-state-change produced an EventBridge event and that the **Firehose `IncomingRecords`/`IncomingBytes`** metrics incremented in the window around the transition (`get_metric_data` on the delivery stream).
   - Inspect the Firehose **destination** (e.g., the S3 bucket/prefix recorded in §2) for a newly-written record whose payload contains the **alarm name** and `"state":"ALARM"`. Confirm `DeliveryToS3.Success` (or destination-appropriate) metric is non-zero for the window.
   - Note `autoalarm:re-alarm-enabled=false` on this alarm during the test so the scheduled ReAlarm doesn't perturb the transition mid-verification.
4. **Clear & confirm deletion path:** set `autoalarm:enabled=false`, assert the alarm is deleted.
5. Record: alarm-created ✓/✗, reached ALARM ✓/✗, Firehose ingested record ✓/✗, payload contained alarm name ✓/✗.

---

## 7. ReAlarm subsystem

Components: **producer** (scheduled ~120 min), **consumer**, **tag-event handler**. Because waiting 2 hours is impractical, invoke the **producer Lambda manually** (break-glass invoke via TrueMark MCP). Remember §1.4: this acts on **all** ALARM-state alarms account-wide.

- **R1. Reset behavior.** With a test alarm in `ALARM` (from §6 setup), invoke the producer; assert the alarm is reset (`SetAlarmState` to `OK`/`INSUFFICIENT_DATA`, visible in `get_alarm_history`) and re-evaluates.
- **R2. Opt-out.** Set `autoalarm:re-alarm-enabled=false` on a second ALARM-state test alarm; invoke producer; assert it is **skipped**.
- **R3. Custom interval.** Set `autoalarm:re-alarm-minutes=15` (valid) on a test alarm; assert a per-alarm 15-min schedule is created (inspect the schedule/rule the tag-event handler manages). Then set `autoalarm:re-alarm-minutes=3` (invalid, <5) and `=2000` (invalid, >1440); assert each is treated as invalid and any existing per-alarm schedule is **removed**.
- **R4. AutoScaling exclusion.** Confirm an alarm tied to an AutoScaling action is **never** reset (if no ASG exists, document as not-tested rather than fabricating one).
- **R5. Logs.** Confirm producer/consumer/tag-event handler log groups show the decisions above (see §10).

---

## 8. Prometheus path (EC2 only) — run **only if** `prometheusWorkspaceId` was set at deploy

- **P1. Prefer-Prometheus.** With a workspace configured and the EC2 instance **reporting** to AMP, enable AutoAlarm; assert **Prometheus alert rules** (CPU/Memory/Storage) are created and that any pre-existing **CloudWatch** alarms for that instance are **deleted**.
- **P2. Force CloudWatch.** Set `autoalarm:target=cloudwatch`; assert CloudWatch alarms are used instead.
- **P3. Fallback.** Set `autoalarm:target=prometheus` on an instance **not** reporting to AMP; assert AutoAlarm detects this and **falls back to CloudWatch** alarms.
- Verify AMP rule groups via the CloudWatch MCP PromQL tools / AMP rule-group inspection. If `prometheusWorkspaceId` is unset, mark §8 **N/A** in the scorecard.

---

## 9. Negative / edge cases (to unearth bugs — emphasize refactor-touched areas)

- **E1. Invalid tag values.** Bad comparison operator, non-numeric threshold, malformed 8-field value, out-of-range period. Assert: schema validation rejects gracefully, a clear error is **logged**, no malformed alarm is created, and (if applicable) the event lands in the service's **`-Failed` DLQ** rather than crashing the handler.
- **E2. Prefix-collision / resource-id-extraction (recent fix).** Create two resources whose identifiers **share a prefix** (e.g., a queue `orders` and `orders-2`, or instances/log groups with shared-prefix names). Enable both, then disable **one**. Assert **only** the disabled resource's alarms are deleted and the sibling's survive. (This is the alarm-deletion-safety / resource-id-extraction guarantee.)
- **E3. Empty identifier guard.** Confirm the handler **refuses to delete alarms by service prefix when the identifier is empty** (look for the "Refusing to delete alarms by service prefix" log line) — i.e., no mass deletion on a bad/empty id.
- **E4. Batch processing (recent fix).** Tag many resources in rapid succession (e.g., 10+ SQS queues or log groups at once). Assert the main handler processes **all** of them (no dropped messages), DLQs stay empty, and alarms appear for every resource.
- **E5. Target Group without ALB.** Tag a target group not associated with an ALB; confirm AutoAlarm's documented behavior (TG metrics require ALB association) — alarms that depend on association behave as designed, not erroring silently.
- **E6. CloudFront region.** Confirm that tagging a CloudFront distribution while operating in **`us-west-2`** produces **no** events (events arrive only in `us-east-1`); run the actual CloudFront case in `us-east-1`. Documents the region constraint explicitly.
- **E7. Re-enable idempotency.** Enable an already-enabled resource / disable an already-disabled one; assert no duplicate alarms and no errors.

---

## 10. Logging verification (read all CloudWatch logs)

For **every** AutoAlarm Lambda log group discovered in §2 (main handler, ReAlarm producer/consumer/tag-event, SQS handler), query the window `[START_TIME, now]`:

- Use `execute_log_insights_query` filtered on your `RUN_ID`, the test resource ids, and the alarm names. For each surface case A–G assert a corresponding **create/update/delete decision** was logged.
- Assert **no unexpected `ERROR`/exception** lines (the only errors should be the intentional ones from §9 E1, and those should be structured, not stack-crash traces).
- Confirm **each tag/CloudTrail event was processed** (no silent drops) and that **DLQs are empty** (or contain only the deliberately-failed E1 events).
- Spot-check that the **refactor-touched code paths** (batch processing, deletion-safety guard, resource-id extraction) emit the expected log lines.
- Save raw query results to `./.autoalarm-test/logs-<RUN_ID>/` per log group.

---

## 11. Teardown (inventory-driven; destroy only agent-created resources)

Execute in this order, reading **only** from `inventory-<RUN_ID>.json`:

1. For each tag-only resource: remove the `autoalarm:*` / `autoalarm-test:*` keys **you added** and **restore** any original `autoalarm:*` value you overwrote (per §1.2). Let AutoAlarm delete the alarms.
2. For each agent-created resource: set `autoalarm:enabled=false` (let AutoAlarm delete alarms), then **delete the resource itself**.
3. Delete any **orphan** `AutoAlarm-*` alarms that are in the inventory but still present (match name `AutoAlarm-*` **and** a test resource id).
4. Confirm **DLQs** are back to baseline depth (purge only the deliberately-failed E1 test messages if needed).
5. **Final assertion:** the set of `AutoAlarm-*` alarms equals the §2 **baseline** — no orphaned test alarms remain — and no non-test resource was modified.

---

## 12. Results scorecard (fill in)

| Surface | A enable | B custom | C nullish | D disable=false | E untag | F isolation | G create→destroy | Logs OK |
|---|---|---|---|---|---|---|---|---|
| EC2 | | | | | | | | |
| SQS | | | | | | | | |
| Log Group | | | | | | | | |
| Step Functions | | | | | | | | |
| ECS | | | | | | | | |
| Target Group | | | | | | | | |
| Lambda | | | | | | | | |
| ALB | | | | | | | (manual) | |
| CloudFront (us-east-1) | | | | | | | (manual) | |
| OpenSearch | | | | | | | (manual) | |
| RDS | | | | | | | (manual) | |
| RDS Cluster | | | | | | | (manual) | |
| Route53 Resolver | | | | | | | (manual) | |
| Transit Gateway | | | | | | | (manual) | |
| VPN | | | | | | | (manual) | |

**Cross-cutting:**

| Test | Result | Notes |
|---|---|---|
| §6 Custom-tag alarm created | | |
| §6 Reached ALARM | | |
| §6 Firehose ingested the state-change record | | |
| §6 Disable deletes the alarm | | |
| §7 R1 reset / R2 opt-out / R3 interval / R4 ASG-exclusion | | |
| §8 Prometheus P1/P2/P3 (or N/A) | | |
| §9 E1 invalid→DLQ / E2 prefix-collision / E3 empty-id guard / E4 batch / E5 TG / E6 CF region / E7 idempotency | | |
| §10 All log groups clean; DLQs empty | | |
| §11 Alarm set returned to baseline; no non-test resource modified | | |

---

## Appendix A — TrueMark MCP discovery hints
- `gateway_manifest` → see gateways. `search_tools("create EC2 instance")`, `search_tools("tag resource")`, `search_tools("invoke lambda")`, `search_tools("kinesis firehose metrics")`, `search_tools("describe alarms")` → `get_tool_schema` → `invoke_tool`.
- CloudWatch MCP: `describe_log_groups`, `execute_log_insights_query`, `get_active_alarms`, `get_alarm_history`, `get_metric_data`, PromQL tools for AMP.

## Appendix B — Tag cheat-sheet
```
autoalarm:enabled = true | false            # master switch (remove = also deletes)
autoalarm:target  = cloudwatch | prometheus  # EC2 only
autoalarm:re-alarm-enabled = false           # per-alarm ReAlarm opt-out
autoalarm:re-alarm-minutes = 5..1440         # per-alarm ReAlarm interval (out-of-range = invalid)
autoalarm:<metric> = warn/crit/period/evalPeriods/stat/datapoints/comparisonOp/treatMissingData
#   '-' in warn or crit disables that threshold; both '-' = no alarm for that metric
```

## Appendix C — Run-id markers
```
autoalarm-test:run-id = <RUN_ID>
Name = autoalarm-test-<surface>-<RUN_ID>
```
Inventory & baseline live under ./.autoalarm-test/ keyed by RUN_ID. Teardown trusts the inventory and nothing else.
