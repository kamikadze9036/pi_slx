import { themeQuery } from './theme';

export interface ShiftNavigation {
  previous: string | null;
  next: string | null;
  is_current: boolean;
}

export const requestedShiftStart = new URLSearchParams(window.location.search).get('shift_start');

export function displayLink(path: string, shiftStart: string | null = requestedShiftStart): string {
  const query = new URLSearchParams(themeQuery);
  if (shiftStart) query.set('shift_start', shiftStart);
  return `${path}${query.size ? `?${query}` : ''}`;
}

export const shiftApiQuery = requestedShiftStart
  ? `?shift_start=${encodeURIComponent(requestedShiftStart)}` : '';

export function ShiftNavigator({ displayId, view, shift, navigation }: {
  displayId: string;
  view: 'hourly' | 'imprint';
  shift: { name: string; start: string; end: string };
  navigation: ShiftNavigation;
}) {
  const path = `/display/${encodeURIComponent(displayId)}/${view}`;
  const date = new Date(shift.start).toLocaleDateString('cs-CZ', {
    weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric'
  });
  const time = (value: string) => new Date(value).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
  return <nav className="shift-navigator" aria-label="Shift history">
    {navigation.previous
      ? <a href={displayLink(path, navigation.previous)} aria-label="Previous shift">← PREVIOUS SHIFT</a>
      : <span className="shift-nav-disabled">← PREVIOUS SHIFT</span>}
    <div className="shift-nav-selected"><span>{navigation.is_current ? 'CURRENT SHIFT' : 'COMPLETED SHIFT'}</span>
      <strong>{date} · {shift.name} · {time(shift.start)}–{time(shift.end)}</strong></div>
    {navigation.next
      ? <a href={displayLink(path, navigation.next)} aria-label="Next shift">NEXT SHIFT →</a>
      : <span className="shift-nav-disabled">NEXT SHIFT →</span>}
    <a className="shift-nav-live" href={displayLink(path, null)}>CURRENT ↗</a>
  </nav>;
}
