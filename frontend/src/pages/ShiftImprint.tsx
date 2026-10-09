import { useEffect, useState } from 'react';
import type { Hour, ImprintData } from '../types';
import { displayTheme, themeQuery } from '../theme';
import { ShiftNavigator, displayLink, shiftApiQuery, useShiftStart } from '../ShiftNavigator';
import { HourUnitToggle, useHourUnit } from '../HourUnit';
import { EuromapShift } from './EuromapShift';
import { t, LangSwitch, locale, numberLocale } from '../i18n';

const VERSION = import.meta.env.VITE_APP_VERSION || 'dev';
const fmt = (value: number) => new Intl.NumberFormat(numberLocale).format(value);
const pct = (value: number | null | undefined) => value == null ? '—' : `${Math.round(value * 100)}%`;
const pct2 = (value: number | null | undefined) => value == null ? '—' : `${(value * 100).toFixed(2)}%`;
const mins = (value: number) => `${Math.round(value / 60)} min`;
const clock = (value: string) => new Date(value).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
const position = (at: string, start: string, end: string) => Math.max(0, Math.min(100,
  (new Date(at).getTime() - new Date(start).getTime()) / (new Date(end).getTime() - new Date(start).getTime()) * 100));
const categoryLabel: Record<string, string> = {
  mechanical: t('Mechanical'), material: t('Material'), quality: t('Quality'), micro_stop: t('Micro stop'),
  planned: t('Planned'), other: t('Other')
};
const categoryClass = (value: string) => Object.hasOwn(categoryLabel, value) ? value : 'other';

const hourCategories: { label: string; className: string; seconds: keyof Hour;
  pieces: keyof NonNullable<Hour['piece_equivalents']> }[] = [
  { label: t('Good'), className: 'good', seconds: 'good_seconds', pieces: 'good' },
  { label: t('Slow running'), className: 'speed', seconds: 'speed_loss_seconds', pieces: 'speed_loss' },
  { label: t('Micro stops'), className: 'micro', seconds: 'microstop_seconds', pieces: 'microstop' },
  { label: t('Downtime'), className: 'down', seconds: 'downtime_seconds', pieces: 'downtime' },
  { label: t('Break'), className: 'break', seconds: 'excluded_break_seconds', pieces: 'break' },
  { label: t('Scrap'), className: 'scrap', seconds: 'scrap_loss_seconds', pieces: 'scrap' },
  { label: t('Unknown'), className: 'unknown', seconds: 'unknown_seconds', pieces: 'unknown' },
];

function HourBreakdownRow({ hour, unit }: { hour: Hour; unit: 'minutes' | 'pieces' }) {
  const equivalents = hour.piece_equivalents;
  const values = hourCategories.map(category => unit === 'minutes'
    ? Number(hour[category.seconds]) / 60 : equivalents?.[category.pieces] ?? 0);
  const total = unit === 'minutes' ? hour.duration_seconds / 60 : Math.max(1, values.reduce((sum, value) => sum + value, 0));
  return <div className="imprint-hour-row">
    <strong className="imprint-hour-time">{clock(hour.start)}–{clock(hour.end)}</strong>
    <div className="imprint-hour-bar" aria-label={t('{time} hourly {unit} breakdown', { time: clock(hour.start), unit: t(unit) })}>
      {unit === 'pieces' && !equivalents ? <span className="imprint-hour-unavailable">{t('Ideal cycle unavailable')}</span>
        : hourCategories.map((category, index) => {
          const value = values[index];
          if (value <= 0) return null;
          const width = value / total * 100;
          const amount = unit === 'minutes' ? `${value.toFixed(1)} min` : `${Math.round(value)} ${t('pcs')}`;
          const label = unit === 'minutes' ? String(Math.round(value)) : fmt(Math.round(value));
          return <span key={category.label} className={`imprint-hour-segment ${category.className}`}
            style={{ width: `${width}%` }} title={`${category.label}: ${amount}${unit === 'pieces' && category.pieces !== 'good' && category.pieces !== 'scrap' ? ` ${t('equivalent')}` : ''}`}>
            <span className={`segment-number length-${Math.min(label.length, 6)}`} aria-hidden="true">{label}</span>
          </span>;
        })}
    </div>
    <span className="imprint-hour-figure">{t('GOOD/TGT')} <b>{fmt(hour.good_count)}/{hour.target_good == null ? '—' : fmt(hour.target_good)}</b></span>
    <span className="imprint-hour-figure">{t('SCRAP')} <b>{fmt(hour.scrap_count)}</b></span>
    <span className="imprint-hour-figure">OEE <b>{pct(hour.oee)}</b></span>
  </div>;
}

