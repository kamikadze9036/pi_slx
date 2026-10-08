import { Fragment, useState, type CSSProperties } from 'react';
import type { ImprintData } from '../types';
import { displayTheme, themeQuery } from '../theme';
import { ShiftNavigator, displayLink } from '../ShiftNavigator';
import { CavityRates, ScrapLanes, scrapByCavity } from '../CavityRates';
import { OrdersStrip } from '../OrdersStrip';
import { useHourUnit, type HourUnit } from '../HourUnit';
import { buildOverviewHours, buildOverviewTotal, compositionOrder, hourClock, hourDetailSummary, hourDuration, hourNumber, hourStopTime,
  overviewHeadline, type OverviewHour } from '../hourly-model';

function Gauge({ value, text, tone = 'good', caption, label }: {
  value: number | null; text: string; tone?: string; caption: string; label: string;
}) {
  return <div className={`overview-gauge ${tone}`} aria-label={label}>
    <div className="overview-ring" style={{ '--progress': `${Math.max(0, Math.min(1, value ?? 0)) * 100}%` } as CSSProperties}>
      <strong>{text}</strong>
    </div><small>{caption}</small>
  </div>;
}

function RecordedActivity({ row, maxCycles, maxScrap }: { row: OverviewHour; maxCycles: number; maxScrap: number }) {
  const tracks = [
    { key: 'good', label: 'CYCLES / COUNT', value: row.count, max: row.total ? Math.max(1, row.count ?? 0) : maxCycles, text: hourNumber(row.count) },
    { key: 'downtime', label: 'STOP TIME', value: row.stopSeconds, max: Math.max(1, row.elapsed), text: hourStopTime(row.stopSeconds) },
    { key: 'scrap', label: 'DECLARED SCRAP', value: row.scrap, max: row.total ? Math.max(1, row.scrap ?? 0) : maxScrap, text: `${hourNumber(row.scrap)} pcs` },
  ];
  return <div className="overview-recorded-bars">{tracks.map(track => <div key={track.key}>
    <span>{track.label}<b>{track.text}</b></span>
    <div className="overview-activity-track" aria-label={`${track.label}: ${track.text}`}>
      {track.value != null && <i className={track.key} style={{ width: `${Math.max(0, Math.min(100, track.value / track.max * 100))}%` }} />}
    </div>
  </div>)}</div>;
}

