from dataclasses import dataclass, field

@dataclass(frozen=True)
class LossInput:
    elapsed_seconds: float
    good_count: int
    scrap_count: int
    downtime_seconds: float
    ideal_cycle_seconds: float | None
    pieces_per_cycle: int = 1
    microstop_seconds: float = 0
    excluded_break_seconds: float = 0

@dataclass
class LossResult:
    planned_seconds: float
    good_seconds: float
    speed_loss_seconds: float
    microstop_seconds: float
    downtime_seconds: float
    scrap_loss_seconds: float
    unknown_seconds: float
    excluded_break_seconds: float
    availability: float | None
    performance: float | None
    quality: float | None
    oee: float | None
    status: str
    warnings: list[str] = field(default_factory=list)

def calculate(value: LossInput) -> LossResult:
    warnings: list[str] = []
    if value.elapsed_seconds < 0 or value.good_count < 0 or value.scrap_count < 0 or value.downtime_seconds < 0 or value.microstop_seconds < 0 or value.excluded_break_seconds < 0:
        warnings.append("negative_input")
    elapsed = max(0.0, value.elapsed_seconds)
    excluded = min(elapsed, max(0.0, value.excluded_break_seconds))
    planned = elapsed - excluded
    downtime = min(planned, max(0.0, value.downtime_seconds))
    if value.downtime_seconds > planned + 1:
        warnings.append("downtime_exceeds_planned")
    runtime = planned - downtime
    microstop = min(runtime, max(0.0, value.microstop_seconds))
    productive_runtime = runtime - microstop
    good_count = max(0, value.good_count)
    scrap_count = max(0, value.scrap_count)
    total_count = good_count + scrap_count
    if not value.ideal_cycle_seconds or value.ideal_cycle_seconds <= 0 or value.pieces_per_cycle <= 0:
        warnings.append("missing_ideal_cycle")
        availability = runtime / planned if planned else None
        quality = good_count / total_count if total_count else None
        return LossResult(planned, 0, 0, microstop, downtime, 0, productive_runtime, excluded,
                          availability, None, quality, None, "insufficient_data", warnings)
    ideal_per_piece = value.ideal_cycle_seconds / value.pieces_per_cycle
    good_ideal = good_count * ideal_per_piece
    scrap_ideal = scrap_count * ideal_per_piece
    ideal = good_ideal + scrap_ideal
    availability = runtime / planned if planned else None
    performance = ideal / runtime if runtime else None
    quality = good_count / total_count if total_count else None
    oee = availability * performance * quality if None not in (availability, performance, quality) else None
    if performance is not None and performance > 1.02:
        warnings.append("performance_above_100_percent")
    if ideal > productive_runtime + 1:
        warnings.append("ideal_time_exceeds_runtime")
        # Preserve the observed good/scrap ratio while keeping the bar within elapsed time.
        factor = productive_runtime / ideal if ideal else 0
        good_time, scrap_time, speed = good_ideal * factor, scrap_ideal * factor, 0.0
    else:
        good_time, scrap_time = good_ideal, scrap_ideal
        speed = max(0.0, productive_runtime - ideal)
    status = "ok" if oee is not None else "insufficient_data"
    return LossResult(planned, good_time, speed, microstop, downtime, scrap_time, 0, excluded,
                      availability, performance, quality, oee, status, warnings)
