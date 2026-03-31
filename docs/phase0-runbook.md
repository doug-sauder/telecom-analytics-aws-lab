# Runbook -- Phase 0

**Start services**

```bash
cd $PROJECT_DIR/infra/compose/phase0
docker compose up -d
```

**Run unit tests**

```bash
cd $PROJECT_DIR/services/ingest
npm test
```

**Run integration tests**

```bash
docker compose --profile test -f compose.yaml -f compose.test.yaml up --build --abort-on-container-exit --exit-code-from test
```
