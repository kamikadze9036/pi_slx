import { useEffect, useState } from 'react';
import type { ImprintData } from '../types';
import { displayTheme } from '../theme';
import { shiftApiQuery, useShiftStart } from '../ShiftNavigator';
import { HourlyOverview } from './HourlyOverview';

const VERSION = import.meta.env.VITE_APP_VERSION || 'dev';

export function DashboardNew({ displayId }: { displayId: string }) {
  const shiftStart = useShiftStart();
  const [data, setData] = useState<ImprintData | null>(null);
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
      const timeout = setTimeout(() => controller.abort(), 25000);
      try {
        const response = await fetch(`/api/displays/${encodeURIComponent(displayId)}/dashboard${shiftApiQuery(shiftStart)}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        let next: ImprintData = await response.json();
        // Live records come from the identical endpoint as the original hourly view.
        // Verified MES providers additionally supply event reasons through the imprint endpoint.
        if (next.data_source !== 'euromap63' && next.status !== 'outside_shift') {
          const details = await fetch(`/api/displays/${encodeURIComponent(displayId)}/shift-imprint${shiftApiQuery(shiftStart)}`, { signal: controller.signal });
          if (!details.ok) throw new Error(`HTTP ${details.status}`);
          next = await details.json();
        }
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
  }, [displayId, shiftStart]);

  if (!data) return <main className={`empty-state theme-${displayTheme()}`}><div className="eyebrow">PRODUCTION EFFICIENCY</div><h1>{offline ? 'DATA CONNECTION LOST' : 'Loading hourly overview…'}</h1><p>{offline ? 'Reconnecting automatically' : `Display ${displayId}`}</p></main>;
  if (data.status === 'outside_shift') return <main className={`empty-state theme-${displayTheme(data.display.theme)}`}><div className="eyebrow">{data.machine.name}</div><h1>Outside scheduled shift</h1><p>Waiting for the next configured shift</p></main>;
  return <HourlyOverview data={data} offline={offline} updatedAt={updatedAt} now={now} />;
}
