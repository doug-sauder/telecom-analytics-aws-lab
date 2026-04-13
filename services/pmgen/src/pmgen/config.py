from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class RuntimeConfig(BaseSettings):
    # Read PMGEN_* variables from the environment and ignore unrelated values.
    model_config = SettingsConfigDict(env_prefix="PMGEN_", extra="ignore")

    target_url: str = "http://localhost:3000/v1/events"
    interval_seconds: float = Field(default=5.0, gt=0)
    cell_count: int = Field(default=50, ge=1)
    source: str = "pmgen"
    schema_version: int = Field(default=1, ge=1)
    scenario: str = "steady"
    request_timeout_seconds: float = Field(default=5.0, gt=0)
    kafka_broker: str = "localhost:9092"
    kafka_topic: str = "pm.events"
