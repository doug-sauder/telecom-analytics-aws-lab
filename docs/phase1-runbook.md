# Runbook - Phase 1


## Prerequisites

  - GitHub repository cloned locally.
  - TCP ports available on localhost: 3000 (ingest), 3001 (Grafana).
  - Docker Desktop installed.
  
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

  - Pmgen readiness: (not yet implemented)
  - Ingest readiness: `curl -s http://localhost:3000/readyz`

**Stop the stack**

```bash
docker compose -f infra/compose/compose.yaml down
```

## Where to Open Grafana

  - Grafana login: `http://localhost:3001`
  - Default Grafana credentials: `admin` / `admin`

Grafana has platform dashboards and telecom analytics dashboards:

  - platform: check status of the event pipeline: pmgen, Redpanda, ingest, Postgres
  - telecom analytics: view status of the simulated telecom network

## What to Expect

## Quick Verification

Use these checks if the dashboard does not populate as expected.

**Confirm the API is ready**

**Confirm events are being stored**

**Confirm the KPI view has data**

## Tests

**Run unit tests**

**Run integration tests**

**Run the smoke test**

```bash
docker compose -f infra/compose/compose.yaml -f infra/compose/compose.test.yaml up -d --build
docker compose -f infra/compose/compose.yaml -f infra/compose/compose.test.yaml run --rm smoke-test
teststatus=$?
docker compose -f infra/compose/compose.yaml -f infra/compose/compose.test.yaml down
exit $teststatus
```
