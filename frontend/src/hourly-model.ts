import type { Hour, ImprintData, OverviewResult } from './types';
import type { HourUnit } from './HourUnit';

export const hourClock = (value: string) => new Date(value).toLocaleTimeString('en-GB', {
  timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit'
});
export const hourNumber = (value: number | null) => value == null ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value);
export const hourDuration = (seconds: number) => seconds < 60 ? `${hourNumber(Math.round(seconds))} s` : `${hourNumber(seconds / 60)} min`;
export const hourStopTime = (seconds: number | null) => seconds == null ? '—' : `${Math.round(seconds / 60)} min`;

export const lossCategories = [
  { key: 'good', seconds: 'good_seconds', label: 'Good production' },
  { key: 'speed_loss', seconds: 'speed_loss_seconds', label: 'Slow running' },
  { key: 'microstop', seconds: 'microstop_seconds', label: 'Micro stops' },
  { key: 'downtime', seconds: 'downtime_seconds', label: 'Observed stop' },
  { key: 'break', seconds: 'excluded_break_seconds', label: 'Break' },
  { key: 'scrap', seconds: 'scrap_loss_seconds', label: 'Scrap' },
  { key: 'unknown', seconds: 'unknown_seconds', label: 'Unverified time' },
] as const;
export interface HourSegment { key: string; label: string; value: number }
export interface HourDetail {
  key: string; label: string; amount: string; reason: string; comment?: string;
  start?: string; end?: string; cavity?: number | null;
  quantity?: number;
}
export const compositionOrder = [
  { key: 'good', label: 'OK pieces' }, { key: 'scrap', label: 'Declared scrap' },
  { key: 'downtime', label: 'Stop' }, { key: 'microstop', label: 'Micro stops' },
  { key: 'speed_loss', label: 'Slow running' }, { key: 'break', label: 'Excluded break' },
] as const;
export interface OverviewHour {
  metrics?: OverviewResult | null;
  id: string; start: string; end: string; duration: number; elapsed: number;
  current: boolean; future: boolean; total?: boolean;
  count: number | null; scrap: number | null; target: number | null; oee: number | null;
  stopCount: number | null; stopSeconds: number | null;
  ideal: number | null; estimated: number | null;
  segments: HourSegment[]; details: HourDetail[]; warnings: string[];
}

export function compositionSegments(composition: NonNullable<OverviewResult['composition']>, unit: HourUnit): HourSegment[] {
  return compositionOrder.flatMap(({ key, label }) => {
    const part = composition[key];
    const value = part ? unit === 'minutes' ? part.seconds / 60 : part.pieces : null;
    return value ? [{ key, label, value }] : [];
  });
}

const overlap = (start: string, end: string, from: string, to: string) => Math.max(0,
  (Math.min(Date.parse(end), Date.parse(to)) - Math.max(Date.parse(start), Date.parse(from))) / 1000);
const inside = (at: string, from: string, to: string) => Date.parse(at) >= Date.parse(from) && Date.parse(at) < Date.parse(to);

function recordedDetails(data: ImprintData, start: string, end: string): HourDetail[] {
  const live = data.live_shift;
  const events = live?.downtime_events ?? data.downtime_events ?? [];
  const stops = events.flatMap(event => {
    const seconds = overlap(event.start, event.end, start, end);
    if (!seconds) return [];
    return [{ key: 'category' in event && event.category === 'micro_stop' ? 'microstop' : 'downtime',
      label: 'category' in event && event.category === 'micro_stop' ? 'Micro stop' : 'Observed stop',
      amount: hourDuration(seconds), reason: event.reason, comment: event.comment ?? undefined,
      start: new Date(Math.max(Date.parse(start), Date.parse(event.start))).toISOString(),
      end: new Date(Math.min(Date.parse(end), Date.parse(event.end))).toISOString() }];
  });
  const scrap: HourDetail[] = live ? (live.scrap_declarations ?? []).filter(item => inside(item.time, start, end)).map(item => ({
    key: 'scrap', label: 'Declared scrap', amount: `${hourNumber(item.quantity)} pcs`, reason: item.reason,
    start: item.time, cavity: item.cavity_no, quantity: item.quantity, comment: item.comment ?? undefined,
  })) : (data.scrap_reports ?? []).filter(item => inside(item.at, start, end)).map(item => ({
    key: 'scrap', label: 'Declared scrap', amount: `${hourNumber(item.count)} pcs`, reason: item.reason, start: item.at, quantity: item.count, comment: item.comment ?? undefined,
  }));
  return [...stops, ...scrap].sort((a, b) => Date.parse(a.start!) - Date.parse(b.start!));
}

