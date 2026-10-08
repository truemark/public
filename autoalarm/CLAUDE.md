# CLAUDE.md — AutoAlarm

AutoAlarm is an event-driven AWS Lambda system that creates/updates/deletes CloudWatch alarms (and Prometheus rules) for ~14 service types based on resource tags. See `ARCHITECTURE.md` and `README.md` for behavior and the tag schema.

## Surface testing

When asked to **test the surfaces**, **test alarm creation/deletion**, **verify a refactor**, or **run the AutoAlarm test pattern**, follow **[`TESTING_PLAN.md`](./TESTING_PLAN.md)** — the prescriptive, step-by-step runbook for exercising every surface via tag/untag, resource create/destroy, the custom-tag → ALARM → Kinesis Firehose delivery path, and CloudWatch log verification. It is written to be run with the **TrueMark MCP gateway** + CloudWatch MCP. Default region `us-west-2` (CloudFront → `us-east-1`).

### Non-negotiable test guardrails (full detail in `TESTING_PLAN.md` §1 and §11)
- **Destroy only resources the agent itself created during the run.** Never delete/stop/reconfigure a pre-existing resource.
- Stamp every created resource with `autoalarm-test:run-id=<RUN_ID>` and a `autoalarm-test-*` `Name`; record everything in `./.autoalarm-test/inventory-<RUN_ID>.json`. **Teardown trusts the inventory and nothing else.**
- Before deleting any alarm, require **both** an `AutoAlarm-*` name match **and** an inventory-tracked test resource id.
- For tag-only (pre-existing) resources, restore original tags exactly — remove only the keys you added.
- **ReAlarm resets every ALARM-state alarm in the account by default**; set `autoalarm:re-alarm-enabled=false` on test alarms you don't want reset.

## Layout
- `handlers/src/` — Lambda handlers, `service-modules/`, `alarm-configs/` (one per surface).
- `cdk/lib/` — stack + subconstructs (EventBridge rules, ReAlarm producer/consumer/tag-event, SQS handler).
- `TESTING_PLAN.md` — the surface test runbook (start here for any testing task).
