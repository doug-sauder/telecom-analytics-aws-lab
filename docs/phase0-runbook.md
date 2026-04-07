# Runbook -- Phase 0

## Prerequisites

- Docker Desktop or Docker Engine with Compose support
- At least 4 GB of memory available to Docker
- Port `3000` available for the ingest API
- Port `3001` available for Grafana

## How to Run

Phase 0 is designed to run entirely through Docker Compose.

**Start the stack**

```bash
cd /path/to/cloud-native-telecom-analytics/infra/compose/phase0
docker compose up -d --build
```

The first startup can take a minute or two while the ingest and pmgen images build.

**Check readiness**

- Ingest readiness: `http://localhost:3000/readyz`
- Grafana login: `http://localhost:3001`
- Default Grafana credentials: `admin` / `admin`

**Stop the stack**

```bash
cd /path/to/cloud-native-telecom-analytics/infra/compose/phase0
docker compose down
```

## Where to Open Grafana

- Grafana: `http://localhost:3001`
- Dashboard folder: `Phase 0`
- Dashboard name: `Phase 0 KPIs`

Grafana is provisioned automatically with:

- a Postgres datasource pointed at the `telecom` database
- the exported dashboard from `dashboards/phase0-kpis.json`

You should not need to create the datasource or import the dashboard manually.

## What to Expect

- `pmgen` sends one synthetic PM event every 5 seconds to `POST /v1/events`.
- The ingest service stores events in `analytics.pm_events` and rejects duplicate `event_id` values.
- Postgres exposes the `analytics.v_kpi_utilization_1m` view for Grafana queries.
- Grafana shows the `Average DL PRB Utilization` time-series panel and refreshes every 10 seconds.

On a clean startup, the chart can remain empty for roughly the first minute because the dashboard queries a 1-minute bucketed SQL view. Once enough events have been ingested, the first data point should appear and continue updating.

## Quick Verification

Use these checks if the dashboard does not populate as expected.

**Confirm the API is ready**

```bash
curl -i http://localhost:3000/readyz
```

Expected result: HTTP `200 OK`.

**Confirm events are being stored**

```bash
cd /path/to/cloud-native-telecom-analytics/infra/compose/phase0
docker compose exec postgres psql -U telecom -d telecom \
  -c "select count(*) as events from analytics.pm_events;"
```

Expected result: the count increases over time.

**Confirm the KPI view has data**

```bash
cd /path/to/cloud-native-telecom-analytics/infra/compose/phase0
docker compose exec postgres psql -U telecom -d telecom \
  -c "select ts, dl_prb_util_pct_avg, samples from analytics.v_kpi_utilization_1m order by ts desc limit 5;"
```

Expected result: recent rows with non-null utilization averages.

## Tests

**Run unit tests**

```bash
cd /path/to/cloud-native-telecom-analytics/services/ingest
npm test
```

**Run integration tests**

```bash
cd /path/to/cloud-native-telecom-analytics/infra/compose/phase0
docker compose --profile test -f compose.yaml -f compose.test.yaml up --build --abort-on-container-exit --exit-code-from test
```
