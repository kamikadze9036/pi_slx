import { useEffect, useState } from 'react';
import type { DashboardData, Hour } from '../types';
import { displayTheme, themeQuery } from '../theme';
import { ShiftNavigator, displayLink, shiftApiQuery } from '../ShiftNavigator';
import { HourUnitToggle, useHourUnit, type HourUnit } from '../HourUnit';

const VERSION = import.meta.env.VITE_APP_VERSION || 'dev';
const number = (value: number) => new Intl.NumberFormat('en-US').format(value);
const pct = (value: number | null | undefined) => value == null ? '—' : `${Math.round(value * 100)}%`;
const mins = (value: number) => `${Math.round(value / 60)}m`;
const clock = (value: string) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

const categories: { key: keyof Hour; pieces: keyof NonNullable<Hour['piece_equivalents']>;
  label: string; className: string }[] = [
  { key: 'good_seconds', pieces: 'good', label: 'Good production', className: 'good' },
  { key: 'speed_loss_seconds', pieces: 'speed_loss', label: 'Slow running', className: 'speed' },
  { key: 'microstop_seconds', pieces: 'microstop', label: 'Micro stops', className: 'micro' },
  { key: 'downtime_seconds', pieces: 'downtime', label: 'Downtime', className: 'down' },
  { key: 'excluded_break_seconds', pieces: 'break', label: 'Break', className: 'break' },
  { key: 'scrap_loss_seconds', pieces: 'scrap', label: 'Scrap', className: 'scrap' },
  { key: 'unknown_seconds', pieces: 'unknown', label: 'Unknown', className: 'unknown' },
];

function HourRow({ hour, unit }: { hour: Hour; unit: HourUnit }) {
  const equivalents = hour.piece_equivalents;
  const values = categories.map(category => unit === 'minutes'
    ? Number(hour[category.key]) / 60 : equivalents?.[category.pieces] ?? 0);
  const total = unit === 'minutes' ? hour.duration_seconds / 60
    : Math.max(1, values.reduce((sum, value) => sum + value, 0));
  return <div className={`hour-row ${hour.current ? 'is-current' : ''}`}>
    <div className="hour-time"><strong>{clock(hour.start)}</strong><span>{clock(hour.end)}</span></div>
    <div className="bar-wrap">
      <div className="bar" aria-label={`${clock(hour.start)} to ${clock(hour.end)} ${unit} production breakdown`}>
        {unit === 'pieces' && !equivalents ? <span className="hour-piece-unavailable">Ideal cycle unavailable</span>
          : categories.map(({ key, pieces, label, className }, index) => {
          const value = values[index];
          if (value <= 0) return null;
          const width = value / total * 100;
          const amount = unit === 'minutes' ? `${value.toFixed(1)} min` : `${Math.round(value)} pcs`;
          const qualifier = unit === 'pieces' && pieces !== 'good' && pieces !== 'scrap' ? ' equivalent' : '';
          return <div key={key} className={`bar-segment ${className}`} style={{ width: `${width}%` }}
            title={`${label}: ${amount}${qualifier}`} aria-label={`${label}: ${amount}${qualifier}`}>
            {width > 8 ? (unit === 'minutes' ? `${value.toFixed(1)}m` : number(Math.round(value))) : ''}
          </div>;
        })}
      </div>
      {hour.current && unit === 'minutes' && <span className="now-mark">NOW</span>}
    </div>
    <div className="hour-metric"><span>OEE</span><strong>{pct(hour.oee)}</strong></div>
    <div className="hour-metric detail-metric"><span>PERF</span><strong>{pct(hour.performance)}</strong></div>
    <div className="hour-metric detail-metric"><span>GOOD / TGT</span><strong>{number(hour.good_count)}<em>/{hour.target_good == null ? '—' : number(hour.target_good)}</em></strong></div>
    <div className="hour-metric detail-metric"><span>SCRAP</span><strong>{number(hour.scrap_count)}</strong></div>
    <div className="hour-metric detail-metric"><span>{unit === 'minutes' ? 'STOP' : 'STOP EQ'}</span><strong>{unit === 'minutes' ? mins(hour.downtime_seconds) : equivalents ? number(Math.round(equivalents.downtime)) : '—'}</strong></div>
  </div>;
}

