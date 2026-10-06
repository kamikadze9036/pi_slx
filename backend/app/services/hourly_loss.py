"""Pure hourly production-loss calculation (see docs/hourly-new-pdf-proposal.md).

All inputs are expected to be verified; unavailable metrics are None, never guessed.
Rate segments (one effective order/cycle/cavity set) are computed separately and summed.
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class SegmentInput:
    elapsed_seconds: float          # T
    good_count: float               # G
    scrap_count: float              # S
    downtime_seconds: float         # D (excludes E and micro-stops)
    microstop_seconds: float        # M
    ideal_cycle_seconds: float | None   # C
    pieces_per_cycle: float | None      # N
    excluded_seconds: float = 0     # E
    gain_verified: bool = False


@dataclass
class SegmentResult:
    planned_seconds: float
    excluded_seconds: float
    ideal_capacity: float | None
    without_scrap_or_stops: float | None
    recoverable_output: float | None
    stop_recovery: float | None
    downtime_equiv: float | None
    microstop_equiv: float | None
    speed_loss_pieces: float | None
    speed_gain_pieces: float | None
    good_count: float
    scrap_count: float
    efficiency: float | None
    cycle_actual_seconds: float | None
    cycle_delta_seconds: float | None
    ideal_cycle_seconds: float | None
    status: str  # verified | insufficient_data | inconsistent


def calculate_segment(i: SegmentInput) -> SegmentResult:
    planned = i.elapsed_seconds - i.excluded_seconds
    produced = i.good_count + i.scrap_count
    runtime = planned - i.downtime_seconds - i.microstop_seconds
    base = dict(planned_seconds=planned, excluded_seconds=i.excluded_seconds,
                good_count=i.good_count, scrap_count=i.scrap_count,
                ideal_cycle_seconds=i.ideal_cycle_seconds)
    unavailable = dict(ideal_capacity=None, without_scrap_or_stops=None, recoverable_output=None,
                       stop_recovery=None, downtime_equiv=None, microstop_equiv=None,
                       speed_loss_pieces=None, speed_gain_pieces=None, efficiency=None,
                       cycle_actual_seconds=None, cycle_delta_seconds=None)
    if (not i.ideal_cycle_seconds or not i.pieces_per_cycle or i.ideal_cycle_seconds <= 0
            or i.pieces_per_cycle <= 0 or planned <= 0):
        return SegmentResult(**base, **unavailable, status="insufficient_data")
    if runtime < -1e-9:
        return SegmentResult(**base, **unavailable, status="inconsistent")

    rate = i.pieces_per_cycle / i.ideal_cycle_seconds  # r, pieces/s
    capacity = planned * rate
    runtime = max(runtime, 0.0)
    stopped = i.downtime_seconds + i.microstop_seconds
    # Achieved-rate counterfactual is unavailable when nothing ran.
    if runtime > 0:
        achieved = produced / runtime
        recovery = stopped * achieved
        without = produced + recovery
        recoverable = i.scrap_count + recovery
        cycle_actual = runtime * i.pieces_per_cycle / produced if produced > 0 else None
    else:
        recovery = without = recoverable = cycle_actual = None
    speed_loss = max(0.0, runtime * rate - produced)
    speed_gain = max(0.0, produced - runtime * rate)
    status = "verified"
    if speed_gain > 1e-9 and not i.gain_verified:
        status = "inconsistent"
    return SegmentResult(
        **base, ideal_capacity=capacity, without_scrap_or_stops=without,
        recoverable_output=recoverable, stop_recovery=recovery,
        downtime_equiv=i.downtime_seconds * rate, microstop_equiv=i.microstop_seconds * rate,
        speed_loss_pieces=speed_loss, speed_gain_pieces=speed_gain,
        efficiency=i.good_count / capacity,  # raw value, may exceed 1
        cycle_actual_seconds=cycle_actual,
        cycle_delta_seconds=None if cycle_actual is None else cycle_actual - i.ideal_cycle_seconds,
        status=status)


def _sum(values):
    values = list(values)
    return None if any(v is None for v in values) else sum(values)


def aggregate(results: list[SegmentResult]) -> SegmentResult:
    """Combine rate segments (hour with changeover, or hours into a shift).

    Counts and capacity are summed before ratios are computed; metrics missing in any
    segment stay None rather than being silently dropped.
    """
    if not results:
        raise ValueError("no segments")
    capacity = _sum(r.ideal_capacity for r in results)
    good = sum(r.good_count for r in results)
    cycles = {r.ideal_cycle_seconds for r in results}
    ideal_cycle = cycles.pop() if len(cycles) == 1 else None  # mixed orders: no single cycle
    cycle_actual = cycle_delta = None
    if ideal_cycle is not None:
        cycle_actual = _weighted_cycle(results)
        cycle_delta = None if cycle_actual is None else cycle_actual - ideal_cycle
    statuses = {r.status for r in results}
    status = ("inconsistent" if "inconsistent" in statuses
              else "insufficient_data" if "insufficient_data" in statuses else "verified")
    return SegmentResult(
        planned_seconds=sum(r.planned_seconds for r in results),
        excluded_seconds=sum(r.excluded_seconds for r in results),
        ideal_capacity=capacity,
        without_scrap_or_stops=_sum(r.without_scrap_or_stops for r in results),
        recoverable_output=_sum(r.recoverable_output for r in results),
        stop_recovery=_sum(r.stop_recovery for r in results),
        downtime_equiv=_sum(r.downtime_equiv for r in results),
        microstop_equiv=_sum(r.microstop_equiv for r in results),
        speed_loss_pieces=_sum(r.speed_loss_pieces for r in results),
        speed_gain_pieces=_sum(r.speed_gain_pieces for r in results),
        good_count=good, scrap_count=sum(r.scrap_count for r in results),
        efficiency=(good / capacity) if capacity else None,
        cycle_actual_seconds=cycle_actual, cycle_delta_seconds=cycle_delta,
        ideal_cycle_seconds=ideal_cycle, status=status)


def _weighted_cycle(results: list[SegmentResult]) -> float | None:
    # Output-weighted: sum(cycle_i * produced_i) / sum(produced_i); needs every segment.
    total = weighted = 0.0
    for r in results:
        produced = r.good_count + r.scrap_count
        if r.cycle_actual_seconds is None:
            if produced > 0:
                return None
            continue
        total += produced
        weighted += r.cycle_actual_seconds * produced
    return weighted / total if total else None
