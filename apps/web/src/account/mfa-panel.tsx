import type {
  CurrentSessionResponse,
  MfaEnrollmentResponse,
  MfaStatusResponse,
} from '@puntuale/contracts';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { type AuthApi, type AuthFailure, mfaFailureMessage } from '../api/auth';
import { Message } from '../components/message';
import {
  EMPTY_FACTOR,
  FactorFields,
  MfaVerifyForm,
  PasswordField,
  toFactor,
  TotpField,
} from './mfa-fields';
import { QrCode } from './qr-code';

interface MfaPanelProps {
  api: AuthApi;
  current: CurrentSessionResponse;
  onChanged: (next: CurrentSessionResponse) => void;
  onEnded: (message: string | null) => void;
}

type Outcome = { kind: 'success' | 'error'; message: string };

/** Sección «Verificación en dos pasos». El secreto y los códigos solo viven en esta pantalla. */
export function MfaPanel({ api, current, onChanged, onEnded }: MfaPanelProps) {
  const [status, setStatus] = useState<MfaStatusResponse | null>(null);
  const [enrollment, setEnrollment] = useState<MfaEnrollmentResponse | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const fail = useCallback(
    (failure: AuthFailure) => {
      if (failure.code === 'unauthenticated') onEnded(mfaFailureMessage(failure));
      else setOutcome({ kind: 'error', message: mfaFailureMessage(failure) });
    },
    [onEnded],
  );

  const reload = useCallback(async () => {
    const [next, session] = await Promise.all([api.mfaStatus(), api.currentSession()]);
    if (next.ok) setStatus(next.value);
    else fail(next.failure);
    if (session.ok) onChanged(session.value);
  }, [api, fail, onChanged]);

  useEffect(() => {
    void api.mfaStatus().then((next) => {
      if (next.ok) setStatus(next.value);
      else fail(next.failure);
    });
  }, [api, fail, current.session.id]);

  function started(next: MfaEnrollmentResponse) {
    setOutcome(null);
    setEnrollment(next);
  }

  async function confirmed(codes: string[]) {
    setEnrollment(null);
    setRecoveryCodes(codes);
    setOutcome({ kind: 'success', message: 'La verificación en dos pasos quedó activa.' });
    await reload();
  }

  let body;
  if (recoveryCodes) {
    body = <RecoveryCodes codes={recoveryCodes} onDone={() => setRecoveryCodes(null)} />;
  } else if (status === null) {
    body = (
      <p className="pt-loading" role="status">
        Cargando…
      </p>
    );
  } else if (enrollment) {
    body = (
      <EnrollmentSteps
        api={api}
        account={current.user.email}
        enrollment={enrollment}
        onConfirmed={confirmed}
        onCancel={() => setEnrollment(null)}
        onFailure={fail}
      />
    );
  } else if (!status.enrolled) {
    body = <StartEnrollment api={api} onStarted={started} onFailure={fail} />;
  } else if (!status.verifiedThisSession) {
    body = (
      <div className="pt-card">
        <h3>Verifica esta sesión</h3>
        <p className="pt-hint">Escribe el código de tu aplicación para usar tus roles con MFA.</p>
        <MfaVerifyForm
          api={api}
          onVerified={async () => {
            setOutcome({ kind: 'success', message: 'Sesión verificada.' });
            await reload();
          }}
          onSessionEnded={onEnded}
        />
      </div>
    );
  } else {
    body = (
      <ManageMfa
        api={api}
        status={status}
        onStarted={started}
        onDisabled={async () => {
          setOutcome({ kind: 'success', message: 'Desactivaste la verificación en dos pasos.' });
          await reload();
        }}
        onFailure={fail}
      />
    );
  }

  return (
    <section className="pt-section" aria-labelledby="pt-mfa-title">
      <h2 id="pt-mfa-title">Verificación en dos pasos</h2>
      <p className="pt-lead">Es obligatoria para los roles administrativos y de auditoría.</p>
      {outcome && <Message kind={outcome.kind}>{outcome.message}</Message>}
      {body}
    </section>
  );
}

function StartEnrollment({
  api,
  onStarted,
  onFailure,
}: {
  api: AuthApi;
  onStarted: (next: MfaEnrollmentResponse) => void;
  onFailure: (failure: AuthFailure) => void;
}) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const result = await api.startMfaEnrollment({ password });
    setPassword('');
    setBusy(false);
    if (result.ok) onStarted(result.value);
    else onFailure(result.failure);
  }

  return (
    <div className="pt-card">
      <div className="pt-card-head">
        <h3>Sin configurar</h3>
        <span className="pt-tag pt-tag--muted">No activa</span>
      </div>
      <p className="pt-hint">
        Necesitas una aplicación autenticadora en tu teléfono. Confirma tu contraseña para empezar.
      </p>
      <form className="pt-form" onSubmit={(event) => void submit(event)}>
        <PasswordField value={password} onChange={setPassword} />
        <button
          type="submit"
          className="pt-button pt-button--primary"
          disabled={busy}
          aria-busy={busy}
        >
          {busy ? 'Comprobando…' : 'Configurar'}
        </button>
      </form>
    </div>
  );
}

