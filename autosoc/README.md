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

Data lake administrators automatically get `Describe` visibility into
every database/table in the account, and can grant themselves (or
anyone else) any permission at will — but that grant is **not**
automatic. Per [Lake Formation's own implicit-permissions
reference](https://docs.aws.amazon.com/lake-formation/latest/dg/implicit-permissions.html),
administrators do not implicitly receive `SELECT` on tables created by
a *different* principal — and Security Lake's own service role, not
you, creates the tables this stack's data lake populates. Immediately
after being added as an administrator, self-grant query access once
(cheap and trivial for an admin to do, but not automatic):

```bash
aws lakeformation grant-permissions --region us-east-2 \
  --principal DataLakePrincipalIdentifier=<your-role-arn> \
  --resource '{"Database":{"Name":"<security-lake-database-name>"}}' \
  --permissions "DESCRIBE"

aws lakeformation grant-permissions --region us-east-2 \
  --principal DataLakePrincipalIdentifier=<your-role-arn> \
  --resource '{"Table":{"DatabaseName":"<security-lake-database-name>","TableWildcard":{}}}' \
  --permissions "SELECT" "DESCRIBE"
```

Without this, Athena queries fail with an insufficient-permissions
error even for a registered administrator. For a narrower grant (a
specific database/table rather than full administrator access), or for
a principal in a *different* AWS account, use the same
`grant-permissions` API (same-account) or Security Lake's
`LAKEFORMATION`-type subscriber (cross-account) directly — the
`lakeFormationDataLakeAdmins` flag above is specifically for the
account-wide administrator designation, not fine-grained grants.

**The Lake Formation `SELECT` grant above is necessary but not
sufficient** — Lake Formation administrator status grants neither
Athena API access nor access to the results bucket, so a principal
without those can still hit `AccessDenied` after following the steps
above. The full set of IAM permissions needed, beyond the Lake
Formation grant itself:

Rather than hand-assembling that list, grant the role AWS's own
published [**Lake Formation "Data analyst" persona**
policy](https://docs.aws.amazon.com/lake-formation/latest/dg/permissions-reference.html) —
it's the authoritative reference for exactly this scenario (an IAM
principal querying Lake Formation-governed tables via Athena), and
covers Glue Data Catalog reads and results-bucket access that a
narrower, hand-picked list is easy to under-specify:

- The AWS managed policy **`AmazonAthenaFullAccess`** — covers the
  Athena API actions (`StartQueryExecution`, `GetQueryExecution`,
  `GetQueryResults`, `StopQueryExecution`, `GetWorkGroup`, etc.) and S3
  access on the results bucket, including `s3:GetBucketLocation` and
  multipart-upload actions that a narrower `GetObject`/`PutObject`-only
  policy omits.
- Plus this inline policy, covering `lakeformation:GetDataAccess` (per
  [Lake Formation's underlying-data-access
  docs](https://docs.aws.amazon.com/lake-formation/latest/dg/access-control-underlying-data.html),
  *"Amazon Athena requires the user to have the
  `lakeformation:GetDataAccess` permission"* — the resource **must** be
  `*`, scoping it to a specific ARN is not supported) and the Glue Data
  Catalog reads Lake Formation's table/database grants do not
  themselves supply as IAM permissions:
  ```json
  {
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": [
          "lakeformation:GetDataAccess",
          "glue:GetTable",
          "glue:GetTables",
          "glue:SearchTables",
          "glue:GetDatabase",
          "glue:GetDatabases",
          "glue:GetPartitions",
          "lakeformation:GetResourceLFTags",
          "lakeformation:ListLFTags",
          "lakeformation:GetLFTag",
          "lakeformation:SearchTablesByLFTags",
          "lakeformation:SearchDatabasesByLFTags"
        ],
        "Resource": "*"
      }
    ]
  }
  ```

### Querying via Athena

This stack always creates an S3 bucket and an Athena workgroup
(default name `security-lake-queries`, overridable via
`-c athenaWorkGroupName=<name>`) pre-configured to use that bucket as
the query-results location. **Select this workgroup explicitly** when
running queries in the Athena console or CLI — Athena does not use it
automatically just because it exists. The bucket's `CfnOutput`
(`AthenaResultsBucketName`) and the workgroup name (`AthenaWorkGroupName`)
are both published for reference.

The workgroup is retained on `cdk destroy` (same reasoning as the
results bucket — it's shared, account-wide infrastructure). Because
Athena workgroup names can't be auto-generated by CloudFormation the
way the bucket's name is, a retained workgroup left behind by a prior
destroy will collide with a same-named redeploy attempt. If that
happens, pass `-c createAthenaWorkGroup=false` **and**
`-c existingAthenaResultsBucketName=<bucket-name>` (the retained
workgroup's own `OutputLocation`, from the `AthenaResultsBucketName`
output of the destroyed stack) to skip recreating either and reuse
both of them instead. The two flags must be passed together: the
retained workgroup's `OutputLocation` is fixed at creation and isn't
updated by this stack, so reusing the workgroup without also reusing
the bucket its output points at would leave `AthenaResultsBucketName`
naming a different, freshly-created bucket than the one the workgroup
actually writes to — this stack refuses to synthesize with
`createAthenaWorkGroup=false` unless `existingAthenaResultsBucketName`
is also set.

Result objects in the bucket expire automatically after 30 days;
they're cheap to regenerate by re-running the query, so nothing is
backed up before expiry.
