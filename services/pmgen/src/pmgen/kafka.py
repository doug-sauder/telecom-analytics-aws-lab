import json
from collections.abc import Mapping
from typing import Any

from aiokafka import AIOKafkaProducer

from pmgen.models import PMEvent


class KafkaEventPublisher:
    # Shared Kafka publisher for PM event payloads.
    #
    # The publisher owns producer lifecycle, JSON serialization, and message
    # delivery. Service-specific concerns such as metrics and logging should wrap
    # this class rather than being embedded here.
    def __init__(self, bootstrap_servers: str, topic: str) -> None:
        self._producer: AIOKafkaProducer | None = None
        self._bootstrap_servers = bootstrap_servers
        self._topic = topic

    async def _ensure_started(self) -> AIOKafkaProducer:
        # Start the producer lazily so short-lived callers can construct the
        # publisher without opening network connections immediately.
        if self._producer is None:
            producer = AIOKafkaProducer(
                bootstrap_servers=self._bootstrap_servers,
                value_serializer=lambda value: json.dumps(value).encode("utf-8"),
                key_serializer=lambda key: key.encode("utf-8"),
                acks="all",
                linger_ms=5,
            )
            await producer.start()
            self._producer = producer

        return self._producer

    async def publish_event(self, event: PMEvent) -> None:
        # Use the event entity as the Kafka key so one cell's events stay ordered
        # when the topic has multiple partitions.
        payload = event.model_dump(mode="json")
        await self.publish_payload(payload, event.entity_id)

    async def publish_payload(self, payload: Mapping[str, Any], key: str) -> None:
        # Publish a JSON-serializable payload to the configured topic.
        #
        # Parameters:
        #   payload: Mapping that will be JSON-encoded as the Kafka message value.
        #   key: Kafka message key used for partitioning and ordering.
        producer = await self._ensure_started()
        await producer.send_and_wait(
            self._topic,
            value=dict(payload),
            key=key,
        )

    async def aclose(self) -> None:
        # Close the producer if it was started.
        if self._producer is not None:
            await self._producer.stop()
            self._producer = None
