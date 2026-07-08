#!/bin/sh

# Stop immediately when a command fails or an unset variable is referenced.
set -eu

readonly SQL_DIRECTORY="/opt/telecom-db-init/sql"
readonly RDS_CA_BUNDLE="/opt/telecom-db-init/certs/global-bundle.pem"

# Validate one required environment variable without exposing its value.
# Parameter: the environment variable name to inspect.
require_environment_variable() {
    variable_name="$1"
    eval "variable_value=\${$variable_name-}"

    if [ -z "$variable_value" ]; then
        printf 'Required environment variable %s is not set.\n' "$variable_name" >&2
        exit 2
    fi
}

# Verify all connection and role credentials supplied by the ECS task.
for variable_name in \
    PGHOST \
    PGPORT \
    PGDATABASE \
    PGUSER \
    PGPASSWORD \
    POSTGRES_EXPORTER_PASSWORD
do
    require_environment_variable "$variable_name"
done

# Require full TLS verification against the bundled Amazon RDS trust store.
export PGSSLMODE="verify-full"
export PGSSLROOTCERT="$RDS_CA_BUNDLE"

# Test connectivity before making any database changes.
printf 'Testing the PostgreSQL connection.\n'
psql \
    --no-password \
    --set=ON_ERROR_STOP=1 \
    --command='SELECT 1 AS connection_ok;'

# Apply the schema and monitoring role in a deterministic order.
printf 'Applying the analytics schema.\n'
psql \
    --no-password \
    --set=ON_ERROR_STOP=1 \
    --file="$SQL_DIRECTORY/01-schema.sql"

printf 'Applying the monitoring role configuration.\n'
psql \
    --no-password \
    --set=ON_ERROR_STOP=1 \
    --variable=exporter_password="$POSTGRES_EXPORTER_PASSWORD" \
    --file="$SQL_DIRECTORY/02-monitoring-user.sql"

# Assert that initialization produced every required database object and grant.
printf 'Validating the initialized database.\n'
psql \
    --no-password \
    --set=ON_ERROR_STOP=1 \
    --file="$SQL_DIRECTORY/validate.sql"

printf 'Database initialization and validation completed successfully.\n'
