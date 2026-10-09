import { useEffect, useState } from 'react';
import type { DashboardSettings, Display, Machine, Shift } from '../types';
import { t, LangSwitch } from '../i18n';

type Tab = 'displays' | 'machines' | 'shifts' | 'settings';
const kpiLabels: Record<string, string> = { oee: 'OEE', availability: t('Availability'), performance: t('Performance'),
  quality: t('Quality'), good: t('Good pieces'), scrap: t('Scrap'), downtime: t('Downtime'), speed_loss: t('Speed loss') };
const emptyDisplay: Display = { id: '', name: '', machine_id: 'demo-machine', dashboard_type: 'hourly-new', theme: 'dark', active: true, online: false, last_seen: null };
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
      if (!displayResponse.ok) throw new Error(t('Admin key required or invalid'));
      setMachines(await machineResponse.json()); setShifts(await shiftResponse.json()); setDisplays(await displayResponse.json());
      if (settingsResponse.ok) setDashboardSettings(await settingsResponse.json());
      setMessage('');
    } catch (error) { setMessage(String(error)); }
  }
  useEffect(() => { if (key) { sessionStorage.setItem('admin-key', key); load(); } }, [key]);
  useEffect(() => { setForm(tab === 'displays' ? emptyDisplay : tab === 'machines' ? emptyMachine : emptyShift); }, [tab]);

  function update(name: string, value: unknown) { setForm(current => ({ ...current, [name]: value })); }
  async function save() {
    if (!form.id) { setMessage(t('ID is required')); return; }
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
      await load(); setMessage(t('Saved'));
    } catch (error) { setMessage(String(error)); }
  }
  async function saveSettings() {
    try {
      const response = await fetch('/api/admin/dashboard-settings', { method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Key': key }, body: JSON.stringify(dashboardSettings) });
      if (!response.ok) throw new Error((await response.json()).detail || `HTTP ${response.status}`);
      setDashboardSettings(await response.json()); setMessage(t('Saved'));
    } catch (error) { setMessage(String(error)); }
  }
  const items = tab === 'displays' ? displays : tab === 'machines' ? machines : tab === 'shifts' ? shifts : [];
  return <main className="admin-page"><header className="admin-header"><div><div className="eyebrow">{t('PRODUCTION EFFICIENCY')}</div><h1>{t('Configuration')}</h1></div><LangSwitch /><a href="/display/demo">{t('OPEN DEMO DISPLAY ↗')}</a></header>
    <div className="admin-key"><label>{t('ADMIN API KEY')}<input type="password" value={keyInput} onChange={event => setKeyInput(event.target.value)} placeholder={t('Enter key from .env')} /></label><button onClick={() => keyInput === key ? load() : setKey(keyInput)}>{t('CONNECT')}</button></div>
    <nav className="admin-tabs">{(['displays', 'machines', 'shifts', 'settings'] as Tab[]).map(value => <button key={value} className={tab === value ? 'active' : ''} onClick={() => { setTab(value); setMessage(''); }}>{t(value).toUpperCase()}</button>)}</nav>
    {tab === 'settings' ? <section className="admin-form settings-form"><h2>{t('DASHBOARD SETTINGS')}</h2>
      <label>{t('REFRESH INTERVAL (SECONDS)')}<input type="number" min="3" max="300" value={dashboardSettings.refresh_seconds} onChange={event => setDashboardSettings(current => ({ ...current, refresh_seconds: Number(event.target.value) }))} /></label>
      <label>{t('OEE WARNING BELOW (%)')}<input type="number" min="0" max="100" value={Math.round(dashboardSettings.oee_warning_threshold * 100)} onChange={event => setDashboardSettings(current => ({ ...current, oee_warning_threshold: Number(event.target.value) / 100 }))} /></label>
      <div className="eyebrow">{t('VISIBLE SHIFT KPI')}</div><div className="settings-kpis">{Object.entries(kpiLabels).map(([value, label]) => <label className="check" key={value}><input type="checkbox" checked={dashboardSettings.visible_kpis.includes(value)} onChange={event => setDashboardSettings(current => ({ ...current,
        visible_kpis: event.target.checked ? [...current.visible_kpis, value] : current.visible_kpis.filter(key => key !== value) }))} /> {label}</label>)}</div>
      <button className="save-button" onClick={saveSettings}>{t('SAVE SETTINGS')}</button>{message && <p className="admin-message">{message}</p>}</section>
    : <div className="admin-grid"><section className="admin-list"><h2>{t(tab).toUpperCase()}</h2>{items.map(item => <button key={item.id} onClick={() => setForm(item)}><strong>{item.name}</strong><small>{item.id}{'online' in item ? ` · ${(item as Display).online ? t('ONLINE') : t('OFFLINE')}` : ''}</small></button>)}<button className="new-item" onClick={() => setForm(tab === 'displays' ? emptyDisplay : tab === 'machines' ? emptyMachine : emptyShift)}>+ {t('NEW')} {t(tab.slice(0, -1)).toUpperCase()}</button></section>
      <section className="admin-form"><h2>{form.id ? t('EDIT {id}', { id: form.id }) : `${t('NEW')} ${t(tab.slice(0, -1)).toUpperCase()}`}</h2>
        <label>ID<input value={form.id} onChange={event => update('id', event.target.value)} /></label>
        <label>{t('NAME')}<input value={form.name} onChange={event => update('name', event.target.value)} /></label>
        {tab === 'displays' && <><label>{t('MACHINE')}<select value={(form as Display).machine_id} onChange={event => update('machine_id', event.target.value)}>{machines.map(machine => <option key={machine.id} value={machine.id}>{machine.name}</option>)}</select></label><label>{t('DASHBOARD TYPE')}<select value={(form as Display).dashboard_type} onChange={event => update('dashboard_type', event.target.value)}>{(form as Display).dashboard_type === 'production-efficiency' && <option value="production-efficiency">{t('Hourly losses (legacy)')}</option>}<option value="hourly-new">{t('New hourly overview')}</option><option value="shift-imprint">{t('Shift imprint')}</option></select></label><label>{t('DISPLAY THEME')}<select value={(form as Display).theme} onChange={event => update('theme', event.target.value)}><option value="dark">{t('Dark')}</option><option value="light">{t('Light')}</option></select></label></>}
        {tab === 'machines' && <><label>{t('CICLADES MACHINE ID')}<input value={(form as Machine).mes_id} onChange={event => update('mes_id', event.target.value)} /></label><label>{t('PIECES PER CYCLE')}<input type="number" min="1" value={(form as Machine).pieces_per_cycle} onChange={event => update('pieces_per_cycle', Number(event.target.value))} /></label><label>{t('FALLBACK IDEAL CYCLE (SECONDS)')}<input type="number" min="0" step="0.1" value={(form as Machine).ideal_cycle_seconds ?? ''} onChange={event => update('ideal_cycle_seconds', event.target.value ? Number(event.target.value) : null)} /></label><label className="check"><input type="checkbox" checked={(form as Machine).fleet_enabled} onChange={event => update('fleet_enabled', event.target.checked)} /> {t('SHOW IN PLANT OVERVIEW')}</label></>}
        {tab === 'shifts' && <><label>{t('START')}<input type="time" value={(form as Shift).start_time.slice(0, 5)} onChange={event => update('start_time', event.target.value)} /></label><label>{t('END')}<input type="time" value={(form as Shift).end_time.slice(0, 5)} onChange={event => update('end_time', event.target.value)} /></label><label>{t('WEEKDAYS (MON=0, COMMA SEPARATED)')}<input value={(form as Shift).days.join(',')} onChange={event => update('days', event.target.value.split(',').map(Number))} /></label></>}
        <label className="check"><input type="checkbox" checked={form.active} onChange={event => update('active', event.target.checked)} /> {t('ACTIVE')}</label>
        <button className="save-button" onClick={save}>{t('SAVE CONFIGURATION')}</button>{message && <p className="admin-message">{message}</p>}</section></div>}
  </main>;
}
