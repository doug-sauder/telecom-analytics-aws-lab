\set ON_ERROR_STOP on

-- Fail validation when the database, TLS session, objects, or grants are absent.
DO $validation$
BEGIN
    IF current_database() <> 'telecom' THEN
        RAISE EXCEPTION 'Connected to unexpected database: %', current_database();
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_stat_ssl
        WHERE pid = pg_backend_pid()
          AND ssl
    ) THEN
        RAISE EXCEPTION 'The current database connection is not using TLS.';
    END IF;

    IF to_regnamespace('analytics') IS NULL THEN
        RAISE EXCEPTION 'Required schema analytics does not exist.';
    END IF;

    IF to_regclass('analytics.pm_events') IS NULL THEN
        RAISE EXCEPTION 'Required table analytics.pm_events does not exist.';
    END IF;

    IF to_regclass('analytics.v_kpi_utilization_1m') IS NULL THEN
        RAISE EXCEPTION 'Required view analytics.v_kpi_utilization_1m does not exist.';
    END IF;

    IF to_regclass('analytics.v_kpi_utilization_1m_by_entity') IS NULL THEN
        RAISE EXCEPTION 'Required view analytics.v_kpi_utilization_1m_by_entity does not exist.';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_extension
        WHERE extname = 'pgcrypto'
    ) THEN
        RAISE EXCEPTION 'Required extension pgcrypto does not exist.';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_roles
        WHERE rolname = 'postgres_exporter'
          AND rolcanlogin
          AND pg_has_role(rolname, 'pg_monitor', 'member')
    ) THEN
        RAISE EXCEPTION 'Monitoring role is absent or lacks required permissions.';
    END IF;
END
$validation$;

-- Print non-secret evidence for the ECS task log.
SELECT current_database(), current_user;

SELECT ssl, version, cipher
FROM pg_stat_ssl
WHERE pid = pg_backend_pid();

SELECT to_regnamespace('analytics') AS analytics_schema;
SELECT to_regclass('analytics.pm_events') AS pm_events_table;
SELECT to_regclass('analytics.v_kpi_utilization_1m') AS utilization_view;
SELECT to_regclass('analytics.v_kpi_utilization_1m_by_entity') AS entity_view;

SELECT extname
FROM pg_extension
WHERE extname = 'pgcrypto';

SELECT
    rolname,
    rolcanlogin,
    pg_has_role(rolname, 'pg_monitor', 'member') AS has_pg_monitor
FROM pg_roles
WHERE rolname = 'postgres_exporter';