export function buildOverviewHours(data: ImprintData, unit: HourUnit): OverviewHour[] {
  const shift = data.shift!;
  const live = data.live_shift;
  const observed = Math.min(Date.parse(data.server_time), Date.parse(shift.end));
  const result: OverviewHour[] = [];
  // Use the exact server intervals used by the original view, including DST hours.
  for (const source of live?.hours ?? data.hours ?? []) {
    const start = source.start;
    const end = source.end;
    const at = Date.parse(start);
    const duration = (Date.parse(end) - at) / 1000;
    const elapsed = source.elapsed_seconds;
    const hour = data.hours?.find(item => Date.parse(item.start) === at);
    const record = live?.hours.find(item => Date.parse(item.start) === at);
    const details = recordedDetails(data, start, new Date(Math.max(at, Math.min(observed, Date.parse(end)))).toISOString());
    const metrics = data.overview?.hours.find(item => Date.parse(item.start) === at) ?? null;
    let segments: HourSegment[];
    if (metrics?.composition) {
      segments = compositionSegments(metrics.composition, unit);
    } else if (live) {
      const stopped = Math.max(0, Math.min(elapsed, record?.stop_seconds ?? 0));
      // Minutes cannot be shown in a pieces chart: without piece metrics the hour has no pieces breakdown
      segments = unit === 'pieces' ? [] : [{ key: 'downtime', label: 'Observed stop', value: stopped / 60 },
        { key: 'unknown', label: 'Unverified time', value: (elapsed - stopped) / 60 }];
    } else if (hour) {
      segments = lossCategories.map(category => ({ key: category.key, label: category.label,
        value: unit === 'minutes' ? Number(hour[category.seconds as keyof Hour]) / 60
          : hour.piece_equivalents?.[category.key] ?? 0 }));
    } else {
      segments = [{ key: 'unknown', label: 'Unverified time', value: unit === 'minutes' ? elapsed / 60 : 0 }];
    }
    if (unit === 'minutes' || (live && metrics?.composition)) segments.push({ key: 'future', label: 'Future time', value: (duration - elapsed) / 60 });
    const scrap = live ? live.scrap_declarations == null || elapsed === 0 ? null
      : live.scrap_declarations.filter(item => inside(item.time, start, end)).reduce((sum, item) => sum + item.quantity, 0)
      : hour?.scrap_count ?? null;
    result.push({ metrics, id: start, start, end, duration, elapsed, future: elapsed === 0,
      current: elapsed > 0 && elapsed < duration,
      count: live ? record?.cycle_count ?? null : hour?.good_count ?? null,
      stopCount: live ? record?.stop_count ?? null : null,
      stopSeconds: live ? record?.stop_seconds ?? null : hour?.downtime_seconds ?? null,
      scrap, target: hour?.target_good ?? null, oee: hour?.oee ?? null,
      ideal: hour?.ideal_cycle_seconds ?? null, estimated: hour?.estimated_cycle_seconds ?? null,
      segments: segments.filter(segment => segment.value > 0), details, warnings: hour?.warnings ?? [] });
  }
  return result;
}

