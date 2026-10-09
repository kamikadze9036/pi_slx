import { Fragment, useState } from 'react';
import type { DashboardData } from '../types';
import { displayTheme, themeQuery } from '../theme';
import { ShiftNavigator, displayLink } from '../ShiftNavigator';
import { CavityRates, ScrapLanes, scrapByCavity } from '../CavityRates';
import { OrdersStrip } from '../OrdersStrip';
import { t, LangSwitch, locale, formatNumber } from '../i18n';

const clock = (value: string) => new Date(value).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
const number = (value: number | null) => value == null ? '—' : formatNumber(value);
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
  const machineState = live.current_machine?.state === 'bezi' ? t('RUNNING')
    : live.current_machine?.state === 'stoji' ? t('STOPPED')
      : live.current_machine?.state === 'bez_zakazky' ? t('NO ORDER') : t('UNKNOWN');
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
    return [`${clock(new Date(from).toISOString())}–${clock(new Date(from + scrapBinMs).toISOString())} · ${t('{n} pcs declared', { n: number(total) })}`,
      ...[...rows].sort((a, b) => b[1] - a[1]).map(([label, quantity]) => `${label}: ${t('{n} pcs', { n: number(quantity) })}`)].join('\n');
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
    return { total, title: [t('{n} pcs declared', { n: number(total) }), ...[...reasons].sort((a, b) => b[1] - a[1]).map(([label, quantity]) => `${label}: ${t('{n} pcs', { n: number(quantity) })}`)].join('\n') };
  };
  const shiftRatePct = live.cavities?.shift_total?.reject_pct ?? null;
  const maxHourScrap = Math.max(1, ...live.hours.map(hour => hourScrap(hour)?.total ?? 0));
  let worstCavity: number | null = null, worstPct = -1;
  for (const row of cavityRows) if (row.shift_reject_pct != null && row.shift_reject_pct > worstPct) { worstCavity = row.cavity_no; worstPct = row.shift_reject_pct; }
  const reasonRows = scrapByReason.map(row => ({ ...row, byLane: lanes.map(no => laneQty(no, row.reason)) }));
  const shiftScrap = scrapByCavity(live);
  const hasObservedData = summary.cycle_count != null || summary.observed_stop_seconds != null;

  return <main className={`screen real-shift-screen theme-${displayTheme(data.display.theme)}`}>
    <div className="real-sticky">
    <header className="topbar"><div className="brand"><span className="brand-mark">P·E</span><span>PRODUCTION<br/>EFFICIENCY</span></div>
      <nav className="view-nav" aria-label={t('Display views')}><a href={`/fleet${themeQuery}`}>{t('PLANT OVERVIEW ↗')}</a>
      <a href={displayLink(`/display/${encodeURIComponent(data.display.id)}/hourly-new`)}>{t('HOURLY OVERVIEW ↗')}</a>
      {view === 'imprint' ? <span className="selected">{t('SHIFT IMPRINT')}</span>
        : <a href={displayLink(`/display/${encodeURIComponent(data.display.id)}/imprint`)}>{t('SHIFT IMPRINT ↗')}</a>}</nav>
      <div className="top-status"><span className={`status-dot ${stale ? 'stale' : ''}`}></span>{stale ? t('EUROMAP63 CONNECTION LOST') : t('EUROMAP63 · RECORDED DATA')}</div>
      <div className="top-time"><span>{now.toLocaleDateString(locale, { weekday: 'short', day: '2-digit', month: 'short' }).toUpperCase()}</span>
        <strong>{now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false })}</strong><LangSwitch /></div></header>
    {stale && <div className="stale-banner">{t('Showing last available Euromap63 data · Last successful update {time} · Retrying', { time: updatedAt?.toLocaleTimeString(locale) || t('unknown') })}</div>}
    <ShiftNavigator displayId={data.display.id} view={view} shift={shift} navigation={data.shift_navigation!} />
    <section className="real-summary"><div className="real-title"><div><span className="eyebrow">{view === 'hourly' ? t('HOURLY RECORDS') : t('SHIFT IMPRINT')} / {data.machine.id.toUpperCase()}</span>
      <h1>{data.machine.name}</h1><p>{live.machine_code} · {shift.name} · {clock(shift.start)}–{clock(shift.end)}</p></div></div>
    <section className="real-shift-kpis scope-shift" aria-label={t('Recorded shift values')}><b className="scope-tag shift">{t('SHIFT RESULTS · {name}', { name: shift.name })}</b>
      <div><span>{counter ? t('COUNTER INCREASE') : t('RECORDED CYCLES')}</span><strong>{number(summary.cycle_count)}</strong><small>{counter ? t('15-minute sampled cycle counter') : t('Machine cycles, not good pieces')}</small></div>
      <div><span>{t('OBSERVED STOPS')}</span><strong>{number(summary.observed_stop_count)}</strong><small>{live.stop_source === 'histo_events' ? t('Approximate timestamps') : t('Cycle-gap detection')}</small></div>
      <div><span>{t('OBSERVED STOP TIME')}</span><strong>{minutes(summary.observed_stop_seconds)}</strong><small>{t('Partial coverage possible')}</small></div>
      <div className="scrap-kpi"><span>{t('SHIFT SCRAP · PCS')}</span><div className="scrap-kpi-value"><strong>{shiftScrap ? number(shiftScrap.total) : '—'}</strong>{shiftScrap && <ScrapLanes lanes={shiftScrap.lanes} />}</div><small>{t('Declared by the operator')}</small></div>
    </section>
      <div className="real-head-actions">
        {canSplit && <div className="real-scrap-toggle" role="group" aria-label={t('Scrap display')}><button type="button" aria-pressed={!splitView} onClick={() => chooseView(false)}>{t('TOTAL')}</button>
          <button type="button" aria-pressed={splitView} onClick={() => chooseView(true)}>{t('BY CAVITY')}</button></div>}
        {live.detail_url && <a href={live.detail_url}>{t('EUROMAP63 MACHINE DETAIL ↗')}</a>}</div></section>
    </div>
    {live.orders?.length ? <OrdersStrip live={live} /> : live.current_machine && <section className="real-current-machine scope-order" aria-label={t('Current machine state')}><b className="scope-tag order">{t('CURRENT ORDER')}</b>
      <div><span>{t('CURRENT MACHINE STATE')}</span><strong>{machineState}</strong></div>
      <div><span>{t('ORDER · TOOL')}</span><strong>{live.current_machine.order_ref || '—'}</strong><em className="tool-line" title={live.current_machine.tool_label || ''}>{live.current_machine.tool_ref ? `${live.current_machine.tool_ref}${live.current_machine.tool_label ? ` · ${live.current_machine.tool_label}` : ''}` : t('Tool unavailable')}</em></div>
      <div><span>{t('ACTUAL / PLANNED CYCLE')}</span><strong>{seconds(live.current_machine.cycle_time_real_s)} / {seconds(live.current_machine.cycle_time_planned_s)}</strong></div>
      <div className="cavity-cell"><span>{t('ORDER SCRAP BY CAVITY · % SINCE ORDER START')}</span><CavityRates live={live} /></div>
    </section>}
    {!hasObservedData && <div className="real-shift-empty">{t('No cycle or stop records are available for this shift. No production quantity is inferred.')}</div>}
    {view === 'hourly' ? <section className="real-shift-panel"><div className="real-shift-section-head"><span className="eyebrow">{t('01 / HOURLY VIEW')}</span><h2>{t('Recorded activity by hour')}</h2></div>
      <div className="real-hour-heading"><span>{t('HOUR')}</span><span>{counter ? t('COUNTER INCREASE') : t('RECORDED CYCLES')} / {t('OBSERVED STOP TIME')}</span><span>{counter ? t('COUNT') : t('CYCLES')}</span><span>{t('STOPS')}</span><span>{t('STOP TIME')}</span><span>{t('SCRAP')}</span></div>
      <div className="real-hours">{live.hours.map(hour => { const scrap = hourScrap(hour); return <div className="real-hour-row" key={hour.start}>
        <strong>{clock(hour.start)}–{clock(hour.end)}</strong>
        <div className="real-hour-bars"><div className="real-hour-cycle-track" aria-label={t(counter ? '{n} counter increase' : '{n} recorded cycles', { n: number(hour.cycle_count) })}>
          {hour.cycle_count != null && <i style={{ width: `${hour.cycle_count / maxCycles * 100}%` }} />}</div>
          <div className="real-hour-stop-track" aria-label={t('{time} observed stop time', { time: minutes(hour.stop_seconds) })}>
            {hour.stop_seconds != null && <i style={{ width: `${Math.min(100, hour.stop_seconds / hour.elapsed_seconds * 100)}%` }} />}</div>
          {scrap && <div className="real-hour-scrap-track" title={scrap.title} aria-label={t('{n} pcs declared scrap', { n: number(scrap.total) })}>
            {scrap.total > 0 && <i style={{ width: `${scrap.total / maxHourScrap * 100}%` }} />}</div>}</div>
        <span>{number(hour.cycle_count)}</span><span>{number(hour.stop_count)}</span><span>{minutes(hour.stop_seconds)}</span>
        <span className="real-hour-scrap" title={scrap?.title}>{scrap ? number(scrap.total) : '—'}</span>
      </div>; })}</div>
      <p className="real-shift-help">{t('HELP_HOURLY', { what: counter ? t('sampled counter increase') : t('recorded cycle count') })}</p>
    </section> : <section className="real-shift-panel"><div className="real-shift-section-head"><span className="eyebrow">{t('01 / CHRONOLOGICAL VIEW')}</span><h2>{t('Recorded shift imprint')}</h2></div>
      <div className="real-timeline-axis"><span>{clock(shift.start)}</span><span>{clock(shift.end)}</span></div>
      <div className="real-timeline-label">{t('OBSERVED STOP INTERVALS')}</div>
      <div className="real-timeline-stops" aria-label={t('Observed stop intervals')}>{live.downtime_events.map((event, index) => <i key={`${event.start}-${index}`}
        style={{ left: `${position(event.start, shift.start, shift.end)}%`, width: `${Math.max(0.25, position(event.end, shift.start, shift.end) - position(event.start, shift.start, shift.end))}%` }}
        title={`${clock(event.start)}–${clock(event.end)} · ${event.reason} · ${minutes(event.seconds)}`} />)}</div>
      <div className="real-timeline-label">{counter ? t('COUNTER INCREASE / 15 MIN') : t('RECORDED CYCLES / 10 MIN')}</div>
      <div className="real-timeline-cycles" aria-label={counter ? t('Counter increase in sampled intervals') : t('Recorded cycles in ten-minute intervals')}>{live.cycle_bins.map(bin => <i key={bin.start}
        style={{ left: `${position(bin.start, shift.start, shift.end)}%`, width: `${binWidth}%`, height: `${Math.max(2, bin.count / maxBin * 100)}%` }}
        title={t(counter ? '{time} · {n} counter increase' : '{time} · {n} cycles', { time: clock(bin.start), n: bin.count })} />)}</div>
      {scrapList && !splitView && <><div className="real-timeline-label">{t('DECLARED SCRAP / {n} MIN', { n: live.bin_minutes })}</div>
        <div className="real-timeline-scrap" aria-label={t('Declared scrap in time intervals')}>{[...scrapBins].map(([slot, quantity]) => <i key={slot}
          style={{ left: `${slot * scrapSlotWidth}%`, width: `${scrapSlotWidth}%`, height: `${Math.max(8, quantity / maxScrapBin * 100)}%` }}
          title={scrapTitle(slot)} />)}</div></>}
      {scrapList && splitView && <><div className="real-timeline-label">{t('DECLARED SCRAP BY CAVITY / {n} MIN', { n: live.bin_minutes })}</div>
        <div className="real-scrap-lanes">{laneData.map(lane => <div key={lane.no ?? 'unknown'} className="real-scrap-lane">
          <div className="lane-head"><span className={`real-cav-tag ${lane.no === worstCavity ? 'worst' : ''}`}>{laneName(lane.no)}</span><em className="lane-total">{t('{n} pcs', { n: number(laneQty(lane.no)) })}</em></div>
          <div className="real-timeline-scrap lane" aria-label={t('Declared scrap, cavity {lane}', { lane: laneName(lane.no) })}>{[...lane.bins].map(([slot, quantity]) => <i key={slot}
            style={{ left: `${slot * scrapSlotWidth}%`, width: `${scrapSlotWidth}%`, height: `${Math.max(8, quantity / maxScrapBin * 100)}%` }}
            title={scrapTitle(slot, lane.no)} />)}</div></div>)}</div></>}
      <p className="real-shift-help">{t('HELP_IMPRINT', { what: counter ? t('counter changes') : t('cycles') })}{scrapList ? t('HELP_IMPRINT_SCRAP') : ''}</p>
    </section>}
    <section className="real-shift-panel"><div className="real-shift-section-head"><span className="eyebrow">{t('02 / STOP DETAIL')}</span><h2>{t('Recorded stop reasons')}</h2></div>
      {live.downtime_events.length ? <div className="real-stop-list">{live.downtime_events.map((event, index) => <div key={`${event.start}-${index}`}>
        <span>{clock(event.start)}–{clock(event.end)}</span><strong>{event.reason}</strong><b>{minutes(event.seconds)}</b></div>)}</div>
        : <p className="real-shift-help">{t('No stop intervals returned for this shift. This does not confirm uninterrupted production.')}</p>}</section>
    {splitView && <section className="real-shift-panel"><div className="real-shift-section-head"><span className="eyebrow">{t('03 / CAVITIES')}</span><h2>{t('Scrap by cavity')}{live.cavities?.order_ref ? ` · ${live.cavities.order_ref}` : ''} · {t('{n} pcs', { n: number(scrapTotal) })}{shiftRatePct != null ? ` · ${shiftRatePct.toFixed(2)}%` : ''}</h2></div>
      <div className="real-cav-table"><div className="real-cav-row head"><span>{t('CAV.')}</span><span>{t('PART')}</span><span>{t('THIS SHIFT')}</span><span>{t('SHARE')}</span><span>{t('SHIFT SCRAP RATE')}</span></div>
        {lanes.map(no => { const row = cavityRows.find(r => r.cavity_no === no); const qty = laneQty(no);
          const share = scrapTotal > 0 ? qty / scrapTotal * 100 : 0; const over = row?.shift_reject_pct != null && row.target_pct != null && row.shift_reject_pct > row.target_pct;
          return <div className="real-cav-row" key={no ?? 'unknown'}>
            <span className={`real-cav-tag ${no === worstCavity ? 'worst' : ''}`}>{laneName(no)}</span>
            <span className="real-cav-part">{row ? <>{row.label || row.product}<small>{row.product}</small></> : <>{t('Unassigned')}<small>{t('Other order or unknown product')}</small></>}</span>
            <b>{t('{n} pcs', { n: number(qty) })}</b>
            <span className="real-cav-bar"><span className="real-bar"><i style={{ width: `${share}%` }} /></span><em>{share.toFixed(0)}%</em></span>
            <span className="real-cav-bar">{row?.shift_reject_pct != null ? <><span className="real-bar"><i className={over ? 'over' : ''} style={{ width: `${Math.min(100, row.shift_reject_pct / 20 * 100)}%` }} />
              {row.target_pct != null && <u style={{ left: `${Math.min(100, row.target_pct / 20 * 100)}%` }} />}</span><em className={over ? 'over' : ''} title={row.reject_pct != null ? t('Whole order: {pct}', { pct: `${row.reject_pct.toFixed(2)}%` }) : undefined}>{row.shift_reject_pct.toFixed(2)}%</em></> : <em>—</em>}</span>
          </div>; })}
        <div className="real-cav-row total"><span className="real-cav-tag">Σ</span><span className="real-cav-part">{t('Total, all cavities')}</span><b>{t('{n} pcs', { n: number(scrapTotal) })}</b>
          <span className="real-cav-bar"><em>100%</em></span><span className="real-cav-bar"><em>{shiftRatePct != null ? `${shiftRatePct.toFixed(2)}%` : '—'}</em></span></div></div>
      <p className="real-shift-help">{t('HELP_CAVITIES')}</p>
    </section>}
    {view === 'imprint' && <section className="real-shift-panel"><div className="real-shift-section-head"><span className="eyebrow">{splitView ? '04' : '03'} / {t('SCRAP DECLARATIONS')}</span><h2>{t('Declared scrap')}{scrapList ? ` · ${t('{n} pcs', { n: number(scrapTotal) })}` : ''}</h2></div>
      {scrapList === null ? <p className="real-shift-help">{t('Scrap declarations are unavailable from Euromap63.')}</p>
        : scrapList.length === 0 ? <p className="real-shift-help">{t('No scrap was declared in this shift.')}</p> : <>
        {splitView ? <div className="real-scrap-matrix" style={{ gridTemplateColumns: `minmax(0,1fr) repeat(${lanes.length}, 52px) 70px` }}>
          <span className="h">{t('REASON')}</span>{lanes.map(no => <span className="h" key={no ?? 'unknown'}>{laneName(no)}</span>)}<span className="h">{t('TOTAL')}</span>
          {reasonRows.map(row => { const top = Math.max(...row.byLane); return <Fragment key={row.reason}>
            <strong>{row.reason}</strong>
            {row.byLane.map((qty, index) => <span key={index} className={qty && qty === top ? 'hot' : ''}>{qty || '·'}</span>)}
            <b>{number(row.quantity)}</b></Fragment>; })}
          <strong className="total">{t('TOTAL')}</strong>{lanes.map(no => <span key={no ?? 'unknown'} className="total">{laneQty(no) || '·'}</span>)}<b className="total">{number(scrapTotal)}</b></div>
        : <div className="real-scrap-reasons">{scrapByReason.map(row => <div key={row.reason}>
          <strong>{row.reason}</strong><span>{t('{n}× declared', { n: row.declarations })}</span><b>{t('{n} pcs', { n: number(row.quantity) })}</b></div>)}</div>}
        <div className={`real-scrap-list ${splitView ? 'by-cavity' : ''}`} aria-label={t('Individual scrap declarations')}>{scrapList.map((item, index) => <div key={`${item.time}-${index}`}>
          <span>{clock(item.time)}</span>{splitView && <span className={`real-cav-tag ${item.cavity_no === worstCavity ? 'worst' : ''}`}>{laneName(item.cavity_no ?? null)}</span>}
          <strong>{item.reason}</strong>{!splitView && <em>{item.product || ''}</em>}<b>{t('{n} pcs', { n: number(item.quantity) })}</b></div>)}</div></>}
    </section>}
    <footer><span>{data.display.name.toUpperCase()} / {shift.name.toUpperCase()}</span>
      <span>{t('EUROMAP63 API · NO SIMULATED PRODUCTION DATA')}</span><span>{t('UPDATED {time}', { time: updatedAt?.toLocaleTimeString(locale) || '—' })}</span></footer>
  </main>;
}
