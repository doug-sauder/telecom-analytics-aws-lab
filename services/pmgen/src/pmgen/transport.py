import time
from typing import Protocol

import httpx

from pmgen.config import RuntimeConfig
from pmgen.kafka import KafkaEventPublisher
from pmgen.models import PMEvent
from pmgen.metrics import (
    KAFKA_EVENTS_FAILED,
    KAFKA_EVENTS_SENT,
    KAFKA_SEND_DURATION,
    KAFKA_SEND_ERRORS,
    KAFKA_SENDS_IN_PROGRESS,
)


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
        # Wrap the reusable publisher with pmgen-specific metrics.
        self._publisher = KafkaEventPublisher(config.kafka_broker, config.kafka_topic)
        self._target_for_logging = config.kafka_broker

    async def send(self, event: PMEvent) -> None:
        try:
            KAFKA_SENDS_IN_PROGRESS.inc()
            start_time = time.perf_counter()
            try:
                await self._publisher.publish_event(event)
                KAFKA_EVENTS_SENT.inc()
            finally:
                end_time = time.perf_counter()
                KAFKA_SEND_DURATION.observe(end_time - start_time)
                KAFKA_SENDS_IN_PROGRESS.dec()
        except Exception as exc:
            KAFKA_EVENTS_FAILED.inc()
            KAFKA_SEND_ERRORS.labels(type=type(exc).__name__).inc()
            raise

    async def aclose(self) -> None:
        await self._publisher.aclose()

    def target(self) -> str:
        return self._target_for_logging
