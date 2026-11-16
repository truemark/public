# AutoSoc

This AWS CDK project provisions an Amazon Security Lake data lake with the
full set of standard AWS native log sources, using constructs from
`truemark-cdk-lib`. It optionally also provisions a Security Lake
**Subscriber** so a separate SIEM deployment — e.g. the companion
[`autosiem`][autosiem] package — can ingest OCSF Parquet objects produced
by the data lake.

[autosiem]: https://github.com/truemark/public/tree/main/autosiem

## Deploying

Security Lake requires the `AWSServiceRoleForLakeFormationDataAccess`
service-linked role. If it does not already exist in this account, add
`-c createLakeFormationSlr=true` to the first deploy below. Do not enable
that flag when the role already exists.

```
cdk deploy AutoSocSecurityLake
```

This always provisions the Security Lake data lake and its log sources.
It does **not** deploy any SIEM/OpenSearch resources — that's the
`autosiem` package's job, deployed as its own independent stack
(typically in a different AWS account, e.g. a security-audit account
reading from this package's log-archive account). See
`autosiem/README.md` for how to deploy it and wire it to this stack's
Security Lake subscriber.

## Wiring up a Security Lake subscriber for autosiem

To let a SIEM in another account ingest OCSF Parquet from this data
lake, deploy with the subscriber context flags set to the **consuming**
account (e.g. the security-audit account running `autosiem`):

```
cdk deploy AutoSocSecurityLake \
  -c siemSubscriberAccountId=<security-audit-account-id> \
  -c siemSubscriberExternalId=$(openssl rand -hex 16)
```

Supplying both flags causes `AutoSocSecurityLakeStack` to create a
`AWS::SecurityLake::Subscriber` + `SubscriberNotification` for that
principal, and publish three values as `CfnOutput`s:

- `SecurityLakeSubscriberRoleArn`
- `SecurityLakeSubscriberExternalId`
- `SecurityLakeSubscriberNotificationQueueArn`

Copy these into the `autosiem` deploy's `-c siemSecurityLake*` context
flags (`autosiem/README.md` has the exact commands and the full
cross-account walkthrough). There is no CloudFormation cross-stack
export/`Fn::ImportValue` link between `autosoc` and `autosiem` — they are
independent CDK apps/stacks, typically in different accounts, so the
hand-off is this manual (or scripted) copy step.

> **About the Security Lake queue visibility timeout.** Security Lake
> auto-provisions the subscriber Main-Queue with a 300 s
> `VisibilityTimeout`, which is **less than** aes-siem's default 600 s
> es-loader Lambda timeout. Without a patch, aes-siem's
> event-source-mapping creation is rejected once you deploy `autosiem`
> against this subscriber. `StandardSecurityLake` fixes this
> automatically: `AutoSocSecurityLakeStack` passes
> `sqsVisibilityTimeoutSeconds: 3600`
> on the subscriber, so the construct emits an `AwsCustomResource` that
> calls `sqs:SetQueueAttributes` to raise the timeout to 3600 s as part
> of this `autosoc` deploy — before you ever copy the queue ARN into
> `autosiem`. Confirm `AutoSocSecurityLake` reaches `CREATE_COMPLETE`/
> `UPDATE_COMPLETE` before deploying `autosiem` against it. See §1 in
> `autosiem/README.md`'s gotchas section for the full backstory and a
> manual fallback.

## Granting humans direct query access to Security Lake

Security Lake's data is governed by AWS Lake Formation. Being an IAM
admin in this account does **not** by itself grant Lake Formation query
access — Lake Formation enforces its own separate permission layer, so
without an explicit grant, even an admin role sees zero databases when
browsing the Glue Data Catalog. Two things close that gap:

### Registering Lake Formation data lake administrators

```
cdk deploy AutoSocSecurityLake \
  -c lakeFormationDataLakeAdmins=<role-arn-1>,<role-arn-2>
```

This uses `MutationType: APPEND` on `AWS::LakeFormation::DataLakeSettings`
deliberately — the default `MutationType` (`REPLACE`) would silently
revoke every administrator not listed, including the ones Security Lake
and the CDK bootstrap process register automatically
(`AmazonSecurityLakeMetaStoreManagerV2`, the `cdk-hnb659fds-cfn-exec-role`).
`APPEND` only adds the principals you list here, leaving those alone.

Data lake administrators can see and query everything by default — no
separate `SELECT` grant is needed for an administrator to query their
own account's data. For a narrower grant (a specific database/table
rather than full administrator access), or for a principal in a
*different* AWS account, use Lake Formation's own `grant-permissions`
API (same-account) or Security Lake's `LAKEFORMATION`-type subscriber
(cross-account) directly — this flag is specifically for the
account-wide administrator designation, not fine-grained grants.

### Querying via Athena

This stack always creates an S3 bucket and an Athena workgroup
(`security-lake-queries`) pre-configured to use it as the query-results
location, so Lake Formation administrators can start running Athena
queries against Security Lake's tables immediately — no manual Athena
setup required. The bucket's `CfnOutput` (`AthenaResultsBucketName`)
and the workgroup name are both published for reference. Result objects
expire automatically after 30 days; they're cheap to regenerate by
re-running the query, so nothing is backed up before expiry.
