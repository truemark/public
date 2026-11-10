# Database Collector

An AWS CDK project that collects database metrics Amazon RDS does not publish
on its own. Tag an RDS instance, or a Secrets Manager secret holding
connection details, and the database is queried once per minute. Results are
written as structured logs that carry metric data.

> **Status: scaffold.** The project structure, build and infrastructure are in
> place. The collector does not connect to databases yet, and the registrar
> does not create schedules yet.

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

The collector's role may request IAM authentication tokens for the database
user above on any RDS instance in the account and region. A database only
accepts them after an administrator creates that user and enables IAM
authentication for it. IAM authentication is available for PostgreSQL, MySQL
and MariaDB. Oracle and SQL Server need a secret.

## Tags

Tags are read from RDS instances and Secrets Manager secrets. RDS clusters are
not supported yet.

| Tag                             | Description                                                    |
|---------------------------------|----------------------------------------------------------------|
| `database-collector:enabled`    | Set to `true` to collect from this database.                   |
| `database-collector:secret`     | RDS only. Secret to log in with. IAM authentication if absent. |
| `database-collector:username`   | RDS only. Database user for IAM authentication.                |
| `database-collector:database`   | RDS only. Database name to connect to.                         |
| `database-collector:query-sets` | Custom query sets to run in addition to the built-in queries.  |
