# PM Generator (`pmgen`)

CLI-first synthetic PM event generator for Phase 0.

## Commands

- `pmgen run`: continuously generate and send events to the ingest service.
- `pmgen produce`: continuously generate and publish events to Kafka or SQS.
- `pmgen generate-once`: emit a single event to stdout or POST it once.
- `pmgen config show`: print the effective runtime configuration.

## Quick start

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e .
pmgen generate-once --pretty
pmgen run
```

## Environment

Configuration can be provided by environment variables:

- `PMGEN_TARGET_URL`
- `PMGEN_INTERVAL_SECONDS`
- `PMGEN_CELL_COUNT`
- `PMGEN_SOURCE`
- `PMGEN_SCHEMA_VERSION`
- `PMGEN_SCENARIO`
- `PMGEN_REQUEST_TIMEOUT_SECONDS`
- `PMGEN_EVENT_TRANSPORT` (`kafka` or `sqs`; defaults to `kafka`)
- `PMGEN_KAFKA_BROKER`
- `PMGEN_KAFKA_TOPIC`
- `PMGEN_SQS_QUEUE_URL` (required when `PMGEN_EVENT_TRANSPORT=sqs`)
- `PMGEN_SQS_REGION`
- `PMGEN_SQS_ENDPOINT_URL`

Defaults are set for local Compose usage.

For ECS SQS mode, set `PMGEN_EVENT_TRANSPORT=sqs` and
`PMGEN_SQS_QUEUE_URL` to the PM events queue URL. The service uses the standard
AWS credential provider chain, so the ECS task role should grant
`sqs:SendMessage` to that queue.
