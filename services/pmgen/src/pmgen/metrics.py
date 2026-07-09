# Prometheus metrics for PMGen

from prometheus_client import Counter, Gauge, Histogram


EVENTS_GENERATED = Counter(
    "pmgen_events_generated",
    "Total PM events generated",
)

KAFKA_EVENTS_SENT = Counter(
    "pmgen_kafka_events_sent",
    "Total PM events successfully sent to Kafka",
)

KAFKA_EVENTS_FAILED = Counter(
    "pmgen_kafka_events_failed",
    "Total PM events that failed to send to Kafka",
)

KAFKA_SENDS_IN_PROGRESS = Gauge(
    "pmgen_kafka_sends_in_progress",
    "Number of Kafka sends currently in progress",
)

KAFKA_SEND_DURATION = Histogram(
    "pmgen_kafka_send_duration_seconds",
    "Time spent waiting for Kafka send_and_wait to complete",
    buckets=(0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0),
)

KAFKA_SEND_ERRORS = Counter(
    "pmgen_kafka_send_errors",
    "Kafka send failures by type",
    ["type"],
)

SQS_EVENTS_SENT = Counter(
    "pmgen_sqs_events_sent",
    "Total PM events successfully sent to SQS",
)

SQS_EVENTS_FAILED = Counter(
    "pmgen_sqs_events_failed",
    "Total PM events that failed to send to SQS",
)

SQS_SENDS_IN_PROGRESS = Gauge(
    "pmgen_sqs_sends_in_progress",
    "Number of SQS sends currently in progress",
)

SQS_SEND_DURATION = Histogram(
    "pmgen_sqs_send_duration_seconds",
    "Time spent waiting for SQS SendMessage to complete",
    buckets=(0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0),
)

SQS_SEND_ERRORS = Counter(
    "pmgen_sqs_send_errors",
    "SQS send failures by type",
    ["type"],
)
