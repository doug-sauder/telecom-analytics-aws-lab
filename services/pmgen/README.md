# PM Generator (`pmgen`)

CLI-first synthetic PM event generator for Phase 0.

## Commands

- `pmgen run`: continuously generate and send events to the ingest service.
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

Defaults are set for local Compose usage.

