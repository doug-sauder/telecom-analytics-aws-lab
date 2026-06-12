# Runbook

## Introduction

Although the artifacts of this project are based on standards (notably Docker
containers, Kubernetes manifests), this runbook assumes a specific runtime environment
(for example, Docker Desktop, kind, etc). You should be able to run the services in a
different runtime environment, such as AWS. However, you will have to adapt the
instructions in this runbook for your own environent.

## Prerequisites

 - GitHub repository cloned locally
 - Docker Desktop installed
 - kind (Kubernetes in Docker) Kubernetes cluster created (single node is fine)

## Kubernetes runtime organization

Kubernetes cluster
  - data-services (Namespace)
    - postgres (Service [ClusterIP])
    - postgres-headless (Service [Headless])
    - postgres (StatefulService)
      - postgres-N (Pod)
    - redpanda (Service [ClusterIP])
    - redpanda-internal (Service [Headless])
    - redpanda (StatefulService)
      - redpanda-N (Pod)
  - telecom-analytics (namespace)
    - ingest (Service [ClusterIP])
    - ingest (Deployment)
      - ingest (Pod)
    - pmgen (Service [ClusterIP])
    - pmgen (Deployment)
      - pmgen (Pod)
  - monitoring (namespace)

## Deploy the services

Run commands from the project root directory.

Deploy all platform services.

```
kubectl apply -k infra/k8s/base
```

Enable port forwarding to access Grafana via browser.

```
kubectl port-forward -n monitoring svc/grafana 3001:3000
```

Undeploy all platform services.

```
kubectl delete -k infra/k8s/base
```

## Test the data services

1. Confirm current state
```
kubectl get pods,pvc -n data-services
```

2. Insert a test row into Postgres

```
kubectl exec -n data-services postgres-0 -- psql -U telecom -d telecom -c "
INSERT INTO analytics.pm_events (
  event_id,
  schema_version,
  source,
  event_time,
  entity_type,
  entity_id,
  metrics
)
VALUES (
  gen_random_uuid(),
  1,
  'k8s-persistence-test',
  now(),
  'cell',
  'persistence-cell-001',
  '{\"dl_prb_util_pct\":42.5,\"ul_prb_util_pct\":17.2}'::jsonb
);
"
```

3. Verify it exists

```
kubectl exec -n data-services postgres-0 -- psql -U telecom -d telecom -c "
SELECT source, entity_id, metrics
FROM analytics.pm_events
WHERE source = 'k8s-persistence-test';
"
```

4. Produce a test Kafka message

```
printf '%s\n' '{"source":"k8s-persistence-test","entity_id":"persistence-cell-001"}' | kubectl exec -i -n data-services redpanda-0 -- rpk topic produce pm.events --brokers localhost:9092
```

Verify it can be consumed

```
kubectl exec -n data-services redpanda-0 -- rpk topic consume pm.events --brokers localhost:9092 --offset start --num 1
```

5. Delete pods, keeping StatefulSets and PVCs

```
kubectl delete pod postgres-0 redpanda-0 -n data-services
```

6. Wait for recovery

```
kubectl get pods -n data-services -w
```

7. Verify Postgres row survived

```
kubectl exec -n data-services postgres-0 -- psql -U telecom -d telecom -c "
SELECT count(*) AS persisted_rows
FROM analytics.pm_events
WHERE source = 'k8s-persistence-test';
"
```

8. Verify Redpanda topic still exists

```
kubectl exec -n data-services redpanda-0 -- rpk topic list --brokers localhost:9092
```

## Validate application services

These checks cover Sprint 2 Step 3:

- Validate service discovery
- Validate end-to-end event flow

The validation runs as a Kubernetes Job in the `telecom-analytics` namespace.
It checks that the application service DNS names resolve, verifies the ingest
and pmgen readiness endpoints, publishes a deterministic event to Redpanda,
confirms ingest stores that event in Postgres, and waits for a fresh event from
the deployed pmgen service to appear in Postgres.

1. Build the local application images

```
docker build -t telecom-analytics-ingest:local services/ingest
docker build -t telecom-analytics-pmgen:local services/pmgen
docker build -t telecom-analytics-smoke-test:local -f tests/smoke/Dockerfile .
```

2. Load images into the local Kubernetes cluster if the cluster does not share
   the Docker image store

For kind:

Note: For Docker Desktop Kubernetes, this step is usually not needed.

Note: For a kind cluster create by Docker Desktop, you must explicitly provide the
cluster name in kind commands. To discover the cluster name, run the command `kind get
clusters`. The cluster name is probably "desktop". To specify the cluster name
"desktop", include the `--name=desktop` option.

```
kind load docker-image telecom-analytics-ingest:local
kind load docker-image telecom-analytics-pmgen:local
kind load docker-image telecom-analytics-smoke-test:local
```

3. Deploy the Kubernetes base

```
kubectl apply -k infra/k8s/base
```

4. Wait for the data services and application services

```
kubectl rollout status statefulset/postgres -n data-services --timeout=180s
kubectl rollout status statefulset/redpanda -n data-services --timeout=180s
kubectl wait --for=condition=complete job/redpanda-topic-init -n data-services --timeout=180s
kubectl rollout status deployment/ingest -n telecom-analytics --timeout=180s
kubectl rollout status deployment/pmgen -n telecom-analytics --timeout=180s
```

5. Run the Step 3 validation Job

Delete any previous validation Job before re-running it:

```
kubectl delete job step3-smoke-test -n telecom-analytics --ignore-not-found
kubectl apply -k infra/k8s/base/validation
kubectl wait --for=condition=complete job/step3-smoke-test -n telecom-analytics --timeout=180s
```

6. Inspect validation output

```
kubectl logs -n telecom-analytics job/step3-smoke-test
```

Expected output includes:

```
ingest service discovery verified
pmgen service discovery verified
Kafka event found in Postgres and validated successfully.
pmgen event flow verified.
Test complete
```

7. Optional manual database check

```
kubectl exec -n data-services postgres-0 -- psql -U telecom -d telecom -c "
SELECT source, count(*) AS rows
FROM analytics.pm_events
WHERE source IN ('smoke-test', 'pmgen')
GROUP BY source
ORDER BY source;
"
```
