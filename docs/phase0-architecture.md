# Phase 0 Architecture

## Objective

Demonstrate an end-to-end pipeline that is credible, repeatable, and easy to operate:

**Simulated telecom PM counters → ingest → store → query → dashboard**

No Kafka, no lakehouse, no OLAP store. One database and one visualization tool.

---

## 1) Components

### A. PM Counter Generator (container)

* Purpose: emit synthetic performance-management (PM) counter events on an interval (e.g., every 5 seconds).
* Output: HTTP POST to the ingestion service.
* Deployment: Docker Compose service (later: Kubernetes Deployment).

**Event example (JSON)**

```json
{
  "event_id": "uuid",
  "schema_version": 1,
  "source": "pmgen",
  "event_time": "2025-12-29T20:45:12Z",
  "entity_type": "cell",
  "entity_id": "CELL-000123",
  "metrics": {
    "dl_prb_util_pct": 73.2,
    "ul_prb_util_pct": 41.8,
    "rrc_conn_avg": 18,
    "drop_rate_pct": 0.7
  }
}
```

### B. Ingestion API (container)

* Purpose: accept events, validate, deduplicate, persist.
* Interface: `POST /v1/events`
* Persistence:

  * insert raw events into Postgres table `pm_events`
  * optionally maintain a small rollup table `pm_kpi_5m` (can be computed by SQL view initially)

### C. Postgres (container)

* Purpose: primary store for Phase 0
* Stores:

  * raw events table
  * a view or materialized view for KPIs

### D. Grafana (container)

* Purpose: dashboard showing time-series KPI(s)
* Datasource: Postgres
* Panels:

  * time series of average DL utilization (e.g., `avg(dl_prb_util_pct)` over time)
  * optionally a “top N busiest cells” table

### E. Minimal Observability (optional but recommended in Phase 0)

* App logs to stdout (structured JSON logs if feasible)
* You can defer Prometheus until Phase 1; Grafana is already present for the demo.

---

## 2) Data model (Postgres)

### `pm_events` (raw)

* `event_id` UUID PRIMARY KEY (enforces idempotency)
* `event_time` timestamptz NOT NULL
* `ingest_time` timestamptz NOT NULL DEFAULT now()
* `source` text NOT NULL
* `entity_id` text NOT NULL
* `metrics` jsonb NOT NULL

Recommended indexes:

* `(event_time)`
* `(entity_id, event_time)`
* GIN on `metrics` only if needed later (avoid premature indexing)

### KPI query strategy (Phase 0)

Start with a **SQL view** that buckets by time and computes aggregates. Example conceptually:

* bucket = 1 minute or 5 minutes
* KPI = average `dl_prb_util_pct` across all cells (or per selected cell)

You can keep this simple by extracting metric values from JSONB in SQL. In Phase 1, you can normalize metrics or move to OLAP.

---

## 3) Runtime topology (Phase 0)

Docker Compose (primary) with four services:

* `pmgen` → posts to `ingest`
* `ingest` → writes to `postgres`
* `grafana` → reads from `postgres`

Later, the same boundaries map cleanly to Kubernetes Deployments/Services.

---

## 4) Repo layout (minimal but professional)

* `services/pmgen/` (generator)
* `services/ingest/` (API)
* `infra/compose/` (`compose.yml`)
* `infra/db/` (SQL migrations / schema)
* `docs/` (architecture + runbook)
* `dashboards/` (Grafana JSON exports)

---

# Sprint 0

## Deliverable definition (what “done” means)

By the end of this sprint, a reviewer should be able to run one command and see data flowing into a dashboard.

### Acceptance criteria

1. `docker compose up` starts all services successfully.
2. Generator emits PM events continuously.
3. Ingestion API persists events to Postgres with deduplication by `event_id`.
4. Grafana dashboard shows a time-series panel updating over time.
