import { type FormEvent, useId, useLayoutEffect, useState } from 'react';
import { type FormFeedback, formatWait } from '../api/auth';
import { Icon, Message } from '../components/message';

const EYE = 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z';
const EYE_OFF =
  'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a18 18 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a10 10 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2';

/** Segundos que faltan de la espera indicada por la API. La API sigue aplicando el límite. */
function useWaitCountdown(feedback: FormFeedback | null): number {
  const [remaining, setRemaining] = useState(0);
  useLayoutEffect(() => {
    if (feedback?.kind !== 'wait') {
      setRemaining(0);
      return undefined;
    }
    const endsAt = Date.now() + feedback.retryAfterSeconds * 1000;
    setRemaining(feedback.retryAfterSeconds);
    const timer = setInterval(() => {
      const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) clearInterval(timer);
    }, 250);
    return () => clearInterval(timer);
  }, [feedback]);
  return remaining;
}

interface LoginFormProps {
  /** Correo fijo para confirmar la identidad. Sin él, el campo se puede editar. */
  fixedEmail?: string;
  submitLabel: string;
  busyLabel: string;
  feedback: FormFeedback | null;
  onSubmit: (credentials: { email: string; password: string }) => Promise<void>;
}

export function LoginForm({
  fixedEmail,
  submitLabel,
  busyLabel,
  feedback,
  onSubmit,
}: LoginFormProps) {
  const [email, setEmail] = useState(fixedEmail ?? '');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const remaining = useWaitCountdown(feedback);
  const ids = useId();
  const emailId = `${ids}-email`;
  const passwordId = `${ids}-password`;
  const feedbackId = `${ids}-feedback`;

  const waiting = remaining > 0;
  const waitEnded = feedback?.kind === 'wait' && !waiting;
  const invalid = feedback?.kind === 'error';

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (waiting) return;
    setBusy(true);
    setPasswordVisible(false);
    try {
      await onSubmit({ email: fixedEmail ?? email, password });
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  const buttonLabel = busy ? busyLabel : waiting ? `Espera ${formatWait(remaining)}` : submitLabel;

  return (
    <form className="pt-form" onSubmit={(event) => void handleSubmit(event)}>
      {fixedEmail === undefined && (
        <div className="pt-field">
          <label htmlFor={emailId}>Correo</label>
          <input
            id={emailId}
            type="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            aria-invalid={invalid}
            aria-describedby={feedback ? feedbackId : undefined}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
      )}
      <div className="pt-field">
        <label htmlFor={passwordId}>Contraseña</label>
        <div className="pt-password">
          <input
            id={passwordId}
            type={passwordVisible ? 'text' : 'password'}
            autoComplete="current-password"
            autoCapitalize="none"
            spellCheck={false}
            required
            aria-invalid={invalid}
            aria-describedby={feedback ? feedbackId : undefined}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <button
            type="button"
            className="pt-password-toggle"
            aria-controls={passwordId}
            aria-label={passwordVisible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            onClick={() => setPasswordVisible((visible) => !visible)}
          >
            <Icon path={passwordVisible ? EYE_OFF : EYE} />
            <span aria-hidden="true">{passwordVisible ? 'Ocultar' : 'Mostrar'}</span>
          </button>
        </div>
      </div>
      {feedback?.kind === 'error' && (
        <Message kind="error" id={feedbackId}>
          {feedback.message}
        </Message>
      )}
      {feedback?.kind === 'wait' && waiting && (
        <Message kind="wait" id={feedbackId}>
          Demasiados intentos. {feedback.message}
        </Message>
      )}
      {waitEnded && (
        <Message kind="info" id={feedbackId}>
          Terminó la espera. Ya puedes volver a intentarlo.
        </Message>
      )}
      <button
        type="submit"
        className="pt-button pt-button--primary"
        disabled={busy || waiting}
        aria-busy={busy}
      >
        {busy && <span className="pt-spinner" aria-hidden="true" />}
        {buttonLabel}
      </button>
    </form>
  );
}
