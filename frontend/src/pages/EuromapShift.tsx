import { Fragment, useState } from 'react';
import type { DashboardData } from '../types';
import { displayTheme, themeQuery } from '../theme';
import { ShiftNavigator, displayLink } from '../ShiftNavigator';
import { CavityRates } from '../CavityRates';

const clock = (value: string) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
const number = (value: number | null) => value == null ? '—' : new Intl.NumberFormat('en-US').format(value);
const minutes = (value: number | null) => value == null ? '—' : `${Math.round(value / 60)} min`;
const seconds = (value: number | null | undefined) => value == null ? '—' : `${value.toFixed(1)} s`;
const position = (value: string, start: string, end: string) => Math.max(0, Math.min(100,
  (new Date(value).getTime() - new Date(start).getTime()) / (new Date(end).getTime() - new Date(start).getTime()) * 100));

export function EuromapShift({ data, view, offline, updatedAt, now }: {
  data: DashboardData; view: 'hourly' | 'imprint'; offline: boolean;
  updatedAt: Date | null; now: Date;
}) {
  const shift = data.shift!;
  const live = data.live_shift!;
  const summary = live.summary;
  const counter = live.cycle_source === 'counter';
  const machineState = live.current_machine?.state === 'bezi' ? 'RUNNING'
    : live.current_machine?.state === 'stoji' ? 'STOPPED'
      : live.current_machine?.state === 'bez_zakazky' ? 'NO ORDER' : 'UNKNOWN';
  const stale = offline || data.status === 'stale';
  const maxCycles = Math.max(1, ...live.hours.map(hour => hour.cycle_count || 0));
  const maxBin = Math.max(1, ...live.cycle_bins.map(bin => bin.count));
  const binWidth = Math.max(0.25, live.bin_minutes / ((new Date(shift.end).getTime() - new Date(shift.start).getTime()) / 60000) * 85);
  const scrapList = live.scrap_declarations ?? null;
  const scrapTotal = scrapList?.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
  const scrapBinMs = live.bin_minutes * 60000;
  const scrapBins = new Map<number, number>();
  for (const item of scrapList || []) {
    const slot = Math.floor((new Date(item.time).getTime() - new Date(shift.start).getTime()) / scrapBinMs);
    scrapBins.set(slot, (scrapBins.get(slot) || 0) + item.quantity);
  }
  const maxScrapBin = Math.max(1, ...scrapBins.values());
  const scrapSlotWidth = Math.max(0.25, scrapBinMs / (new Date(shift.end).getTime() - new Date(shift.start).getTime()) * 100);
  const scrapByReason = [...(scrapList || []).reduce((map, item) => {
    const row = map.get(item.reason) || { reason: item.reason, quantity: 0, declarations: 0 };
    row.quantity += item.quantity; row.declarations += 1; return map.set(item.reason, row);
  }, new Map<string, { reason: string; quantity: number; declarations: number }>()).values()]
    .sort((a, b) => b.quantity - a.quantity);
  const cavityRows = live.cavities?.rows ?? [];
  const canSplit = view === 'imprint' && scrapList != null && cavityRows.length > 1;
  const [splitPref, setSplitPref] = useState(() => { try { return localStorage.getItem('shift-scrap-view') === 'split'; } catch { return false; } });
  const splitView = canSplit && splitPref;
  const chooseView = (split: boolean) => { setSplitPref(split); try { localStorage.setItem('shift-scrap-view', split ? 'split' : 'sum'); } catch { /* storage unavailable */ } };
  const lanes: (number | null)[] = [...cavityRows.map(row => row.cavity_no), ...(scrapList?.some(item => item.cavity_no == null) ? [null] : [])];
  const laneName = (no: number | null) => no == null ? '?' : `K${no}`;
  const laneData = lanes.map(no => {
    const bins = new Map<number, number>();
    for (const item of scrapList || []) if ((item.cavity_no ?? null) === no) {
      const slot = Math.floor((new Date(item.time).getTime() - new Date(shift.start).getTime()) / scrapBinMs);
      bins.set(slot, (bins.get(slot) || 0) + item.quantity);
    }
    return { no, bins };
  });
  const maxLaneBin = Math.max(1, ...laneData.flatMap(lane => [...lane.bins.values()]));
  const laneQty = (no: number | null, reason?: string) => (scrapList || [])
    .filter(item => (item.cavity_no ?? null) === no && (reason === undefined || item.reason === reason))
    .reduce((sum, item) => sum + item.quantity, 0);
  // Hover text for a scrap bar: interval, total and one line per reason (and cavity in the total view)
  const scrapTitle = (slot: number, lane?: number | null) => {
    const from = new Date(shift.start).getTime() + slot * scrapBinMs;
    const rows = new Map<string, number>();
    for (const item of scrapList || []) {
      const at = new Date(item.time).getTime();
      if (at < from || at >= from + scrapBinMs || (lane !== undefined && (item.cavity_no ?? null) !== lane)) continue;
      const label = lane === undefined && item.cavity_no != null ? `${item.reason} · K${item.cavity_no}` : item.reason;
      rows.set(label, (rows.get(label) || 0) + item.quantity);
    }
    const total = [...rows.values()].reduce((sum, quantity) => sum + quantity, 0);
    return [`${clock(new Date(from).toISOString())}–${clock(new Date(from + scrapBinMs).toISOString())} · ${number(total)} pcs declared`,
      ...[...rows].sort((a, b) => b[1] - a[1]).map(([label, quantity]) => `${label}: ${number(quantity)} pcs`)].join('\n');
  };
  // Declared scrap per shift hour, with reasons for the hover text; null when the scrap source is unavailable
  const hourScrap = (hour: { start: string; end: string }) => {
    if (!scrapList) return null;
    const from = new Date(hour.start).getTime(), to = new Date(hour.end).getTime();
    const reasons = new Map<string, number>();
    for (const item of scrapList) {
      const at = new Date(item.time).getTime();
      if (at >= from && at < to) reasons.set(item.reason, (reasons.get(item.reason) || 0) + item.quantity);
    }
    const total = [...reasons.values()].reduce((sum, quantity) => sum + quantity, 0);
    return { total, title: [`${number(total)} pcs declared`, ...[...reasons].sort((a, b) => b[1] - a[1]).map(([label, quantity]) => `${label}: ${number(quantity)} pcs`)].join('\n') };
  };
  const shiftRatePct = live.cavities?.shift_total?.reject_pct ?? null;
  const maxHourScrap = Math.max(1, ...live.hours.map(hour => hourScrap(hour)?.total ?? 0));
  let worstCavity: number | null = null, worstPct = -1;
  for (const row of cavityRows) if (row.shift_reject_pct != null && row.shift_reject_pct > worstPct) { worstCavity = row.cavity_no; worstPct = row.shift_reject_pct; }
  const reasonRows = scrapByReason.map(row => ({ ...row, byLane: lanes.map(no => laneQty(no, row.reason)) }));
  const hasObservedData = summary.cycle_count != null || summary.observed_stop_seconds != null;
  const sourceNote = live.stop_source === 'cycles'
    ? 'Stop intervals inferred from gaps between recorded machine cycles. Shift boundaries may be incomplete.'
    : live.stop_source === 'histo_events'
      ? 'Stop intervals from sampled Cyclades status events via Euromap63. Start and end times are approximate.'
      : 'Stop history is unavailable from Euromap63.';

  return <main className={`screen real-shift-screen theme-${displayTheme(data.display.theme)}`}>
    <div className="real-sticky">
    <header className="topbar"><div className="brand"><span className="brand-mark">P·E</span><span>PRODUCTION<br/>EFFICIENCY</span></div>
      <nav className="view-nav" aria-label="Display views"><a href={`/fleet${themeQuery}`}>PLANT OVERVIEW ↗</a>
      <a href={displayLink(`/display/${encodeURIComponent(data.display.id)}/hourly-new`)}>HOURLY OVERVIEW ↗</a>
      {view === 'imprint' ? <span className="selected">SHIFT IMPRINT</span>
        : <a href={displayLink(`/display/${encodeURIComponent(data.display.id)}/imprint`)}>SHIFT IMPRINT ↗</a>}</nav>
      <div className="top-status"><span className={`status-dot ${stale ? 'stale' : ''}`}></span>{stale ? 'EUROMAP63 CONNECTION LOST' : 'EUROMAP63 · RECORDED DATA'}</div>
      <div className="top-time"><span>{now.toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short' }).toUpperCase()}</span>
        <strong>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</strong></div></header>
    {stale && <div className="stale-banner">Showing last available Euromap63 data · Last successful update {updatedAt?.toLocaleTimeString() || 'unknown'} · Retrying</div>}
    <ShiftNavigator displayId={data.display.id} view={view} shift={shift} navigation={data.shift_navigation!} />
    <section className="real-summary"><div className="real-title"><div><span className="eyebrow">{view === 'hourly' ? 'HOURLY RECORDS' : 'SHIFT IMPRINT'} / {data.machine.id.toUpperCase()}</span>
      <h1>{data.machine.name}</h1><p>{live.machine_code} · {shift.name} · {clock(shift.start)}–{clock(shift.end)}</p></div></div>
    <section className="real-shift-kpis" aria-label="Recorded shift values">
      <div><span>{counter ? 'COUNTER INCREASE' : 'RECORDED CYCLES'}</span><strong>{number(summary.cycle_count)}</strong><small>{counter ? '15-minute sampled cycle counter' : 'Machine cycles, not good pieces'}</small></div>
      <div><span>OBSERVED STOPS</span><strong>{number(summary.observed_stop_count)}</strong><small>{live.stop_source === 'histo_events' ? 'Approximate timestamps' : 'Cycle-gap detection'}</small></div>
      <div><span>OBSERVED STOP TIME</span><strong>{minutes(summary.observed_stop_seconds)}</strong><small>Partial coverage possible</small></div>
    </section>
      <div className="real-head-actions">
        {canSplit && <div className="real-scrap-toggle" role="group" aria-label="Scrap display"><button type="button" aria-pressed={!splitView} onClick={() => chooseView(false)}>TOTAL</button>
          <button type="button" aria-pressed={splitView} onClick={() => chooseView(true)}>BY CAVITY</button></div>}
        {live.detail_url && <a href={live.detail_url}>EUROMAP63 MACHINE DETAIL ↗</a>}</div></section>
    </div>
    {live.current_machine && <section className="real-current-machine" aria-label="Current machine state">
      <div><span>CURRENT MACHINE STATE</span><strong>{machineState}</strong></div>
      <div><span>CURRENT ORDER</span><strong>{live.current_machine.order_ref || '—'}</strong></div>
      <div><span>ACTUAL / PLANNED CYCLE</span><strong>{seconds(live.current_machine.cycle_time_real_s)} / {seconds(live.current_machine.cycle_time_planned_s)}</strong></div>
      <div className="cavity-cell"><span>SCRAP BY CAVITY · CURRENT ORDER{live.cavities?.order_ref ? ` ${live.cavities.order_ref}` : ''}</span><CavityRates live={live} /></div>
    </section>}
    <div className="real-shift-note">{counter ? 'Cycle counts come from changes in a sampled machine counter; missing intervals and counter resets are excluded. ' : ''}{sourceNote} Good pieces, shift scrap and OEE are unavailable until a verified production source is connected.</div>
    {!hasObservedData && <div className="real-shift-empty">No cycle or stop records are available for this shift. No production quantity is inferred.</div>}
    {view === 'hourly' ? <section className="real-shift-panel"><div className="real-shift-section-head"><span className="eyebrow">01 / HOURLY VIEW</span><h2>Recorded activity by hour</h2></div>
      <div className="real-hour-heading"><span>HOUR</span><span>{counter ? 'COUNTER INCREASE' : 'RECORDED CYCLES'} / OBSERVED STOP TIME</span><span>{counter ? 'COUNT' : 'CYCLES'}</span><span>STOPS</span><span>STOP TIME</span><span>SCRAP</span></div>
      <div className="real-hours">{live.hours.map(hour => { const scrap = hourScrap(hour); return <div className="real-hour-row" key={hour.start}>
        <strong>{clock(hour.start)}–{clock(hour.end)}</strong>
        <div className="real-hour-bars"><div className="real-hour-cycle-track" aria-label={`${number(hour.cycle_count)} ${counter ? 'counter increase' : 'recorded cycles'}`}>
          {hour.cycle_count != null && <i style={{ width: `${hour.cycle_count / maxCycles * 100}%` }} />}</div>
          <div className="real-hour-stop-track" aria-label={`${minutes(hour.stop_seconds)} observed stop time`}>
            {hour.stop_seconds != null && <i style={{ width: `${Math.min(100, hour.stop_seconds / hour.elapsed_seconds * 100)}%` }} />}</div>
          {scrap && <div className="real-hour-scrap-track" title={scrap.title} aria-label={`${number(scrap.total)} pcs declared scrap`}>
            {scrap.total > 0 && <i style={{ width: `${scrap.total / maxHourScrap * 100}%` }} />}</div>}</div>
        <span>{number(hour.cycle_count)}</span><span>{number(hour.stop_count)}</span><span>{minutes(hour.stop_seconds)}</span>
        <span className="real-hour-scrap" title={scrap?.title}>{scrap ? number(scrap.total) : '—'}</span>
      </div>; })}</div>
      <p className="real-shift-help">Green: {counter ? 'sampled counter increase' : 'recorded cycle count'} relative to the busiest hour. Orange: observed stop time relative to elapsed time in that hour. Red: scrap pieces declared in that hour relative to the worst hour (pieces declared by the operator, not when they were produced). “—” means unavailable, not zero.</p>
    </section> : <section className="real-shift-panel"><div className="real-shift-section-head"><span className="eyebrow">01 / CHRONOLOGICAL VIEW</span><h2>Recorded shift imprint</h2></div>
      <div className="real-timeline-axis"><span>{clock(shift.start)}</span><span>{clock(shift.end)}</span></div>
      <div className="real-timeline-label">OBSERVED STOP INTERVALS</div>
      <div className="real-timeline-stops" aria-label="Observed stop intervals">{live.downtime_events.map((event, index) => <i key={`${event.start}-${index}`}
        style={{ left: `${position(event.start, shift.start, shift.end)}%`, width: `${Math.max(0.25, position(event.end, shift.start, shift.end) - position(event.start, shift.start, shift.end))}%` }}
        title={`${clock(event.start)}–${clock(event.end)} · ${event.reason} · ${minutes(event.seconds)}`} />)}</div>
      <div className="real-timeline-label">{counter ? 'COUNTER INCREASE / 15 MIN' : 'RECORDED CYCLES / 10 MIN'}</div>
      <div className="real-timeline-cycles" aria-label={counter ? 'Counter increase in sampled intervals' : 'Recorded cycles in ten-minute intervals'}>{live.cycle_bins.map(bin => <i key={bin.start}
        style={{ left: `${position(bin.start, shift.start, shift.end)}%`, width: `${binWidth}%`, height: `${Math.max(2, bin.count / maxBin * 100)}%` }}
        title={`${clock(bin.start)} · ${bin.count} ${counter ? 'counter increase' : 'cycles'}`} />)}</div>
      {scrapList && !splitView && <><div className="real-timeline-label">DECLARED SCRAP / {live.bin_minutes} MIN</div>
        <div className="real-timeline-scrap" aria-label="Declared scrap in time intervals">{[...scrapBins].map(([slot, quantity]) => <i key={slot}
          style={{ left: `${slot * scrapSlotWidth}%`, width: `${scrapSlotWidth}%`, height: `${Math.max(8, quantity / maxScrapBin * 100)}%` }}
          title={scrapTitle(slot)} />)}</div></>}
      {scrapList && splitView && <><div className="real-timeline-label">DECLARED SCRAP BY CAVITY / {live.bin_minutes} MIN</div>
        <div className="real-scrap-lanes">{laneData.map(lane => <div key={lane.no ?? 'unknown'} className="real-scrap-lane">
          <span className={`real-cav-tag ${lane.no === worstCavity ? 'worst' : ''}`}>{laneName(lane.no)}</span>
          <div className="real-timeline-scrap lane" aria-label={`Declared scrap, cavity ${laneName(lane.no)}`}>{[...lane.bins].map(([slot, quantity]) => <i key={slot}
            style={{ left: `${slot * scrapSlotWidth}%`, width: `${scrapSlotWidth}%`, height: `${Math.max(14, quantity / maxLaneBin * 100)}%` }}
            title={scrapTitle(slot, lane.no)} />)}</div></div>)}</div></>}
      <p className="real-shift-help">Unmarked time is not confirmed running. Bars show {counter ? 'counter changes' : 'cycles'}, not good pieces.{scrapList ? ' Scrap bars show pieces declared by the operator in that interval, not when the scrap was produced.' : ''}</p>
    </section>}
    <section className="real-shift-panel"><div className="real-shift-section-head"><span className="eyebrow">02 / STOP DETAIL</span><h2>Recorded stop reasons</h2></div>
      {live.downtime_events.length ? <div className="real-stop-list">{live.downtime_events.map((event, index) => <div key={`${event.start}-${index}`}>
        <span>{clock(event.start)}–{clock(event.end)}</span><strong>{event.reason}</strong><b>{minutes(event.seconds)}</b></div>)}</div>
        : <p className="real-shift-help">No stop intervals returned for this shift. This does not confirm uninterrupted production.</p>}</section>
    {splitView && <section className="real-shift-panel"><div className="real-shift-section-head"><span className="eyebrow">03 / CAVITIES</span><h2>Scrap by cavity{live.cavities?.order_ref ? ` · ${live.cavities.order_ref}` : ''} · {number(scrapTotal)} pcs{shiftRatePct != null ? ` · ${shiftRatePct.toFixed(2)}%` : ''}</h2></div>
      <div className="real-cav-table"><div className="real-cav-row head"><span>CAV.</span><span>PART</span><span>THIS SHIFT</span><span>SHARE</span><span>SHIFT SCRAP RATE</span></div>
        {lanes.map(no => { const row = cavityRows.find(r => r.cavity_no === no); const qty = laneQty(no);
          const share = scrapTotal > 0 ? qty / scrapTotal * 100 : 0; const over = row?.shift_reject_pct != null && row.target_pct != null && row.shift_reject_pct > row.target_pct;
          return <div className="real-cav-row" key={no ?? 'unknown'}>
            <span className={`real-cav-tag ${no === worstCavity ? 'worst' : ''}`}>{laneName(no)}</span>
            <span className="real-cav-part">{row ? <>{row.label || row.product}<small>{row.product}</small></> : <>Unassigned<small>Other order or unknown product</small></>}</span>
            <b>{number(qty)} pcs</b>
            <span className="real-cav-bar"><span className="real-bar"><i style={{ width: `${share}%` }} /></span><em>{share.toFixed(0)}%</em></span>
            <span className="real-cav-bar">{row?.shift_reject_pct != null ? <><span className="real-bar"><i className={over ? 'over' : ''} style={{ width: `${Math.min(100, row.shift_reject_pct / 20 * 100)}%` }} />
              {row.target_pct != null && <u style={{ left: `${Math.min(100, row.target_pct / 20 * 100)}%` }} />}</span><em className={over ? 'over' : ''} title={row.reject_pct != null ? `Whole order: ${row.reject_pct.toFixed(2)}%` : undefined}>{row.shift_reject_pct.toFixed(2)}%</em></> : <em>—</em>}</span>
          </div>; })}</div>
      <p className="real-shift-help">Shift scrap rate = scrap / produced pieces counted in this shift, from the Cyclades shift balance (same source as the Results by shift report); the whole-order rate is in the hover text and the marker is the target. Values end at the last operator declaration in the shift.</p>
    </section>}
    {view === 'imprint' && <section className="real-shift-panel"><div className="real-shift-section-head"><span className="eyebrow">{splitView ? '04' : '03'} / SCRAP DECLARATIONS</span><h2>Declared scrap{scrapList ? ` · ${number(scrapTotal)} pcs` : ''}</h2></div>
      {scrapList === null ? <p className="real-shift-help">Scrap declarations are unavailable from Euromap63.</p>
        : scrapList.length === 0 ? <p className="real-shift-help">No scrap was declared in this shift.</p> : <>
        {splitView ? <div className="real-scrap-matrix" style={{ gridTemplateColumns: `minmax(0,1fr) repeat(${lanes.length}, 52px) 70px` }}>
          <span className="h">REASON</span>{lanes.map(no => <span className="h" key={no ?? 'unknown'}>{laneName(no)}</span>)}<span className="h">TOTAL</span>
          {reasonRows.map(row => { const top = Math.max(...row.byLane); return <Fragment key={row.reason}>
            <strong>{row.reason}</strong>
            {row.byLane.map((qty, index) => <span key={index} className={qty && qty === top ? 'hot' : ''}>{qty || '·'}</span>)}
            <b>{number(row.quantity)}</b></Fragment>; })}</div>
        : <div className="real-scrap-reasons">{scrapByReason.map(row => <div key={row.reason}>
          <strong>{row.reason}</strong><span>{row.declarations}× declared</span><b>{number(row.quantity)} pcs</b></div>)}</div>}
        <div className={`real-scrap-list ${splitView ? 'by-cavity' : ''}`} aria-label="Individual scrap declarations">{scrapList.map((item, index) => <div key={`${item.time}-${index}`}>
          <span>{clock(item.time)}</span>{splitView && <span className={`real-cav-tag ${item.cavity_no === worstCavity ? 'worst' : ''}`}>{laneName(item.cavity_no ?? null)}</span>}
          <strong>{item.reason}</strong>{!splitView && <em>{item.product || ''}</em>}<b>{number(item.quantity)} pcs</b></div>)}</div></>}
    </section>}
    <footer><span>{data.display.name.toUpperCase()} / {shift.name.toUpperCase()}</span>
      <span>EUROMAP63 API · NO SIMULATED PRODUCTION DATA</span><span>UPDATED {updatedAt?.toLocaleTimeString() || '—'}</span></footer>
  </main>;
}
