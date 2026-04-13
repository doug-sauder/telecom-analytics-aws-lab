import asyncio
import logging

from pmgen.config import RuntimeConfig
from pmgen.generator import EventGenerator
from pmgen.models import RuntimeStats
from pmgen.transport import EventSender

LOGGER = logging.getLogger(__name__)


class PmgenRuntime:
    def __init__(self, config: RuntimeConfig, event_sender: EventSender) -> None:
        self.config = config
        self.stats = RuntimeStats()
        self.generator = EventGenerator(config)
        self.sender = event_sender
        self._running = False

    async def run_forever(self) -> None:
        self._running = True
        LOGGER.info(
            "starting pmgen target=%s interval_seconds=%s scenario=%s cell_count=%s",
            self.sender.target(),
            self.config.interval_seconds,
            self.config.scenario,
            self.config.cell_count,
        )
        try:
            while self._running:
                await self.run_once()
                # Pace generation so the service behaves like a steady event source.
                await asyncio.sleep(self.config.interval_seconds)
        finally:
            await self.sender.aclose()

    async def run_once(self) -> None:
        event = self.generator.next_event()
        self.stats.generated += 1
        try:
            await self.sender.send(event)
        except Exception as exc:
            self.stats.failed += 1
            self.stats.last_error = str(exc)
            LOGGER.exception("failed to send event entity_id=%s event_id=%s", event.entity_id, event.event_id)
            return

        self.stats.sent += 1
        # Log the first success quickly, then sample progress to keep logs readable.
        if self.stats.sent == 1 or self.stats.sent % 10 == 0:
            LOGGER.info(
                "sent event_id=%s entity_id=%s totals generated=%s sent=%s failed=%s",
                event.event_id,
                event.entity_id,
                self.stats.generated,
                self.stats.sent,
                self.stats.failed,
            )

    def stop(self) -> None:
        self._running = False
