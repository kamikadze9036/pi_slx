import { Fragment, useState, type CSSProperties } from 'react';
import type { ImprintData } from '../types';
import { displayTheme, themeQuery } from '../theme';
import { ShiftNavigator, displayLink } from '../ShiftNavigator';
import { CavityRates, ScrapLanes, scrapByCavity } from '../CavityRates';
import { OrdersStrip } from '../OrdersStrip';
import { t, LangSwitch, locale } from '../i18n';
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
    { key: 'good', label: t('CYCLES / COUNT'), value: row.count, max: row.total ? Math.max(1, row.count ?? 0) : maxCycles, text: hourNumber(row.count) },
    { key: 'downtime', label: t('STOP TIME'), value: row.stopSeconds, max: Math.max(1, row.elapsed), text: hourStopTime(row.stopSeconds) },
    { key: 'scrap', label: t('DECLARED SCRAP'), value: row.scrap, max: row.total ? Math.max(1, row.scrap ?? 0) : maxScrap, text: `${hourNumber(row.scrap)} ${t('pcs')}` },
  ];
  return <div className="overview-recorded-bars">{tracks.map(track => <div key={track.key}>
    <span>{track.label}<b>{track.text}</b></span>
    <div className="overview-activity-track" aria-label={`${track.label}: ${track.text}`}>
      {track.value != null && <i className={track.key} style={{ width: `${Math.max(0, Math.min(100, track.value / track.max * 100))}%` }} />}
    </div>
  </div>)}</div>;
}

