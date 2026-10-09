import { useEffect, useState } from 'react';
import type { FleetData, FleetMachine } from '../types';
import { displayTheme, themeQuery } from '../theme';
import { t, LangSwitch, locale, formatNumber } from '../i18n';

const fmt = (value: number | null) => value == null ? '—' : formatNumber(value);
const pct = (value: number | null) => value == null ? '—' : `${Math.round(value * 100)}%`;
const mins = (value: number | null) => value == null ? '—' : `${Math.round(value / 60)}m`;
const cycle = (value: number | null) => value == null ? '—' : `${value.toFixed(1)}s`;
const age = (value: number | null) => value == null ? '—' : value < 60 ? `${Math.round(value)}s` : `${Math.round(value / 60)}m`;
const liveLabels: Record<string, string> = {
  bezi: t('RUNNING'), stoji: t('STOPPED'), bez_zakazky: t('NO ORDER'), neznamo: t('UNKNOWN')
};
const kpiLabels: Record<string, string> = {
  on_track: t('OEE ON TARGET'), attention: t('OEE BELOW LIMIT'), stale: t('OLD KPI DATA'),
  no_data: t('OEE UNAVAILABLE'), outside_shift: t('OUTSIDE SHIFT'),
  unavailable: t('MES UNAVAILABLE'), unconfigured: t('KPI NOT CONNECTED')
};

