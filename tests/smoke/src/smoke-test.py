import asyncio
import os
import time
from datetime import datetime, timezone
from sys import exit
from uuid import uuid4

import psycopg
import requests

from pmgen.kafka import KafkaEventPublisher
from pmgen.models import EventMetrics, PMEvent

PROMETHEUS_API_ENDPOINT = "http://prometheus:9090/api/v1/query"
KAFKA_BROKER = os.getenv("SMOKE_KAFKA_BROKER", "redpanda:9092")
KAFKA_TOPIC = os.getenv("SMOKE_KAFKA_TOPIC", "pm.events")
KNOWN_ENTITY_ID = "smoke-cell-001"
POSTGRES_HOST = os.getenv("SMOKE_PGHOST", "postgres")
POSTGRES_PORT = int(os.getenv("SMOKE_PGPORT", "5432"))
POSTGRES_USER = os.getenv("SMOKE_PGUSER", "telecom")
POSTGRES_PASSWORD = os.getenv("SMOKE_PGPASSWORD", "telecom")
POSTGRES_DATABASE = os.getenv("SMOKE_PGDATABASE", "telecom")
POSTGRES_POLL_TIMEOUT_SECONDS = float(os.getenv("SMOKE_DB_POLL_TIMEOUT_SECONDS", "30"))
POSTGRES_POLL_INTERVAL_SECONDS = float(os.getenv("SMOKE_DB_POLL_INTERVAL_SECONDS", "1"))
EVENT_TIME_TOLERANCE_SECONDS = 120
EXPECTED_PROMETHEUS_JOBS = {
    "ingest",
    "pmgen",
    "postgres",
    "prometheus",
    "redpanda",
}


# Known Kafka event
def build_known_event(event_id):
    # Build a recognizable payload with a runtime UUID and current event time.
    return PMEvent(
        event_id=event_id,
        schema_version=1,
        source="smoke-test",
        event_time=datetime.now(timezone.utc),
        entity_type="cell",
        entity_id=KNOWN_ENTITY_ID,
        metrics=EventMetrics(
            dl_prb_util_pct=42.5,
            ul_prb_util_pct=21.25,
            rrc_conn_avg=128,
            drop_rate_pct=0.5,
        ),
    )


async def publish_known_kafka_event(event):
    # Publish one known PM event through the same Kafka code used by pmgen.
    publisher = KafkaEventPublisher(KAFKA_BROKER, KAFKA_TOPIC)
    try:
        await publisher.publish_event(event)
    finally:
        await publisher.aclose()

    print("Known Kafka event published:", event.event_id)


# Postgres verification helpers
def postgres_connection_kwargs():
    # Keep connection settings together so the poll loop can reconnect cleanly.
    return {
        "host": POSTGRES_HOST,
        "port": POSTGRES_PORT,
        "user": POSTGRES_USER,
        "password": POSTGRES_PASSWORD,
        "dbname": POSTGRES_DATABASE,
        "connect_timeout": 5,
    }


def fetch_stored_event(event_id):
    # Look up the published event in the analytics schema by the in-memory UUID.
    query = """
        SELECT
            event_id::text,
            source,
            event_time,
            entity_id,
            metrics
        FROM analytics.pm_events
        WHERE event_id = %s
    """
    with psycopg.connect(**postgres_connection_kwargs()) as connection:
        with connection.cursor() as cursor:
            cursor.execute(query, (event_id,))
            row = cursor.fetchone()

    if row is None:
        return None

    return {
        "event_id": row[0],
        "source": row[1],
        "event_time": row[2],
        "entity_id": row[3],
        "metrics": row[4],
    }


def validate_stored_event(stored_event, expected_event):
    # Confirm the consumed Kafka event matches the known payload sent by smoke.
    expected_metrics = expected_event.metrics.model_dump(mode="json")
    stored_metrics = stored_event["metrics"]
    stored_event_time = stored_event["event_time"]
    current_time = datetime.now(timezone.utc)
    earliest_allowed_time = current_time.timestamp() - EVENT_TIME_TOLERANCE_SECONDS
    latest_allowed_time = current_time.timestamp() + EVENT_TIME_TOLERANCE_SECONDS

    if stored_event["event_id"] != expected_event.event_id:
        return f"event_id mismatch: {stored_event['event_id']}"

    if stored_event["source"] != expected_event.source:
        return f"source mismatch: {stored_event['source']}"

    if stored_event["entity_id"] != expected_event.entity_id:
        return f"entity_id mismatch: {stored_event['entity_id']}"

    if stored_event_time.tzinfo is None:
        stored_event_time = stored_event_time.replace(tzinfo=timezone.utc)

    stored_timestamp = stored_event_time.timestamp()
    if stored_timestamp < earliest_allowed_time or stored_timestamp > latest_allowed_time:
        return f"event_time outside tolerance: {stored_event_time.isoformat()}"

    if stored_metrics != expected_metrics:
        return f"metrics mismatch: {stored_metrics}"

    return None


