import type { DashboardData } from '../types';
import { displayTheme, themeQuery } from '../theme';
import { ShiftNavigator, displayLink } from '../ShiftNavigator';

const clock = (value: string) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
const number = (value: number | null) => value == null ? '—' : new Intl.NumberFormat('en-US').format(value);
const minutes = (value: number | null) => value == null ? '—' : `${Math.round(value / 60)} min`;
const position = (value: string, start: string, end: string) => Math.max(0, Math.min(100,
  (new Date(value).getTime() - new Date(start).getTime()) / (new Date(end).getTime() - new Date(start).getTime()) * 100));

export function EuromapShift({ data, view, offline, updatedAt, now }: {
  data: DashboardData; view: 'hourly' | 'imprint'; offline: boolean;
  updatedAt: Date | null; now: Date;
}) {
  const shift = data.shift!;
  const live = data.live_shift!;
  const summary = live.summary;
  const stale = offline || data.status === 'stale';
  const maxCycles = Math.max(1, ...live.hours.map(hour => hour.cycle_count || 0));
  const maxBin = Math.max(1, ...live.cycle_bins.map(bin => bin.count));
  const hasObservedData = summary.recorded_cycles != null || summary.observed_stop_seconds != null;
  const sourceNote = live.stop_source === 'cycles'
    ? 'Stop intervals inferred from gaps between recorded machine cycles. Shift boundaries may be incomplete.'
    : live.stop_source === 'histo_events'
      ? 'Stop intervals from sampled Cyclades status events via Euromap63. Start and end times are approximate.'
      : 'Stop history is unavailable from Euromap63.';

  return <main className={`screen real-shift-screen theme-${displayTheme(data.display.theme)}`}>
    <header className="topbar"><div className="brand"><span className="brand-mark">P·E</span><span>PRODUCTION<br/>EFFICIENCY</span></div>
      <div className="top-status"><span className={`status-dot ${stale ? 'stale' : ''}`}></span>{stale ? 'EUROMAP63 CONNECTION LOST' : 'EUROMAP63 · RECORDED DATA'}</div>
      <div className="top-time"><span>{now.toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short' }).toUpperCase()}</span>
        <strong>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</strong></div></header>
    <nav className="view-nav" aria-label="Display views"><a href={`/fleet${themeQuery}`}>PLANT OVERVIEW ↗</a>
      {view === 'hourly' ? <span className="selected">HOURLY RECORDS</span>
        : <a href={displayLink(`/display/${encodeURIComponent(data.display.id)}/hourly`)}>HOURLY RECORDS ↗</a>}
      {view === 'imprint' ? <span className="selected">SHIFT IMPRINT</span>
        : <a href={displayLink(`/display/${encodeURIComponent(data.display.id)}/imprint`)}>SHIFT IMPRINT ↗</a>}</nav>
    {stale && <div className="stale-banner">Showing last available Euromap63 data · Last successful update {updatedAt?.toLocaleTimeString() || 'unknown'} · Retrying</div>}
    <ShiftNavigator displayId={data.display.id} view={view} shift={shift} navigation={data.shift_navigation!} />
    <section className="real-shift-head"><div><span className="eyebrow">{view === 'hourly' ? 'HOURLY RECORDS' : 'SHIFT IMPRINT'} / {data.machine.id.toUpperCase()}</span>
      <h1>{data.machine.name}</h1><p>{live.machine_code} · {shift.name} · {clock(shift.start)}–{clock(shift.end)}</p></div>
      {live.detail_url && <a href={live.detail_url}>EUROMAP63 MACHINE DETAIL ↗</a>}</section>
    <section className="real-shift-kpis" aria-label="Recorded shift values">
      <div><span>RECORDED CYCLES</span><strong>{number(summary.recorded_cycles)}</strong><small>Machine cycles, not good pieces</small></div>
      <div><span>OBSERVED STOPS</span><strong>{number(summary.observed_stop_count)}</strong><small>{live.stop_source === 'histo_events' ? 'Approximate timestamps' : 'Cycle-gap detection'}</small></div>
      <div><span>OBSERVED STOP TIME</span><strong>{minutes(summary.observed_stop_seconds)}</strong><small>Partial coverage possible</small></div>
    </section>
    <div className="real-shift-note">{sourceNote} Good pieces, scrap and OEE are unavailable until a verified production source is connected.</div>
    {!hasObservedData && <div className="real-shift-empty">No cycle or stop records are available for this shift. No production quantity is inferred.</div>}
    {view === 'hourly' ? <section className="real-shift-panel"><div className="real-shift-section-head"><span className="eyebrow">01 / HOURLY VIEW</span><h2>Recorded activity by hour</h2></div>
      <div className="real-hour-heading"><span>HOUR</span><span>RECORDED CYCLES / OBSERVED STOP TIME</span><span>CYCLES</span><span>STOPS</span><span>STOP TIME</span></div>
      <div className="real-hours">{live.hours.map(hour => <div className="real-hour-row" key={hour.start}>
        <strong>{clock(hour.start)}–{clock(hour.end)}</strong>
        <div className="real-hour-bars"><div className="real-hour-cycle-track" aria-label={`${number(hour.cycle_count)} recorded cycles`}>
          {hour.cycle_count != null && <i style={{ width: `${hour.cycle_count / maxCycles * 100}%` }} />}</div>
          <div className="real-hour-stop-track" aria-label={`${minutes(hour.stop_seconds)} observed stop time`}>
            {hour.stop_seconds != null && <i style={{ width: `${Math.min(100, hour.stop_seconds / hour.elapsed_seconds * 100)}%` }} />}</div></div>
        <span>{number(hour.cycle_count)}</span><span>{number(hour.stop_count)}</span><span>{minutes(hour.stop_seconds)}</span>
      </div>)}</div>
      <p className="real-shift-help">Green: recorded cycle count relative to the busiest hour. Red: observed stop time relative to elapsed time in that hour. “—” means unavailable, not zero.</p>
    </section> : <section className="real-shift-panel"><div className="real-shift-section-head"><span className="eyebrow">01 / CHRONOLOGICAL VIEW</span><h2>Recorded shift imprint</h2></div>
      <div className="real-timeline-axis"><span>{clock(shift.start)}</span><span>{clock(shift.end)}</span></div>
      <div className="real-timeline-label">OBSERVED STOP INTERVALS</div>
      <div className="real-timeline-stops" aria-label="Observed stop intervals">{live.downtime_events.map((event, index) => <i key={`${event.start}-${index}`}
        style={{ left: `${position(event.start, shift.start, shift.end)}%`, width: `${Math.max(0.25, position(event.end, shift.start, shift.end) - position(event.start, shift.start, shift.end))}%` }}
        title={`${clock(event.start)}–${clock(event.end)} · ${event.reason} · ${minutes(event.seconds)}`} />)}</div>
      <div className="real-timeline-label">RECORDED CYCLES / 10 MIN</div>
      <div className="real-timeline-cycles" aria-label="Recorded cycles in ten-minute intervals">{live.cycle_bins.map(bin => <i key={bin.start}
        style={{ left: `${position(bin.start, shift.start, shift.end)}%`, height: `${Math.max(2, bin.count / maxBin * 100)}%` }}
        title={`${clock(bin.start)} · ${bin.count} cycles`} />)}</div>
      <p className="real-shift-help">Unmarked time is not confirmed running. Cycle bars show counts, not good pieces.</p>
    </section>}
    <section className="real-shift-panel"><div className="real-shift-section-head"><span className="eyebrow">02 / STOP DETAIL</span><h2>Recorded stop reasons</h2></div>
      {live.downtime_events.length ? <div className="real-stop-list">{live.downtime_events.map((event, index) => <div key={`${event.start}-${index}`}>
        <span>{clock(event.start)}–{clock(event.end)}</span><strong>{event.reason}</strong><b>{minutes(event.seconds)}</b></div>)}</div>
        : <p className="real-shift-help">No stop intervals returned for this shift. This does not confirm uninterrupted production.</p>}</section>
    <footer><span>{data.display.name.toUpperCase()} / {shift.name.toUpperCase()}</span>
      <span>EUROMAP63 API · NO SIMULATED PRODUCTION DATA</span><span>UPDATED {updatedAt?.toLocaleTimeString() || '—'}</span></footer>
  </main>;
}
