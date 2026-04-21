import random

from pmgen.config import RuntimeConfig
from pmgen.models import EventMetrics, PMEvent
from pmgen.scenarios import ScenarioState, generate_metrics
from pmgen.metrics import EVENTS_GENERATED


class EventGenerator:
    def __init__(self, config: RuntimeConfig) -> None:
        self.config = config
        # Scenario state persists across events so profile-specific trends evolve over time.
        self.state = ScenarioState()

    def next_event(self) -> PMEvent:
        cell_index = random.randint(1, self.config.cell_count)
        entity_id = f"CELL-{cell_index:06d}"
        metrics = generate_metrics(
            scenario=self.config.scenario,
            cell_index=cell_index,
            state=self.state,
        )
        pm_event = PMEvent(
            schema_version=self.config.schema_version,
            source=self.config.source,
            entity_id=entity_id,
            metrics=EventMetrics.model_validate(metrics),
        )
        EVENTS_GENERATED.inc()
        return pm_event
