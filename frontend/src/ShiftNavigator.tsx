import { useSyncExternalStore, type MouseEvent } from 'react';
import { themeQuery } from './theme';
import { t, locale } from './i18n';

export interface ShiftNavigation {
  previous: string | null;
  next: string | null;
  is_current: boolean;
}

const readShiftStart = () => new URLSearchParams(window.location.search).get('shift_start');
let currentShiftStart = readShiftStart();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());
window.addEventListener('popstate', () => { currentShiftStart = readShiftStart(); notify(); });

export function useShiftStart(): string | null {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => currentShiftStart);
}

export function displayLink(path: string, shiftStart: string | null = currentShiftStart): string {
  const query = new URLSearchParams(themeQuery);
  if (shiftStart) query.set('shift_start', shiftStart);
  return `${path}${query.size ? `?${query}` : ''}`;
}

export const shiftApiQuery = (shiftStart: string | null) =>
  shiftStart ? `?shift_start=${encodeURIComponent(shiftStart)}` : '';

// Switch shift without a page reload so the surrounding layout stays mounted.
function selectShift(event: MouseEvent, href: string, shiftStart: string | null) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  window.history.pushState(null, '', href);
  currentShiftStart = shiftStart;
  notify();
}

export function ShiftNavigator({ displayId, view, shift, navigation }: {
  displayId: string;
  view: 'hourly' | 'hourly-new' | 'imprint';
  shift: { name: string; start: string; end: string };
  navigation: ShiftNavigation;
}) {
  const path = `/display/${encodeURIComponent(displayId)}/${view}`;
  const date = new Date(shift.start).toLocaleDateString(locale, {
    timeZone: 'Europe/Prague', weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric'
  });
  const time = (value: string) => new Date(value).toLocaleTimeString('cs-CZ', { timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit' });
  return <nav className="shift-navigator" aria-label={t('Shift history')}>
    {navigation.previous
      ? <a href={displayLink(path, navigation.previous)} onClick={event => selectShift(event, displayLink(path, navigation.previous), navigation.previous)} aria-label={t('Previous shift')}>← {t('PREVIOUS SHIFT')}</a>
      : <span className="shift-nav-disabled">← {t('PREVIOUS SHIFT')}</span>}
    <div className="shift-nav-selected"><span>{navigation.is_current ? t('CURRENT SHIFT') : t('COMPLETED SHIFT')}</span>
      <strong>{date} · {shift.name} · {time(shift.start)}–{time(shift.end)}</strong></div>
    {navigation.next
      ? <a href={displayLink(path, navigation.next)} onClick={event => selectShift(event, displayLink(path, navigation.next), navigation.next)} aria-label={t('Next shift')}>{t('NEXT SHIFT')} →</a>
      : <span className="shift-nav-disabled">{t('NEXT SHIFT')} →</span>}
    <a className="shift-nav-live" href={displayLink(path, null)} onClick={event => selectShift(event, displayLink(path, null), null)}>{t('CURRENT')} ↗</a>
  </nav>;
}
