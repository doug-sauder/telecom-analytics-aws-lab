# Ingest service (Node/Express)

This service accepts POST /v1/events and stores raw PM (performance measurement) events into Postgres (schema `analytics.pm_events`).
It also polls AWS SQS for JSON-encoded PM event messages and persists valid events in batches.

## Quick start (local):

- Copy `.env.example` to `.env` and adjust if needed.
- Install deps: `npm ci`
- Configure SQS: set `SQS_QUEUE_URL` and, if needed, `AWS_REGION`.
- Start: `npm start`

## Docker / Compose:

- The service is intended to run in the project's Compose file alongside `postgres`.
- Build and run with `docker compose -f infra/compose/compose.yaml up --build` (from project root).

## Integration Tests

Run the full stack and API-level integration tests:

```bash
cd <project-root>

docker compose \
  -f infra/compose/compose.yaml \
  -f infra/compose/compose.test.yaml \
  --profile test \
  up -d --build

docker wait analytics-test-1

docker compose \
  -f infra/compose/compose.yaml \
  -f infra/compose/compose.test.yaml \
  --profile test \
  logs test

docker compose \
  -f infra/compose/compose.yaml \
  -f infra/compose/compose.test.yaml \
  --profile test \
  down -v
```

`docker wait analytics-test-1` returns `0` when the integration test passes and a non-zero code when it fails.
The current integration suite validates the legacy `POST /v1/events` path; it does not yet cover the SQS consumer end-to-end flow.

## Notes

 * This service uses `npm ci` and `package-lock.json` for deterministic builds. If `package.json` is modified, regenerate the lockfile before building.

## API:

POST /v1/events
- Body: JSON object with required fields `event_time` (ISO timestamp), `entity_id` (string), and `metrics` (object). Optionally `event_id`, `source`, `entity_type`, `schema_version`.
- Returns: 201 {"event_id": "..."} on success.
