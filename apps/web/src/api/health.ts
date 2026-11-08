import { HealthResponseSchema, type HealthResponse } from '@puntuale/contracts';

export type HealthView =
  { state: 'loading' } | { state: 'ok' } | { state: 'degraded' } | { state: 'unreachable' };

/** Traduce la respuesta de `GET /health` a lo que muestra la interfaz. Valida el contrato. */
export function toHealthView(body: unknown): HealthView {
  const parsed = HealthResponseSchema.safeParse(body);
  if (!parsed.success) return { state: 'unreachable' };
  const health: HealthResponse = parsed.data;
  return health.status === 'ok' ? { state: 'ok' } : { state: 'degraded' };
}

export async function fetchHealth(fetchImpl: typeof fetch = fetch): Promise<HealthView> {
  try {
    const response = await fetchImpl('/health');
    return toHealthView(await response.json());
  } catch {
    return { state: 'unreachable' };
  }
}

export const HEALTH_LABELS_ES: Record<HealthView['state'], string> = {
  loading: 'Consultando la API…',
  ok: 'API y base de datos disponibles',
  degraded: 'La API responde, pero la base de datos no está disponible',
  unreachable: 'No se pudo contactar a la API',
};
