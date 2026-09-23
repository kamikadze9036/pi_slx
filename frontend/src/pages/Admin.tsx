import { useEffect, useState } from 'react';
import type { DashboardSettings, Display, Machine, Shift } from '../types';

type Tab = 'displays' | 'machines' | 'shifts' | 'settings';
const kpiLabels: Record<string, string> = { oee: 'OEE', availability: 'Availability', performance: 'Performance',
  quality: 'Quality', good: 'Good pieces', scrap: 'Scrap', downtime: 'Downtime', speed_loss: 'Speed loss' };
const emptyDisplay: Display = { id: '', name: '', machine_id: 'demo-machine', dashboard_type: 'production-efficiency', theme: 'dark', active: true, online: false, last_seen: null };
const emptyMachine: Machine = { id: '', mes_id: '', name: '', active: true, fleet_enabled: true, pieces_per_cycle: 1, ideal_cycle_seconds: null };
const emptyShift: Shift = { id: '', name: '', start_time: '06:00', end_time: '14:00', days: [0, 1, 2, 3, 4], active: true };

export function Admin() {
  const [key, setKey] = useState(sessionStorage.getItem('admin-key') || '');
  const [keyInput, setKeyInput] = useState(key);
  const [tab, setTab] = useState<Tab>('displays');
  const [machines, setMachines] = useState<Machine[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [displays, setDisplays] = useState<Display[]>([]);
  const [form, setForm] = useState<Display | Machine | Shift>(emptyDisplay);
  const [dashboardSettings, setDashboardSettings] = useState<DashboardSettings>({ refresh_seconds: 10,
    visible_kpis: Object.keys(kpiLabels), oee_warning_threshold: 0.7 });
  const [message, setMessage] = useState('');

  async function load() {
    try {
      const [machineResponse, shiftResponse, displayResponse, settingsResponse] = await Promise.all([
        fetch('/api/machines'), fetch('/api/config/shifts'),
        fetch('/api/admin/displays', { headers: { 'X-Admin-Key': key } }),
        fetch('/api/config/dashboard-settings')
      ]);
      if (!displayResponse.ok) throw new Error('Admin key required or invalid');
      setMachines(await machineResponse.json()); setShifts(await shiftResponse.json()); setDisplays(await displayResponse.json());
      if (settingsResponse.ok) setDashboardSettings(await settingsResponse.json());
      setMessage('');
    } catch (error) { setMessage(String(error)); }
  }
  useEffect(() => { if (key) { sessionStorage.setItem('admin-key', key); load(); } }, [key]);
  useEffect(() => { setForm(tab === 'displays' ? emptyDisplay : tab === 'machines' ? emptyMachine : emptyShift); }, [tab]);

  function update(name: string, value: unknown) { setForm(current => ({ ...current, [name]: value })); }
  async function save() {
    if (!form.id) { setMessage('ID is required'); return; }
    const payload = tab === 'machines' ? { ...form, ideal_cycle_seconds: (form as Machine).ideal_cycle_seconds || null }
      : tab === 'displays' ? {
          id: form.id, name: form.name, machine_id: (form as Display).machine_id,
          dashboard_type: (form as Display).dashboard_type, theme: (form as Display).theme, active: form.active
        } : form;
    try {
      const response = await fetch(`/api/admin/${tab}/${encodeURIComponent(form.id)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Admin-Key': key }, body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error((await response.json()).detail || `HTTP ${response.status}`);
      await load(); setMessage('Saved');
    } catch (error) { setMessage(String(error)); }
  }
  async function saveSettings() {
    try {
      const response = await fetch('/api/admin/dashboard-settings', { method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Key': key }, body: JSON.stringify(dashboardSettings) });
      if (!response.ok) throw new Error((await response.json()).detail || `HTTP ${response.status}`);
      setDashboardSettings(await response.json()); setMessage('Saved');
    } catch (error) { setMessage(String(error)); }
  }
  const items = tab === 'displays' ? displays : tab === 'machines' ? machines : tab === 'shifts' ? shifts : [];
  return <main className="admin-page"><header className="admin-header"><div><div className="eyebrow">PRODUCTION EFFICIENCY</div><h1>Configuration</h1></div><a href="/display/demo">OPEN DEMO DISPLAY ↗</a></header>
    <div className="admin-key"><label>ADMIN API KEY<input type="password" value={keyInput} onChange={event => setKeyInput(event.target.value)} placeholder="Enter key from .env" /></label><button onClick={() => keyInput === key ? load() : setKey(keyInput)}>CONNECT</button></div>
    <nav className="admin-tabs">{(['displays', 'machines', 'shifts', 'settings'] as Tab[]).map(value => <button key={value} className={tab === value ? 'active' : ''} onClick={() => { setTab(value); setMessage(''); }}>{value.toUpperCase()}</button>)}</nav>
    {tab === 'settings' ? <section className="admin-form settings-form"><h2>DASHBOARD SETTINGS</h2>
      <label>REFRESH INTERVAL (SECONDS)<input type="number" min="3" max="300" value={dashboardSettings.refresh_seconds} onChange={event => setDashboardSettings(current => ({ ...current, refresh_seconds: Number(event.target.value) }))} /></label>
      <label>OEE WARNING BELOW (%)<input type="number" min="0" max="100" value={Math.round(dashboardSettings.oee_warning_threshold * 100)} onChange={event => setDashboardSettings(current => ({ ...current, oee_warning_threshold: Number(event.target.value) / 100 }))} /></label>
      <div className="eyebrow">VISIBLE SHIFT KPI</div><div className="settings-kpis">{Object.entries(kpiLabels).map(([value, label]) => <label className="check" key={value}><input type="checkbox" checked={dashboardSettings.visible_kpis.includes(value)} onChange={event => setDashboardSettings(current => ({ ...current,
        visible_kpis: event.target.checked ? [...current.visible_kpis, value] : current.visible_kpis.filter(key => key !== value) }))} /> {label}</label>)}</div>
      <button className="save-button" onClick={saveSettings}>SAVE SETTINGS</button>{message && <p className="admin-message">{message}</p>}</section>
    : <div className="admin-grid"><section className="admin-list"><h2>{tab.toUpperCase()}</h2>{items.map(item => <button key={item.id} onClick={() => setForm(item)}><strong>{item.name}</strong><small>{item.id}{'online' in item ? ` · ${(item as Display).online ? 'ONLINE' : 'OFFLINE'}` : ''}</small></button>)}<button className="new-item" onClick={() => setForm(tab === 'displays' ? emptyDisplay : tab === 'machines' ? emptyMachine : emptyShift)}>+ NEW {tab.slice(0, -1).toUpperCase()}</button></section>
      <section className="admin-form"><h2>{form.id ? `EDIT ${form.id}` : `NEW ${tab.slice(0, -1).toUpperCase()}`}</h2>
        <label>ID<input value={form.id} onChange={event => update('id', event.target.value)} /></label>
        <label>NAME<input value={form.name} onChange={event => update('name', event.target.value)} /></label>
        {tab === 'displays' && <><label>MACHINE<select value={(form as Display).machine_id} onChange={event => update('machine_id', event.target.value)}>{machines.map(machine => <option key={machine.id} value={machine.id}>{machine.name}</option>)}</select></label><label>DASHBOARD TYPE<select value={(form as Display).dashboard_type} onChange={event => update('dashboard_type', event.target.value)}><option value="production-efficiency">Hourly losses</option><option value="shift-imprint">Shift imprint</option></select></label><label>DISPLAY THEME<select value={(form as Display).theme} onChange={event => update('theme', event.target.value)}><option value="dark">Dark</option><option value="light">Light</option></select></label></>}
        {tab === 'machines' && <><label>CICLADES MACHINE ID<input value={(form as Machine).mes_id} onChange={event => update('mes_id', event.target.value)} /></label><label>PIECES PER CYCLE<input type="number" min="1" value={(form as Machine).pieces_per_cycle} onChange={event => update('pieces_per_cycle', Number(event.target.value))} /></label><label>FALLBACK IDEAL CYCLE (SECONDS)<input type="number" min="0" step="0.1" value={(form as Machine).ideal_cycle_seconds ?? ''} onChange={event => update('ideal_cycle_seconds', event.target.value ? Number(event.target.value) : null)} /></label><label className="check"><input type="checkbox" checked={(form as Machine).fleet_enabled} onChange={event => update('fleet_enabled', event.target.checked)} /> SHOW IN PLANT OVERVIEW</label></>}
        {tab === 'shifts' && <><label>START<input type="time" value={(form as Shift).start_time.slice(0, 5)} onChange={event => update('start_time', event.target.value)} /></label><label>END<input type="time" value={(form as Shift).end_time.slice(0, 5)} onChange={event => update('end_time', event.target.value)} /></label><label>WEEKDAYS (MON=0, COMMA SEPARATED)<input value={(form as Shift).days.join(',')} onChange={event => update('days', event.target.value.split(',').map(Number))} /></label></>}
        <label className="check"><input type="checkbox" checked={form.active} onChange={event => update('active', event.target.checked)} /> ACTIVE</label>
        <button className="save-button" onClick={save}>SAVE CONFIGURATION</button>{message && <p className="admin-message">{message}</p>}</section></div>}
  </main>;
}
