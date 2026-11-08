export interface LoginThrottleLimits {
  maxFailuresPerAccount: number;
  maxFailuresPerIp: number;
  windowSeconds: number;
  delayBaseMs: number;
  delayMaxMs: number;
}

/** Fallos dentro de la ventana y la antigüedad, en segundos, del más viejo y del más reciente. */
export interface LoginThrottleSnapshot {
  accountFailures: number;
  ipFailures: number;
  oldestAccountAgeSeconds: number | null;
  newestAccountAgeSeconds: number | null;
  oldestIpAgeSeconds: number | null;
}

export type LoginThrottleDecision =
  { allowed: true } | { allowed: false; retryAfterSeconds: number };

function denied(seconds: number): LoginThrottleDecision {
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(seconds)) };
}

/** Espera, en segundos, después de `failures` fallos: 1 s, 2 s, 4 s… hasta el máximo. */
export function progressiveDelaySeconds(
  failures: number,
  limits: Pick<LoginThrottleLimits, 'delayBaseMs' | 'delayMaxMs'>,
): number {
  if (failures <= 0 || limits.delayBaseMs === 0) return 0;
  return Math.min(limits.delayMaxMs, limits.delayBaseMs * 2 ** (failures - 1)) / 1000;
}

/**
 * Decide si se admite un intento. No hay bloqueo permanente: el límite se libera cuando los fallos
 * salen de la ventana. La decisión no depende de que la cuenta exista (ADR 0014).
 */
export function evaluateLoginThrottle(
  snapshot: LoginThrottleSnapshot,
  limits: LoginThrottleLimits,
): LoginThrottleDecision {
  if (snapshot.accountFailures >= limits.maxFailuresPerAccount) {
    return denied(limits.windowSeconds - (snapshot.oldestAccountAgeSeconds ?? 0));
  }
  if (snapshot.ipFailures >= limits.maxFailuresPerIp) {
    return denied(limits.windowSeconds - (snapshot.oldestIpAgeSeconds ?? 0));
  }
  const delay = progressiveDelaySeconds(snapshot.accountFailures, limits);
  const remaining = delay - (snapshot.newestAccountAgeSeconds ?? delay);
  return remaining > 0 ? denied(remaining) : { allowed: true };
}
