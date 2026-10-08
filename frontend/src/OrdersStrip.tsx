import type { DashboardData } from './types';
import { CavityRates } from './CavityRates';

type Live = NonNullable<DashboardData['live_shift']>;
const clock = (value: string) => new Date(value).toLocaleTimeString('en-GB', { timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit' });
const seconds = (value?: number | null) => value == null ? '—' : `${value.toFixed(1)} s`;
const hours = (value?: number | null) => value == null ? '—' : value < 1 ? `${Math.round(value * 60)} min` : `${value.toFixed(1)} h`;

// One row per order that ran in the shown shift, oldest first; expected time to end only for the order running now.
export function OrdersStrip({ live }: { live: Live }) {
  const orders = live.orders ?? [];
  const machine = live.current_machine;
  return <div className="orders-strip scope-order">{orders.map((order, index) => <div key={order.order_ref} className={`order-row ${order.status}`}>
    <div className="order-badge"><b className="order-tag">ORDER {index + 1}/{orders.length}</b>
      <em>{order.status === 'running' ? 'RUNNING NOW' : order.ended_at ? `FINISHED ${clock(order.ended_at)}` : 'FINISHED'}</em></div>
    <div className="order-cell"><span>ORDER · TOOL</span><strong>{order.order_ref}</strong>
      <small title={order.tool_label || ''}>{order.tool ? `${order.tool}${order.tool_label ? ` · ${order.tool_label}` : ''}` : 'Tool unavailable'}</small></div>
    <div className="order-cell" title={order.status === 'running' && order.remaining ? `Missing pieces of the slowest cavity as a share of the planned order duration (includes the scrap allowance). Without allowance: ${hours(order.remaining.hours_without_allowance)}` : undefined}>
      <span>EXPECTED TIME TO END</span><strong>{order.status === 'running' && order.remaining?.hours != null ? `~${hours(order.remaining.hours)}` : '—'}</strong>
      {order.status === 'running' && order.remaining?.pieces_left != null && <small>{new Intl.NumberFormat('en-US').format(order.remaining.pieces_left)} pcs left</small>}</div>
    <div className="order-cell"><span>{order.status === 'running' ? 'ACTUAL / PLANNED CYCLE' : 'PLANNED CYCLE'}</span>
      <strong>{order.status === 'running' && machine ? `${seconds(machine.cycle_time_real_s)} / ${seconds(machine.cycle_time_planned_s ?? order.planned_cycle_s)}` : seconds(order.planned_cycle_s)}</strong></div>
    <div className="order-cell cavity-cell"><span>ORDER SCRAP BY CAVITY · % SINCE ORDER START</span><CavityRates rows={order.cavities} /></div>
  </div>)}</div>;
}
