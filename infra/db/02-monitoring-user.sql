\set ON_ERROR_STOP on

-- Require the exporter password to be supplied by the initialization task.
\if :{?exporter_password}
\else
    \echo 'Required psql variable exporter_password was not provided.'
    \quit 3
\endif

BEGIN;

-- Create the login role only when it does not already exist.
SELECT 'CREATE ROLE postgres_exporter LOGIN'
WHERE NOT EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'postgres_exporter'
)
\gexec

-- Set or rotate the password without embedding it in source control.
SELECT format(
    'ALTER ROLE postgres_exporter WITH LOGIN PASSWORD %L',
    :'exporter_password'
)
\gexec

-- Grant the minimum monitoring permissions required by postgres_exporter.
GRANT CONNECT ON DATABASE telecom TO postgres_exporter;
GRANT pg_monitor TO postgres_exporter;

COMMIT;
