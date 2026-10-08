import type { DashboardData } from './types';

type Live = NonNullable<DashboardData['live_shift']>;

export interface CavityRow { cavity_no: number; product: string; label?: string | null; qty_good: number | null;
  qty_reject: number | null; reject_pct: number | null; target_pct?: number | null }

// Scrap rate of every cavity of an order (the live one by default); the worst one is highlighted.
export function CavityRates({ live, rows: given }: { live?: Live; rows?: CavityRow[] }) {
  const rows = (given ?? live?.cavities?.rows ?? []).filter(row => row.reject_pct != null);
  const worstPct = rows.length ? Math.max(...rows.map(row => row.reject_pct!)) : null;
  const fallback = given ? null : live?.current_machine?.worst_cavity_scrap;
  if (!rows.length) return <strong className="cavity-rates-empty">{fallback?.reject_pct != null
    ? `${fallback.cavity_no != null ? `K${fallback.cavity_no} ` : ''}${fallback.reject_pct.toFixed(2)}%` : '—'}</strong>;
  const reject = rows.reduce((sum, row) => sum + (row.qty_reject ?? 0), 0);
  const made = rows.reduce((sum, row) => sum + (row.qty_good ?? 0) + (row.qty_reject ?? 0), 0);
  const fmt = new Intl.NumberFormat('en-US');
  return <div className="cavity-rates" role="list">
    {rows.length > 1 && made > 0 && <div role="listitem" className="total" title={`All cavities · ${fmt.format(reject)} scrap / ${fmt.format(made)} made`}>
      <span>Σ</span><b>{(reject / made * 100).toFixed(2)}%</b><small>{fmt.format(reject)} pcs</small></div>}
    {rows.map(row => {
    const worst = rows.length > 1 && row.reject_pct === worstPct;
    return <div key={row.cavity_no} role="listitem" className={worst ? 'worst' : ''}
      title={`K${row.cavity_no} · ${row.label || row.product} · ${row.qty_reject ?? '—'} scrap / ${(row.qty_good ?? 0) + (row.qty_reject ?? 0)} made${row.target_pct != null ? ` · target ${row.target_pct}%` : ''}${worst ? ' · worst cavity' : ''}`}>
      <span>K{row.cavity_no}</span><b>{row.reject_pct!.toFixed(2)}%</b>{row.qty_reject != null && <small>{new Intl.NumberFormat('en-US').format(row.qty_reject)} pcs</small>}</div>;
  })}</div>;
}

// Declared scrap pieces of the shift: total and per cavity; null when the scrap source is unavailable.
export function scrapByCavity(live: Live) {
  const list = live.scrap_declarations;
  if (!list) return null;
  const rows = live.cavities?.rows ?? [];
  const numbers: (number | null)[] = [...rows.map(row => row.cavity_no), ...(list.some(item => item.cavity_no == null) ? [null] : [])];
  const lanes = numbers.map(no => ({ label: no == null ? '?' : `K${no}`,
    qty: list.filter(item => (item.cavity_no ?? null) === no).reduce((sum, item) => sum + item.quantity, 0) }));
  return { total: list.reduce((sum, item) => sum + item.quantity, 0), lanes: lanes.length > 1 ? lanes : [] };
}

export function ScrapLanes({ lanes }: { lanes: { label: string; qty: number }[] }) {
  if (!lanes.length) return null;
  const max = Math.max(...lanes.map(lane => lane.qty));
  return <span className="scrap-lanes">{lanes.map(lane => <span key={lane.label} className={lane.qty > 0 && lane.qty === max ? 'worst' : ''}>
    {lane.label} <b>{new Intl.NumberFormat('en-US').format(lane.qty)}</b></span>)}</span>;
}
