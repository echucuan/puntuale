import type { FormFeedback } from '../api/auth';
import type { HealthView } from '../api/health';
import { AppMeta } from '../components/app-meta';
import { BrandLogo } from '../components/brand-logo';
import { Message } from '../components/message';
import { LoginForm } from './login-form';

interface LoginPageProps {
  health: HealthView;
  notice: string | null;
  feedback: FormFeedback | null;
  onSubmit: (credentials: { email: string; password: string }) => Promise<void>;
}

export function LoginPage({ health, notice, feedback, onSubmit }: LoginPageProps) {
  return (
    <div className="pt-login">
      <aside className="pt-login-brand">
        <BrandLogo className="pt-logo--large" />
        <div className="pt-login-claim">
          <p className="pt-tagline">Cada jornada cuenta</p>
          <p className="pt-tagline-note">Control de asistencia</p>
        </div>
        <div className="pt-login-band" aria-hidden="true" />
      </aside>
      <main className="pt-login-main">
        <div className="pt-login-panel">
          <h1 tabIndex={-1} data-page-heading>
            Iniciar sesión
          </h1>
          {notice && <Message kind="info">{notice}</Message>}
          <LoginForm
            submitLabel="Iniciar sesión"
            busyLabel="Iniciando sesión…"
            feedback={feedback}
            onSubmit={onSubmit}
          />
          <AppMeta health={health} />
        </div>
      </main>
    </div>
  );
}
