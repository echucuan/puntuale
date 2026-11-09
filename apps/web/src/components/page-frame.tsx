import type { CurrentSessionResponse } from '@puntuale/contracts';
import { type ReactNode, useState } from 'react';
import { type AuthApi, authFailureMessage } from '../api/auth';
import type { HealthView } from '../api/health';
import { followLink, type Navigate } from '../routing';
import { AppMeta } from './app-meta';
import { BrandLogo } from './brand-logo';
import { Message } from './message';

export interface PageContext {
  api: AuthApi;
  health: HealthView;
  current: CurrentSessionResponse;
  navigate: Navigate;
  path: string;
  onEnded: (message: string | null) => void;
}

export interface NavItem {
  path: string;
  label: string;
}

interface PageFrameProps extends PageContext {
  title: string;
  /** Enlaces de la empresa actual. Solo se pasan los que llevan a una función disponible. */
  tenantNav?: readonly NavItem[];
  children: ReactNode;
}

/** Encabezado y contenedor común de las pantallas con sesión. */
export function PageFrame({
  api,
  health,
  current,
  navigate,
  path,
  onEnded,
  title,
  tenantNav = [],
  children,
}: PageFrameProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function logout() {
    setBusy(true);
    setError(null);
    const result = await api.logout();
    if (result.ok) {
      onEnded('Sesión cerrada.');
      return;
    }
    if (result.failure.code === 'unauthenticated') {
      onEnded(authFailureMessage(result.failure));
      return;
    }
    setError(authFailureMessage(result.failure));
    setBusy(false);
  }

  const links: readonly NavItem[] = [
    { path: '/', label: 'Mis empresas' },
    ...tenantNav,
    { path: '/cuenta', label: 'Mi cuenta' },
  ];

  return (
    <div className="pt-account">
      <header className="pt-topbar">
        <div className="pt-topbar-inner">
          <BrandLogo className="pt-logo--header" />
          <div className="pt-user">
            <div className="pt-user-text">
              <strong>{current.user.displayName}</strong>
              <small className="pt-user-email">{current.user.email}</small>
            </div>
            <button
              type="button"
              className="pt-button pt-button--secondary"
              disabled={busy}
              aria-busy={busy}
              onClick={() => void logout()}
            >
              {busy ? 'Cerrando sesión…' : 'Cerrar sesión'}
            </button>
          </div>
        </div>
        <nav className="pt-nav" aria-label="Principal">
          <ul>
            {links.map((link) => (
              <li key={link.path}>
                <a
                  href={link.path}
                  aria-current={link.path === path ? 'page' : undefined}
                  onClick={(event) => followLink(event, link.path, navigate)}
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main className="pt-account-main">
        <h1 tabIndex={-1} data-page-heading>
          {title}
        </h1>
        {error && <Message kind="error">{error}</Message>}
        {children}
        <AppMeta health={health} />
      </main>
    </div>
  );
}