function OverviewRow({ row, data, unit, maxCycles, maxScrap }: { row: OverviewHour; data: ImprintData; unit: HourUnit; maxCycles: number; maxScrap: number }) {
  const [expanded, setExpanded] = useState(false);
  const live = !!data.live_shift;
  const details = hourDetailSummary(row, live, unit);
  const total = Math.max(1, row.segments.reduce((sum, segment) => sum + segment.value, 0));
  const metrics = row.metrics;
  // Without verified production metrics the recorded activity bars and count/stop gauges stay as in the original view.
  const recorded = live && !metrics?.composition;
  const delta = metrics?.cycle?.delta_seconds ?? null;
  const cycleText = delta == null ? '—' : `${delta > 0 ? '+' : ''}${hourNumber(Math.round(delta * 10) / 10)}s`;
  const ratio = metrics?.efficiency?.ratio ?? null;
  const efficiencyText = ratio == null ? '—' : `${Math.round(ratio * 100)}%`;
  const unavailable = metrics?.quality.missing_inputs.join(' · ') || (row.future ? 'Hour has not started' : 'Unavailable');
  const inconsistent = metrics?.quality.status === 'inconsistent';
  const sourceOrder = data.production?.order ?? (row.total ? data.live_shift?.cavities?.order_ref : null);
  const detailId = `hour-detail-${row.id.replace(/[^a-zA-Z0-9]/g, '')}`;
  return <Fragment>
    <tr className={`${row.current ? 'overview-current' : ''} ${row.future ? 'overview-future' : ''} ${row.total ? 'overview-total' : ''}`}>
      <td className="overview-job"><span title={sourceOrder ?? 'Order for this hour is unavailable'}>{sourceOrder ?? '—'}</span></td>
      <th scope="row" className="overview-hour">
        <strong>{row.total ? 'Total' : `${hourClock(row.start)}–${hourClock(row.end)}`}</strong>
        <span>{row.total ? `${hourClock(row.start)}–${hourClock(row.end)}` : data.machine.name}</span>
        {row.current && <small className="overview-live-tag">CURRENT HOUR</small>}
        {row.future && <small>FUTURE HOUR</small>}
        {!row.future && <button type="button" aria-expanded={expanded} aria-controls={detailId} onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Hide details −' : 'Hour details +'}</button>}
      </th>
      <td className="overview-composition">{recorded ? <RecordedActivity row={row} maxCycles={maxCycles} maxScrap={maxScrap} /> : <div className="overview-stack" aria-label={`Output and losses ${row.total ? 'shift' : hourClock(row.start)} in ${unit === 'minutes' ? 'minutes' : 'pieces'}`}>
        {row.segments.map(segment => <div key={segment.key} className={`overview-segment ${segment.key}`}
          style={{ width: `${segment.value / total * 100}%` }} title={`${segment.label}: ${unit === 'minutes' ? hourDuration(segment.value * 60) : `${hourNumber(segment.value)} ${['good', 'scrap'].includes(segment.key) ? 'pcs' : 'pcs eq.'}`}`}>
          <span>{hourNumber(Math.round(segment.value * 10) / 10)}</span>
        </div>)}
        {row.segments.length === 0 && <span className="overview-no-composition">Breakdown unavailable</span>}
      </div>}</td>
      <td>{recorded ? <div className="overview-record-count"><Gauge value={row.count == null ? null : row.total ? Number(row.count > 0) : row.count / maxCycles} text={hourNumber(row.count)}
        caption={data.live_shift?.cycle_source === 'counter' ? 'Counter increase' : 'Recorded cycles'} label={`Recorded count ${hourNumber(row.count)}`} /></div> : <Gauge value={ratio} text={efficiencyText} tone={ratio == null ? 'unknown' : inconsistent ? 'scrap' : ratio < (data.display_settings?.oee_warning_threshold ?? 0.7) ? 'warning' : 'good'}
        caption={metrics?.capacity?.ideal_capacity != null ? `${metrics.production?.count_basis === 'estimated' ? '~' : ''}${hourNumber(metrics.production?.good_count ?? null)} / ${hourNumber(Math.round(metrics.capacity.ideal_capacity * 10) / 10)} pcs${metrics.production?.count_basis === 'estimated' ? ' · est.' : ''}${ratio != null && ratio > 1 ? ' · above 100%' : ''}` : unavailable}
        label={`Output efficiency ${efficiencyText}`} />}</td>
      <td>{recorded ? <div className="overview-stop-value"><Gauge value={row.stopSeconds == null ? null : row.stopSeconds / Math.max(1, row.elapsed)} text={row.stopSeconds == null ? '—' : `${Math.round(row.stopSeconds / 60)}m`} tone="warning"
        caption={`${hourNumber(row.stopCount)} ${row.stopCount === 1 ? 'stop' : 'stops'}`} label={`Observed stops ${hourNumber(row.stopCount)}, stop time ${hourStopTime(row.stopSeconds)}`} /></div> : <Gauge value={delta == null ? null : 1} text={cycleText} tone={delta == null ? 'unknown' : delta > 0 ? 'scrap' : 'good'}
        caption={delta == null ? 'No verified cycle' : `${hourNumber(Math.round(metrics!.cycle!.actual_seconds! * 10) / 10)} / ${hourNumber(metrics!.cycle!.ideal_seconds)} s`}
        label={delta == null ? 'Cycle time unavailable' : `Calculated cycle ${metrics!.cycle!.actual_seconds} seconds, ideal ${metrics!.cycle!.ideal_seconds} seconds`} />}</td>
      <td className="overview-reasons" colSpan={3}>
        <div className="overview-detail-grid">
          {details.length ? details.map((detail, index) => <Fragment key={`${detail.key}-${detail.reason}-${index}`}>
            <span className="overview-type"><i className={detail.key} /><span>{detail.label}, <b>{detail.amount}</b></span></span>
            <span className="overview-reason" title={detail.reason}>{detail.reason}</span>
            <span className="overview-comment" title="Source comment">{detail.comment || '—'}</span>
          </Fragment>) : <span className="overview-row-empty">{row.future ? 'Hour has not started' : 'Detailed breakdown unavailable'}</span>}
        </div>
        {!row.future && <div className="overview-row-figures">
          <span>{live ? data.live_shift?.cycle_source === 'counter' ? 'Counter increase' : 'Recorded cycles' : 'OK pieces'} <b>{hourNumber(row.count)}</b></span>
          <span>{live ? 'Declared scrap' : 'Scrap'} <b className="overview-scrap-count">{hourNumber(row.scrap)} pcs</b></span>
          {live && <span>Observed stops <b className="overview-stop-count">{hourNumber(row.stopCount)}</b> · <b className="overview-stop-time">{hourStopTime(row.stopSeconds)}</b></span>}
          {metrics?.capacity?.recoverable_output != null && <span>Recoverable output <b>+{hourNumber(Math.round(metrics.capacity.recoverable_output * 10) / 10)} pcs</b></span>}
          {row.current && <span>Elapsed <b>{hourDuration(row.elapsed)}</b></span>}
        </div>}
      </td>
    </tr>
    {expanded && <tr className="overview-expanded"><td colSpan={8}><div id={detailId}>
      <h3>{row.total ? 'Shift events' : `Events ${hourClock(row.start)}–${hourClock(row.end)}`}</h3>
      {row.details.length ? <table className="overview-event-table"><thead><tr><th>TIME</th><th>TYPE</th><th>REASON</th><th>QUANTITY / DURATION</th><th>CAVITY</th><th>COMMENT</th></tr></thead>
        <tbody>{row.details.map((detail, index) => <tr key={index}><td>{detail.start && hourClock(detail.start)}{detail.end && `–${hourClock(detail.end)}`}</td>
          <td><i className={`overview-event-dot ${detail.key}`} />{detail.label}</td><td>{detail.reason}</td><td>{detail.amount}</td><td>{detail.cavity != null ? `K${detail.cavity}` : '—'}</td><td>{detail.comment || '—'}</td></tr>)}</tbody></table>
        : <p>No individual events are available for this hour.</p>}
      {row.warnings.length > 0 && <p>Data quality: {row.warnings.join(', ')}</p>}
    </div></td></tr>}
  </Fragment>;
}

export function HourlyOverview({ data, offline, updatedAt, now }: {
  data: ImprintData; offline: boolean; updatedAt: Date | null; now: Date;
}) {
  const [storedUnit, chooseUnit] = useHourUnit('hourly-new-unit');
  const [search, setSearch] = useState('');
  const live = !!data.live_shift;
  const piecesAvailable = !!data.overview?.total.composition;
  const unit = piecesAvailable ? storedUnit : 'minutes';
  const rows = buildOverviewHours(data, unit);
  const total = buildOverviewTotal(data, rows, unit);
  const headline = overviewHeadline(total);
  const maxCycles = Math.max(1, ...rows.map(row => row.count ?? 0));
  const maxScrap = Math.max(1, ...rows.map(row => row.scrap ?? 0));
  const pcs = (value: number | null) => value == null ? '—' : `${hourNumber(Math.round(value * 10) / 10)} pcs`;
  const query = search.trim().toLocaleLowerCase('en-US');
  const filtered = rows.filter(row => [hourClock(row.start), hourClock(row.end), data.machine.name, data.production?.order,
    ...row.details.map(detail => detail.reason), ...row.segments.map(segment => segment.label)].join(' ').toLocaleLowerCase('en-US').includes(query));
  const stopEvents = data.live_shift?.downtime_events ?? data.downtime_events ?? [];
  const stopTotalSeconds = stopEvents.reduce((sum, event) => sum + event.seconds, 0);
  const cyclades = data.live_shift?.cyclades_shift ?? null;
  const shiftScrap = data.live_shift ? scrapByCavity(data.live_shift) : null;
  const stale = offline || data.status === 'stale';
  return <main className={`screen hourly-overview theme-${displayTheme(data.display.theme)}`}>
    <div className="overview-sticky">
      <header className="topbar"><div className="brand"><span className="brand-mark">P·E</span><span>PRODUCTION<br />EFFICIENCY</span></div>
        <nav className="view-nav" aria-label="Display views"><a href={`/fleet${themeQuery}`}>PLANT OVERVIEW ↗</a><span className="selected">HOURLY OVERVIEW</span>
          <a href={displayLink(`/display/${encodeURIComponent(data.display.id)}/imprint`)}>SHIFT IMPRINT ↗</a></nav>
        <div className="top-status"><span className={`status-dot ${stale ? 'stale' : ''}`} />{stale ? 'DATA CONNECTION LOST' : live ? 'EUROMAP63' : data.data_source === 'mock' ? 'SIMULATED DATA' : 'CICLADES'}</div>
        <div className="top-time"><span>{now.toLocaleDateString('en-US', { timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric' })}</span><strong>{hourClock(now.toISOString())}</strong></div>
      </header>
      {stale && <div className="stale-banner" role="status">Showing last available data · Updated {updatedAt ? hourClock(updatedAt.toISOString()) : '—'} · Retrying</div>}
      <ShiftNavigator displayId={data.display.id} view="hourly-new" shift={data.shift!} navigation={data.shift_navigation!} />
      <section className="overview-toolbar"><div><h1>{data.machine.name}</h1><p>{data.production?.product || data.live_shift?.machine_code || data.display.name}
        {data.production?.order && ` · ${data.production.order}`}</p></div>
        <div className="overview-controls"><label className="overview-search"><span>⌕</span><input type="search" aria-label="Search hour or reason" placeholder="Search hour or reason…" value={search} onChange={event => setSearch(event.target.value)} /></label>
          <div className="hour-unit-toggle" role="group" aria-label="Hourly breakdown unit">
            <button type="button" aria-pressed={unit === 'minutes'} className={unit === 'minutes' ? 'active' : ''} onClick={() => chooseUnit('minutes')}>MINUTES</button>
            <button type="button" aria-pressed={unit === 'pieces'} className={unit === 'pieces' ? 'active' : ''} disabled={!piecesAvailable} title={piecesAvailable ? 'Loss equivalents calculated from the ideal cycle' : 'Verified hourly OK-piece counts are unavailable'} onClick={() => chooseUnit('pieces')}>PIECES</button>
          </div></div></section>
    </div>
    <h2 className="scope-heading shift">SHIFT RESULTS <span>{data.shift!.name} · {hourClock(data.shift!.start)}–{hourClock(data.shift!.end)}</span></h2>
    <section className="overview-live-kpis overview-shift-ribbon" aria-label="Shift results">
      <div title={headline.estimated ? 'Interpolated from carton declarations; hours without full declaration coverage are excluded' : undefined}><span>OK PIECES{headline.estimated ? ' · EST.' : ''}</span><strong>{pcs(headline.ok)}</strong>{headline.estimated && headline.coverage && <small>est. · {headline.coverage.hours_covered} / {headline.coverage.hours_total} hours</small>}</div>
      <div title="OK + scrap + stopped time recovered at the achieved running rate. A calculated counterfactual, not a measured count."><span>WITHOUT SCRAP / STOPS</span><strong>{pcs(headline.withoutLosses)}</strong></div>
      <div><span>RECOVERABLE OUTPUT</span><strong>{headline.recoverable == null ? '—' : `+${pcs(headline.recoverable)}`}</strong></div>
      <div title="Planned production time at the ideal cycle"><span>IDEAL CAPACITY</span><strong>{pcs(headline.idealCapacity)}</strong></div>
      <div><span>{data.live_shift?.cycle_source === 'counter' ? 'COUNTER INCREASE' : live ? 'RECORDED CYCLES' : 'RECORDED COUNT'}</span><strong>{hourNumber(total.count)}</strong></div>
      <div><span>OBSERVED STOPS</span><strong>{hourNumber(total.stopCount)}</strong></div>
      <div><span>OBSERVED STOP TIME</span><strong>{hourStopTime(total.stopSeconds)}</strong></div>
      <div className="scrap-kpi"><span>SHIFT SCRAP</span><div className="scrap-kpi-value"><strong>{hourNumber(total.scrap)} pcs</strong>{shiftScrap && <ScrapLanes lanes={shiftScrap.lanes} />}</div></div>
    </section>
    {cyclades && <p className="overview-cyclades" title="Cyclades books pieces that were made but not yet declared as OK or scrap (a carton is declared when full) as delta scrap, and the figure changes again once the carton is declared.">
      <span>CYCLADES SHIFT · DECLARED UP TO {hourClock(cyclades.as_of)}</span>
      <span>OK <b>{hourNumber(cyclades.ok)}</b></span><span>SCRAP <b>{hourNumber(cyclades.scrap)}</b></span>
      <span>UNDECLARED (Δ SCRAP) <b>{hourNumber(cyclades.delta_scrap)}</b></span><span>MADE <b>{hourNumber(cyclades.made)}</b></span>
      {headline.estimated && headline.coverage && <span className="overview-cyclades-estimate">OUR ESTIMATE · {headline.coverage.hours_covered}/{headline.coverage.hours_total} H <b>~{hourNumber(Math.round(headline.ok ?? 0))}</b> OK</span>}</p>}
    {live && data.live_shift?.orders?.length ? <>
      <h2 className="scope-heading order">{data.live_shift.orders.length > 1 ? 'ORDERS IN THIS SHIFT' : 'ORDER IN THIS SHIFT'} <span>{data.live_shift.orders.map(order => order.order_ref).join(' → ')}</span>{data.live_shift.detail_url && <a className="scope-link" href={data.live_shift.detail_url}>Machine detail ↗</a>}</h2>
      <OrdersStrip live={data.live_shift} /></> : live && data.live_shift?.current_machine ? <><h2 className="scope-heading order">CURRENT ORDER <span>{data.live_shift.current_machine.order_ref || '—'}{data.live_shift.current_machine.tool_ref ? ` · tool ${data.live_shift.current_machine.tool_ref}${data.live_shift.current_machine.tool_label ? ` · ${data.live_shift.current_machine.tool_label}` : ''}` : ''}</span></h2>
    <div className="overview-current-state">
      <span>CURRENT MACHINE STATE · <b>{data.live_shift.current_machine.state === 'bezi' ? 'RUNNING' : data.live_shift.current_machine.state === 'stoji' ? 'STOPPED' : data.live_shift.current_machine.state === 'bez_zakazky' ? 'NO ORDER' : 'UNKNOWN'}</b></span>
      <span>CURRENT ORDER · <b>{data.live_shift.current_machine.order_ref || '—'}</b></span>
      <span>ACTUAL / PLANNED CYCLE · <b>{hourNumber(data.live_shift.current_machine.cycle_time_real_s ?? null)} / {hourNumber(data.live_shift.current_machine.cycle_time_planned_s ?? null)} s</b></span>
      <span className="cavity-cell">ORDER SCRAP BY CAVITY · % · <CavityRates live={data.live_shift} /></span>
      {data.live_shift.detail_url && <a href={data.live_shift.detail_url}>Machine detail ↗</a>}</div></> : null}

    <div className="overview-table-scroll" role="region" aria-label="Hourly production overview" tabIndex={0}>
      <table className="overview-table"><colgroup><col className="col-job" /><col className="col-hour" /><col className="col-bar" /><col className="col-gauge" /><col className="col-gauge" /><col className="col-type" /><col className="col-reason" /><col className="col-comment" /></colgroup>
        <thead><tr><th>ORDER</th><th>HOUR / MACHINE</th>{piecesAvailable || !live ? <><th>OUTPUT / LOSSES<small>{unit === 'minutes' ? 'MINUTES' : 'PIECES / EQ.'}</small></th><th>OUTPUT EFFICIENCY<small>OK / IDEAL CAPACITY</small></th><th>CYCLE<small>ACTUAL / IDEAL</small></th></> : <><th>RECORDED ACTIVITY</th><th>{data.live_shift?.cycle_source === 'counter' ? 'COUNT' : 'CYCLES'}</th><th>STOPS<small>OBSERVED STOP TIME</small></th></>}<th>TYPE</th><th>REASON</th><th>COMMENT</th></tr></thead>
        <tbody>{filtered.map(row => <OverviewRow key={`${data.machine.id}-${row.id}`} row={row} data={data} unit={unit} maxCycles={maxCycles} maxScrap={maxScrap} />)}
          {filtered.length === 0 && <tr><td className="overview-no-results" colSpan={8}>No hours match this search. <button type="button" onClick={() => setSearch('')}>Clear search</button></td></tr>}
          <OverviewRow key={`${data.machine.id}-${data.shift!.start}-total`} row={total} data={data} unit={unit} maxCycles={maxCycles} maxScrap={maxScrap} /></tbody>
      </table>
    </div>
    <section className="overview-stops" aria-label="Recorded stop reasons">
      <div className="overview-stops-head"><div><span className="overview-stops-eyebrow">STOP DETAIL</span><h2>Recorded stop reasons</h2></div>
        <div className="overview-stops-total"><span>TOTAL</span><strong>{stopEvents.length} {stopEvents.length === 1 ? 'stop' : 'stops'} · {hourDuration(stopTotalSeconds)}</strong></div></div>
      {stopEvents.length ? <div className="overview-stop-list">{stopEvents.map((event, index) => <div key={`${event.start}-${index}`}>
        <span>{hourClock(event.start)}–{hourClock(event.end)}</span><strong title={event.reason}>{event.reason}</strong><em title={event.comment || ''}>{event.comment || ''}</em><b>{hourDuration(event.seconds)}</b></div>)}</div>
        : <p className="overview-stops-empty">No stop intervals returned for this shift. This does not confirm uninterrupted production.</p>}
    </section>
    <div className="overview-legend">{(piecesAvailable ? [...compositionOrder] : live ? [{ key: 'good', label: data.live_shift?.cycle_source === 'counter' ? 'Counter increase' : 'Recorded cycles' }, { key: 'downtime', label: 'Observed stop time' }, { key: 'scrap', label: 'Declared scrap' }] : [compositionOrder[2], { key: 'unknown', label: 'Unverified time' }]).map(category =>
      <span key={category.key}><i className={category.key} />{category.label}</span>)}{unit === 'minutes' && piecesAvailable && <span><i className="future" />Future time</span>}</div>
    <p className="overview-note">Output / losses share one scale per hour: OK pieces and scrap use ideal-cycle time, stops use observed duration, slow running is the remaining planned time; in pieces mode time losses are ideal-rate equivalents. Without scrap / stops = OK + scrap + stopped time recovered at the achieved running rate (a calculated counterfactual, not a measurement); ideal capacity is planned time at the ideal cycle. Efficiency is output / ideal capacity and is labelled OEE only when its inputs are verified; values above 100% are kept as calculated. {live ? 'Recorded cycles are not OK pieces; unmarked time does not confirm running. ' : ''}“—” means unavailable, not zero. The total covers the full shift even while searching.{headline.estimated ? ' OK pieces marked est. are interpolated between carton declarations (a carton is declared when full), so single hours are approximate; hours without full declaration coverage show “—”.' : ''}</p>
    <footer><span>{data.display.name} / {data.shift!.name}</span><span>{filtered.length} / {rows.length} HOURS</span><span>UPDATED {updatedAt ? hourClock(updatedAt.toISOString()) : '—'}</span></footer>
  </main>;
}
