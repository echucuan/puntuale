import type { CurrentSessionResponse } from '@puntuale/contracts';
import { useState } from 'react';
import { type AuthApi, authFailureMessage } from '../api/auth';
import type { HealthView } from '../api/health';
import { SessionPanel } from '../auth/session-panel';
import { AppMeta } from '../components/app-meta';
import { BrandLogo } from '../components/brand-logo';
import { Message } from '../components/message';

interface AccountPageProps {
  api: AuthApi;
  health: HealthView;
  current: CurrentSessionResponse;
  onChanged: (next: CurrentSessionResponse) => void;
  onEnded: (message: string | null) => void;
}

/** «Mi cuenta»: solo presenta las funciones de sesión existentes. */
export function AccountPage({ api, health, current, onChanged, onEnded }: AccountPageProps) {
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
      </header>
      <main className="pt-account-main">
        <h1 tabIndex={-1} data-page-heading>
          Mi cuenta
        </h1>
        {error && <Message kind="error">{error}</Message>}
        <SessionPanel api={api} current={current} onChanged={onChanged} onEnded={onEnded} />
        <AppMeta health={health} />
      </main>
    </div>
  );
}
