# Runbook - Phase 1


## Prerequisites

  - GitHub repository cloned locally.
  - Docker Desktop installed.
  - Node.js and npm installed for local ingest service tests:
    - Node.js `>=18`
    - npm dependencies installed with `npm ci` from `services/ingest`
  - Python installed for local PM generator and smoke-test development:
    - Python `>=3.12` is recommended because the smoke-test package requires it.
    - `pmgen` supports Python `>=3.11`.
    - Python build tooling dependencies are installed automatically from each
      package's `pyproject.toml` when using `pip install`.
    - `pmgen` runtime dependencies: `httpx`, `pydantic`, `pydantic-settings`,
      `typer`, `aiokafka`, and `prometheus-client`
    - smoke-test runtime dependencies: `psycopg[binary]` and `requests`
  - TCP ports available on localhost:
    - 3000 (ingest)
    - 3001 (Grafana)
    - 8000 (pmgen)
    - 9090 (Prometheus)
    - 9187 (postgres-exporter)
    - 19092 (Redpanda)
    - 9644 (Redpanda)
  
Run Docker Compose commands (below) from project root directory.


## How to Run

**Start the stack**

```bash
docker compose -f infra/compose/compose.yaml up -d --build
```

**Check readiness**

Method 1: Run `ps` in Docker Compose. Check for '(healthy)' status.

```bash
docker compose -f infra/compose/compose.yaml ps
```

Method 2: Use `curl` to check readiness endpoints.

  - pmgen readiness: `curl -i http://localhost:8000/readyz`
  - ingest readiness: `curl -i http://localhost:3000/readyz`

**Stop the stack**

```bash
docker compose -f infra/compose/compose.yaml down
```

## Open Grafana

  - Grafana login: `http://localhost:3001`
  - Default Grafana credentials: `admin` / `admin`

Grafana has platform dashboards and telecom analytics dashboards:

  - platform: check status of the event pipeline: pmgen, Redpanda, ingest, Postgres
  - telecom analytics: view status of the simulated telecom network

## What to Expect

After startup, the stack should show both telecom KPI data and platform health.
Grafana can take one or two refresh intervals to populate because Prometheus
scrapes every 15 seconds and the telecom KPI view uses 1-minute buckets.

**Analytics dashboard**

Open the `RAN KPIs` dashboard. The dashboard should show recent telecom KPI
time series from Postgres:

  - average downlink PRB utilization
  - average uplink PRB utilization
  - average RRC connections
  - call/session drop rate percentage

On a clean startup, these panels can be empty for roughly the first minute. Once
`pmgen` has produced enough events, the panels should begin updating.

**System dashboard**

Open the `System Overview` dashboard. The `Service Health` panel should show
five Prometheus jobs up:

  - `ingest`
  - `postgres`
  - `pmgen`
  - `redpanda`
  - `prometheus`

The event-flow panels should show the platform receiving and processing
telemetry:

  - `Events Generated` should be non-zero.
  - `Kafka Messages Consumed` should be non-zero.
  - `Events Inserted` should be non-zero.

The normal steady-state error and backlog indicators should stay quiet:

  - Kafka produce failures should stay at `0`.
  - Invalid events should stay at `0`.
  - DB insert errors should stay at `0`.
  - Kafka consumer lag should remain low after the stack has settled.

**Platform dashboards**

Use the individual platform dashboards when the system dashboard points to a
problem:

  - `pmgen`: producer event rate, Kafka send latency, and send failures
  - `ingest`: Kafka messages processed, inserted/rejected events, and consumer lag
  - `Redpanda`: broker scrape health, request activity, and consumer-group lag
  - `Postgres`: database health, connections, transaction activity, and row changes

## Quick Verification

Use these checks if the dashboard does not populate as expected.

**Confirm the API is ready**

```bash
curl -i http://localhost:3000/readyz
curl -i http://localhost:8000/readyz
```

Expected result: both commands return HTTP `200 OK`.