export function ShiftImprint({ displayId }: { displayId: string }) {
  const shiftStart = useShiftStart();
  const [data, setData] = useState<ImprintData | null>(null);
  const [offline, setOffline] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [now, setNow] = useState(new Date());
  const [hourUnit, chooseHourUnit] = useHourUnit();
  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setTimeout>;
    let interval = 10;
    let activeController: AbortController | null = null;
    async function refresh() {
      const controller = new AbortController(); activeController = controller;
      const timeout = setTimeout(() => controller.abort(), 25000);
      try {
        const response = await fetch(`/api/displays/${encodeURIComponent(displayId)}/shift-imprint${shiftApiQuery(shiftStart)}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const next: ImprintData = await response.json();
        if (mounted) { setData(next); setOffline(false); interval = next.refresh_seconds;
          setUpdatedAt(next.status === 'stale' && next.last_successful_update ? new Date(next.last_successful_update) : new Date()); }
      } catch { if (mounted) setOffline(true); }
      finally { clearTimeout(timeout); if (activeController === controller) activeController = null;
        if (mounted) timer = setTimeout(refresh, Math.max(3, interval) * 1000); }
    }
    refresh();
    const clockTimer = setInterval(() => setNow(new Date()), 1000);
    const heartbeat = () => fetch(`/api/displays/${encodeURIComponent(displayId)}/heartbeat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ frontend_version: VERSION })
    }).catch(() => undefined);
    heartbeat(); const beatTimer = setInterval(heartbeat, 15000);
    return () => { mounted = false; activeController?.abort(); clearTimeout(timer); clearInterval(clockTimer); clearInterval(beatTimer); };
  }, [displayId, shiftStart]);

  if (!data) return <main className={`empty-state theme-${displayTheme()}`}><span className="eyebrow">{t('SHIFT IMPRINT')}</span><h1>{offline ? t('DATA CONNECTION LOST') : t('Loading shift…')}</h1><p>{offline ? t('Reconnecting automatically') : t('Display {id}', { id: displayId })}</p></main>;
  if (data.status === 'outside_shift') return <main className={`empty-state theme-${displayTheme(data.display.theme)}`}><span className="eyebrow">{t('SHIFT IMPRINT')}</span><h1>{t('Outside scheduled shift')}</h1><p>{t('Waiting for the next configured shift')}</p></main>;
  if (data.data_source === 'euromap63') return <EuromapShift data={data} view="imprint" offline={offline} updatedAt={updatedAt} now={now} />;
  const shift = data.shift!;
  const production = data.production!;
  const summary = data.summary!;
  const hours = data.hours || [];
  const events = data.downtime_events || [];
  const reports = data.scrap_reports || [];
  const duration = new Date(shift.end).getTime() - new Date(shift.start).getTime();
  const elapsed = Math.max(0, Math.min(100, (new Date(data.server_time).getTime() - new Date(shift.start).getTime()) / duration * 100));
  const stale = offline || data.status === 'stale';
  const maxReason = Math.max(1, ...(data.downtime_reasons || []).map(item => item.seconds));
  const maxScrap = Math.max(1, ...hours.map(item => item.scrap_count));
  return <main className={`screen imprint-screen theme-${displayTheme(data.display.theme)}`}>
    <header className="topbar">
      <div className="brand"><span className="brand-mark">P·E</span><span>PRODUCTION<br/>EFFICIENCY</span></div>
      <div className="top-status"><span className={`status-dot ${stale ? 'stale' : ''}`}></span>{stale ? t('DATA CONNECTION LOST') : `${data.shift_navigation?.is_current ? t('CURRENT SHIFT') : t('HISTORICAL SHIFT')} · ${data.data_source === 'mock' ? t('SIMULATED DATA') : t('CICLADES DATA')}`}</div>
      <div className="top-time"><span>{now.toLocaleDateString(locale, { weekday: 'short', day: '2-digit', month: 'short' }).toUpperCase()}</span><strong>{now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false })}</strong><LangSwitch /></div>
    </header>
    <nav className="view-nav" aria-label={t('Display views')}><a href={`/fleet${themeQuery}`}>{t('PLANT OVERVIEW ↗')}</a><a href={displayLink(`/display/${encodeURIComponent(displayId)}/hourly-new`)}>{t('HOURLY OVERVIEW ↗')}</a><span className="selected">{t('SHIFT IMPRINT')}</span></nav>
    {stale && <div className="stale-banner">{t('Showing last available data · Last successful update {time} · Retrying', { time: updatedAt?.toLocaleTimeString(locale) || t('unknown') })}</div>}
    <ShiftNavigator displayId={displayId} view="imprint" shift={shift} navigation={data.shift_navigation!} />
    <section className="imprint-head"><div><span className="eyebrow">{t('SHIFT IMPRINT')} <span className="slash">/</span> {data.display.id.toUpperCase()}</span>
      <h1>{data.machine.name}</h1><p>{production.product || t('Product unavailable')} <span>·</span> {production.order || t('Order unavailable')}</p></div>
      <div className="imprint-shift"><span>{t('{name} SHIFT', { name: shift.name.toUpperCase() })}</span><strong>{clock(shift.start)} — {clock(shift.end)}</strong><small>{new Date(shift.start).toLocaleDateString(locale)}</small></div></section>
    <section className="imprint-kpis">
      <div><span>{t('GOOD PIECES')}</span><strong>{fmt(summary.good_count)}</strong><small>{t('Target {n}', { n: production.target == null ? '—' : fmt(production.target) })}</small></div>
      <div><span>OEE</span><strong>{pct(summary.oee)}</strong><small>{data.shift_navigation?.is_current ? t('Shift to date') : t('Full shift')}</small></div>
      <div><span>{t('DOWNTIME')}</span><strong className="orange-text">{mins(summary.downtime_seconds)}</strong><small>{t('Unplanned stops')}</small></div>
      <div><span>{t('MICRO STOPS')}</span><strong className="purple-text">{mins(events.filter(item => item.category === 'micro_stop').reduce((sum, item) => sum + item.seconds, 0))}</strong><small>{t('Short interruptions')}</small></div>
      <div><span>{t('SCRAP')}</span><strong className="red-text">{fmt(summary.scrap_count)}</strong><small>{t('{pct} of output', { pct: pct2(summary.scrap_percent) })}</small></div>
    </section>
    <section className="imprint-panel timeline-panel"><div className="imprint-panel-head"><div><span className="eyebrow">{t('01 / CHRONOLOGICAL VIEW')}</span><h2>{t('Shift timeline')}</h2></div><span>{t('RUNNING / STOPS / SCRAP REPORTS')}</span></div>
      <div className="timeline-axis">{(data.ticks || [shift.start, shift.end]).map((tick, index, array) => <span key={`${tick}-${index}`} className={index === 0 ? 'first' : index === array.length - 1 ? 'last' : ''}
        style={{ left: `${position(tick, shift.start, shift.end)}%` }}>{clock(tick)}</span>)}</div>
      <div className="timeline-label">{t('MACHINE STATE')}</div>
      <div className="shift-track"><div className={`shift-elapsed ${data.downtime_detail_available ? '' : 'unknown-elapsed'}`} style={{ width: `${elapsed}%` }}></div>
        {events.map((item, index) => <div key={`${item.start}-${index}`} className={`shift-event ${categoryClass(item.category)}`}
          style={{ left: `${position(item.start, shift.start, shift.end)}%`, width: `${Math.max(0.2, position(item.end, shift.start, shift.end) - position(item.start, shift.start, shift.end))}%` }}
          title={`${item.reason}: ${(item.seconds / 60).toFixed(1)} min`} aria-label={t('{time} {reason} {mins}', { time: clock(item.start), reason: item.reason, mins: mins(item.seconds) })}></div>)}</div>
      <div className="timeline-label scrap-label">{t('SCRAP REPORTS')}</div>
      <div className="scrap-track">{reports.map((item, index) => <span key={`${item.at}-${index}`} className="scrap-pin"
        style={{ left: `${position(item.at, shift.start, shift.end)}%` }} title={t('{time} {reason}: {n} pcs', { time: clock(item.at), reason: item.reason, n: item.count })}
        aria-label={t('{time} {reason} {n} scrap pieces', { time: clock(item.at), reason: item.reason, n: item.count })}></span>)}</div>
      <div className="timeline-legend"><span><i className={data.downtime_detail_available ? 'running' : 'unknown'}></i>{data.downtime_detail_available ? t('Running') : t('Unclassified elapsed')}</span>{['mechanical','material','quality','micro_stop','planned','other'].map(category => <span key={category}><i className={category}></i>{categoryLabel[category]}</span>)}<span><i className="scrap-key"></i>{t('Scrap report')}</span><span><i className="future-key"></i>{t('Future')}</span></div>
      {!data.downtime_detail_available && <div className="detail-unavailable">{t('Downtime event details are not mapped in the MES provider.')}</div>}
      {!data.scrap_detail_available && <div className="detail-unavailable">{t('Scrap report details are not mapped in the MES provider.')}</div>}
    </section>
    <section className="imprint-panel hourly-output"><div className="imprint-panel-head"><div><span className="eyebrow">{t('02 / HOURLY OUTPUT')}</span><h2>{t('Production by hour')}</h2></div>
      <HourUnitToggle unit={hourUnit} onChange={chooseHourUnit} /></div>
      <div className="imprint-hour-list">{hours.map(hour => <HourBreakdownRow key={hour.start} hour={hour} unit={hourUnit} />)}</div>
      <div className="imprint-hour-legend">{hourCategories.map(category => <span key={category.label}><i className={category.className}></i>{category.label}</span>)}</div>
      {hourUnit === 'pieces' && <p className="imprint-hour-note">{t('Good and scrap are actual pieces. Other categories show estimated piece equivalents from the ideal cycle. Breaks appear when configured in the source data.')}</p>}
    </section>
    <section className="imprint-bottom"><div className="imprint-panel reasons-panel"><div className="imprint-panel-head"><div><span className="eyebrow">{t('03 / DOWNTIME')}</span><h2>{t('Stop reasons')}</h2></div><span>{t('TOTAL ELAPSED')}</span></div>
      {(data.downtime_reasons || []).length ? <div className="reason-list">{data.downtime_reasons!.slice(0, 5).map(item => <div className="reason-row" key={`${item.category}-${item.reason}`}>
        <span className={`reason-dot ${categoryClass(item.category)}`}></span><span className="reason-name">{item.reason}</span><div className="reason-bar"><i className={categoryClass(item.category)} style={{ width: `${item.seconds / maxReason * 100}%` }}></i></div><strong>{mins(item.seconds)}</strong></div>)}</div>
        : <p className="panel-empty">{data.downtime_detail_available ? t('No recorded stops in this shift.') : t('Reason mapping unavailable.')}</p>}</div>
      <div className="imprint-panel scrap-panel"><div className="imprint-panel-head"><div><span className="eyebrow">{t('04 / QUALITY')}</span><h2>{t('Scrap reporting')}</h2></div><span>{t('{n} PCS / {pct}', { n: fmt(summary.scrap_count), pct: pct2(summary.scrap_percent) })}</span></div>
        <div className="scrap-content"><div className="scrap-hour-chart">{hours.map(hour => <div key={hour.start}><div className="scrap-column"><i style={{ height: `${hour.scrap_count / maxScrap * 100}%` }}></i></div><span>{clock(hour.start)}</span></div>)}</div>
          <div className="scrap-reasons">{(data.scrap_reasons || []).slice(0, 4).map(item => <div key={item.reason}><span>{item.reason}</span><strong>{t('{n} pcs', { n: item.count })}</strong></div>)}
            {!data.scrap_detail_available && <p className="panel-empty">{t('Reason mapping unavailable.')}</p>}</div></div></div></section>
    <footer><span>{data.display.name.toUpperCase()} <span className="footer-sep">/</span> {t('{name} SHIFT', { name: shift.name.toUpperCase() })}</span><span>{summary.warnings.length ? t('DATA QUALITY · {text}', { text: summary.warnings.join(', ') }) : t('DATA QUALITY · OK')}</span><span>{t('UPDATED {time}', { time: updatedAt?.toLocaleTimeString(locale) || '—' })}</span></footer>
  </main>;
}