function MachineCard({ machine, liveOnly }: { machine: FleetMachine; liveOnly: boolean }) {
  const href = machine.display_id ? `/display/${encodeURIComponent(machine.display_id)}${themeQuery}` : machine.live_detail_url;
  const statusClass = machine.live_state === 'stoji' ? 'is-stopped'
    : machine.live_state === 'bez_zakazky' ? 'is-no-order'
    : !liveOnly && machine.kpi_state === 'attention' ? 'is-attention'
    : machine.live_state === 'bezi' ? 'is-running' : 'is-unknown';
  const content = <>
    <div className="fleet-card-top"><strong>{machine.mes_id}</strong><span className="fleet-live-label">{liveLabels[machine.live_state || ''] || t('STATE UNKNOWN')}</span></div>
    <div className="fleet-card-name">{machine.tool_ref || '—'}</div>
    <div className="fleet-card-order" title={machine.order || ''}>{machine.stop_reason && machine.live_state === 'stoji'
      ? t('STOP · {reason}', { reason: machine.stop_reason }) : machine.order ? t('OF · {order}', { order: machine.order }) : t('NO ACTIVE ORDER DATA')}</div>
    {liveOnly ? <>
      <div className="fleet-card-main"><div><small>{t('ACTUAL / PLANNED CYCLE')}</small><strong>{cycle(machine.cycle_time_real_s)}</strong></div>
        <div className="fleet-good"><small>{t('PLAN')}</small><strong>{cycle(machine.cycle_time_planned_s)}</strong></div></div>
      <div className="fleet-card-metrics fleet-live-metrics"><span title={t('Worst cavity reject rate for the current order, not this shift')}>{t('WORST CAVITY · OF')} <strong>{machine.worst_cavity_scrap ? `${machine.worst_cavity_scrap.reject_pct.toFixed(2)}%` : '—'}</strong></span>
        <span>{machine.worst_cavity_scrap?.cavity_no != null ? t('CAVITY {no}', { no: machine.worst_cavity_scrap.cavity_no }) : ''}</span></div>
      <div className="fleet-card-foot"><span>{machine.collector_status === 'ok' ? t('E63 COLLECTOR OK · CYCLE {age}', { age: age(machine.last_cycle_age_s) })
        : machine.collector_status === 'stale' ? t('E63 COLLECTOR STALE') : t('EUROMAP63 STATE FEED')}</span><b>{href ? 'DETAIL ↗' : '—'}</b></div>
    </> : <>
      <div className="fleet-card-main"><div><small>{t('SHIFT OEE')}</small><strong>{pct(machine.oee)}</strong></div>
        <div className="fleet-good"><small>{t('GOOD / TARGET')}</small><strong>{fmt(machine.good_count)}<em> / {fmt(machine.target_good)}</em></strong></div></div>
      <div className="fleet-progress"><i style={{ width: `${machine.good_count != null && machine.target_good ? Math.min(100, machine.good_count / machine.target_good * 100) : 0}%` }} /></div>
      <div className="fleet-card-metrics"><span>{t('SCRAP')} <strong>{fmt(machine.scrap_count)}</strong></span><span>{t('DOWNTIME')} <strong>{mins(machine.downtime_seconds)}</strong></span></div>
      <div className="fleet-card-foot"><span>{kpiLabels[machine.kpi_state]}</span><b>{href ? 'DETAIL ↗' : '—'}</b></div>
    </>}
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
  if (!data) return <main className={`empty-state theme-${theme}`}><span className="eyebrow">{t('PLANT OVERVIEW')}</span>
    <h1>{offline ? t('DATA CONNECTION LOST') : t('Loading machines…')}</h1>
    <p>{offline ? t('Reconnecting automatically') : t('Machine state and recorded shift activity')}</p></main>;

  const source = data.live_source === 'euromap63' ? t('EUROMAP63 LIVE STATE')
    : data.live_source === 'demo' ? t('DEMO / SIMULATED DATA')
    : data.live_source === 'unavailable' ? t('LIVE STATE CONNECTION LOST') : t('LIVE STATE NOT CONNECTED');
  const kpiSource = data.data_source === 'mock' ? t('SIMULATED SHIFT KPI') : t('CICLADES SHIFT KPI');
  const liveOnly = data.data_source === 'euromap63' || (data.data_source === 'mock' && data.live_source !== 'demo');
  const coverage = data.machines.filter(machine => machine.oee != null && machine.kpi_state !== 'stale').length;
  return <main className={`screen fleet-screen theme-${theme}`}>
    <header className="topbar"><div className="brand"><span className="brand-mark">P·E</span><span>PRODUCTION<br/>EFFICIENCY</span></div>
      <div className="top-status"><span className={`status-dot ${offline ? 'stale' : ''}`}></span>{offline ? t('DATA CONNECTION LOST') : liveOnly ? t('{source} · LIVE VALUES', { source }) : `${source} · ${kpiSource}`}</div>
      <div className="top-time"><span>{now.toLocaleDateString(locale, { weekday: 'short', day: '2-digit', month: 'short' }).toUpperCase()}</span>
        <strong>{now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false })}</strong><LangSwitch /></div></header>
    {offline && <div className="stale-banner">{t('Showing last available plant overview · Retrying')}</div>}
    <section className="fleet-head"><div><span className="eyebrow">{t('PLANT / INJECTION MOULDING')}</span><h1>{t('Production overview')}</h1>
      <p>{liveOnly ? t('{n} presses · machine state, cycle and current-order cavity scrap', { n: data.summary.total }) : t('{n} presses · live state and current shift performance', { n: data.summary.total })}</p></div>
      <div className="fleet-head-side"><span>{liveOnly ? t('LIVE DATA') : kpiSource}</span><strong>{liveOnly ? `${fmt(data.summary.with_cycle_time)} / ${data.summary.total}` : `${coverage} / ${data.summary.total}`}</strong><small>{liveOnly ? t('CYCLE TIME COVERAGE') : t('SHIFT KPI COVERAGE')}</small></div></section>
    <section className="fleet-summary" aria-label={t('Plant summary')}>
      <div><span>{t('RUNNING')}</span><strong className="run-color">{fmt(data.summary.running)}</strong></div>
      <div><span>{t('STOPPED')}</span><strong className="stop-color">{fmt(data.summary.stopped)}</strong></div>
      <div><span>{t('NO ORDER')}</span><strong>{fmt(data.summary.without_order)}</strong></div>
      {liveOnly ? <>
        <div><span>{t('CYCLE TIMES')}</span><strong>{fmt(data.summary.with_cycle_time)}</strong></div>
        <div><span>{t('EUROMAP COLLECTORS')}</span><strong>{fmt(data.summary.collectors_online)}</strong></div>
        <div><span>{t('STALE COLLECTORS')}</span><strong className="warn-color">{fmt(data.summary.collectors_stale)}</strong></div>
      </> : <>
        <div><span>{t('LOW OEE')}</span><strong className="warn-color">{data.summary.attention}</strong></div>
        <div><span>{t('DATA GAPS')}</span><strong>{data.summary.unavailable}</strong></div>
        <div><span>{t('AVERAGE OEE')}</span><strong>{pct(data.summary.average_oee)}</strong></div>
      </>}
    </section>
    <div className="fleet-grid" aria-label={t('Machines')}>{data.machines.map(machine => <MachineCard key={machine.id} machine={machine} liveOnly={liveOnly} />)}</div>
    <footer><span>{data.data_source === 'euromap63' ? t('SHIFT VIEWS: RECORDED CYCLES / STOPS') : liveOnly ? t('SHIFT KPI DEMO ONLY IN DETAIL') : t('SHIFT OEE LIMIT {n}%', { n: Math.round(data.oee_warning_threshold * 100) })} <span className="footer-sep">/</span> {t('LIVE STATE: {source}', { source })} <span className="footer-sep">/</span> {liveOnly ? t('CAVITY SCRAP = CURRENT ORDER') : kpiSource}</span>
      <span>{t('SHOWN BY MACHINE NUMBER · SELECT A PRESS FOR DETAILS')}</span><span>{t('UPDATED {time}', { time: updatedAt?.toLocaleTimeString(locale) || '—' })}</span></footer>
  </main>;
}