function Kpi({ label, value, note, accent }: { label: string; value: string; note?: string; accent?: string }) {
  return <div className={`kpi ${accent || ''}`}><span className="kpi-label">{label}</span><strong>{value}</strong>{note && <span className="kpi-note">{note}</span>}</div>;
}

export function Dashboard({ displayId }: { displayId: string }) {
  const [data, setData] = useState<DashboardData | null>(null);
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
      const controller = new AbortController();
      activeController = controller;
      const timeout = setTimeout(() => controller.abort(), 6000);
      try {
        const response = await fetch(`/api/displays/${encodeURIComponent(displayId)}/dashboard${shiftApiQuery}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const next: DashboardData = await response.json();
        if (mounted) { setData(next); setOffline(false); setUpdatedAt(next.status === 'stale' && next.last_successful_update ? new Date(next.last_successful_update) : new Date()); interval = next.refresh_seconds; }
      } catch {
        if (mounted) setOffline(true);
      } finally {
        clearTimeout(timeout);
        if (activeController === controller) activeController = null;
        if (mounted) timer = setTimeout(refresh, Math.max(3, interval) * 1000);
      }
    }
    refresh();
    const clockTimer = setInterval(() => setNow(new Date()), 1000);
    const heartbeat = () => fetch(`/api/displays/${encodeURIComponent(displayId)}/heartbeat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ frontend_version: VERSION })
    }).catch(() => undefined);
    heartbeat();
    const beatTimer = setInterval(heartbeat, 15000);
    return () => { mounted = false; activeController?.abort(); clearTimeout(timer); clearInterval(clockTimer); clearInterval(beatTimer); };
  }, [displayId]);

  const stale = offline || data?.status === 'stale';
  if (!data) return <main className={`empty-state theme-${displayTheme()}`}><div className="eyebrow">PRODUCTION EFFICIENCY</div><h1>{offline ? 'DATA CONNECTION LOST' : 'Loading display…'}</h1><p>{offline ? 'Reconnecting automatically' : `Display ${displayId}`}</p></main>;
  if (data.status === 'outside_shift') return <main className={`empty-state theme-${displayTheme(data.display.theme)}`}><div className="eyebrow">{data.machine.name}</div><h1>Outside scheduled shift</h1><p>Waiting for the next configured shift</p></main>;
  const production = data.production!;
  const summary = data.summary!;
  const displaySettings = data.display_settings;
  const show = (key: string) => !displaySettings || displaySettings.visible_kpis.includes(key);
  const oeeWarning = summary.oee != null && summary.oee < (displaySettings?.oee_warning_threshold ?? 0.7);
  return <main className={`screen theme-${displayTheme(data.display.theme)}`}>
    <header className="topbar">
      <div className="brand"><span className="brand-mark">P·E</span><span>PRODUCTION<br/>EFFICIENCY</span></div>
      <div className="top-status"><span className={`status-dot ${stale ? 'stale' : ''}`}></span>{stale ? 'DATA CONNECTION LOST' : `${data.shift_navigation?.is_current ? 'CURRENT SHIFT' : 'HISTORICAL SHIFT'} · ${data.data_source === 'mock' ? 'SIMULATED DATA' : 'CICLADES DATA'}`}</div>
      <div className="top-time"><span>{now.toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short' }).toUpperCase()}</span><strong>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</strong></div>
    </header>
    <nav className="view-nav" aria-label="Display views"><a href={`/fleet${themeQuery}`}>PLANT OVERVIEW ↗</a><span className="selected">HOURLY LOSSES</span><a href={displayLink(`/display/${encodeURIComponent(displayId)}/imprint`)}>SHIFT IMPRINT ↗</a></nav>
    {stale && <div className="stale-banner">Showing last available data · Last successful update {updatedAt?.toLocaleTimeString() || 'unknown'} · Retrying</div>}
    <ShiftNavigator displayId={displayId} view="hourly" shift={data.shift!} navigation={data.shift_navigation!} />
    <section className="headline">
      <div className="line-title"><div className="eyebrow">PRODUCTION LINE <span className="slash">/</span> {data.display.id.toUpperCase()}</div>
        <h1>{data.machine.name}</h1><div className="product-line">{production.product || 'Product unavailable'} <span>·</span> {production.order || 'Order unavailable'}</div></div>
      <div className="headline-meta"><div><span>SELECTED SHIFT</span><strong>{data.shift!.name}</strong><small>{clock(data.shift!.start)} — {clock(data.shift!.end)}</small></div>
        <div><span>SHIFT TARGET</span><strong>{production.target == null ? '—' : number(production.target)}</strong><small>GOOD PIECES</small></div>
        <div><span>ACTUAL / Δ</span><strong>{number(production.actual_good)}</strong><small className={(production.delta || 0) < 0 ? 'negative' : 'positive'}>{production.delta == null ? '—' : `${production.delta > 0 ? '+' : ''}${number(production.delta)} VS TARGET`}</small></div></div>
    </section>
    <section className="chart-panel">
      <div className="section-head"><div><span className="eyebrow">01 / SHIFT BREAKDOWN</span><h2>{hourUnit === 'minutes' ? 'Where the time went' : 'Where the output went'}</h2></div>
        <div className="hourly-head-actions"><span className="section-aside">{hourUnit === 'minutes' ? 'HOURLY LOSS COMPOSITION · ELAPSED TIME ONLY' : 'GOOD / SCRAP ACTUAL · LOSSES ESTIMATED'}</span><HourUnitToggle unit={hourUnit} onChange={chooseHourUnit} /></div></div>
      <div className="bar-heading"><span>HOUR</span><span>{hourUnit === 'minutes' ? 'TIME COMPOSITION · 60 MIN CAPACITY' : 'PIECE COMPOSITION · IDEAL CYCLE'}</span><span>OEE</span><span>PERF</span><span>GOOD / TGT</span><span>SCRAP</span><span>{hourUnit === 'minutes' ? 'STOP' : 'STOP EQ'}</span></div>
      <div className="hours">{data.hours!.map(hour => <HourRow key={hour.start} hour={hour} unit={hourUnit} />)}</div>
      <div className="legend">{categories.map(item => <span key={item.key}><i className={item.className}></i>{item.label}</span>)}{hourUnit === 'minutes' && <span><i className="future"></i>Future</span>}</div>
      {hourUnit === 'pieces' && <p className="hour-piece-note">Good and scrap are actual pieces. Other categories are estimated piece equivalents from the ideal cycle. Breaks appear when configured in the source data.</p>}
    </section>
    <section className="summary-panel"><div className="summary-title"><span className="eyebrow">02 / SHIFT PERFORMANCE</span><h2>At a glance</h2></div>
      <div className="kpis">
        {show('oee') && <Kpi label="OVERALL OEE" value={pct(summary.oee)} note={data.shift_navigation?.is_current ? 'SHIFT TO DATE' : 'FULL SHIFT'} accent={oeeWarning ? 'primary warning' : 'primary'} />}
        {show('availability') && <Kpi label="AVAILABILITY" value={pct(summary.availability)} />}
        {show('performance') && <Kpi label="PERFORMANCE" value={pct(summary.performance)} />}
        {show('quality') && <Kpi label="QUALITY" value={pct(summary.quality)} />}
        {show('good') && <Kpi label="GOOD PIECES" value={number(summary.good_count)} accent="green-text" />}
        {show('scrap') && <Kpi label="SCRAP" value={number(summary.scrap_count)} note={`${pct(summary.scrap_percent)} OF TOTAL`} accent="orange-text" />}
        {show('downtime') && <Kpi label="DOWNTIME" value={mins(summary.downtime_seconds)} accent="red-text" />}
        {show('speed_loss') && <Kpi label="SPEED LOSS" value={mins(summary.speed_loss_seconds)} accent="yellow-text" />}
      </div></section>
    <footer><span>{data.display.name.toUpperCase()} <span className="footer-sep">/</span> {data.shift!.name.toUpperCase()} SHIFT</span><span>{summary.warnings.length > 0 ? `DATA QUALITY · ${summary.warnings.join(', ')}` : 'DATA QUALITY · OK'}</span><span>UPDATED {updatedAt?.toLocaleTimeString() || '—'}</span></footer>
  </main>;
}
