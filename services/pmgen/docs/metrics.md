# PMGen Metrics

PMGen exposes Prometheus metrics on `/metrics` from the port configured by
`PMGEN_PROMETHEUS_PORT` (`8000` by default). The custom metrics below are
defined by the pmgen service in addition to the default Python process and
Prometheus client metrics.

Prometheus counters are registered in code without the `_total` suffix, but the
Prometheus Python client exposes them with `_total` at scrape time.

| Metric | Type | Labels | What it measures |
| --- | --- | --- | --- |
| `pmgen_events_generated_total` | Counter | none | Synthetic PM events created by the generator. |
| `pmgen_kafka_events_sent_total` | Counter | none | PM events acknowledged by Kafka. |
| `pmgen_kafka_events_failed_total` | Counter | none | PM events that failed during Kafka send handling. |
| `pmgen_kafka_sends_in_progress` | Gauge | none | Kafka sends currently waiting for completion. |
| `pmgen_kafka_send_duration_seconds` | Histogram | `le` | Kafka `send_and_wait` duration in seconds. |
| `pmgen_kafka_send_errors_total` | Counter | `type` | Kafka send failures grouped by exception class name. |

## Interpreting the Metric Set

Read these metrics as a producer funnel. `pmgen_events_generated_total` shows
the event volume PMGen intends to emit, while `pmgen_kafka_events_sent_total`
shows confirmed Kafka delivery and `pmgen_kafka_events_failed_total` shows send
failures. The in-progress gauge and send-duration histogram explain whether
delivery is slowing down before outright failures appear.

Event rate comparison:

```promql
rate(pmgen_events_generated_total[5m])
rate(pmgen_kafka_events_sent_total[5m])
rate(pmgen_kafka_events_failed_total[5m])
```

Generated but not successfully sent:

```promql
rate(pmgen_events_generated_total[5m])
-
rate(pmgen_kafka_events_sent_total[5m])
```

Kafka send failure ratio:

```promql
rate(pmgen_kafka_events_failed_total[5m])
/
rate(pmgen_events_generated_total[5m])
```

## pmgen_events_generated

**Type:** Counter

**Exposed series:** `pmgen_events_generated_total`

**Labels:** none

Counts every synthetic PM event created by the event generator. The counter is
incremented after the generator chooses a cell, builds the PM metric payload,
and validates the event model. It does not indicate that the event was delivered
successfully.

Use this metric to measure the producer's intended event volume and to confirm
that the generator loop is running.

Example queries:

```promql
rate(pmgen_events_generated_total[5m])
increase(pmgen_events_generated_total[1h])
```

## pmgen_kafka_events_sent

**Type:** Counter

**Exposed series:** `pmgen_kafka_events_sent_total`

**Labels:** none

Counts PM events that were successfully acknowledged by Kafka. The counter is
incremented only after `send_and_wait` completes without raising an exception.

Use this metric to measure confirmed Kafka delivery volume. Compare it with
`pmgen_events_generated_total` to identify events that were generated but not
successfully delivered.

Example queries:

```promql
rate(pmgen_kafka_events_sent_total[5m])
increase(pmgen_kafka_events_sent_total[1h])
```

## pmgen_kafka_events_failed

**Type:** Counter

**Exposed series:** `pmgen_kafka_events_failed_total`

**Labels:** none

Counts PM events that failed during Kafka send handling. The counter is
incremented when the Kafka producer start, serialization, send, acknowledgement,
or cleanup path raises an exception while sending an event.

Use this metric for alerting on producer delivery failures. For failure
classification, pair it with `pmgen_kafka_send_errors_total`.

Example queries:

```promql
rate(pmgen_kafka_events_failed_total[5m])
increase(pmgen_kafka_events_failed_total[1h])
```

## pmgen_kafka_sends_in_progress

**Type:** Gauge

**Exposed series:** `pmgen_kafka_sends_in_progress`

**Labels:** none

Tracks the number of Kafka sends currently waiting for completion. The gauge is
incremented immediately before the service awaits `send_and_wait` and decremented
when that wait finishes, whether the send succeeds or fails.

Use this metric to spot producer backpressure or sends that are taking longer
than expected. In the current runtime loop, PMGen sends one event at a time, so a
sustained value above `0` usually means Kafka acknowledgements are slow.

Example queries:

```promql
pmgen_kafka_sends_in_progress
max_over_time(pmgen_kafka_sends_in_progress[5m])
```

## pmgen_kafka_send_duration_seconds

**Type:** Histogram

**Exposed series:**

- `pmgen_kafka_send_duration_seconds_bucket`
- `pmgen_kafka_send_duration_seconds_count`
- `pmgen_kafka_send_duration_seconds_sum`

**Labels:** `le` on bucket series

Measures how long Kafka `send_and_wait` takes for each attempted event send. The
histogram observes duration in seconds after the wait exits, whether the send
succeeds or fails.

Configured buckets:

```text
0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0
```

Use this metric for Kafka producer latency and acknowledgement-time SLOs.

Example queries:

Average Kafka send latency:

```promql
rate(pmgen_kafka_send_duration_seconds_sum[5m])
/
rate(pmgen_kafka_send_duration_seconds_count[5m])
```

p95 Kafka send latency:

```promql
histogram_quantile(0.95, rate(pmgen_kafka_send_duration_seconds_bucket[5m]))
```

## pmgen_kafka_send_errors

**Type:** Counter

**Exposed series:** `pmgen_kafka_send_errors_total`

**Labels:** `type`

Counts Kafka send failures grouped by Python exception class name. The `type`
label is populated from `type(exc).__name__` when a send attempt fails.

Use this metric to separate failure modes, such as broker connectivity problems,
producer startup failures, serialization errors, or acknowledgement timeouts.
Because label values come from exception class names, dashboards and alerts
should aggregate by `type` but avoid assuming the complete set of possible
values is fixed.

Cardinality note: `type` is expected to stay low-cardinality because it uses
exception class names, not event IDs, entity IDs, broker addresses, or raw error
messages. Do not add high-cardinality failure details to this label.

Example queries:

```promql
sum by (type) (rate(pmgen_kafka_send_errors_total[5m]))
topk(5, sum by (type) (increase(pmgen_kafka_send_errors_total[1h])))
```
