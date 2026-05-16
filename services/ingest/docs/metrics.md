# Ingest Metrics

The ingest service exposes Prometheus metrics on `/metrics` from the HTTP server
port configured by `PORT` (`3000` by default). The custom metrics below are
defined by the ingest service in addition to the default Node.js process and
Prometheus client metrics, which use the `ingest_` prefix.

| Metric | Type | Labels | Description |
| --- | --- | --- | --- |
| ingest_events_inserted_total | Counter | path | Counts events inserted into PostgreSQL. |
| ingest_events_rejected_total | Counter | path, reason | Counts rejected events (invalid or duplicate). |
| ingest_kafka_messages_processed_total | Counter | result | Counts valid and invalid Kafka messages processed. |
| ingest_kafka_batch_duration_seconds | Histogram | le | Measures Kafka batch processing duration. |
| ingest_consumer_lag | Gauge | topic, partition | Approximates Kafka consumer lag by topic partition. |

## Interpreting the Metric Set

Read these metrics as an ingest pipeline. `ingest_kafka_messages_processed_total`
shows how many Kafka messages are accepted for parsing and validation,
`ingest_events_inserted_total` shows the subset persisted to Postgres, and
`ingest_events_rejected_total` explains invalid or duplicate events. Batch
duration and consumer lag show whether ingestion is slowing down even before
rejections increase.

The custom event counters are currently emitted from the Kafka consumer path.
The legacy `POST /v1/events` route is served by the same process, but it does
not currently increment these custom counters.

Kafka message processing rates:

```promql
sum by (result) (rate(ingest_kafka_messages_processed_total[5m]))
```

Inserted and rejected event rates:

```promql
sum(rate(ingest_events_inserted_total[5m]))
sum(rate(ingest_events_rejected_total[5m]))
```

Kafka valid messages compared with inserted events:

```promql
sum(rate(ingest_kafka_messages_processed_total{result="valid"}[5m]))
-
sum(rate(ingest_events_inserted_total[5m]))
```

Rejected event ratio:

```promql
sum(rate(ingest_events_rejected_total[5m]))
/
(
  sum(rate(ingest_events_inserted_total[5m]))
  +
  sum(rate(ingest_events_rejected_total[5m]))
)
```

## ingest_events_inserted_total

**Type:** Counter

**Labels:** `path`

Counts events successfully inserted into Postgres. In the current Kafka consumer
path, `path` is set to `kafka` and the counter is incremented after each batch
insert attempt by the number of rows actually inserted.

Use this metric to measure persisted event volume and to compare successful
storage with Kafka message intake.

Example queries:

```promql
rate(ingest_events_inserted_total{path="kafka"}[5m])
increase(ingest_events_inserted_total{path="kafka"}[1h])
```

## ingest_events_rejected_total

**Type:** Counter

**Labels:** `path`, `reason`

Counts events rejected before or during insert accounting. In the current Kafka
consumer path, `path` is set to `kafka`.

Known `reason` values:

- `json_parse`: the Kafka message value could not be parsed as JSON.
- `validation`: the parsed payload failed event schema validation.
- `duplicate`: the event was valid but was not inserted because it already
  existed.

Use this metric to alert on ingestion quality problems and to separate malformed
payloads from duplicate event IDs.

Example queries:

```promql
sum by (reason) (rate(ingest_events_rejected_total{path="kafka"}[5m]))
topk(5, sum by (reason) (increase(ingest_events_rejected_total[1h])))
```

Cardinality note: `path` and `reason` should remain low-cardinality operational
labels. Do not add event IDs, entity IDs, raw payload values, or raw error
messages to either label.

## ingest_kafka_messages_processed_total

**Type:** Counter

**Labels:** `result`

Counts Kafka messages processed by the consumer after parsing and validation.
Messages that become normalized events are counted with `result="valid"`;
messages skipped because of JSON parsing or validation failures are counted with
`result="invalid"`.

Use this metric to measure Kafka intake and to compare valid message volume with
inserted row volume.

Example queries:

```promql
sum by (result) (rate(ingest_kafka_messages_processed_total[5m]))
increase(ingest_kafka_messages_processed_total{result="invalid"}[1h])
```

Cardinality note: `result` is expected to stay bounded to a small set of status
values. Do not put detailed validation errors or payload identifiers in this
label.

## ingest_kafka_batch_duration_seconds

**Type:** Histogram

**Exposed series:**

- `ingest_kafka_batch_duration_seconds_bucket`
- `ingest_kafka_batch_duration_seconds_count`
- `ingest_kafka_batch_duration_seconds_sum`

**Labels:** `le` on bucket series

Measures how long the ingest service spends processing a Kafka batch. The timer
starts when batch handling begins and stops after message parsing, validation,
database insertion, offset resolution, heartbeat, commit, and lag observation
complete.

Configured buckets:

```text
0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5
```

Use this metric for Kafka consumer processing latency and batch handling SLOs.

Example queries:

Average Kafka batch processing latency:

```promql
rate(ingest_kafka_batch_duration_seconds_sum[5m])
/
rate(ingest_kafka_batch_duration_seconds_count[5m])
```

p95 Kafka batch processing latency:

```promql
histogram_quantile(0.95, rate(ingest_kafka_batch_duration_seconds_bucket[5m]))
```

## ingest_consumer_lag

**Type:** Gauge

**Labels:** `topic`, `partition`

Tracks approximate Kafka consumer lag for each topic partition observed in a
processed batch. The value is set from KafkaJS batch metadata when enough offset
information is available.

Use this metric to identify partitions where the ingest consumer is falling
behind Kafka production.

Example queries:

```promql
sum by (topic) (ingest_consumer_lag)
max by (topic, partition) (ingest_consumer_lag)
```

Cardinality note: `topic` and `partition` cardinality scales with subscribed
Kafka topics and partition count. Avoid adding consumer group IDs, message keys,
entity IDs, or offsets as labels.
