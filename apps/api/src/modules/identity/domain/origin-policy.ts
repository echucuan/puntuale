const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method.toUpperCase());
}

function originOfReferer(referer: string): string | null {
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

export interface OriginCheck {
  method: string;
  origin: string | undefined;
  referer: string | undefined;
  allowed: ReadonlySet<string>;
}

/**
 * Regla de origen (ADR 0014):
 * - Un `Origin` presente debe estar en la lista, en cualquier método.
 * - En un método mutable sin `Origin`, se valida `Referer`.
 * - En un método mutable sin ninguno de los dos, se rechaza.
 */
export function isOriginAllowed({ method, origin, referer, allowed }: OriginCheck): boolean {
  if (origin !== undefined) return allowed.has(origin);
  if (isSafeMethod(method)) return true;
  if (referer === undefined) return false;
  const refererOrigin = originOfReferer(referer);
  return refererOrigin !== null && allowed.has(refererOrigin);
}
