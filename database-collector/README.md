# Database Collector

An AWS CDK project that collects database metrics Amazon RDS does not publish
on its own. Tag an RDS instance, or a Secrets Manager secret holding
connection details, and the database is queried once per minute. Results are
written as structured logs that carry metric data.

> **Status: in development.** The collector connects to PostgreSQL, MySQL and
> MariaDB and writes metrics. The registrar does not create schedules yet, so
> for now the collector only runs when invoked by hand (see
> [Invoking the collector](#invoking-the-collector)). Oracle, SQL Server and
> custom queries are not implemented yet.

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
  MySQL and MariaDB servers. Without Docker those tests are skipped.

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
and SSM APIs (through a NAT gateway or VPC interface endpoints).

```bash
cd database-collector/cdk
pnpm cdk deploy \
  -c vpcId=vpc-0123456789abcdef0 \
  -c subnetIds=subnet-0123456789abcdef0,subnet-0fedcba9876543210
```

| Context key    | Required | Default                        | Description                                              |
|----------------|----------|--------------------------------|----------------------------------------------------------|
| `vpcId`        | yes      |                                | VPC the collector function runs in.                      |
| `subnetIds`    | yes      |                                | Comma-separated subnet IDs for the collector function.   |
| `tagPrefix`    | no       | `database-collector:`          | Prefix of the tags read from databases and secrets.      |
| `databaseUser` | no       | `database_collector`           | Database user for IAM authentication.                    |
| `roleName`     | no       | `database-collector-<region>`  | Name of the collector's IAM role.                        |

The stack outputs the collector's role ARN and security group ID. Allow the
security group in each monitored database's security group.

## Database access

The collector logs in as a dedicated, read-only monitoring user. It makes
every session read-only as well, so a query cannot change data.

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

### TLS

Connections are encrypted and the server certificate is verified by default.
The Amazon RDS certificate authorities are bundled with the collector.

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
| `LongestIdleInTransactionSeconds`, `BlockedSessions` | PostgreSQL | | 1 min |
| `LongestStatementSeconds`, `BlockedTransactions` | MySQL, MariaDB | | 1 min |
| `DeadTuples`, `LiveTuples` | PostgreSQL | | 5 min |
| `DatabaseSizeBytes` | PostgreSQL | `DatabaseName` | 15 min |
| `SchemaSizeBytes` | MySQL, MariaDB | `SchemaName` | 15 min |

A database that cannot be reached, or a query that fails, is reported as
`Up` = 0 or a `QueryErrors` count plus an `ERROR` log line. It does not fail
the function.

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
| `secretId` | Secret to log in with. IAM authentication is used without it. |
| `engine`, `host` | Required, from the event or the secret. |
| `port`, `database` | Default to the engine's port, and to `postgres` or `information_schema`. |
| `username` | Required for IAM authentication; otherwise read from the secret. |
| `tls` | `verify` (default), `encrypt` (no certificate check) or `off`. |

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
| `database-collector:query-sets` | Custom query sets to run in addition to the built-in queries.  |
