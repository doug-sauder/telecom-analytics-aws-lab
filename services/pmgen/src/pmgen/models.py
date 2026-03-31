from datetime import datetime, timezone
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field


class EventMetrics(BaseModel):
    dl_prb_util_pct: float = Field(ge=0, le=100)
    ul_prb_util_pct: float = Field(ge=0, le=100)
    rrc_conn_avg: int = Field(ge=0)
    drop_rate_pct: float = Field(ge=0, le=100)


class PMEvent(BaseModel):
    # Reject unknown fields so generated payloads stay aligned with the ingest contract.
    model_config = ConfigDict(extra="forbid")

    event_id: str = Field(default_factory=lambda: str(uuid4()))
    schema_version: int = 1
    source: str = "pmgen"
    event_time: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    entity_type: Literal["cell"] = "cell"
    entity_id: str
    metrics: EventMetrics


class RuntimeStats(BaseModel):
    generated: int = 0
    sent: int = 0
    failed: int = 0
    last_error: str | None = None
