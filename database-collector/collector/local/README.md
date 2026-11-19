# Running the collector locally

Runs the real collector code against PostgreSQL, MySQL and MariaDB in Docker,
with no Lambda or AWS account. Metric lines are written to stdout exactly as
the deployed function writes them (CloudWatch embedded metric format), and a
one-line summary per database goes to stderr.

`LocalRunner` (in `src/local`, never part of the Lambda package) stands in for
the Lambda handler. It reads secrets from `targets.yaml` instead of Secrets
Manager, and collects at the start of every minute. Its first collection runs
every query, so the 5- and 15-minute ones show up straight away. IAM
authentication is not available locally.

## Start the databases

```bash
cd database-collector/collector/local
docker compose up -d --wait
```

Each server gets a `database_collector` user with the privileges the main
README asks for, and some sample data (`init/`). They listen on localhost
ports 15432 (PostgreSQL), 13306 (MySQL) and 13307 (MariaDB).

## Run the collector

From your shell (fastest while changing code):

```bash
cd database-collector/collector
./gradlew runLocal --args="local/targets.yaml --once"   # one collection
./gradlew runLocal                                      # every minute until Ctrl+C
```

Or in a container next to the databases:

```bash
./gradlew localDist                                  # from database-collector/collector
docker compose --profile collector up -d collector   # from local/
docker compose logs -f collector
```

`docker compose logs` only shows stdout and stderr together. To pick out
metrics from the shell runner, pipe stdout through `jq`, for example:

```bash
./gradlew -q runLocal --args="local/targets.yaml --once" 2>/dev/null \
  | jq -c 'select(.Query == "collector") | {Target, Up, CollectMillis, QueryErrors}'
```

Set `METRICS_NAMESPACE=` (empty) to get plain JSON without the `_aws` block.

## Things to try

- `local-unreachable` points at a closed port and shows how a down database
  is reported (`Up` = 0 plus an ERROR line).
- Stop a database (`docker compose stop mysql`) while the collector runs in
  a loop, then start it again, to watch it go down and recover.
- Open a long transaction (`docker compose exec postgres psql -U postgres -c
  "BEGIN; SELECT pg_sleep(120);"`) to see `LongestTransactionSeconds` rise.
- Add your own targets and secrets to `targets.yaml`. `${NAME:-default}`
  is replaced with environment variables.
- Try custom queries under `querySets:` in `targets.yaml` and name them in a
  target's `querySets` field; `local-postgres` runs the `example` set. They
  stand in for sets kept in S3 or SSM (see the main README).

## Clean up

```bash
docker compose --profile collector down -v
```
