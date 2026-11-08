import { type FormEvent, useState } from 'react';

interface LoginFormProps {
  /** Correo fijo para volver a iniciar sesión. Sin él, el campo se puede editar. */
  fixedEmail?: string;
  submitLabel: string;
  error: string | null;
  onSubmit: (credentials: { email: string; password: string }) => Promise<void>;
}

export function LoginForm({ fixedEmail, submitLabel, error, onSubmit }: LoginFormProps) {
  const [email, setEmail] = useState(fixedEmail ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await onSubmit({ email: fixedEmail ?? email, password });
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="pt-form" onSubmit={(event) => void handleSubmit(event)}>
      {fixedEmail === undefined && (
        <label>
          Correo
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
      )}
      <label>
        Contraseña
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      {error && (
        <p className="pt-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="pt-button" disabled={busy}>
        {busy ? 'Procesando…' : submitLabel}
      </button>
    </form>
  );
}
