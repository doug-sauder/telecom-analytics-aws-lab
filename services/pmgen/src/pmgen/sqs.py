import asyncio
import json
from collections.abc import Mapping
from typing import Any

import boto3

from pmgen.models import PMEvent


class SqsEventPublisher:
    # Shared SQS publisher for PM event payloads.
    #
    # The publisher owns AWS client construction, JSON serialization, and
    # SendMessage calls. Service-specific metrics and logging should wrap this
    # class rather than being embedded here.
    def __init__(
        self,
        queue_url: str,
        region: str,
        endpoint_url: str | None = None,
    ) -> None:
        self._queue_url = queue_url
        self._client = boto3.client(
            "sqs",
            region_name=region,
            endpoint_url=endpoint_url,
        )

    async def publish_event(self, event: PMEvent) -> None:
        # Use the same JSON payload shape consumed by ingest from Kafka and HTTP.
        payload = event.model_dump(mode="json")
        await self.publish_payload(payload, event.event_id, event.entity_id)

    async def publish_payload(
        self,
        payload: Mapping[str, Any],
        event_id: str,
        entity_id: str,
    ) -> None:
        # Publish a JSON-serializable payload to the configured SQS queue.
        #
        # Parameters:
        #   payload: Mapping that will be JSON-encoded as the SQS message body.
        #   event_id: PM event identifier recorded as an SQS message attribute.
        #   entity_id: Cell identifier recorded as an SQS message attribute.
        message_body = json.dumps(dict(payload))
        message_attributes = {
            "event_id": {
                "DataType": "String",
                "StringValue": event_id,
            },
            "entity_id": {
                "DataType": "String",
                "StringValue": entity_id,
            },
        }

        await asyncio.to_thread(
            self._client.send_message,
            QueueUrl=self._queue_url,
            MessageBody=message_body,
            MessageAttributes=message_attributes,
        )

    async def aclose(self) -> None:
        # Boto3 SQS clients do not require explicit asynchronous shutdown.
        close = getattr(self._client, "close", None)

        if close is not None:
            close()
