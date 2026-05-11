# README

To run the smoke test:

From the directory infra/compose, run

```bash
docker compose -f compose.yaml -f compose.test.yaml up -d --build
docker compose -f compose.yaml -f compose.test.yaml run --rm smoke-test
teststatus=$?
docker compose -f compose.yaml -f compose.test.yaml down
exit $teststatus
```
