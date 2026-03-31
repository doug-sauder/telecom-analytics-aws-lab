# Ingest service (Node/Express)

This service accepts POST /v1/events and stores raw PM (performance measurement) events into Postgres (schema `analytics.pm_events`).

## Quick start (local):

- Copy `.env.example` to `.env` and adjust if needed.
- Install deps: `npm ci`
- Start: `npm start`

## Docker / Compose:

- The service is intended to run in the project's Compose file alongside `postgres`.
- Build and run with `docker compose -f infra/compose/phase0/compose.yaml up --build` (from project root).

## Integration Tests

Run the full stack and API-level integration tests:

```bash
docker compose --profile test \
  -f compose.yaml \
  -f compose.test.yaml \
  up --build --abort-on-container-exit --exit-code-from test
```

## Notes

 * This service uses `npm ci` and `package-lock.json` for deterministic builds. If `package.json` is modified, regenerate the lockfile before building.

## API:

POST /v1/events
- Body: JSON object with required fields `event_time` (ISO timestamp), `entity_id` (string), and `metrics` (object). Optionally `event_id`, `source`, `entity_type`, `schema_version`.
- Returns: 201 {"event_id": "..."} on success.

