import { useEffect, useState } from 'react';
import { fetchHealth, HEALTH_LABELS_ES, type HealthView } from './api/health';

/** Pantalla base de 1.0-a: marca y estado de la API. Las pantallas de producto llegan desde 1.0-b. */
export function App() {
  const [health, setHealth] = useState<HealthView>({ state: 'loading' });

  useEffect(() => {
    let active = true;
    void fetchHealth().then((view) => {
      if (active) setHealth(view);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="pt-shell">
      <header className="pt-header">
        <span className="pt-wordmark">Puntuale</span>
        <span className="pt-badge">1.0-a · en construcción</span>
      </header>
      <section className="pt-card" aria-live="polite">
        <h1>Control de asistencia</h1>
        <p className={`pt-status pt-status--${health.state}`}>{HEALTH_LABELS_ES[health.state]}</p>
      </section>
    </main>
  );
}
