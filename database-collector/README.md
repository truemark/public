# Database Collector

An AWS CDK project that collects database metrics Amazon RDS does not publish
on its own. Tag an RDS instance, or a Secrets Manager secret holding
connection details, and the database is queried once per minute. Results are
written as structured logs that carry metric data.

> **Status: in development.** The collector connects to PostgreSQL, MySQL,
> MariaDB, Oracle and SQL Server and writes metrics, including
> [custom queries](#custom-queries). The registrar does not create schedules
> yet, so for now the collector only runs when invoked by hand (see
> [Invoking the collector](#invoking-the-collector)).

## How it works

```
tag change ──▶ EventBridge rule ──▶ registrar function ──▶ one schedule per database
                                    (also runs hourly                 │ every minute
                                     to reconcile)                    ▼
                                                           collector function ──▶ structured logs
                                                           (Java, JDBC, in your VPC)
```

- **Registrar** (TypeScript) keeps one EventBridge Scheduler schedule per
  tagged database. Removing the tag removes the schedule.
- **Collector** (Java 25, SnapStart) handles one database per invocation. The
  PostgreSQL, MariaDB (also used for MySQL), Oracle and SQL Server JDBC
  drivers are bundled automatically by the Gradle build.

## Project structure

| Path         | What it is                                                                 |
|--------------|----------------------------------------------------------------------------|
| `cdk/`       | CDK app, stack and constructs (TypeScript).                                |
| `registrar/` | Registrar Lambda handler (TypeScript).                                     |
| `collector/` | Collector Lambda function (Java, Gradle). Its `package.json` only maps pnpm scripts to Gradle so the workspace build covers it. |

## Requirements

- Node.js 22 or later and pnpm.
- A JDK. The Gradle wrapper downloads JDK 25 for compilation if it is not
  installed.
- Docker, to run the collector's integration tests against real PostgreSQL,
  MySQL, MariaDB, Oracle and SQL Server servers (the SQL Server image is
  x86-64 only). Without Docker those tests are skipped.

## Build and test

From the repository root:

```bash
pnpm install
pnpm --filter "database-collector-cdk..." build
pnpm --filter "database-collector-*" test
```

## Deploy

The installer chooses the VPC and the subnets the collector function runs in.
The subnets need a route to the monitored databases and to the Secrets Manager
API (through a NAT gateway or a VPC interface endpoint). To use custom query
sets they also need a route to S3 (a gateway endpoint is enough) or to SSM,
depending on where the sets are kept.

```bash
cd database-collector/cdk
pnpm cdk deploy \
  -c vpcId=vpc-0123456789abcdef0 \
  -c subnetIds=subnet-0123456789abcdef0,subnet-0fedcba9876543210
```

| Context key        | Required | Default                       | Description                                                     |
|--------------------|----------|-------------------------------|-----------------------------------------------------------------|
| `vpcId`            | yes      |                               | VPC the collector function runs in.                             |
| `subnetIds`        | yes      |                               | Comma-separated subnet IDs for the collector function.          |
| `tagPrefix`        | no       | `database-collector:`         | Prefix of the tags read from databases and secrets.             |
| `databaseUser`     | no       | `database_collector`          | Database user for IAM authentication.                           |
| `roleName`         | no       | `database-collector-<region>` | Name of the collector's IAM role.                               |
| `metricsNamespace` | no       | `DatabaseCollector`           | CloudWatch namespace for metrics. Empty: logs only, no metrics. |
| `querySetParameterPath` | no  | `/database-collector/query-sets` | SSM path query sets are read from (the default source).      |
| `querySetsDir`     | no       |                               | Local folder whose `*.yaml` files are uploaded as query sets on every deploy (reference them as `s3:<name>`). |

The stack outputs the collector's role ARN, security group ID, query set
bucket name and query set parameter path. Allow the security group in each
monitored database's security group.

## Database access

The collector logs in as a dedicated, read-only monitoring user. On
PostgreSQL, MySQL and MariaDB it makes every session read-only as well, so a
query cannot change data. Oracle and SQL Server have no such session setting,
so there the monitoring user must only be granted read access, as below.

### IAM authentication

The collector's role may request IAM authentication tokens for the database
user above on any RDS instance in the account and region. A database only
accepts them after an administrator creates that user. IAM authentication is
available for PostgreSQL, MySQL and MariaDB.

PostgreSQL:

```sql
CREATE USER database_collector;
GRANT rds_iam, pg_monitor TO database_collector;
```

MySQL and MariaDB:

```sql
CREATE USER 'database_collector'@'%' IDENTIFIED WITH AWSAuthenticationPlugin AS 'RDS';
GRANT PROCESS, SHOW VIEW ON *.* TO 'database_collector'@'%';
```

`PROCESS` lets the user see other users' sessions and transactions. `SHOW VIEW`
makes every schema's tables visible in `information_schema`, which
`SchemaSizeBytes` needs, without allowing the user to read their rows.

### Secrets

Otherwise the collector reads the user name and password from a Secrets
Manager secret in the JSON format RDS uses (`username`, `password`, and
optionally `engine`, `host`, `port`, `dbname`). The collector's role can only
read secrets tagged `database-collector:enabled` or `database-collector:allow`
with the value `true`. A secret encrypted with a customer managed KMS key
also needs that key to allow the role to decrypt.

The same `pg_monitor` role, or `PROCESS` and `SHOW VIEW` privileges, are needed.
Oracle and SQL Server only support secrets, because RDS does not offer IAM
database authentication for them.

Oracle, connected to the database (the PDB, for a multitenant instance) the
collector logs in to:

```sql
CREATE USER database_collector IDENTIFIED BY "<password>";
GRANT CREATE SESSION, SELECT_CATALOG_ROLE TO database_collector;
```

`SELECT_CATALOG_ROLE` gives read access to the `v$` and `dba_` views the
built-in queries use, and no access to table data. On RDS the master user can
grant it.

SQL Server:

```sql
CREATE LOGIN database_collector WITH PASSWORD = '<password>';
GRANT VIEW SERVER STATE, VIEW ANY DEFINITION TO database_collector;
```

`VIEW SERVER STATE` lets the login see other sessions, transactions and
requests; without it the queries only see the collector's own session and
report zeros. `VIEW ANY DEFINITION` is needed for `DatabaseSizeBytes`. The
login connects to `master` as `guest` and needs no database user.

### TLS

Connections are encrypted and the server certificate is verified by default.
The Amazon RDS certificate authorities are bundled with the collector.

Oracle on RDS only accepts TLS once the `SSL` option is added to the
instance's option group, and then on a separate port (2484 by default), so
set `port` to that port. Without it, use `tls` = `encrypt`, which on Oracle
means native network encryption instead of TLS (the `NATIVE_NETWORK_ENCRYPTION`
option, or a server that accepts it), or `off`.

## Metrics

Each result is one JSON log line in the collector function's log group, in
the CloudWatch embedded metric format, so CloudWatch also publishes it as a
metric in the `DatabaseCollector` namespace. Every metric has a `Target`
dimension identifying the database; some have one more, shown below. Deploy
with `-c metricsNamespace=` (empty) to keep the logs but publish no metrics.

| Metric | Engines | Extra dimension | Every |
|---|---|---|---|
| `Up` (1 when the collector could log in, otherwise 0) | all | | 1 min |
| `ConnectMillis`, `CollectMillis`, `QueryErrors` | all | | 1 min |
| `Sessions` | all | `State` | 1 min |
| `ConnectionsUsedPercent` | all | | 1 min |
| `LongestTransactionSeconds` | all | | 1 min |
| `LongestStatementSeconds` | MySQL, MariaDB, Oracle, SQL Server | | 1 min |
| `LongestIdleInTransactionSeconds` | PostgreSQL, SQL Server | | 1 min |
| `BlockedSessions` | PostgreSQL, Oracle, SQL Server | | 1 min |
| `BlockedTransactions` | MySQL, MariaDB | | 1 min |
| `DeadTuples`, `LiveTuples` | PostgreSQL | | 5 min |
| `TablespaceUsedBytes`, `TablespaceUsedPercent` | Oracle | `TablespaceName` | 5 min |
| `DatabaseSizeBytes` | PostgreSQL, SQL Server | `DatabaseName` | 15 min |
| `SchemaSizeBytes` | MySQL, MariaDB | `SchemaName` | 15 min |

`DeadTuples` and `LiveTuples` cover only the database the collector connects
to (`postgres` unless set with the `database` tag or event field).
`SchemaSizeBytes` on MySQL 8 comes from cached table statistics, so it can be
up to `information_schema_stats_expiry` (default 1 day) old.

The `State` values are `active`, `idle`, `idle in transaction`,
`idle in transaction (aborted)` and `other` on PostgreSQL; `active` and `idle`
on MySQL and MariaDB; `active`, `idle` and `other` on Oracle; and `active`,
`idle`, `idle in transaction` and `other` on SQL Server.

On Oracle, `ConnectionsUsedPercent` is whichever of the `processes` and
`sessions` limits is closer, counting background processes, and
`TablespaceUsedPercent` is measured against the size a tablespace can grow
to with autoextend. On SQL Server, `ConnectionsUsedPercent` is relative to the
`user connections` setting (32767 when unlimited), and `DatabaseSizeBytes` is
the allocated size of the data files, without the log.

A dimension whose value is NULL is reported as `"null"`. Each query keeps at
most 100 rows; when a result is truncated a `WARN` log line says so.

A database that cannot be reached, or a query that fails, is reported as
`Up` = 0 or a `QueryErrors` count plus an `ERROR` log line. It does not fail
the function.

## Custom queries

Custom queries are grouped in query sets. A query set is a YAML list in the
same format as the built-in queries in
[`collector/src/main/resources/queries`](collector/src/main/resources/queries):

```yaml
- name: order_backlog
  interval: 15m
  sql: |
    SELECT status AS "Status", count(*) AS orders
    FROM orders.orders
    WHERE status IN ('pending', 'processing')
    GROUP BY status
  dimensions: [Status]
  metrics:
    - {column: orders, name: OrderBacklog, unit: Count}
```

| Field | Description |
|---|---|
| `name` | Required. Logged as `<set>/<name>` in the `Query` field. |
| `sql` | Required. Runs in a read-only session, as the collector's database user, with a 10 second timeout. |
| `interval` | How often the query runs: minutes (`5`), or `15m`, `2h`, `1d`. Default 1 minute. |
| `dimensions` | Result columns whose values become metric dimensions, in addition to `Target`. |
| `metrics` | Result columns to publish: `column`, metric `name` and CloudWatch `unit` (default `None`). |

The collector still runs every minute. Each run it executes the queries that
are due: a query with interval *N* runs when the minutes since 1970-01-01
UTC are divisible by *N*. So `1h` runs at minute 0 of every hour and `1d` at
00:00 UTC. A run that fails or is skipped is not made up later.

The database user needs whatever privileges the queries use, for example
`SELECT` on the tables a query reads. Only the first 100 rows are used, and
each distinct dimension value becomes a separate CloudWatch metric, so keep
dimensions low in cardinality.

### Where query sets are kept

A set can live in either of two places. Which one is chosen per set, by its
name:

| Reference | Read from |
|---|---|
| `orders` or `ssm:orders` | SSM parameter `/database-collector/query-sets/orders` (stack output `QuerySetParameterPath`) |
| `s3:orders` | `query-sets/orders.yaml` in the query set bucket (stack output `QuerySetBucketName`) |

Names may contain letters, digits, `_` and `-`, and `.` or `/` between those
(`s3:team/orders` is `query-sets/team/orders.yaml`). The collector can read
nothing else from the bucket or Parameter Store.

- **S3** suits sets kept in source control. Upload them with
  `aws s3 cp orders.yaml s3://<bucket>/query-sets/orders.yaml`, or deploy with
  `-c querySetsDir=<folder>` to upload a folder's `*.yaml` files on every
  deploy. Reference them with the `s3:` prefix. Sets deleted from the folder stay in the bucket until removed by
  hand. The bucket is versioned, so earlier versions of a set can be restored.
  A set may be up to 64 KB.
- **SSM Parameter Store** suits small sets edited in the console. Create a
  `String` or `SecureString` parameter (a `SecureString` with a customer
  managed KMS key also needs the key to allow the collector's role to
  decrypt). A standard parameter holds up to 4 KB, an advanced one 8 KB.

Sets are cached for 5 minutes, so a change takes effect within about 5
minutes. A set that cannot be read or parsed is logged as an `ERROR` with the
message `Query set unavailable`, counted in `QueryErrors`, and tried again a
minute later; the other queries still run.

### Choosing query sets for a database

Name up to 10 sets, separated by spaces, in the
`database-collector:query-sets` tag (tag values cannot contain commas), or in
the `querySets` field when invoking the collector by hand:

```
database-collector:query-sets = billing s3:orders
```

## Invoking the collector

Until the registrar creates schedules, invoke the `live` alias of the
collector function with an event describing one database:

```json
{
  "id": "orders-db",
  "engine": "postgres",
  "host": "orders.abc123.us-east-2.rds.amazonaws.com",
  "username": "database_collector"
}
```

| Field | Description |
|---|---|
| `id` | Required. Identifies the database in logs and the `Target` dimension. |
| `secretId` | Secret to log in with. IAM authentication is used without it, except on Oracle and SQL Server, which require a secret. |
| `engine`, `host` | Required, from the event or the secret. |
| `port`, `database` | Default to the engine's port, and to `postgres`, `information_schema`, `ORCL` (Oracle service name) or `master`. |
| `username` | Required for IAM authentication; otherwise read from the secret. |
| `tls` | `verify` (default), `encrypt` (no certificate check) or `off`. |
| `querySets` | Custom query sets to run as well, separated by spaces or commas, or a list. See [Custom queries](#custom-queries). |

## Tags

Tags are read from RDS instances and Secrets Manager secrets. RDS clusters are
not supported yet.

| Tag                             | Description                                                    |
|---------------------------------|----------------------------------------------------------------|
| `database-collector:enabled`    | Set to `true` to collect from this database.                   |
| `database-collector:secret`     | RDS only. Secret to log in with. IAM authentication if absent. |
| `database-collector:allow`      | On a secret named by the tag above: set to `true` so the collector may read it. |
| `database-collector:username`   | RDS only. Database user for IAM authentication.                |
| `database-collector:database`   | RDS only. Database name to connect to.                         |
| `database-collector:query-sets` | Custom query sets to run in addition to the built-in queries, separated by spaces. See [Custom queries](#custom-queries). |
