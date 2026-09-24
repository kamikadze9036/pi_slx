from datetime import datetime, timedelta, timezone
from app.mes.base import DowntimeEvent, HourObservation, MesSnapshot, ScrapReport
from app.services.shifts import hourly_intervals, utc_seconds

class MockMesDataProvider:
    # Reproducible profile; counts in the current hour rise as real time passes.
    _profile = [(0.03, 0.01, 0.02, 0.01), (0.09, 0.03, 0.03, 0.01),
                (0.02, 0.11, 0.02, 0.06), (0.19, 0.03, 0.02, 0.01),
                (0.04, 0.15, 0.04, 0.02), (0.02, 0.03, 0.02, 0.09),
                (0.07, 0.06, 0.02, 0.01), (0.03, 0.04, 0.02, 0.02)]
    _reasons = [(("mechanical", "Tool adjustment"), ("material", "Material feed")),
                (("material", "Material shortage"), ("mechanical", "Sensor reset")),
                (("quality", "Quality inspection"), ("mechanical", "Tool cleaning")),
                (("mechanical", "Drive fault"), ("material", "Material feed")),
                (("material", "Material shortage"), ("quality", "Quality inspection")),
                (("mechanical", "Tool adjustment"), ("quality", "Quality inspection")),
                (("material", "Material feed"), ("mechanical", "Sensor reset")),
                (("mechanical", "Tool cleaning"), ("material", "Material shortage"))]
    _scrap_reasons = ["Surface defect", "Dimension", "Incomplete fill", "Surface defect",
                      "Dimension", "Incomplete fill", "Surface defect", "Dimension"]

    def fetch_shift(self, mes_machine_id: str, start: datetime, end: datetime, now: datetime) -> MesSnapshot:
        # Distinct scheduled shifts must have distinct demo histories.
        profile_offset = (sum(mes_machine_id.encode("utf-8")) + start.toordinal() + start.hour // 8) % len(self._profile)
        shift_speed_adjustment = ((start.toordinal() + start.hour // 8) % 5 - 2) * 0.02
        observations = []
        downtime_events = []
        scrap_reports = []
        now_utc = now.astimezone(timezone.utc)
        for index, (begin, stop) in enumerate(hourly_intervals(start, end)):
            begin_utc = begin.astimezone(timezone.utc)
            duration = utc_seconds(begin, stop)
            elapsed = max(0.0, min(duration, (now_utc - begin_utc).total_seconds()))
            if elapsed <= 0:
                continue
            profile_index = (index + profile_offset) % len(self._profile)
            downtime_ratio, slow_ratio, micro_ratio, scrap_ratio = self._profile[profile_index]
            slow_ratio = max(0.0, min(0.45, slow_ratio + shift_speed_adjustment))
            stop_at = begin_utc + timedelta(seconds=elapsed)
            downtime = microstop = 0.0
            for offset, fraction, (category, reason) in [
                (0.13, 0.45, self._reasons[profile_index][0]),
                (0.68, 0.55, self._reasons[profile_index][1]),
                (0.48, 1.0, ("micro_stop", "Brief interruption"))
            ]:
                event_begin = begin_utc + timedelta(seconds=duration * offset)
                event_length = duration * (micro_ratio if category == "micro_stop" else downtime_ratio * fraction)
                event_end = min(event_begin + timedelta(seconds=event_length), stop_at)
                if event_end <= event_begin:
                    continue
                seconds = (event_end - event_begin).total_seconds()
                if category == "micro_stop":
                    microstop += seconds
                else:
                    downtime += seconds
                downtime_events.append(DowntimeEvent(event_begin.astimezone(begin.tzinfo),
                                                     event_end.astimezone(begin.tzinfo), category, reason))
            runtime = elapsed - downtime - microstop
            ideal_seconds = 32.0
            ideal_total = runtime * (1 - slow_ratio)
            total = int(ideal_total / (ideal_seconds / 2))
            scrap_full = int(duration * (1 - downtime_ratio - micro_ratio) * (1 - slow_ratio) / (ideal_seconds / 2) * scrap_ratio)
            scrap = 0
            for offset, fraction in [(0.37, 0.6), (0.82, 0.4)]:
                at = begin_utc + timedelta(seconds=duration * offset)
                if at <= stop_at:
                    count = round(scrap_full * fraction) if offset < 0.5 else scrap_full - round(scrap_full * 0.6)
                    if count > 0:
                        scrap += count
                        scrap_reports.append(ScrapReport(at.astimezone(begin.tzinfo), count,
                                                         self._scrap_reasons[profile_index]))
            scrap = min(scrap, total)
            observations.append(HourObservation(begin, total - scrap, scrap, downtime, microstop, ideal_seconds))
        return MesSnapshot("PX-482 · Housing assembly", f"DEMO-{mes_machine_id}", 220.0, observations,
                           downtime_events, scrap_reports, True, True)
