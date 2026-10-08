import type { DashboardData } from './types';
import { CavityRates } from './CavityRates';

type Live = NonNullable<DashboardData['live_shift']>;
const clock = (value: string) => new Date(value).toLocaleTimeString('en-GB', { timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit' });
const stateText = (state?: string | null) => state === 'bezi' ? 'RUNNING' : state === 'stoji' ? 'STOPPED' : state === 'bez_zakazky' ? 'NO ORDER' : 'UNKNOWN';
const seconds = (value?: number | null) => value == null ? '—' : `${value.toFixed(1)} s`;

// One row per order that ran in the shown shift, oldest first; machine state only for the order running now.
export function OrdersStrip({ live }: { live: Live }) {
  const orders = live.orders ?? [];
  const machine = live.current_machine;
  return <div className="orders-strip scope-order">{orders.map((order, index) => <div key={order.order_ref} className={`order-row ${order.status}`}>
    <div className="order-badge"><b className="order-tag">ORDER {index + 1}/{orders.length}</b>
      <em>{order.status === 'running' ? 'RUNNING NOW' : order.ended_at ? `FINISHED ${clock(order.ended_at)}` : 'FINISHED'}</em></div>
    <div className="order-cell"><span>ORDER · TOOL</span><strong>{order.order_ref}</strong>
      <small title={order.tool_label || ''}>{order.tool ? `${order.tool}${order.tool_label ? ` · ${order.tool_label}` : ''}` : 'Tool unavailable'}</small></div>
    <div className="order-cell"><span>{order.status === 'running' ? 'ACTUAL / PLANNED CYCLE' : 'PLANNED CYCLE'}</span>
      <strong>{order.status === 'running' && machine ? `${seconds(machine.cycle_time_real_s)} / ${seconds(machine.cycle_time_planned_s ?? order.planned_cycle_s)}` : seconds(order.planned_cycle_s)}</strong></div>
    {order.status === 'running' && machine && <div className="order-cell"><span>MACHINE STATE</span><strong>{stateText(machine.state)}</strong></div>}
    <div className="order-cell cavity-cell"><span>ORDER SCRAP BY CAVITY · % SINCE ORDER START</span><CavityRates rows={order.cavities} /></div>
  </div>)}</div>;
}
