import type { MfaFactor } from '@puntuale/contracts';
import { type FormEvent, useId, useState } from 'react';
import { type AuthApi, type AuthResult, mfaFailureMessage } from '../api/auth';
import { Message } from '../components/message';

/** Campo de un código de seis dígitos de la aplicación autenticadora. */
export function TotpField({
  value,
  onChange,
  label = 'Código de seis dígitos',
}: {
  value: string;
  onChange: (next: string) => void;
  label?: string;
}) {
  const id = useId();
  return (
    <div className="pt-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="pt-code-input"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, ''))}
      />
    </div>
  );
}

export function PasswordField({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const id = useId();
  return (
    <div className="pt-field">
      <label htmlFor={id}>Contraseña actual</label>
      <input
        id={id}
        type="password"
        autoComplete="current-password"
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export interface FactorValue {
  useRecovery: boolean;
  code: string;
  recoveryCode: string;
}

export const EMPTY_FACTOR: FactorValue = { useRecovery: false, code: '', recoveryCode: '' };

export function toFactor(value: FactorValue): MfaFactor {
  return value.useRecovery ? { recoveryCode: value.recoveryCode.trim() } : { code: value.code };
}

/** Un segundo factor: código de la aplicación o, si no se tiene a la mano, de recuperación. */
export function FactorFields({
  value,
  onChange,
}: {
  value: FactorValue;
  onChange: (next: FactorValue) => void;
}) {
  const id = useId();
  return (
    <>
      {value.useRecovery ? (
        <div className="pt-field">
          <label htmlFor={id}>Código de recuperación</label>
          <input
            id={id}
            className="pt-code-input"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            required
            maxLength={32}
            value={value.recoveryCode}
            onChange={(event) => onChange({ ...value, recoveryCode: event.target.value })}
          />
        </div>
      ) : (
        <TotpField value={value.code} onChange={(code) => onChange({ ...value, code })} />
      )}
      <button
        type="button"
        className="pt-link-button"
        onClick={() => onChange({ ...EMPTY_FACTOR, useRecovery: !value.useRecovery })}
      >
        {value.useRecovery ? 'Usar el código de la aplicación' : 'Usar un código de recuperación'}
      </button>
    </>
  );
}

/** Completa el segundo factor en esta sesión. */
export function MfaVerifyForm({
  api,
  onVerified,
  onSessionEnded,
}: {
  api: AuthApi;
  onVerified: () => void | Promise<void>;
  onSessionEnded: (message: string) => void;
}) {
  const [factor, setFactor] = useState(EMPTY_FACTOR);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result: AuthResult<null> = await api.verifyMfa(toFactor(factor));
    if (result.ok) {
      setFactor(EMPTY_FACTOR);
      await onVerified();
    } else if (result.failure.code === 'unauthenticated') {
      onSessionEnded(mfaFailureMessage(result.failure));
    } else {
      setError(mfaFailureMessage(result.failure));
    }
    setBusy(false);
  }

  return (
    <form className="pt-form" onSubmit={(event) => void submit(event)}>
      <FactorFields value={factor} onChange={setFactor} />
      {error && <Message kind="error">{error}</Message>}
      <button
        type="submit"
        className="pt-button pt-button--primary"
        disabled={busy}
        aria-busy={busy}
      >
        {busy ? 'Verificando…' : 'Verificar'}
      </button>
    </form>
  );
}
