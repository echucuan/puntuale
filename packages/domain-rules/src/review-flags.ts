/**
 * Planeación idempotente de alertas de revisión (ajuste 2.4 del arquitecto).
 *
 * Una misma regla, jornada y versión de reglas nunca produce dos alertas abiertas idénticas.
 * En la base de datos lo respaldará el índice
 * `UNIQUE (tenant_id, workday_id, code, rules_version) WHERE status = 'open'` (paso 1.0-d).
 */

export interface ReviewFlagRef {
  /** Llave natural de la jornada (`workdayNaturalKey`). */
  workdayKey: string;
  /** Código de la alerta, por ejemplo `CLOCK_SKEW` o `MISSING_OUT`. */
  code: string;
  rulesVersion: string;
}

export interface FlagChangePlan {
  /** Alertas calculadas que no existen abiertas: se crean. */
  toCreate: ReviewFlagRef[];
  /** Alertas abiertas de las mismas jornadas que el cálculo ya no produce: se cierran como `resolved`. */
  toResolve: ReviewFlagRef[];
  /** Alertas que siguen vigentes: no se tocan. */
  unchanged: ReviewFlagRef[];
}

export function reviewFlagIdentity(flag: ReviewFlagRef): string {
  return `${flag.workdayKey}|${flag.code}|${flag.rulesVersion}`;
}

/**
 * Compara las alertas abiertas con las recién calculadas para las jornadas recalculadas.
 * Repetir el cálculo con la misma entrada da un plan sin creaciones.
 */
export function planFlagChanges(
  existingOpen: readonly ReviewFlagRef[],
  computed: readonly ReviewFlagRef[],
): FlagChangePlan {
  const existingById = new Map(existingOpen.map((f) => [reviewFlagIdentity(f), f]));
  const computedById = new Map(computed.map((f) => [reviewFlagIdentity(f), f]));
  const recomputedWorkdays = new Set(computed.map((f) => f.workdayKey));

  const toCreate = [...computedById.entries()]
    .filter(([id]) => !existingById.has(id))
    .map(([, f]) => f);
  const unchanged = [...computedById.entries()]
    .filter(([id]) => existingById.has(id))
    .map(([, f]) => f);
  const toResolve = [...existingById.entries()]
    .filter(([id, f]) => !computedById.has(id) && recomputedWorkdays.has(f.workdayKey))
    .map(([, f]) => f);

  return { toCreate, toResolve, unchanged };
}
