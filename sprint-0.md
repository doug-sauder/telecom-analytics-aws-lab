
# Cloud-Native Telecom Analytics -- Phase 0

## Milestones

**1\. Create the Postgres schema**

   * Add infra/db/schema.sql (or a migration tool if you prefer).

   * Implement pm_events table with:
     - event_id UUID PRIMARY KEY
     - event_time, ingest_time, source, entity_id, metrics jsonb

   * Add the two indexes: (event_time) and (entity_id, event_time).

**2\. Implement ingestion service (minimal)**

Language choice: pick what you will actually use in interviews (Node.js/TypeScript or Python/FastAPI are both fine).

Required behavior:

   * POST /v1/events/pm

   * Validate required fields exist (event_id, event_time, entity_id, metrics)

   * Insert row into Postgres

   * If event_id already exists, return 200 (or 409, but 200 makes
     idempotent retry easier) without inserting a duplicate.

**3\. Implement generator**

   * Emit an event every 5 seconds (configurable).

   * Randomize:
     - entity_id across a small set (e.g., 50 cells)
    - utilization metrics with reasonable ranges and some correlation (optional)

   * POST to ingestion service.

**4\. Add a KPI view for Grafana**

Create infra/db/views.sql with a view like:

   * time bucket = 1 minute

   * KPI = avg of dl_prb_util_pct extracted from metrics

You can start with one KPI and one chart.

**5\. Grafana**

   * Run Grafana in Compose.

   * Add Postgres datasource (config in provisioning if you want it reproducible).

   * Create one dashboard panel for the KPI view.

   * Export the dashboard JSON into dashboards/phase0-kpis.json.

**6\. Documentation**

In docs/phase0-runbook.md:

   * prerequisites

   * how to run

   * where to open Grafana

   * what to expect