export function buildOverviewTotal(data: ImprintData, rows: OverviewHour[], unit: HourUnit = 'minutes'): OverviewHour {
  const segments = new Map<string, HourSegment>();
  for (const row of rows) for (const segment of row.segments) {
    const old = segments.get(segment.key);
    segments.set(segment.key, { ...segment, value: (old?.value ?? 0) + segment.value });
  }
  const cycleHours = (data.hours ?? []).filter(hour => hour.good_count + hour.scrap_count > 0);
  const cycleCount = cycleHours.reduce((sum, hour) => sum + (hour.good_count + hour.scrap_count) / (hour.pieces_per_cycle ?? 1), 0);
  const weightedCycle = (key: 'ideal_cycle_seconds' | 'estimated_cycle_seconds') => !cycleCount || cycleHours.some(hour => hour[key] == null)
    ? null : cycleHours.reduce((sum, hour) => sum + hour[key]! * (hour.good_count + hour.scrap_count) / (hour.pieces_per_cycle ?? 1), 0) / cycleCount;
  const live = data.live_shift;
  const metrics = data.overview?.total ?? null;
  const composed = metrics?.composition ? compositionSegments(metrics.composition, unit) : null;
  return { metrics, id: 'total', start: data.shift!.start, end: data.shift!.end,
    duration: rows.reduce((sum, row) => sum + row.duration, 0), elapsed: rows.reduce((sum, row) => sum + row.elapsed, 0),
    current: false, future: false, total: true,
    count: live ? live.summary.cycle_count : data.summary?.good_count ?? null,
    stopCount: live?.summary.observed_stop_count ?? null,
    stopSeconds: live ? live.summary.observed_stop_seconds : data.summary?.downtime_seconds ?? null,
    scrap: live ? live.scrap_declarations == null ? null : live.scrap_declarations.reduce((sum, item) => sum + item.quantity, 0)
      : data.summary?.scrap_count ?? null,
    target: data.production?.target ?? null, oee: data.summary?.oee ?? null,
    ideal: weightedCycle('ideal_cycle_seconds'), estimated: weightedCycle('estimated_cycle_seconds'),
    segments: composed ?? [...segments.values()], details: rows.flatMap(row => row.details), warnings: data.summary?.warnings ?? [] };
}

export function hourDetailSummary(row: OverviewHour, live: boolean, unit: HourUnit): HourDetail[] {
  const details: HourDetail[] = row.segments.filter(segment => segment.key !== 'future' && (!live || segment.key !== 'unknown')).map(segment => ({
    key: segment.key, label: segment.label,
    amount: unit === 'minutes' || live ? hourDuration(segment.value * 60) : `${hourNumber(segment.value)} ${['good', 'scrap'].includes(segment.key) ? 'pcs' : 'pcs eq.'}`,
    reason: segment.key === 'unknown' ? 'Machine state is unverified in this interval' : '—',
  }));
  // Keep verified event reasons together without duplicating category totals.
  const grouped = new Map<string, HourDetail>();
  for (const detail of row.details) {
    const id = JSON.stringify([detail.key, detail.reason, detail.comment ?? '']);
    if (!grouped.has(id)) grouped.set(id, { ...detail, amount: '', start: undefined, end: undefined });
  }
  for (const item of grouped.values()) {
    const same = row.details.filter(detail => detail.key === item.key && detail.reason === item.reason && detail.comment === item.comment);
    if (item.key === 'scrap') item.amount = `${hourNumber(same.reduce((sum, detail) => sum + (detail.quantity ?? 0), 0))} pcs`;
    else item.amount = hourDuration(same.reduce((sum, detail) => sum + (Date.parse(detail.end!) - Date.parse(detail.start!)) / 1000, 0));
  }
  const knownKeys = new Set([...grouped.values()].map(detail => detail.key));
  return [...(live ? [{ key: 'good', label: 'Recorded count', amount: hourNumber(row.count), reason: '—' }] : []),
    ...details.filter(detail => !knownKeys.has(detail.key) || detail.key === 'scrap'), ...grouped.values()];
}

/** Headline values above the table; null means unavailable, never zero. */
export function overviewHeadline(total: OverviewHour) {
  const m = total.metrics;
  return { ok: m?.production?.good_count ?? null, withoutLosses: m?.capacity?.without_scrap_or_stops ?? null,
    recoverable: m?.capacity?.recoverable_output ?? null, idealCapacity: m?.capacity?.ideal_capacity ?? null,
    efficiency: m?.efficiency?.ratio ?? null, efficiencyKind: m?.efficiency?.kind ?? null,
    cycleDelta: m?.cycle?.delta_seconds ?? null, missing: m?.quality.missing_inputs ?? [],
    estimated: m?.production?.count_basis === 'estimated', coverage: m?.estimate ?? null };
}
