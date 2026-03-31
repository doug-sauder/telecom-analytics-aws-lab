import httpx

from pmgen.config import RuntimeConfig
from pmgen.models import PMEvent


class EventSender:
    def __init__(self, config: RuntimeConfig) -> None:
        # Reuse one client so requests share connection pooling across the runtime loop.
        self._client = httpx.AsyncClient(timeout=config.request_timeout_seconds)
        self._target_url = config.target_url

    async def send(self, event: PMEvent) -> None:
        response = await self._client.post(self._target_url, json=event.model_dump(mode="json"))
        response.raise_for_status()

    async def aclose(self) -> None:
        await self._client.aclose()
