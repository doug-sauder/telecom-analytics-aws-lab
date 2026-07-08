# Pin PostgreSQL 18 and its psql client to a reproducible multi-platform image.
FROM postgres:18-bookworm@sha256:9479eac93922431e8a512b016d7362ae264f4ba139f840891b51f02931e450db

# Install the schema, validation, and initialization entrypoint.
WORKDIR /opt/telecom-db-init

# Create traversable directories for runtime assets.
RUN install \
    --directory \
    --owner=postgres \
    --group=postgres \
    --mode=0555 \
    ./sql \
    ./certs

COPY --chown=postgres:postgres --chmod=0444 infra/db/01-schema.sql ./sql/01-schema.sql
COPY --chown=postgres:postgres --chmod=0444 infra/db/02-monitoring-user.sql ./sql/02-monitoring-user.sql
COPY --chown=postgres:postgres --chmod=0444 infra/aws/db-init/validate.sql ./sql/validate.sql
COPY --chown=postgres:postgres --chmod=0555 infra/aws/db-init/entrypoint.sh ./entrypoint.sh

# Download the AWS global RDS trust bundle and verify the expected contents.
ADD --chown=postgres:postgres --chmod=0444 \
    --checksum=sha256:e5bb2084ccf45087bda1c9bffdea0eb15ee67f0b91646106e466714f9de3c7e3 \
    https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
    ./certs/global-bundle.pem

# Run the one-off initializer without database-server privileges or defaults.
USER postgres
ENTRYPOINT ["/opt/telecom-db-init/entrypoint.sh"]
