import type { CurrentSessionResponse } from '@puntuale/contracts';
import { useCallback, useEffect, useState } from 'react';
import { type AuthApi, authFailureMessage, createAuthApi } from './api/auth';
import { fetchHealth, HEALTH_LABELS_ES, type HealthView } from './api/health';
import { LoginForm } from './auth/login-form';
import { SessionPanel } from './auth/session-panel';

const authApi: AuthApi = createAuthApi();

type AuthView =
  | { state: 'loading' }
  | { state: 'anonymous' }
  | { state: 'signed-in'; current: CurrentSessionResponse };

/** Pantalla de 1.0-b.1: estado de la API, acceso y sesiones. Sin reglas de negocio. */
export function App() {
  const [health, setHealth] = useState<HealthView>({ state: 'loading' });
  const [auth, setAuth] = useState<AuthView>({ state: 'loading' });
  const [loginError, setLoginError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetchHealth().then((view) => {
      if (active) setHealth(view);
    });
    void authApi.currentSession().then((result) => {
      if (active)
        setAuth(result.ok ? { state: 'signed-in', current: result.value } : { state: 'anonymous' });
    });
    return () => {
      active = false;
    };
  }, []);

  const onChanged = useCallback((current: CurrentSessionResponse) => {
    setAuth({ state: 'signed-in', current });
  }, []);

  const onEnded = useCallback((message: string | null) => {
    setNotice(message);
    setLoginError(null);
    setAuth({ state: 'anonymous' });
  }, []);

  async function login(credentials: { email: string; password: string }) {
    const result = await authApi.login(credentials);
    if (result.ok) {
      setLoginError(null);
      setNotice(null);
      setAuth({ state: 'signed-in', current: result.value });
    } else {
      setNotice(null);
      setLoginError(authFailureMessage(result.failure));
    }
  }

  return (
    <main className="pt-shell">
      <header className="pt-header">
        <span className="pt-wordmark">Puntuale</span>
        <span className="pt-badge">1.0-b.1 · en construcción</span>
      </header>
      <section className="pt-card" aria-live="polite">
        <h1>Control de asistencia</h1>
        <p className={`pt-status pt-status--${health.state}`}>{HEALTH_LABELS_ES[health.state]}</p>
      </section>
      {auth.state === 'anonymous' && (
        <section className="pt-card">
          <h2>Iniciar sesión</h2>
          {notice && <p className="pt-notice">{notice}</p>}
          <LoginForm submitLabel="Entrar" error={loginError} onSubmit={login} />
        </section>
      )}
      {auth.state === 'signed-in' && (
        <SessionPanel
          api={authApi}
          current={auth.current}
          onChanged={onChanged}
          onEnded={onEnded}
        />
      )}
    </main>
  );
}
