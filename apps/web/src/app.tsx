import type { CurrentSessionResponse } from '@puntuale/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccountPage } from './account/account-page';
import { type AuthApi, createAuthApi, type FormFeedback, toFormFeedback } from './api/auth';
import { fetchHealth, type HealthView } from './api/health';
import { LoginPage } from './auth/login-page';
import { BrandLogo } from './components/brand-logo';

const authApi: AuthApi = createAuthApi();

type AuthView =
  | { state: 'loading' }
  | { state: 'anonymous' }
  | { state: 'signed-in'; current: CurrentSessionResponse };

/** Acceso y «Mi cuenta» de 1.0-b.1. Sin reglas de negocio. */
export function App() {
  const [health, setHealth] = useState<HealthView>({ state: 'loading' });
  const [auth, setAuth] = useState<AuthView>({ state: 'loading' });
  const [feedback, setFeedback] = useState<FormFeedback | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const previousState = useRef<AuthView['state']>('loading');

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

  // Al cambiar de pantalla tras una acción, el foco pasa a su título.
  useEffect(() => {
    if (previousState.current !== 'loading' && previousState.current !== auth.state) {
      document.querySelector<HTMLElement>('[data-page-heading]')?.focus();
    }
    previousState.current = auth.state;
  }, [auth.state]);

  const onChanged = useCallback((current: CurrentSessionResponse) => {
    setAuth({ state: 'signed-in', current });
  }, []);

  const onEnded = useCallback((message: string | null) => {
    setNotice(message);
    setFeedback(null);
    setAuth({ state: 'anonymous' });
  }, []);

  async function login(credentials: { email: string; password: string }) {
    setFeedback(null);
    const result = await authApi.login(credentials);
    setNotice(null);
    if (result.ok) {
      setAuth({ state: 'signed-in', current: result.value });
    } else {
      setFeedback(toFormFeedback(result.failure));
    }
  }

  if (auth.state === 'loading') {
    return (
      <main className="pt-splash">
        <BrandLogo className="pt-logo--large" />
        <p role="status">Cargando…</p>
      </main>
    );
  }

  if (auth.state === 'anonymous') {
    return <LoginPage health={health} notice={notice} feedback={feedback} onSubmit={login} />;
  }

  return (
    <AccountPage
      api={authApi}
      health={health}
      current={auth.current}
      onChanged={onChanged}
      onEnded={onEnded}
    />
  );
}