function EnrollmentSteps({
  api,
  account,
  enrollment,
  onConfirmed,
  onCancel,
  onFailure,
}: {
  api: AuthApi;
  account: string;
  enrollment: MfaEnrollmentResponse;
  onConfirmed: (codes: string[]) => void | Promise<void>;
  onCancel: () => void;
  onFailure: (failure: AuthFailure) => void;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const result = await api.confirmMfaEnrollment({ code });
    setCode('');
    setBusy(false);
    if (result.ok) await onConfirmed(result.value.recoveryCodes);
    else onFailure(result.failure);
  }

  return (
    <div className="pt-card">
      <h3>Agrega tu cuenta a la aplicación</h3>
      <div className="pt-enroll">
        <QrCode
          value={enrollment.otpauthUri}
          label={`Código QR para agregar la cuenta ${account}`}
        />
        <div className="pt-enroll-steps">
          <p className="pt-hint">Escanea el código QR o escribe esta clave en la aplicación:</p>
          <code className="pt-secret">{enrollment.secret}</code>
          <p className="pt-hint">Después escribe el código que te muestre para confirmar.</p>
          <form className="pt-form" onSubmit={(event) => void submit(event)}>
            <TotpField value={code} onChange={setCode} />
            <div className="pt-actions">
              <button
                type="submit"
                className="pt-button pt-button--primary"
                disabled={busy}
                aria-busy={busy}
              >
                {busy ? 'Confirmando…' : 'Confirmar'}
              </button>
              <button type="button" className="pt-button pt-button--quiet" onClick={onCancel}>
                Cancelar
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  return (
    <div className="pt-card pt-card--current">
      <h3>Guarda tus códigos de recuperación</h3>
      <Message kind="info">
        Solo se muestran esta vez. Cada código sirve una sola vez si pierdes acceso a tu aplicación.
      </Message>
      <ul className="pt-codes">
        {codes.map((code) => (
          <li key={code}>
            <code>{code}</code>
          </li>
        ))}
      </ul>
      <button type="button" className="pt-button pt-button--secondary" onClick={onDone}>
        Ya los guardé
      </button>
    </div>
  );
}

function ManageMfa({
  api,
  status,
  onStarted,
  onDisabled,
  onFailure,
}: {
  api: AuthApi;
  status: MfaStatusResponse;
  onStarted: (next: MfaEnrollmentResponse) => void;
  onDisabled: () => void | Promise<void>;
  onFailure: (failure: AuthFailure) => void;
}) {
  return (
    <>
      <div className="pt-card pt-card--current">
        <div className="pt-card-head">
          <h3>Activa</h3>
          <span className="pt-tag">✓ Sesión verificada</span>
        </div>
        <dl className="pt-facts">
          <dt>Códigos de recuperación disponibles</dt>
          <dd>{status.recoveryCodesRemaining}</dd>
        </dl>
      </div>
      <Reauthenticate
        title="Reemplazar la aplicación"
        hint="Tu configuración actual sigue vigente hasta que confirmes la nueva. Al confirmarla recibirás códigos de recuperación nuevos."
        submitLabel="Reemplazar"
        busyLabel="Comprobando…"
        danger={false}
        onSubmit={async (input) => {
          const result = await api.startMfaEnrollment(input);
          if (result.ok) onStarted(result.value);
          else onFailure(result.failure);
        }}
      />
      <Reauthenticate
        title="Desactivar"
        hint="Mientras esté desactivada no podrás usar tus roles administrativos o de auditoría."
        submitLabel="Desactivar"
        busyLabel="Desactivando…"
        danger
        onSubmit={async (input) => {
          const result = await api.disableMfa(input);
          if (result.ok) await onDisabled();
          else onFailure(result.failure);
        }}
      />
    </>
  );
}

function Reauthenticate({
  title,
  hint,
  submitLabel,
  busyLabel,
  danger,
  onSubmit,
}: {
  title: string;
  hint: string;
  submitLabel: string;
  busyLabel: string;
  danger: boolean;
  onSubmit: (input: { password: string; code?: string; recoveryCode?: string }) => Promise<void>;
}) {
  const [password, setPassword] = useState('');
  const [factor, setFactor] = useState(EMPTY_FACTOR);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    await onSubmit({ password, ...toFactor(factor) });
    setPassword('');
    setFactor(EMPTY_FACTOR);
    setBusy(false);
  }

  return (
    <details className="pt-details">
      <summary>{title}</summary>
      <div className="pt-details-body">
        <p className="pt-hint">{hint}</p>
        <form className="pt-form pt-form--narrow" onSubmit={(event) => void submit(event)}>
          <PasswordField value={password} onChange={setPassword} />
          <FactorFields value={factor} onChange={setFactor} />
          <button
            type="submit"
            className={`pt-button ${danger ? 'pt-button--danger' : 'pt-button--secondary'}`}
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? busyLabel : submitLabel}
          </button>
        </form>
      </div>
    </details>
  );
}
