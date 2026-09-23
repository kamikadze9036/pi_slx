import { useEffect, useState } from 'react';
import type { DashboardData, Hour } from '../types';
import { displayTheme, themeQuery } from '../theme';

const VERSION = import.meta.env.VITE_APP_VERSION || 'dev';
const number = (value: number) => new Intl.NumberFormat('en-US').format(value);
const pct = (value: number | null | undefined) => value == null ? '—' : `${Math.round(value * 100)}%`;
const mins = (value: number) => `${Math.round(value / 60)}m`;
const clock = (value: string) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

const categories: { key: keyof Hour; label: string; className: string }[] = [
  { key: 'good_seconds', label: 'Good production', className: 'good' },
  { key: 'speed_loss_seconds', label: 'Speed loss', className: 'speed' },
  { key: 'microstop_seconds', label: 'Micro stops', className: 'micro' },
  { key: 'downtime_seconds', label: 'Downtime', className: 'down' },
  { key: 'scrap_loss_seconds', label: 'Scrap loss', className: 'scrap' },
  { key: 'unknown_seconds', label: 'Unknown', className: 'unknown' },
];

function HourRow({ hour }: { hour: Hour }) {
  return <div className={`hour-row ${hour.current ? 'is-current' : ''}`}>
    <div className="hour-time"><strong>{clock(hour.start)}</strong><span>{clock(hour.end)}</span></div>
    <div className="bar-wrap">
      <div className="bar" aria-label={`${clock(hour.start)} to ${clock(hour.end)} production loss breakdown`}>
        {categories.map(({ key, label, className }) => {
          const value = hour[key] as number;
          if (!value) return null;
          const width = value / hour.duration_seconds * 100;
          return <div key={key} className={`bar-segment ${className}`} style={{ width: `${width}%` }}
            title={`${label}: ${(value / 60).toFixed(1)} min`} aria-label={`${label}: ${(value / 60).toFixed(1)} minutes`}>
            {width > 8 ? `${(value / 60).toFixed(1)}m` : ''}
          </div>;
        })}
      </div>
      {hour.current && <span className="now-mark">NOW</span>}
    </div>
    <div className="hour-metric"><span>OEE</span><strong>{pct(hour.oee)}</strong></div>
    <div className="hour-metric detail-metric"><span>PERF</span><strong>{pct(hour.performance)}</strong></div>
    <div className="hour-metric detail-metric"><span>GOOD / TGT</span><strong>{number(hour.good_count)}<em>/{hour.target_good == null ? '—' : number(hour.target_good)}</em></strong></div>
    <div className="hour-metric detail-metric"><span>SCRAP</span><strong>{number(hour.scrap_count)}</strong></div>
    <div className="hour-metric detail-metric"><span>STOP</span><strong>{mins(hour.downtime_seconds)}</strong></div>
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
        const response = await fetch(`/api/displays/${encodeURIComponent(displayId)}/dashboard`, { signal: controller.signal });
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
      <div className="top-status"><span className={`status-dot ${stale ? 'stale' : ''}`}></span>{stale ? 'DATA CONNECTION LOST' : 'LIVE MONITORING'}</div>
      <div className="top-time"><span>{now.toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short' }).toUpperCase()}</span><strong>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</strong></div>
    </header>
    <nav className="view-nav" aria-label="Display views"><a href={`/fleet${themeQuery}`}>PLANT OVERVIEW ↗</a><span className="selected">HOURLY LOSSES</span><a href={`/display/${encodeURIComponent(displayId)}/imprint${themeQuery}`}>SHIFT IMPRINT ↗</a></nav>
    {stale && <div className="stale-banner">Showing last available data · Last successful update {updatedAt?.toLocaleTimeString() || 'unknown'} · Retrying</div>}
    <section className="headline">
      <div className="line-title"><div className="eyebrow">PRODUCTION LINE <span className="slash">/</span> {data.display.id.toUpperCase()}</div>
        <h1>{data.machine.name}</h1><div className="product-line">{production.product || 'Product unavailable'} <span>·</span> {production.order || 'Order unavailable'}</div></div>
      <div className="headline-meta"><div><span>ACTIVE SHIFT</span><strong>{data.shift!.name}</strong><small>{clock(data.shift!.start)} — {clock(data.shift!.end)}</small></div>
        <div><span>SHIFT TARGET</span><strong>{production.target == null ? '—' : number(production.target)}</strong><small>GOOD PIECES</small></div>
        <div><span>ACTUAL / Δ</span><strong>{number(production.actual_good)}</strong><small className={(production.delta || 0) < 0 ? 'negative' : 'positive'}>{production.delta == null ? '—' : `${production.delta > 0 ? '+' : ''}${number(production.delta)} VS TARGET`}</small></div></div>
    </section>
    <section className="chart-panel">
      <div className="section-head"><div><span className="eyebrow">01 / SHIFT BREAKDOWN</span><h2>Where the time went</h2></div><span className="section-aside">HOURLY LOSS COMPOSITION <span>·</span> ELAPSED TIME ONLY</span></div>
      <div className="bar-heading"><span>HOUR</span><span>TIME COMPOSITION <i></i> 60 MIN CAPACITY</span><span>OEE</span><span>PERF</span><span>GOOD / TGT</span><span>SCRAP</span><span>STOP</span></div>
      <div className="hours">{data.hours!.map(hour => <HourRow key={hour.start} hour={hour} />)}</div>
      <div className="legend">{categories.map(item => <span key={item.key}><i className={item.className}></i>{item.label}</span>)}<span><i className="future"></i>Future</span></div>
    </section>
    <section className="summary-panel"><div className="summary-title"><span className="eyebrow">02 / SHIFT PERFORMANCE</span><h2>At a glance</h2></div>
      <div className="kpis">
        {show('oee') && <Kpi label="OVERALL OEE" value={pct(summary.oee)} note="SHIFT TO DATE" accent={oeeWarning ? 'primary warning' : 'primary'} />}
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