If ingest is not ready, check Postgres, Redpanda, and ingest startup logs:

```bash
docker compose -f infra/compose/compose.yaml logs postgres redpanda redpanda-init ingest
```

If pmgen is not ready, check whether it can reach Redpanda:

```bash
docker compose -f infra/compose/compose.yaml logs pmgen redpanda
```

**Confirm events are being stored**

```bash
docker compose -f infra/compose/compose.yaml exec postgres psql -U telecom -d telecom \
  -c "select count(*) as events from analytics.pm_events;"
```

Expected result: the count increases over time. `pmgen` sends one event every 5
seconds by default.

To inspect the most recent events:

```bash
docker compose -f infra/compose/compose.yaml exec postgres psql -U telecom -d telecom \
  -c "select event_time, source, entity_id, metrics from analytics.pm_events order by event_time desc limit 5;"
```

If the count is not increasing, verify the Redpanda topic exists and inspect
producer and consumer logs:

```bash
docker compose -f infra/compose/compose.yaml exec redpanda rpk topic list
docker compose -f infra/compose/compose.yaml logs pmgen ingest redpanda
```

**Confirm the KPI view has data**

```bash
docker compose -f infra/compose/compose.yaml exec postgres psql -U telecom -d telecom \
  -c "select ts, dl_prb_util_pct_avg, ul_prb_util_pct_avg, rrc_conn_avg, drop_rate_pct_avg, samples from analytics.v_kpi_utilization_1m order by ts desc limit 5;"
```

Expected result: recent rows with non-null KPI averages and a positive `samples`
count. On a fresh startup, this view can be empty until enough events have
arrived for the first 1-minute bucket.

If raw events exist but this view is empty, inspect recent event metrics and
confirm the events contain KPI keys such as `dl_prb_util_pct`,
`ul_prb_util_pct`, `rrc_conn_avg`, or `drop_rate_pct`:

```bash
docker compose -f infra/compose/compose.yaml exec postgres psql -U telecom -d telecom \
  -c "select event_time, source, metrics from analytics.pm_events order by event_time desc limit 5;"
```

## Tests

Run these commands from the project root unless a command changes directories.

**Run unit tests**

The ingest service unit tests cover event validation, API routes, metrics output,
and Kafka consumer behavior with mocked dependencies.

```bash
cd services/ingest
npm ci
npm test
```

Expected result: Jest exits with status `0`.

**Run integration tests**

The integration suite starts the Phase 1 Compose stack and runs the ingest HTTP
integration tests from an ephemeral Node container. It validates the legacy
`POST /v1/events` path against the running ingest API and Postgres database.

```bash
docker compose  -f infra/compose/compose.yaml -f infra/compose/compose.test.yaml up -d --build
docker compose -f infra/compose/compose.yaml -f infra/compose/compose.test.yaml --profile test run --rm ingest-http-test
teststatus=$?
docker compose -f infra/compose/compose.yaml -f infra/compose/compose.test.yaml --profile test down -v
echo $teststatus
```

Expected result: the `ingest-http-test` service exits with status `0`.

**Run the smoke test**

The smoke test validates the event-driven Phase 1 path. It starts the platform,
waits for core services to become healthy, sends a deterministic PM event through
Redpanda, verifies the event lands in Postgres, and checks basic Prometheus
observability.

```bash
docker compose -f infra/compose/compose.yaml -f infra/compose/compose.test.yaml up -d --build
docker compose -f infra/compose/compose.yaml -f infra/compose/compose.test.yaml run --rm smoke-test
teststatus=$?
docker compose -f infra/compose/compose.yaml -f infra/compose/compose.test.yaml down
echo $teststatus
```

Expected result: the smoke-test container exits with status `0`. If it fails,
inspect service logs before tearing down the stack:

```bash
docker compose -f infra/compose/compose.yaml -f infra/compose/compose.test.yaml logs ingest pmgen redpanda postgres prometheus
```
