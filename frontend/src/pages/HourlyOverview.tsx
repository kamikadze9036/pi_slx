import { Fragment, useState, type CSSProperties } from 'react';
import type { ImprintData } from '../types';
import { displayTheme, themeQuery } from '../theme';
import { ShiftNavigator, displayLink } from '../ShiftNavigator';
import { useHourUnit, type HourUnit } from '../HourUnit';
import { buildOverviewHours, buildOverviewTotal, hourClock, hourDetailSummary, hourDuration, hourNumber, lossCategories,
  type OverviewHour } from '../hourly-model';

function Gauge({ value, text, tone = 'good', caption, label }: {
  value: number | null; text: string; tone?: string; caption: string; label: string;
}) {
  return <div className={`overview-gauge ${tone}`} aria-label={label}>
    <div className="overview-ring" style={{ '--progress': `${Math.max(0, Math.min(1, value ?? 0)) * 100}%` } as CSSProperties}>
      <strong>{text}</strong>
    </div><small>{caption}</small>
  </div>;
}

function OverviewRow({ row, data, unit }: { row: OverviewHour; data: ImprintData; unit: HourUnit }) {
  const [expanded, setExpanded] = useState(false);
  const live = !!data.live_shift;
  const details = hourDetailSummary(row, live, unit);
  const total = Math.max(1, row.segments.reduce((sum, segment) => sum + segment.value, 0));
  const delta = row.ideal != null && row.estimated != null ? row.estimated - row.ideal : null;
  const cycleText = delta == null ? '—' : `${delta > 0 ? '+' : ''}${hourNumber(Math.round(delta * 10) / 10)}s`;
  const oee = row.oee == null ? '—' : `${Math.round(row.oee * 100)}%`;
  const sourceOrder = data.production?.order ?? (row.total ? data.live_shift?.cavities?.order_ref : null);
  const detailId = `hour-detail-${row.id.replace(/[^a-zA-Z0-9]/g, '')}`;
  return <Fragment>
    <tr className={`${row.current ? 'overview-current' : ''} ${row.future ? 'overview-future' : ''} ${row.total ? 'overview-total' : ''}`}>
      <td className="overview-job"><span title={sourceOrder ?? 'Zakázka pro tuto hodinu není dostupná'}>{sourceOrder ?? '—'}</span></td>
      <th scope="row" className="overview-hour">
        <strong>{row.total ? 'Celkový' : `${hourClock(row.start)}–${hourClock(row.end)}`}</strong>
        <span>{row.total ? `${hourClock(row.start)}–${hourClock(row.end)}` : data.machine.name}</span>
        {row.current && <small className="overview-live-tag">PRÁVĚ PROBÍHÁ</small>}
        {row.future && <small>BUDOUCÍ HODINA</small>}
        {!row.future && <button type="button" aria-expanded={expanded} aria-controls={detailId} onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Skrýt detail −' : 'Detail hodiny +'}</button>}
      </th>
      <td className="overview-composition"><div className="overview-stack" aria-label={`Rozklad ${row.total ? 'směny' : hourClock(row.start)} v ${unit === 'minutes' ? 'minutách' : 'kusech'}`}>
        {row.segments.map(segment => <div key={segment.key} className={`overview-segment ${segment.key}`}
          style={{ width: `${segment.value / total * 100}%` }} title={`${segment.label}: ${unit === 'minutes' ? hourDuration(segment.value * 60) : `${hourNumber(segment.value)} ${['good', 'scrap'].includes(segment.key) ? 'ks' : 'ks ekv.'}`}`}>
          <span>{hourNumber(Math.round(segment.value * 10) / 10)}</span>
        </div>)}
        {row.segments.length === 0 && <span className="overview-no-composition">Rozklad není dostupný</span>}
      </div></td>
      <td><Gauge value={row.oee} text={oee} tone={row.oee != null && row.oee < (data.display_settings?.oee_warning_threshold ?? 0.7) ? 'warning' : 'good'}
        caption={live ? 'OEE není dostupné' : `${hourNumber(row.count)} / ${hourNumber(row.target)} ks`} label={`OEE ${oee}`} /></td>
      <td><Gauge value={delta == null ? null : 1} text={cycleText} tone={delta == null ? 'unknown' : delta > 0 ? 'scrap' : 'good'}
        caption={delta == null ? 'Historie cyklu chybí' : `${hourNumber(Math.round(row.estimated! * 10) / 10)} / ${hourNumber(row.ideal)} s`}
        label={delta == null ? 'Čas cyklu není dostupný' : `Vypočtený cyklus ${row.estimated} sekund, ideální ${row.ideal} sekund`} /></td>
      <td className="overview-reasons" colSpan={3}>
        <div className="overview-detail-grid">
          {details.length ? details.map((detail, index) => <Fragment key={`${detail.key}-${detail.reason}-${index}`}>
            <span className="overview-type"><i className={detail.key} /><span>{detail.label}, <b>{detail.amount}</b></span></span>
            <span className="overview-reason" title={detail.reason}>{detail.reason}</span>
            <span className="overview-comment" title="Komentář ze zdroje">{detail.comment || '—'}</span>
          </Fragment>) : <span className="overview-row-empty">{row.future ? 'Hodina ještě nezačala' : 'Podrobný rozklad není dostupný'}</span>}
        </div>
        {!row.future && <div className="overview-row-figures">
          <span>{live ? data.live_shift?.cycle_source === 'counter' ? 'Přírůstek čítače' : 'Zaznamenané cykly' : 'Dobré kusy'} <b>{hourNumber(row.count)}</b></span>
          <span>{live ? 'Hlášené zmetky' : 'Zmetky'} <b>{hourNumber(row.scrap)} ks</b></span>
          {row.current && <span>Uplynulo <b>{hourDuration(row.elapsed)}</b></span>}
        </div>}
      </td>
    </tr>
    {expanded && <tr className="overview-expanded"><td colSpan={8}><div id={detailId}>
      <h3>{row.total ? 'Události směny' : `Události ${hourClock(row.start)}–${hourClock(row.end)}`}</h3>
      {row.details.length ? <table className="overview-event-table"><thead><tr><th>ČAS</th><th>TYP</th><th>DŮVOD</th><th>MNOŽSTVÍ / TRVÁNÍ</th><th>KAVITA</th><th>KOMENTÁŘ</th></tr></thead>
        <tbody>{row.details.map((detail, index) => <tr key={index}><td>{detail.start && hourClock(detail.start)}{detail.end && `–${hourClock(detail.end)}`}</td>
          <td><i className={`overview-event-dot ${detail.key}`} />{detail.label}</td><td>{detail.reason}</td><td>{detail.amount}</td><td>{detail.cavity != null ? `K${detail.cavity}` : '—'}</td><td>{detail.comment || '—'}</td></tr>)}</tbody></table>
        : <p>Zdroj pro tuto hodinu neposkytuje jednotlivé události.</p>}
      {row.warnings.length > 0 && <p>Kvalita dat: {row.warnings.join(', ')}</p>}
    </div></td></tr>}
  </Fragment>;
}

export function HourlyOverview({ data, offline, updatedAt, now }: {
  data: ImprintData; offline: boolean; updatedAt: Date | null; now: Date;
}) {
  const [storedUnit, chooseUnit] = useHourUnit('hourly-new-unit');
  const [search, setSearch] = useState('');
  const live = !!data.live_shift;
  const unit = live ? 'minutes' : storedUnit;
  const rows = buildOverviewHours(data, unit);
  const total = buildOverviewTotal(data, rows);
  const query = search.trim().toLocaleLowerCase('cs-CZ');
  const filtered = rows.filter(row => [hourClock(row.start), hourClock(row.end), data.machine.name, data.production?.order,
    ...row.details.map(detail => detail.reason), ...row.segments.map(segment => segment.label)].join(' ').toLocaleLowerCase('cs-CZ').includes(query));
  const stale = offline || data.status === 'stale';
  return <main className={`screen hourly-overview theme-${displayTheme(data.display.theme)}`}>
    <div className="overview-sticky">
      <header className="topbar"><div className="brand"><span className="brand-mark">P·E</span><span>PRODUCTION<br />EFFICIENCY</span></div>
        <nav className="view-nav" aria-label="Přehledy"><a href={`/fleet${themeQuery}`}>PŘEHLED VÝROBY ↗</a><a href={displayLink(`/display/${encodeURIComponent(data.display.id)}/hourly`)}>HODINOVÝ PŘEHLED PŮVODNÍ ↗</a><span className="selected">HODINOVÝ PŘEHLED NOVÝ</span>
          <a href={displayLink(`/display/${encodeURIComponent(data.display.id)}/imprint`)}>OTISK SMĚNY ↗</a></nav>
        <div className="top-status"><span className={`status-dot ${stale ? 'stale' : ''}`} />{stale ? 'SPOJENÍ PŘERUŠENO' : live ? 'EUROMAP63' : data.data_source === 'mock' ? 'DEMO DATA' : 'CICLADES'}</div>
        <div className="top-time"><span>{now.toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric' })}</span><strong>{hourClock(now.toISOString())}</strong></div>
      </header>
      {stale && <div className="stale-banner" role="status">Zobrazuji poslední dostupná data · Aktualizace {updatedAt ? hourClock(updatedAt.toISOString()) : '—'} · Obnovuji spojení</div>}
      <ShiftNavigator displayId={data.display.id} view="hourly-new" shift={data.shift!} navigation={data.shift_navigation!} language="cs" />
      <section className="overview-toolbar"><div><h1>{data.machine.name}</h1><p>{data.production?.product || data.live_shift?.machine_code || data.display.name}
        {data.production?.order && ` · ${data.production.order}`}</p></div>
        <div className="overview-controls"><label className="overview-search"><span>⌕</span><input type="search" aria-label="Vyhledat hodinu nebo důvod" placeholder="Vyhledat hodinu nebo důvod…" value={search} onChange={event => setSearch(event.target.value)} /></label>
          <div className="hour-unit-toggle" role="group" aria-label="Jednotka hodinového rozkladu">
            <button type="button" aria-pressed={unit === 'minutes'} className={unit === 'minutes' ? 'active' : ''} onClick={() => chooseUnit('minutes')}>MINUTY</button>
            <button type="button" aria-pressed={unit === 'pieces'} className={unit === 'pieces' ? 'active' : ''} disabled={live} title={live ? 'Zdroj neposkytuje ověřené hodinové počty dobrých kusů' : 'Ztráty přepočtené podle ideálního cyklu'} onClick={() => chooseUnit('pieces')}>KUSY</button>
          </div></div></section>
    </div>
    {live && data.live_shift?.current_machine && <div className="overview-current-state"><span>AKTUÁLNĚ · {data.live_shift.current_machine.order_ref || 'Bez zakázky'}</span>
      <span>Cyklus nyní: <b>{hourNumber(data.live_shift.current_machine.cycle_time_real_s ?? null)} / {hourNumber(data.live_shift.current_machine.cycle_time_planned_s ?? null)} s</b></span>
      {data.live_shift.detail_url && <a href={data.live_shift.detail_url}>Detail stroje ↗</a>}</div>}
    <div className="overview-table-scroll" role="region" aria-label="Hodinový výrobní přehled" tabIndex={0}>
      <table className="overview-table"><colgroup><col className="col-job" /><col className="col-hour" /><col className="col-bar" /><col className="col-gauge" /><col className="col-gauge" /><col className="col-type" /><col className="col-reason" /><col className="col-comment" /></colgroup>
        <thead><tr><th>ZAKÁZKA</th><th>HODINA / STROJ</th><th>{unit === 'minutes' ? 'MINUTY' : 'KUSY / EKV.'}</th><th>OEE</th><th>CYKLUS <small>VYPOČTENÝ / IDEÁLNÍ</small></th><th>TYP</th><th>DŮVOD</th><th>KOMENTÁŘ</th></tr></thead>
        <tbody>{filtered.map(row => <OverviewRow key={`${data.machine.id}-${row.id}`} row={row} data={data} unit={unit} />)}
          {filtered.length === 0 && <tr><td className="overview-no-results" colSpan={8}>Žádná hodina neodpovídá hledání. <button type="button" onClick={() => setSearch('')}>Zrušit hledání</button></td></tr>}
          <OverviewRow key={`${data.machine.id}-${data.shift!.start}-total`} row={total} data={data} unit={unit} /></tbody>
      </table>
    </div>
    <div className="overview-legend">{(live ? [{ key: 'downtime', label: 'Pozorovaný prostoj' }, { key: 'unknown', label: 'Neověřený čas' }] : lossCategories).map(category =>
      <span key={category.key}><i className={category.key} />{category.label}</span>)}{unit === 'minutes' && <span><i className="future" />Budoucí čas</span>}</div>
    <p className="overview-note">{live ? 'Počty jsou cykly nebo přírůstky čítače. Neověřený čas nepotvrzuje běh stroje; čas prostojů může mít neúplné pokrytí. Hodinové OEE a historický cyklus zdroj neposkytuje. Zmetky jsou zařazeny podle času hlášení.'
      : 'Cyklus je vypočtený z času běhu bez prostojů a mikrozastavení, počtu kusů a kusů na cyklus; nejde o jednotlivě měřené cykly. V režimu kusů jsou ztráty ekvivalenty podle ideálního cyklu.'} „—“ označuje nedostupnou hodnotu. Celkový řádek zahrnuje celou směnu i při vyhledávání.</p>
    <footer><span>{data.display.name} / {data.shift!.name}</span><span>{filtered.length} / {rows.length} HODIN</span><span>AKTUALIZACE {updatedAt ? hourClock(updatedAt.toISOString()) : '—'}</span></footer>
  </main>;
}