def wait_for_event_in_postgres(expected_event):
    # Poll until ingest consumes the Kafka event and stores it in Postgres.
    deadline = time.monotonic() + POSTGRES_POLL_TIMEOUT_SECONDS
    last_error = None
    event_id = expected_event.event_id

    while time.monotonic() < deadline:
        try:
            stored_event = fetch_stored_event(event_id)
        except psycopg.Error as error:
            last_error = str(error)
            stored_event = None

        if stored_event is not None:
            validation_error = validate_stored_event(stored_event, expected_event)
            if validation_error is not None:
                print("Error: Stored Kafka event did not match expected payload:", validation_error)
                exit(1)
            else:
                print("Kafka event found in Postgres and validated successfully.")

            print("Postgres stored Kafka event:", event_id)
            return

        time.sleep(POSTGRES_POLL_INTERVAL_SECONDS)

    if last_error:
        print("Error: Failed to query Postgres for event:", last_error)
    else:
        print("Error: Published Kafka event was not stored in Postgres:", event_id)
    exit(1)


# Prometheus response helpers
def parse_prometheus_up_results(response_body):
    # Build a service-to-value lookup from the Prometheus vector response.
    results = response_body.get("data", {}).get("result", [])
    up_results_by_job = {}

    for result in results:
        metric_labels = result.get("metric", {})
        job_name = metric_labels.get("job")
        sample = result.get("value", [])

        if not job_name or len(sample) < 2:
            continue

        up_results_by_job[job_name] = sample[1]

    return up_results_by_job


def validate_expected_up_metrics(response_body):
    # Confirm every expected service has an up metric and is scrapeable.
    response_status = response_body.get("status")
    if response_status != "success":
        print("Error: Prometheus query failed. Response status:", response_status)
        exit(1)

    up_results_by_job = parse_prometheus_up_results(response_body)

    missing_jobs = EXPECTED_PROMETHEUS_JOBS - set(up_results_by_job.keys())
    if missing_jobs:
        sorted_missing_jobs = sorted(missing_jobs)
        print("Error: Prometheus did not return up metrics for:", sorted_missing_jobs)
        exit(1)

    down_jobs = []
    for job_name in sorted(EXPECTED_PROMETHEUS_JOBS):
        up_value = up_results_by_job[job_name]
        if up_value != "1":
            down_jobs.append(job_name)

    if down_jobs:
        print("Error: Prometheus reported down targets for:", down_jobs)
        exit(1)

    print("Prometheus up metrics verified for:", sorted(EXPECTED_PROMETHEUS_JOBS))


def check_prometheus_scrapes():
    # Check that Prometheus can scrape the all targets
    try:
        response = requests.get(
            PROMETHEUS_API_ENDPOINT,
            params={"query": "up"},
            timeout=30,
        )
    except requests.Timeout:
        print("Error: Connection to Prometheus timed out.")
        exit(1)
    except requests.ConnectionError:
        print("Error: Failed connect to Prometheus.")
        exit(1)
    except Exception as e:
        print("Error: An unexpected error occurred while connecting to Prometheus:", str(e))
        exit(1)
    if response.status_code != 200:
        print("Error: Prometheus is not responding. Status code:", response.status_code)
        exit(1)

    try:
        response_body = response.json()
    except requests.JSONDecodeError:
        print("Error: Prometheus returned an invalid JSON response.")
        exit(1)

    validate_expected_up_metrics(response_body)


def main():
    check_prometheus_scrapes()
    event_id = str(uuid4())
    event = build_known_event(event_id)
    asyncio.run(publish_known_kafka_event(event))
    wait_for_event_in_postgres(event)
    print("Test complete")

if __name__ == '__main__':
    main()
