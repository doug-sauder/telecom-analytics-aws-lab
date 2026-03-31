import math
import random
from dataclasses import dataclass


@dataclass(slots=True)
class ScenarioState:
    # tick lets scenarios produce time-varying patterns without global state.
    tick: int = 0


def generate_metrics(scenario: str, cell_index: int, state: ScenarioState) -> dict[str, float | int]:
    if scenario == "busy-hour":
        return _busy_hour_metrics(cell_index, state)
    return _steady_metrics(cell_index, state)


def _steady_metrics(cell_index: int, state: ScenarioState) -> dict[str, float | int]:
    base = 45 + (cell_index % 10) * 2
    dl_util = _clamp(base + random.uniform(-8, 8), 0, 100)
    ul_util = _clamp(dl_util * random.uniform(0.45, 0.7), 0, 100)
    rrc_conn = max(0, int(dl_util / 3 + random.uniform(-4, 6)))
    drop_rate = _clamp(dl_util / 180 + random.uniform(0, 0.5), 0, 5)
    state.tick += 1
    return {
        "dl_prb_util_pct": round(dl_util, 2),
        "ul_prb_util_pct": round(ul_util, 2),
        "rrc_conn_avg": rrc_conn,
        "drop_rate_pct": round(drop_rate, 2),
    }


def _busy_hour_metrics(cell_index: int, state: ScenarioState) -> dict[str, float | int]:
    # Combine a sinusoidal wave with per-cell offsets to mimic a diurnal demand spike.
    wave = 20 * math.sin((state.tick + cell_index) / 12)
    base = 65 + (cell_index % 7) * 3
    dl_util = _clamp(base + wave + random.uniform(-5, 5), 0, 100)
    ul_util = _clamp(dl_util * random.uniform(0.5, 0.75), 0, 100)
    rrc_conn = max(0, int(dl_util / 2.6 + random.uniform(-3, 8)))
    drop_rate = _clamp(max(0, (dl_util - 75) / 35) + random.uniform(0, 0.6), 0, 8)
    state.tick += 1
    return {
        "dl_prb_util_pct": round(dl_util, 2),
        "ul_prb_util_pct": round(ul_util, 2),
        "rrc_conn_avg": rrc_conn,
        "drop_rate_pct": round(drop_rate, 2),
    }


def _clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(value, upper))
