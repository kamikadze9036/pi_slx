import { useEffect, useState } from 'react';
import type { FleetData, FleetMachine } from '../types';
import { displayTheme, themeQuery } from '../theme';

const fmt = (value: number | null) => value == null ? '—' : new Intl.NumberFormat('en-US').format(value);
const pct = (value: number | null) => value == null ? '—' : `${Math.round(value * 100)}%`;
const mins = (value: number | null) => value == null ? '—' : `${Math.round(value / 60)}m`;
const liveLabels: Record<string, string> = {
  bezi: 'RUNNING', stoji: 'STOPPED', bez_zakazky: 'NO ORDER', neznamo: 'UNKNOWN'
};
const kpiLabels: Record<string, string> = {
  on_track: 'OEE ON TARGET', attention: 'OEE BELOW LIMIT', stale: 'OLD KPI DATA',
  no_data: 'OEE UNAVAILABLE', outside_shift: 'OUTSIDE SHIFT',
  unavailable: 'MES UNAVAILABLE', unconfigured: 'KPI NOT CONNECTED'
};

function MachineCard({ machine }: { machine: FleetMachine }) {
  const href = machine.display_id ? `/display/${encodeURIComponent(machine.display_id)}${themeQuery}` : machine.live_detail_url;
  const statusClass = machine.live_state === 'stoji' ? 'is-stopped'
    : machine.live_state === 'bez_zakazky' ? 'is-no-order'
    : machine.kpi_state === 'attention' ? 'is-attention'
    : machine.live_state === 'bezi' ? 'is-running' : 'is-unknown';
  const content = <>
    <div className="fleet-card-top"><strong>{machine.mes_id}</strong><span className="fleet-live-label">{liveLabels[machine.live_state || ''] || 'STATE UNKNOWN'}</span></div>
    <div className="fleet-card-name" title={machine.name}>{machine.name}</div>
    <div className="fleet-card-order" title={machine.order || ''}>{machine.stop_reason && machine.live_state === 'stoji'
      ? `STOP · ${machine.stop_reason}` : machine.order ? `OF · ${machine.order}` : 'NO ACTIVE ORDER DATA'}</div>
    <div className="fleet-card-main"><div><small>SHIFT OEE</small><strong>{pct(machine.oee)}</strong></div>
      <div className="fleet-good"><small>GOOD / TARGET</small><strong>{fmt(machine.good_count)}<em> / {fmt(machine.target_good)}</em></strong></div></div>
    <div className="fleet-progress"><i style={{ width: `${machine.good_count != null && machine.target_good ? Math.min(100, machine.good_count / machine.target_good * 100) : 0}%` }} /></div>
    <div className="fleet-card-metrics"><span>SCRAP <strong>{fmt(machine.scrap_count)}</strong></span><span>DOWNTIME <strong>{mins(machine.downtime_seconds)}</strong></span></div>
    <div className="fleet-card-foot"><span>{kpiLabels[machine.kpi_state]}</span><b>{href ? 'DETAIL ↗' : '—'}</b></div>
  </>;
  return href ? <a className={`fleet-card ${statusClass}`} href={href}>{content}</a>
    : <article className={`fleet-card ${statusClass}`}>{content}</article>;
}

export function Fleet() {
  const [data, setData] = useState<FleetData | null>(null);
  const [offline, setOffline] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setTimeout>;
    let interval = 20;
    let controller: AbortController | null = null;
    async function refresh() {
      const request = new AbortController(); controller = request;
      const timeout = setTimeout(() => request.abort(), 25000);
      try {
        const response = await fetch('/api/fleet/dashboard', { signal: request.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const next: FleetData = await response.json();
        if (mounted) { setData(next); setOffline(false); setUpdatedAt(new Date()); interval = next.refresh_seconds; }
      } catch { if (mounted) setOffline(true); }
      finally { clearTimeout(timeout); if (controller === request) controller = null;
        if (mounted) timer = setTimeout(refresh, Math.max(15, interval) * 1000); }
    }
    refresh();
    const clockTimer = setInterval(() => setNow(new Date()), 1000);
    return () => { mounted = false; controller?.abort(); clearTimeout(timer); clearInterval(clockTimer); };
  }, []);

  const theme = displayTheme('light');
  if (!data) return <main className={`empty-state theme-${theme}`}><span className="eyebrow">PLANT OVERVIEW</span>
    <h1>{offline ? 'DATA CONNECTION LOST' : 'Loading machines…'}</h1>
    <p>{offline ? 'Reconnecting automatically' : 'Shift performance and live state'}</p></main>;

  const source = data.live_source === 'euromap63' ? 'EUROMAP63 LIVE STATE'
    : data.live_source === 'demo' ? 'DEMO / SIMULATED DATA'
    : data.live_source === 'unavailable' ? 'LIVE STATE CONNECTION LOST' : 'LIVE STATE NOT CONNECTED';
  const coverage = data.machines.filter(machine => machine.oee != null && machine.kpi_state !== 'stale').length;
  return <main className={`screen fleet-screen theme-${theme}`}>
    <header className="topbar"><div className="brand"><span className="brand-mark">P·E</span><span>PRODUCTION<br/>EFFICIENCY</span></div>
      <div className="top-status"><span className={`status-dot ${offline ? 'stale' : ''}`}></span>{offline ? 'DATA CONNECTION LOST' : source}</div>
      <div className="top-time"><span>{now.toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short' }).toUpperCase()}</span>
        <strong>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</strong></div></header>
    {offline && <div className="stale-banner">Showing last available plant overview · Retrying</div>}
    <section className="fleet-head"><div><span className="eyebrow">PLANT / INJECTION MOULDING</span><h1>Production overview</h1>
      <p>{data.summary.total} presses · live state and current shift performance</p></div>
      <div className="fleet-head-side"><span>{source}</span><strong>{coverage} / {data.summary.total}</strong><small>SHIFT KPI COVERAGE</small></div></section>
    <section className="fleet-summary" aria-label="Plant summary">
      <div><span>RUNNING</span><strong className="run-color">{fmt(data.summary.running)}</strong></div>
      <div><span>STOPPED</span><strong className="stop-color">{fmt(data.summary.stopped)}</strong></div>
      <div><span>NO ORDER</span><strong>{fmt(data.summary.without_order)}</strong></div>
      <div><span>LOW OEE</span><strong className="warn-color">{data.summary.attention}</strong></div>
      <div><span>DATA GAPS</span><strong>{data.summary.unavailable}</strong></div>
      <div><span>AVERAGE OEE</span><strong>{pct(data.summary.average_oee)}</strong></div>
    </section>
    <div className="fleet-grid" aria-label="Machines">{data.machines.map(machine => <MachineCard key={machine.id} machine={machine} />)}</div>
    <footer><span>SHIFT OEE LIMIT {Math.round(data.oee_warning_threshold * 100)}% <span className="footer-sep">/</span> LIVE STATE: {source}</span>
      <span>SHOWN BY MACHINE NUMBER · SELECT A PRESS FOR DETAILS</span><span>UPDATED {updatedAt?.toLocaleTimeString() || '—'}</span></footer>
  </main>;
}