function OverviewRow({ row, data, unit, maxCycles, maxScrap, recordedMode }: { row: OverviewHour; data: ImprintData; unit: HourUnit; maxCycles: number; maxScrap: number; recordedMode: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const live = !!data.live_shift;
  const details = hourDetailSummary(row, live, unit);
  const total = Math.max(1, row.segments.reduce((sum, segment) => sum + segment.value, 0));
  const metrics = row.metrics;
  // Without verified production metrics the recorded activity bars and count/stop gauges stay as in the original view.
  // Recorded-activity layout only when the whole shift has no production metrics; a single hour without them keeps the common layout.
  const recorded = recordedMode;
  const delta = metrics?.cycle?.delta_seconds ?? null;
  const cycleText = delta == null ? '—' : `${delta > 0 ? '+' : ''}${hourNumber(Math.round(delta * 10) / 10)}s`;
  const ratio = metrics?.efficiency?.ratio ?? null;
  const efficiencyText = ratio == null ? '—' : `${Math.round(ratio * 100)}%`;
  const unavailable = metrics?.quality.missing_inputs.join(' · ') || (row.future ? t('Hour has not started') : t('Unavailable'));
  const inconsistent = metrics?.quality.status === 'inconsistent';
  const sourceOrder = data.production?.order ?? (row.total ? data.live_shift?.cavities?.order_ref : null);
  const detailId = `hour-detail-${row.id.replace(/[^a-zA-Z0-9]/g, '')}`;
  return <Fragment>
    <tr className={`${row.current ? 'overview-current' : ''} ${row.future ? 'overview-future' : ''} ${row.total ? 'overview-total' : ''}`}>
      <td className="overview-job"><span title={sourceOrder ?? t('Order for this hour is unavailable')}>{sourceOrder ?? '—'}</span></td>
      <th scope="row" className="overview-hour">
        <strong>{row.total ? t('Total') : `${hourClock(row.start)}–${hourClock(row.end)}`}</strong>
        <span>{row.total ? `${hourClock(row.start)}–${hourClock(row.end)}` : data.machine.name}</span>
        {row.current && <small className="overview-live-tag">{t('CURRENT HOUR')}</small>}
        {row.future && <small>{t('FUTURE HOUR')}</small>}
        {!row.future && <button type="button" aria-expanded={expanded} aria-controls={detailId} onClick={() => setExpanded(!expanded)}>
          {expanded ? t('Hide details −') : t('Hour details +')}</button>}
      </th>
      <td className="overview-composition">{recorded ? <RecordedActivity row={row} maxCycles={maxCycles} maxScrap={maxScrap} /> : <div className="overview-stack" aria-label={t('Output and losses {hour} in {unit}', { hour: row.total ? t('shift') : hourClock(row.start), unit: t(unit) })}>
        {row.segments.map(segment => <div key={segment.key} className={`overview-segment ${segment.key}`}
          style={{ width: `${segment.value / total * 100}%` }} title={`${segment.label}: ${unit === 'minutes' ? hourDuration(segment.value * 60) : `${hourNumber(segment.value)} ${['good', 'scrap'].includes(segment.key) ? t('pcs') : t('pcs eq.')}`}`}>
          <span>{hourNumber(Math.round(segment.value * 10) / 10)}</span>
        </div>)}
        {row.segments.length === 0 && <span className="overview-no-composition">{t('Breakdown unavailable')}</span>}
      </div>}</td>
      <td>{recorded ? <div className="overview-record-count"><Gauge value={row.count == null ? null : row.total ? Number(row.count > 0) : row.count / maxCycles} text={hourNumber(row.count)}
        caption={data.live_shift?.cycle_source === 'counter' ? t('Counter increase') : t('Recorded cycles')} label={t('Recorded count {n}', { n: hourNumber(row.count) })} /></div> : <Gauge value={ratio} text={efficiencyText} tone={ratio == null ? 'unknown' : inconsistent ? 'scrap' : ratio < (data.display_settings?.oee_warning_threshold ?? 0.7) ? 'warning' : 'good'}
        caption={metrics?.capacity?.ideal_capacity != null ? `${metrics.production?.count_basis === 'estimated' ? '~' : ''}${hourNumber(metrics.production?.good_count ?? null)} / ${hourNumber(Math.round(metrics.capacity.ideal_capacity * 10) / 10)} ${t('pcs')}${metrics.production?.count_basis === 'estimated' ? t(' · est.') : ''}${ratio != null && ratio > 1 ? t(' · above 100%') : ''}` : unavailable}
        label={t('Output efficiency {pct}', { pct: efficiencyText })} />}</td>
      <td>{recorded ? <div className="overview-stop-value"><Gauge value={row.stopSeconds == null ? null : row.stopSeconds / Math.max(1, row.elapsed)} text={row.stopSeconds == null ? '—' : `${Math.round(row.stopSeconds / 60)}m`} tone="warning"
        caption={`${hourNumber(row.stopCount)} ${row.stopCount === 1 ? t('stop') : t('stops')}`} label={t('Observed stops {n}, stop time {time}', { n: hourNumber(row.stopCount), time: hourStopTime(row.stopSeconds) })} /></div> : <Gauge value={delta == null ? null : 1} text={cycleText} tone={delta == null ? 'unknown' : delta > 0 ? 'scrap' : 'good'}
        caption={delta == null ? t('No verified cycle') : `${hourNumber(Math.round(metrics!.cycle!.actual_seconds! * 10) / 10)} / ${hourNumber(metrics!.cycle!.ideal_seconds)} s`}
        label={delta == null ? t('Cycle time unavailable') : t('Calculated cycle {actual} seconds, ideal {ideal} seconds', { actual: metrics!.cycle!.actual_seconds!, ideal: metrics!.cycle!.ideal_seconds! })} />}</td>
      <td className="overview-reasons" colSpan={3}>
        <div className="overview-detail-grid">
          {details.length ? details.map((detail, index) => <Fragment key={`${detail.key}-${detail.reason}-${index}`}>
            <span className="overview-type"><i className={detail.key} /><span>{detail.label}, <b>{detail.amount}</b></span></span>
            <span className="overview-reason" title={detail.reason}>{detail.reason}</span>
            <span className="overview-comment" title={t('Source comment')}>{detail.comment || '—'}</span>
          </Fragment>) : <span className="overview-row-empty">{row.future ? t('Hour has not started') : t('Detailed breakdown unavailable')}</span>}
        </div>
        {!row.future && <div className="overview-row-figures">
          <span>{live ? data.live_shift?.cycle_source === 'counter' ? t('Counter increase') : t('Recorded cycles') : t('OK pieces')} <b>{hourNumber(row.count)}</b></span>
          <span>{live ? t('Declared scrap') : t('Scrap')} <b className="overview-scrap-count">{hourNumber(row.scrap)} {t('pcs')}</b></span>
          {live && <span>{t('Observed stops')} <b className="overview-stop-count">{hourNumber(row.stopCount)}</b> · <b className="overview-stop-time">{hourStopTime(row.stopSeconds)}</b></span>}
          {metrics?.capacity?.recoverable_output != null && <span>{t('Recoverable output')} <b>+{hourNumber(Math.round(metrics.capacity.recoverable_output * 10) / 10)} {t('pcs')}</b></span>}
          {row.current && <span>{t('Elapsed')} <b>{hourDuration(row.elapsed)}</b></span>}
        </div>}
      </td>
    </tr>
    {expanded && <tr className="overview-expanded"><td colSpan={8}><div id={detailId}>
      <h3>{row.total ? t('Shift events') : t('Events {range}', { range: `${hourClock(row.start)}–${hourClock(row.end)}` })}</h3>
      {row.details.length ? <table className="overview-event-table"><thead><tr><th>{t('TIME')}</th><th>{t('TYPE')}</th><th>{t('REASON')}</th><th>{t('QUANTITY / DURATION')}</th><th>{t('CAVITY')}</th><th>{t('COMMENT')}</th></tr></thead>
        <tbody>{row.details.map((detail, index) => <tr key={index}><td>{detail.start && hourClock(detail.start)}{detail.end && `–${hourClock(detail.end)}`}</td>
          <td><i className={`overview-event-dot ${detail.key}`} />{detail.label}</td><td>{detail.reason}</td><td>{detail.amount}</td><td>{detail.cavity != null ? `K${detail.cavity}` : '—'}</td><td>{detail.comment || '—'}</td></tr>)}</tbody></table>
        : <p>{t('No individual events are available for this hour.')}</p>}
      {row.warnings.length > 0 && <p>{t('Data quality: {text}', { text: row.warnings.join(', ') })}</p>}
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
  const pcs = (value: number | null) => value == null ? '—' : `${hourNumber(Math.round(value * 10) / 10)} ${t('pcs')}`;
  const query = search.trim().toLocaleLowerCase(locale);
  const filtered = rows.filter(row => [hourClock(row.start), hourClock(row.end), data.machine.name, data.production?.order,
    ...row.details.map(detail => detail.reason), ...row.segments.map(segment => segment.label)].join(' ').toLocaleLowerCase(locale).includes(query));
  const stopEvents = data.live_shift?.downtime_events ?? data.downtime_events ?? [];
  const stopTotalSeconds = stopEvents.reduce((sum, event) => sum + event.seconds, 0);
  const cyclades = data.live_shift?.cyclades_shift ?? null;
  const shiftScrap = data.live_shift ? scrapByCavity(data.live_shift) : null;
  const stale = offline || data.status === 'stale';
  return <main className={`screen hourly-overview theme-${displayTheme(data.display.theme)}`}>
    <div className="overview-sticky">
      <header className="topbar"><div className="brand"><span className="brand-mark">P·E</span><span>PRODUCTION<br />EFFICIENCY</span></div>
        <nav className="view-nav" aria-label={t('Display views')}><a href={`/fleet${themeQuery}`}>{t('PLANT OVERVIEW ↗')}</a><span className="selected">{t('HOURLY OVERVIEW')}</span>
          <a href={displayLink(`/display/${encodeURIComponent(data.display.id)}/imprint`)}>{t('SHIFT IMPRINT ↗')}</a></nav>
        <div className="top-status"><span className={`status-dot ${stale ? 'stale' : ''}`} />{stale ? t('DATA CONNECTION LOST') : live ? 'EUROMAP63' : data.data_source === 'mock' ? t('SIMULATED DATA') : 'CICLADES'}</div>
        <div className="top-time"><span>{now.toLocaleDateString(locale, { timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric' })}</span><strong>{hourClock(now.toISOString())}</strong><LangSwitch /></div>
      </header>
      {stale && <div className="stale-banner" role="status">{t('Showing last available data · Updated {time} · Retrying', { time: updatedAt ? hourClock(updatedAt.toISOString()) : '—' })}</div>}
      <ShiftNavigator displayId={data.display.id} view="hourly-new" shift={data.shift!} navigation={data.shift_navigation!} />
      <section className="overview-toolbar"><div><h1>{data.machine.name}</h1><p>{data.production?.product || data.live_shift?.machine_code || data.display.name}
        {data.production?.order && ` · ${data.production.order}`}</p></div>
        <div className="overview-controls"><label className="overview-search"><span>⌕</span><input type="search" aria-label={t('Search hour or reason')} placeholder={t('Search hour or reason…')} value={search} onChange={event => setSearch(event.target.value)} /></label>
          <div className="hour-unit-toggle" role="group" aria-label={t('Hourly breakdown unit')}>
            <button type="button" aria-pressed={unit === 'minutes'} className={unit === 'minutes' ? 'active' : ''} onClick={() => chooseUnit('minutes')}>{t('MINUTES')}</button>
            <button type="button" aria-pressed={unit === 'pieces'} className={unit === 'pieces' ? 'active' : ''} disabled={!piecesAvailable} title={piecesAvailable ? t('Loss equivalents calculated from the ideal cycle') : t('Verified hourly OK-piece counts are unavailable')} onClick={() => chooseUnit('pieces')}>{t('PIECES')}</button>
          </div></div></section>
    </div>
    <h2 className="scope-heading shift">{t('SHIFT RESULTS')} <span>{data.shift!.name} · {hourClock(data.shift!.start)}–{hourClock(data.shift!.end)}</span></h2>
    <section className="overview-live-kpis overview-shift-ribbon" aria-label={t('Shift results')}>
      <div title={headline.estimated ? t('Interpolated from carton declarations; hours without full declaration coverage are excluded') : undefined}><span>{t('OK PIECES')}{headline.estimated ? t(' · EST.') : ''}</span><strong>{pcs(headline.ok)}</strong>{headline.estimated && headline.coverage && <small>{t('est. · {a} / {b} hours', { a: headline.coverage.hours_covered, b: headline.coverage.hours_total })}</small>}</div>
      <div title={t('OK + scrap + stopped time recovered at the achieved running rate. A calculated counterfactual, not a measured count.')}><span>{t('WITHOUT SCRAP / STOPS')}</span><strong>{pcs(headline.withoutLosses)}</strong></div>
      <div><span>{t('RECOVERABLE OUTPUT')}</span><strong>{headline.recoverable == null ? '—' : `+${pcs(headline.recoverable)}`}</strong></div>
      <div title={t('Planned production time at the ideal cycle')}><span>{t('IDEAL CAPACITY')}</span><strong>{pcs(headline.idealCapacity)}</strong></div>
      <div><span>{data.live_shift?.cycle_source === 'counter' ? t('COUNTER INCREASE') : live ? t('RECORDED CYCLES') : t('RECORDED COUNT')}</span><strong>{hourNumber(total.count)}</strong></div>
      <div><span>{t('OBSERVED STOPS')}</span><strong>{hourNumber(total.stopCount)}</strong></div>
      <div><span>{t('OBSERVED STOP TIME')}</span><strong>{hourStopTime(total.stopSeconds)}</strong></div>
      <div className="scrap-kpi"><span>{t('SHIFT SCRAP')}</span><div className="scrap-kpi-value"><strong>{hourNumber(total.scrap)} {t('pcs')}</strong>{shiftScrap && <ScrapLanes lanes={shiftScrap.lanes} />}</div></div>
    </section>
    {cyclades && <p className="overview-cyclades" title={t('Cyclades books pieces that were made but not yet declared as OK or scrap (a carton is declared when full) as delta scrap, and the figure changes again once the carton is declared.')}>
      <span>{t('CYCLADES SHIFT · DECLARED UP TO {time}', { time: hourClock(cyclades.as_of) })}</span>
      <span>OK <b>{hourNumber(cyclades.ok)}</b></span><span>{t('SCRAP')} <b>{hourNumber(cyclades.scrap)}</b></span>
      <span>{t('UNDECLARED (Δ SCRAP)')} <b>{hourNumber(cyclades.delta_scrap)}</b></span><span>{t('MADE')} <b>{hourNumber(cyclades.made)}</b></span>
      {headline.estimated && headline.coverage && <span className="overview-cyclades-estimate">{t('OUR ESTIMATE · {a}/{b} H', { a: headline.coverage.hours_covered, b: headline.coverage.hours_total })} <b>~{hourNumber(Math.round(headline.ok ?? 0))}</b> OK</span>}</p>}
    {live && data.live_shift?.orders?.length ? <>
      <h2 className="scope-heading order">{data.live_shift.orders.length > 1 ? t('ORDERS IN THIS SHIFT') : t('ORDER IN THIS SHIFT')} <span>{data.live_shift.orders.map(order => order.order_ref).join(' → ')}</span>{data.live_shift.detail_url && <a className="scope-link" href={data.live_shift.detail_url}>{t('Machine detail ↗')}</a>}</h2>
      <OrdersStrip live={data.live_shift} /></> : live && data.live_shift?.current_machine ? <><h2 className="scope-heading order">{t('CURRENT ORDER')} <span>{data.live_shift.current_machine.order_ref || '—'}{data.live_shift.current_machine.tool_ref ? ` · ${t('tool')} ${data.live_shift.current_machine.tool_ref}${data.live_shift.current_machine.tool_label ? ` · ${data.live_shift.current_machine.tool_label}` : ''}` : ''}</span></h2>
    <div className="overview-current-state">
      <span>{t('CURRENT MACHINE STATE')} · <b>{data.live_shift.current_machine.state === 'bezi' ? t('RUNNING') : data.live_shift.current_machine.state === 'stoji' ? t('STOPPED') : data.live_shift.current_machine.state === 'bez_zakazky' ? t('NO ORDER') : t('UNKNOWN')}</b></span>
      <span>{t('CURRENT ORDER')} · <b>{data.live_shift.current_machine.order_ref || '—'}</b></span>
      <span>{t('ACTUAL / PLANNED CYCLE')} · <b>{hourNumber(data.live_shift.current_machine.cycle_time_real_s ?? null)} / {hourNumber(data.live_shift.current_machine.cycle_time_planned_s ?? null)} s</b></span>
      <span className="cavity-cell">{t('ORDER SCRAP BY CAVITY · %')} · <CavityRates live={data.live_shift} /></span>
      {data.live_shift.detail_url && <a href={data.live_shift.detail_url}>{t('Machine detail ↗')}</a>}</div></> : null}

    <div className="overview-table-scroll" role="region" aria-label={t('Hourly production overview')} tabIndex={0}>
      <table className="overview-table"><colgroup><col className="col-job" /><col className="col-hour" /><col className="col-bar" /><col className="col-gauge" /><col className="col-gauge" /><col className="col-type" /><col className="col-reason" /><col className="col-comment" /></colgroup>
        <thead><tr><th>{t('ORDER')}</th><th>{t('HOUR / MACHINE')}</th>{piecesAvailable || !live ? <><th>{t('OUTPUT / LOSSES')}<small>{unit === 'minutes' ? t('MINUTES') : t('PIECES / EQ.')}</small></th><th>{t('OUTPUT EFFICIENCY')}<small>{t('OK / IDEAL CAPACITY')}</small></th><th>{t('CYCLE')}<small>{t('ACTUAL / IDEAL')}</small></th></> : <><th>{t('RECORDED ACTIVITY')}</th><th>{data.live_shift?.cycle_source === 'counter' ? t('COUNT') : t('CYCLES')}</th><th>{t('STOPS')}<small>{t('OBSERVED STOP TIME')}</small></th></>}<th>{t('TYPE')}</th><th>{t('REASON')}</th><th>{t('COMMENT')}</th></tr></thead>
        <tbody>{filtered.map(row => <OverviewRow key={`${data.machine.id}-${row.id}`} row={row} data={data} unit={unit} maxCycles={maxCycles} maxScrap={maxScrap} recordedMode={live && !piecesAvailable} />)}
          {filtered.length === 0 && <tr><td className="overview-no-results" colSpan={8}>{t('No hours match this search.')} <button type="button" onClick={() => setSearch('')}>{t('Clear search')}</button></td></tr>}
          <OverviewRow key={`${data.machine.id}-${data.shift!.start}-total`} row={total} data={data} unit={unit} maxCycles={maxCycles} maxScrap={maxScrap} recordedMode={live && !piecesAvailable} /></tbody>
      </table>
    </div>
    <section className="overview-stops" aria-label={t('Recorded stop reasons')}>
      <div className="overview-stops-head"><div><span className="overview-stops-eyebrow">{t('STOP DETAIL')}</span><h2>{t('Recorded stop reasons')}</h2></div>
        <div className="overview-stops-total"><span>{t('TOTAL')}</span><strong>{stopEvents.length} {stopEvents.length === 1 ? t('stop') : t('stops')} · {hourDuration(stopTotalSeconds)}</strong></div></div>
      {stopEvents.length ? <div className="overview-stop-list">{stopEvents.map((event, index) => <div key={`${event.start}-${index}`}>
        <span>{hourClock(event.start)}–{hourClock(event.end)}</span><strong title={event.reason}>{event.reason}</strong><em title={event.comment || ''}>{event.comment || ''}</em><b>{hourDuration(event.seconds)}</b></div>)}</div>
        : <p className="overview-stops-empty">{t('No stop intervals returned for this shift. This does not confirm uninterrupted production.')}</p>}
    </section>
    <div className="overview-legend">{(piecesAvailable ? [...compositionOrder] : live ? [{ key: 'good', label: data.live_shift?.cycle_source === 'counter' ? t('Counter increase') : t('Recorded cycles') }, { key: 'downtime', label: t('Observed stop time') }, { key: 'scrap', label: t('Declared scrap') }] : [compositionOrder[2], { key: 'unknown', label: t('Unverified time') }]).map(category =>
      <span key={category.key}><i className={category.key} />{category.label}</span>)}{unit === 'minutes' && piecesAvailable && <span><i className="future" />{t('Future time')}</span>}</div>
    <p className="overview-note">{t('OVERVIEW_NOTE')}{live ? t('OVERVIEW_NOTE_LIVE') : ''}{t('OVERVIEW_NOTE_END')}{headline.estimated ? t('OVERVIEW_NOTE_EST') : ''}</p>
    <footer><span>{data.display.name} / {data.shift!.name}</span><span>{t('{a} / {b} HOURS', { a: filtered.length, b: rows.length })}</span><span>{t('UPDATED {time}', { time: updatedAt ? hourClock(updatedAt.toISOString()) : '—' })}</span></footer>
  </main>;
}
