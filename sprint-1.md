# Cloud-Native Telecom Analytics -- Phase 1

## 1. Overview

Phase 1 evolves the Phase 0 architecture by introducing **event-driven ingestion** and **basic observability**. The system transitions from a tightly coupled HTTP → DB model to a **decoupled, queue-based pipeline**.

**Primary theme:** controlled data flow + operational visibility


## 2. Objectives

### 2.1 Functional Objectives
- Introduce a message broker (Redpanda, Kafka-compatible)
- Transition event flow to:
  - `pmgen → queue → ingest → Postgres`
- Implement batch-based ingestion from the queue
- Preserve existing event schema and DB model

### 2.2 Operational Objectives
- Add system-level observability using Prometheus
- Expose metrics from services
- Extend Grafana dashboards to include pipeline health


## 3. Architecture (Phase 1 Target)

```

pmgen (producer)
↓
message queue
↓
ingest (consumer)
↓
Postgres
↓
Grafana

```


## 4. Scope

### 4.1 In Scope
- Redpanda deployment via Docker Compose
- Kafka-compatible producer in `pmgen` (Python)
- Kafka-compatible consumer in `ingest` (Node.js)
- Batch database writes
- Prometheus integration
- Grafana dashboard updates

### 4.2 Out of Scope
- Kubernetes deployment
- High availability / clustering
- Schema registry
- Exactly-once semantics
- Advanced stream processing


## 5. System Design

### 5.1 Message Broker

**Technology:** Redpanda (Kafka-compatible)

**Topic Design:**
```
topic: pm.events
````

**Message Format (unchanged):**
```json
{
  "event_id": "uuid",
  "event_time": "ISO8601",
  "entity_id": "string",
  "metrics": { ... }
}
````


### 5.2 pmgen (Producer)

**Responsibilities:**

* Generate synthetic telecom events
* Publish events to `pm.events` topic

**Configuration:**

* `BROKER_URL`
* `TOPIC_NAME`

**Metrics (Prometheus):**

* `events_generated_total`


### 5.3 ingest (Consumer)

**Responsibilities:**

* Consume events from queue
* Validate payloads
* Batch insert into Postgres

**Behavior:**

* Poll queue continuously
* Process in batches (configurable)
* Use `ON CONFLICT DO NOTHING` for idempotency

**Configuration:**

* `BROKER_URL`
* `TOPIC_NAME`
* `BATCH_SIZE` (default: 100)
* `POLL_INTERVAL_MS` (default: 500)

**Metrics (Prometheus):**

* `events_processed_total`
* `db_insert_latency_seconds`
* `consumer_lag`


### 5.4 Postgres

No schema changes required.

**Existing guarantees leveraged:**

* Primary key on `event_id`
* JSONB metrics storage
* Append-only design


### 5.5 Observability

#### Prometheus

* Scrapes `/metrics` endpoints from:

  * ingest
  * pmgen

#### Grafana (extensions)

* ingestion rate
* queue lag
* DB insert latency


## 6. Docker Compose Changes

### 6.1 New Services

* `redpanda`
* `pmgen` (updated)
* `prometheus`

### 6.2 Updated Services

* `ingest` (consumer instead of HTTP-only)


## 7. Implementation Plan

### Step 1 — Add Message Broker

* Add Redpanda container to compose
* Verify topic creation and connectivity


### Step 2 — Implement Consumer (ingest)

* Add Kafka client library (Node.js)
* Implement polling loop
* Add batch insert logic


### Step 3 — Implement Producer (pmgen)

* Add Kafka client library (Python)
* Publish events to topic
* Validate event flow via logs


### Step 4 — Add Metrics

* Integrate Prometheus client libraries
* Expose `/metrics` endpoints

#### 4.1 Redpanda

  * Scrape metrics from Admin API port (default: 9644) at endpoint /public_metrics
  * Decide which metrics to monitor

#### 4.2 Postgres

 * Add postgres-exporter container to Docker Compose
 * Decide which metrics to monitor

#### 4.3 Pmgen

  * Decide the metrics to expose
  * Integrate client library and expose metrics

#### 4.4 Ingest

  * Decide the metrics to expose
  * Integrate client library and expose metrics

### Step 5 — Add Prometheus

* Configure scrape targets
* Validate metric collection


### Step 6 — Update Grafana

* Add dashboards for:

  * ingestion throughput
  * processing latency
  * queue lag


### Step 7 — Failure Testing

* Stop Postgres → verify retry behavior
* Stop ingest → verify backlog accumulation
* Restart services → verify recovery


## 8. Testing Strategy

### 8.1 Functional Tests

* Events flow end-to-end
* No data loss under normal operation

### 8.2 Failure Scenarios

* DB unavailable
* Consumer restart
* Producer burst load

### 8.3 Observability Validation

* Metrics visible in Prometheus
* Dashboards reflect system state


## 9. Risks and Mitigations

| Risk                          | Mitigation                                                     |
| ----------------------------- | -------------------------------------------------------------- |
| Kafka client complexity       | Use well-supported libraries (kafkajs, confluent-kafka-python) |
| Message loss due to misconfig | Use safe producer/consumer defaults                            |
| Resource usage (local dev)    | Tune Redpanda (low memory mode)                                |
| Silent failures               | Add logging + metrics early                                    |


## 10. Deliverables

* Updated `compose.yaml` (Phase 1)
* pmgen producer implementation
* ingest consumer implementation
* Prometheus configuration
* Grafana dashboard updates
* Updated README with architecture and run instructions


## 11. Exit Criteria

Phase 1 is complete when:

* Full pipeline runs locally with a single command
* pmgen produces events to queue
* ingest consumes and writes to Postgres
* System tolerates restarts without data loss
* Metrics are visible in Prometheus
* Grafana displays both:

  * telecom metrics
  * system metrics


## 12. Stretch Goals (Optional)

* Dead-letter queue
* Topic partitioning by `entity_id`
* Replay capability (offset reset)
* Basic schema validation layer

