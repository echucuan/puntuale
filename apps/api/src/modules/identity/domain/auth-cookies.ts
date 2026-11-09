export interface CookieNames {
  session: string;
  csrf: string;
}

/** `__Host-` exige `Secure`, por eso solo se usa en producción (ADR 0014). */
export function cookieNames(nodeEnv: string): CookieNames {
  return nodeEnv === 'production'
    ? { session: '__Host-puntuale_session', csrf: '__Host-puntuale_csrf' }
    : { session: 'puntuale_session', csrf: 'puntuale_csrf' };
}

/** Lee una cookie del encabezado `Cookie`. Si se repite, gana la primera. */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator !== -1 && part.slice(0, separator).trim() === name) {
      const value = part.slice(separator + 1).trim();
      return value === '' ? null : value;
    }
  }
  return null;
}
