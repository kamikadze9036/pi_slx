import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Dashboard } from './pages/Dashboard';
import { ShiftImprint } from './pages/ShiftImprint';
import { Admin } from './pages/Admin';
import { Fleet } from './pages/Fleet';
import './styles.css';
import './overrides.css';
import './imprint-axis.css';
import './imprint-compact.css';
import './admin-settings.css';
import './light.css';
import './fleet.css';

const path = window.location.pathname;
const match = path.match(/^\/display\/([^/]+)(?:\/(imprint|hourly))?/);

function ConfiguredDisplay({ displayId }: { displayId: string }) {
  const [type, setType] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    fetch(`/api/displays/${encodeURIComponent(displayId)}`, { signal: controller.signal })
      .then(response => response.ok ? response.json() : Promise.reject())
      .then(display => setType(display.dashboard_type))
      .catch(() => setType('production-efficiency'))
      .finally(() => clearTimeout(timeout));
    return () => { controller.abort(); clearTimeout(timeout); };
  }, [displayId]);
  if (type === null) return <main className="empty-state"><span className="eyebrow">PRODUCTION EFFICIENCY</span><h1>Loading display…</h1></main>;
  return type === 'shift-imprint' ? <ShiftImprint displayId={displayId} /> : <Dashboard displayId={displayId} />;
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{path.startsWith('/admin') ? <Admin /> : path.startsWith('/fleet') ? <Fleet /> : match?.[2] === 'imprint' ? <ShiftImprint displayId={match[1]} />
    : match?.[2] === 'hourly' ? <Dashboard displayId={match[1]} />
    : <ConfiguredDisplay displayId={match?.[1] || 'demo'} />}</React.StrictMode>
);
