import { type MouseEvent, useCallback, useEffect, useState } from 'react';

export type Route =
  | { kind: 'tenants' }
  | { kind: 'account' }
  | { kind: 'my-access'; tenantId: string }
  | { kind: 'access'; tenantId: string };

/** Traduce la ruta del navegador. La empresa de la URL solo indica qué se pide: la API decide. */
export function parseRoute(pathname: string): Route {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 1 && parts[0] === 'cuenta') return { kind: 'account' };
  if (parts[0] === 't' && parts[1]) {
    const tenantId = decodeURIComponent(parts[1]);
    if (parts.length === 2) return { kind: 'my-access', tenantId };
    if (parts.length === 3 && parts[2] === 'accesos') return { kind: 'access', tenantId };
  }
  return { kind: 'tenants' };
}

export const tenantPath = (tenantId: string) => `/t/${encodeURIComponent(tenantId)}`;
export const accessPath = (tenantId: string) => `${tenantPath(tenantId)}/accesos`;

export type Navigate = (path: string) => void;

export function useRoute(): { route: Route; path: string; navigate: Navigate } {
  const [path, setPath] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback<Navigate>((next) => {
    if (next !== window.location.pathname) window.history.pushState(null, '', next);
    setPath(next);
  }, []);

  return { route: parseRoute(path), path, navigate };
}

/** Clic normal: navega sin recargar. Con teclas modificadoras se respeta el navegador. */
export function followLink(event: MouseEvent, path: string, navigate: Navigate): void {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate(path);
}
