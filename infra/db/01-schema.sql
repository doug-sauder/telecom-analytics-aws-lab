-- Phase 0: Cloud-Native Telecom Analytics Platform
-- Postgres schema (raw PM events + simple KPI view)
-- Recommended file: infra/db/schema.sql

BEGIN;

-- Optional: keep objects isolated
CREATE SCHEMA IF NOT EXISTS analytics;
SET search_path TO analytics;

-- If you want UUID generation inside Postgres later, enable pgcrypto.
-- Not required if your app generates UUIDs.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -------------------------------------------------------------------
-- 1) Raw events table (append-only)
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pm_events (
    event_id       uuid        PRIMARY KEY,
    schema_version integer     NOT NULL DEFAULT 1,
    source         text        NOT NULL,
    event_time     timestamptz NOT NULL,
    ingest_time    timestamptz NOT NULL DEFAULT now(),
    entity_type    text        NOT NULL DEFAULT 'cell',
    entity_id      text        NOT NULL,
    metrics        jsonb       NOT NULL,

    -- Basic sanity checks (lightweight guardrails)
    CONSTRAINT pm_events_event_time_reasonable
      CHECK (event_time > '2000-01-01'::timestamptz AND event_time < '2100-01-01'::timestamptz),
    CONSTRAINT pm_events_metrics_is_object
      CHECK (jsonb_typeof(metrics) = 'object')
);

-- Time-series query acceleration
CREATE INDEX IF NOT EXISTS pm_events_event_time_idx
    ON pm_events (event_time);

CREATE INDEX IF NOT EXISTS pm_events_entity_time_idx
    ON pm_events (entity_id, event_time);

-- Optional: helpful if you filter by source frequently
CREATE INDEX IF NOT EXISTS pm_events_source_time_idx
    ON pm_events (source, event_time);

-- -------------------------------------------------------------------
-- 2) Simple KPI view (Grafana-friendly)
--    - Buckets by 1 minute
--    - Computes average DL/UL utilization across all cells
--    - Ignores rows where metric keys are missing or non-numeric
-- -------------------------------------------------------------------
CREATE OR REPLACE VIEW v_kpi_utilization_1m AS
SELECT
    date_trunc('minute', event_time) AS ts,
    avg(NULLIF(metrics->>'dl_prb_util_pct', '')::double precision) AS dl_prb_util_pct_avg,
    avg(NULLIF(metrics->>'ul_prb_util_pct', '')::double precision) AS ul_prb_util_pct_avg,
    count(*) AS samples
FROM pm_events
WHERE
    (metrics ? 'dl_prb_util_pct' OR metrics ? 'ul_prb_util_pct')
GROUP BY 1
ORDER BY 1;

-- -------------------------------------------------------------------
-- 3) Optional: Per-entity KPI view (for a dropdown / templating in Grafana)
-- -------------------------------------------------------------------
CREATE OR REPLACE VIEW v_kpi_utilization_1m_by_entity AS
SELECT
    date_trunc('minute', event_time) AS ts,
    entity_id,
    avg(NULLIF(metrics->>'dl_prb_util_pct', '')::double precision) AS dl_prb_util_pct_avg,
    avg(NULLIF(metrics->>'ul_prb_util_pct', '')::double precision) AS ul_prb_util_pct_avg,
    count(*) AS samples
FROM pm_events
WHERE
    (metrics ? 'dl_prb_util_pct' OR metrics ? 'ul_prb_util_pct')
GROUP BY 1, 2;

COMMIT;

