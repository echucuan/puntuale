import type { CurrentSessionResponse } from '@puntuale/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccountPage } from './account/account-page';
import { type AuthApi, createAuthApi, type FormFeedback, toFormFeedback } from './api/auth';
import { fetchHealth, type HealthView } from './api/health';
import { LoginPage } from './auth/login-page';
import { BrandLogo } from './components/brand-logo';
import type { PageContext } from './components/page-frame';
import { useRoute } from './routing';
import { AccessPage } from './tenant/access-page';
import { MyAccessPage } from './tenant/my-access-page';
import { TenantSelectPage } from './tenant/tenant-select-page';

const authApi: AuthApi = createAuthApi();

type AuthView =
  | { state: 'loading' }
  | { state: 'anonymous' }
  | { state: 'signed-in'; current: CurrentSessionResponse };

/** Enruta entre acceso, empresas y cuenta. Sin reglas de negocio. */
export function App() {
  const [health, setHealth] = useState<HealthView>({ state: 'loading' });
  const [auth, setAuth] = useState<AuthView>({ state: 'loading' });
  const [feedback, setFeedback] = useState<FormFeedback | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { route, path, navigate } = useRoute();
  const previousScreen = useRef<string>('loading');

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
  const screen = auth.state === 'signed-in' ? path : auth.state;
  useEffect(() => {
    if (previousScreen.current !== 'loading' && previousScreen.current !== screen) {
      document.querySelector<HTMLElement>('[data-page-heading]')?.focus();
    }
    previousScreen.current = screen;
  }, [screen]);

  const onChanged = useCallback((current: CurrentSessionResponse) => {
    setAuth({ state: 'signed-in', current });
  }, []);

  const onEnded = useCallback(
    (message: string | null) => {
      setNotice(message);
      setFeedback(null);
      setAuth({ state: 'anonymous' });
      navigate('/');
    },
    [navigate],
  );

  const refreshSession = useCallback(async () => {
    const result = await authApi.currentSession();
    if (result.ok) setAuth({ state: 'signed-in', current: result.value });
  }, []);

  async function login(credentials: { email: string; password: string }) {
    setFeedback(null);
    const result = await authApi.login(credentials);
    setNotice(null);
    if (result.ok) {
      // Tras iniciar sesión siempre se elige la empresa de forma explícita.
      navigate('/');
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

  const context: PageContext = {
    api: authApi,
    health,
    current: auth.current,
    navigate,
    path,
    onEnded,
  };

  switch (route.kind) {
    case 'account':
      return <AccountPage {...context} onChanged={onChanged} />;
    case 'my-access':
      return (
        <MyAccessPage
          key={route.tenantId}
          {...context}
          tenantId={route.tenantId}
          onSessionRefresh={refreshSession}
        />
      );
    case 'access':
      return (
        <AccessPage
          key={route.tenantId}
          {...context}
          tenantId={route.tenantId}
          onSessionRefresh={refreshSession}
        />
      );
    default:
      return <TenantSelectPage {...context} />;
  }
}
