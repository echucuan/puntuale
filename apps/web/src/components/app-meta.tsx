import { HEALTH_LABELS_ES, type HealthView } from '../api/health';

/** Estado de la API y subversión, en segundo plano. */
export function AppMeta({ health }: { health: HealthView }) {
  return (
    <p className="pt-meta" aria-live="polite">
      {HEALTH_LABELS_ES[health.state]} · Versión <span className="pt-nowrap">1.0-b.1</span> en
      construcción
    </p>
  );
}
