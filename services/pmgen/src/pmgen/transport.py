import json
from typing import Protocol

from aiokafka import AIOKafkaProducer
import httpx

from pmgen.config import RuntimeConfig
from pmgen.models import PMEvent


class EventSender(Protocol):
    async def send(self, event: PMEvent) -> None:
        ...

    async def aclose(self) -> None:
        ...

    def target(self) -> str:
        ...


class HttpEventSender:
    def __init__(self, config: RuntimeConfig) -> None:
        # Reuse one client so requests share connection pooling across the runtime loop.
        self._client = httpx.AsyncClient(timeout=config.request_timeout_seconds)
        self._target_url = config.target_url

    async def send(self, event: PMEvent) -> None:
        response = await self._client.post(self._target_url, json=event.model_dump(mode="json"))
        response.raise_for_status()

    async def aclose(self) -> None:
        await self._client.aclose()

    def target(self) -> str:
        return self._target_url


class KafkaEventSender:
    def __init__(self, config: RuntimeConfig) -> None:
        self._producer: AIOKafkaProducer | None = None
        self._bootstrap_servers = config.kafka_broker
        self._topic = config.kafka_topic
        self._target_for_logging = config.kafka_broker

    async def _ensure_started(self) -> AIOKafkaProducer:
        if self._producer is None:
            producer = AIOKafkaProducer(
                bootstrap_servers=self._bootstrap_servers,
                value_serializer=lambda v: json.dumps(v).encode("utf-8"),
                key_serializer=lambda k: k.encode("utf-8"),
                acks="all",
                linger_ms=5,
            )
            await producer.start()
            self._producer = producer
        return self._producer

    async def send(self, event: PMEvent) -> None:
        producer = await self._ensure_started()
        await producer.send_and_wait(
            self._topic,
            value=event.model_dump(mode="json"),
            key=event.entity_id,
        )

    async def aclose(self) -> None:
        if self._producer is not None:
            await self._producer.stop()
            self._producer = None

    def target(self) -> str:
        return self._target_for_logging
