# Ingest Service Design

## 1. Purpose

The ingest service accepts telecom performance-management events, validates
those events, and persists valid events to PostgreSQL.

The ingest service primarily receives events as a Kafka consumer. However, the
service also maintains a legacy HTTP ingestion endpoint for compatibility and
focused integration testing.

## 2. Responsibilities

The ingest service performs the following actions:

  - Consumes PM events from the configured Kafka topic.
  - Validates event payload content before persistence.
  - Writes valid events to `analytics.pm_events` database table.
  - Preserves idempotency through the database primary key on `event_id`.
  - Exposes health, readiness, and Prometheus metrics endpoints.
  - Reports invalid Kafka messages without blocking the topic partition.

## 3. Runtime Design

The service is a Node.js application using Express for HTTP endpoints and
KafkaJS for broker consumption.

At startup, the process:

  1. Loads runtime configuration from environment variables.
  2. Verifies PostgreSQL connectivity.
  3. Starts the Express HTTP server.
  4. Connects a Kafka consumer to the configured broker and topic.
  5. Runs the Kafka consumer loop in the same process as the HTTP server.

The HTTP server remains available while the Kafka consumer is running so
readiness and metrics can be scraped from the same container.

## 4. Interfaces

### 4.1 Kafka Input

The primary input is a Kafka topic containing JSON-encoded PM event messages.

Current topic:

> pm.events

The consumer subscribes as part of a configured consumer group. The default
local Compose consumer group is:

> telecom.analytics.ingest

When a consumer group already has committed offsets, the service resumes from
those offsets. When a new consumer group starts without committed offsets, the
service starts from the current end of the topic because it does not subscribe
with replay-from-beginning behavior by default. Replaying older events requires
an operational offset reset.

### 4.2 HTTP Input

The service exposes a compatibility ingestion endpoint:

> POST /v1/events

This endpoint accepts a single event as a JSON payload, validates it, and
writes it immediately to PostgreSQL. It is useful for direct API tests and
backward compatibility with the earlier HTTP-based ingestion path.

HTTP responses:

| Response Code | Status |
| --- | --- |
| 201 | New event inserted |
| 400 | Validation failed |
| 409 | Event id already exists |
| 500 | Unexpected persistence error |

### 4.3 Health and Metrics

The service exposes:


> GET /healthz  
> GET /readyz  
> GET /metrics

`/healthz` confirms the process is alive.

`/readyz` confirms the service can query PostgreSQL.

`/metrics` exposes Prometheus-formatted metrics.

## 5. Event Contract

The ingest service expects PM events with the following logical fields:

| Name | Description | Presence | Format | Example |
| --- | --- | --- | --- | --- |
| event_id | Event identifier supplied by the producer. | optional | UUID | 123e4567-e89b-12d3-a456-426614174000 |
| schema_version | Event schema version. | optional | integer | 1 |
| source | Event source identifier. | optional | string | "pmgen" |
| event_time | Event timestamp. | required | ISO 8601 timestamp | 2026-05-12T12:34:56Z |
| entity_type | Telecom entity type. | optional | string | "cell" |
| entity_id | Telecom entity identifier. | required | string | "cell-123" |
| metrics | PM metric values payload. Must be a JSON object, not an array. | required | object | (see the JSON below) |

The following is an example of a single PM event as a JSON object:

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

The service normalizes valid timestamps to ISO format before persistence.

## 6. Persistence Design

Accepted events are written to PostgreSQL table:

> analytics.pm_events

The database is the idempotency boundary. Inserts use `ON CONFLICT (event_id)
DO NOTHING`, so duplicate event ids do not create duplicate rows.

Kafka messages are written using batch inserts. Each database batch is a
single parameterized `INSERT` statement containing multiple event rows.

The HTTP compatibility path writes one event per request.

## 7. Kafka Consumer Design

The Kafka consumer runs with:

  - Manual offset commit.
  - Manual batch resolution.
  - Configurable database batch size.
  - Configurable Kafka fetch wait time.

