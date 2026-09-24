import { useState } from 'react';

export type HourUnit = 'minutes' | 'pieces';
const storageKey = 'imprint-hour-unit';

export function useHourUnit(): [HourUnit, (unit: HourUnit) => void] {
  const [unit, setUnit] = useState<HourUnit>(() => {
    try { return window.localStorage.getItem(storageKey) === 'pieces' ? 'pieces' : 'minutes'; }
    catch { return 'minutes'; }
  });
  const choose = (next: HourUnit) => {
    try { window.localStorage.setItem(storageKey, next); } catch { /* Browsing still works without storage. */ }
    setUnit(next);
  };
  return [unit, choose];
}

export function HourUnitToggle({ unit, onChange }: { unit: HourUnit; onChange: (unit: HourUnit) => void }) {
  return <div className="hour-unit-toggle" role="group" aria-label="Hourly breakdown unit">
    <button type="button" className={unit === 'minutes' ? 'active' : ''}
      aria-pressed={unit === 'minutes'} onClick={() => onChange('minutes')}>MINUTES</button>
    <button type="button" className={unit === 'pieces' ? 'active' : ''}
      aria-pressed={unit === 'pieces'} onClick={() => onChange('pieces')}>PIECES</button>
  </div>;
}