For each Kafka batch, the service:

  1. Converts message values from bytes to UTF-8 JSON.
  2. Parses JSON payloads.
  3. Normalizes and validates event payloads.
  4. Logs and skips invalid messages.
  5. Inserts valid events into PostgreSQL in database-sized chunks.
  6. Resolves message offsets after database writes complete.
  7. Sends a heartbeat.
  8. Commits offsets when necessary.
  9. Records approximate consumer lag.

Invalid messages are intentionally skipped after being counted and logged. This
prevents a single poison message from blocking all later messages in the same
partition.

## 8. Delivery Semantics

The intended delivery model for valid, persistable events is at-least-once
processing with idempotent writes.

If the service processes a valid message and crashes before committing the
offset, Redpanda may redeliver the message. The database primary key on
`event_id` prevents duplicate rows.

If PostgreSQL rejects a batch because of an unexpected database error, the error
propagates out of batch processing. Offsets for the failed batch are not
committed successfully, allowing the broker to redeliver after recovery.

Invalid JSON messages and messages that fail service-level validation are a
deliberate exception to the at-least-once processing model. The service logs and
counts those messages, resolves their offsets, and does not retry them. This
poison-message policy prevents one malformed message from blocking later
messages in the same partition.

Exactly-once semantics are out of scope.

## 9. Failure Behavior

### 9.1 Invalid JSON

Invalid JSON Kafka messages are:

  - Counted as rejected with reason `json_parse`.
  - Logged with topic, partition, and offset.
  - Skipped so the consumer can continue.

### 9.2 Schema Validation Failure

Kafka messages with invalid event shape are:

  - Counted as rejected with reason `validation`.
  - Logged with topic, partition, and offset.
  - Skipped so the consumer can continue.

### 9.3 Duplicate Events

Duplicate event ids are:

  - Ignored by PostgreSQL through conflict handling.
  - Counted as rejected with reason `duplicate` on the Kafka path.
  - Returned as `409 duplicate_event` on the HTTP path.

### 9.4 PostgreSQL Unavailable

When PostgreSQL is unavailable:

  - Startup fails if the initial database connectivity check fails.
  - `/readyz` returns `503`.
  - Kafka batch persistence fails, preventing successful offset commit for the
    failed batch.

### 9.5 Shutdown

On `SIGINT` or `SIGTERM`, the service:

  1. Disconnects the Kafka consumer.
  2. Closes the HTTP server.
  3. Exits the process.

## 10. Configuration

The service is configured through environment variables.

HTTP server:

  - `PORT`

PostgreSQL:

  - `PGHOST`
  - `PGPORT`
  - `PGUSER`
  - `PGPASSWORD`
  - `PGDATABASE`

Kafka consumer:

  - `BROKER_URL`
  - `TOPIC_NAME`
  - `CONSUMER_GROUP_ID`
  - `BATCH_SIZE`
  - `POLL_INTERVAL_MS`

Defaults support local development, but Compose should set explicit values for
the integrated stack.

## 11. Metrics

The service uses `prom-client` and exposes default Node.js process metrics
with the `ingest_` prefix. See [Ingest Metrics](metrics.md) for the full
metrics description.

## 12. Testing

Current test coverage includes:

  - Event normalization and validation unit tests.
  - HTTP event route unit tests.
  - Metrics endpoint unit test.
  - Kafka consumer unit tests for lag calculation, message processing, invalid
    payload handling, and batch handling.
  - HTTP integration test for inserting an event and rejecting a duplicate
    `event_id`.

Known test gap:

  - The integration suite does not yet cover the full Redpanda-to-ingest-to-PostgreSQL path.

## 13. Known Limitations

  - Invalid Kafka messages are skipped rather than sent to a dead-letter
    topic.
  - The service does not currently expose a dedicated Kafka consumer readiness
    signal.
  - The HTTP ingestion path is retained for compatibility but is not the
    primary event path.
  - Consumer replay and offset reset are operational procedures, not service
    features.
  - Schema evolution is limited to the `schema_version` field; there is no
    schema registry.

## 14. Related Documents

  - Top-level architecture: `docs/architecture.md`
  - Ingest metrics reference: `services/ingest/docs/metrics.md`
  - Database schema: `infra/db/01-schema.sql`
  - Compose runtime: `infra/compose/compose.yaml`
