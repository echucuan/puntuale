import type { ActiveSession, CurrentSessionResponse } from '@puntuale/contracts';
import { useCallback, useEffect, useState } from 'react';
import {
  type AuthApi,
  type AuthFailure,
  authFailureMessage,
  type FormFeedback,
  toFormFeedback,
} from '../api/auth';
import { Message } from '../components/message';
import { deviceLabel } from './device-label';
import { LoginForm } from './login-form';

interface SessionPanelProps {
  api: AuthApi;
  current: CurrentSessionResponse;
  onChanged: (next: CurrentSessionResponse) => void;
  onEnded: (message: string | null) => void;
}

type Outcome = { kind: 'success' | 'error'; message: string };

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
}

function currentFirst(sessions: ActiveSession[]): ActiveSession[] {
  return [...sessions].sort((a, b) => Number(b.current) - Number(a.current));
}

/** Sección «Seguridad y sesiones». Solo presenta datos y llama a la API. */
export function SessionPanel({ api, current, onChanged, onEnded }: SessionPanelProps) {
  const [sessions, setSessions] = useState<ActiveSession[] | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rotationFeedback, setRotationFeedback] = useState<FormFeedback | null>(null);
  const [rotationDone, setRotationDone] = useState(false);
  const [rotation, setRotation] = useState<{ before: string; after: string } | null>(null);

  const showFailure = useCallback(
    (failure: AuthFailure) => {
      if (failure.code === 'unauthenticated') onEnded(authFailureMessage(failure));
      else setOutcome({ kind: 'error', message: authFailureMessage(failure) });
    },
    [onEnded],
  );

  const load = useCallback(async (): Promise<boolean> => {
    const result = await api.listSessions();
    if (result.ok) setSessions(result.value);
    else showFailure(result.failure);
    return result.ok;
  }, [api, showFailure]);

  useEffect(() => {
    void load();
  }, [load, current.session.id]);

  async function refresh() {
    setBusy('refresh');
    setOutcome(null);
    if (await load()) setOutcome({ kind: 'success', message: 'Lista de sesiones actualizada.' });
    setBusy(null);
  }

  async function revoke(item: ActiveSession) {
    setBusy(item.id);
    setOutcome(null);
    const result = await api.revokeSession(item.id);
    if (!result.ok) {
      showFailure(result.failure);
    } else if (item.current) {
      onEnded('Revocaste la sesión actual. Inicia sesión de nuevo para continuar.');
      return;
    } else if (await load()) {
      setOutcome({ kind: 'success', message: 'Sesión revocada. Ya no puede usarse.' });
    }
    setBusy(null);
  }

  async function rotate(credentials: { email: string; password: string }) {
    setRotationDone(false);
    const result = await api.login(credentials);
    if (result.ok) {
      setRotationFeedback(null);
      setRotationDone(true);
      setRotation({ before: current.session.id, after: result.value.session.id });
      onChanged(result.value);
    } else if (result.failure.code === 'unauthenticated') {
      onEnded(authFailureMessage(result.failure));
    } else {
      setRotationFeedback(toFormFeedback(result.failure));
    }
  }

  const list = sessions ? currentFirst(sessions) : null;

  return (
    <section className="pt-section" aria-labelledby="pt-security-title">
      <h2 id="pt-security-title">Seguridad y sesiones</h2>
      <p className="pt-lead">Revisa dónde has iniciado sesión y cierra lo que no reconozcas.</p>

      <div className="pt-card pt-card--current">
        <div className="pt-card-head">
          <h3>Sesión actual</h3>
          <span className="pt-tag">✓ Esta sesión</span>
        </div>
        <dl className="pt-facts">
          <dt>Iniciada</dt>
          <dd>{formatDate(current.session.createdAt)}</dd>
          <dt>Vence por inactividad</dt>
          <dd>{formatDate(current.session.idleExpiresAt)}</dd>
          <dt>Vence a más tardar</dt>
          <dd>{formatDate(current.session.expiresAt)}</dd>
        </dl>
      </div>

      <div className="pt-card">
        <div className="pt-card-head">
          <h3>Sesiones activas</h3>
          <button
            type="button"
            className="pt-button pt-button--quiet"
            disabled={busy !== null}
            aria-busy={busy === 'refresh'}
            onClick={() => void refresh()}
          >
            {busy === 'refresh' ? 'Actualizando…' : 'Actualizar lista'}
          </button>
        </div>
        {outcome && <Message kind={outcome.kind}>{outcome.message}</Message>}
        {list === null ? (
          <p className="pt-loading" role="status">
            Cargando sesiones…
          </p>
        ) : list.length === 0 ? (
          <p className="pt-loading">No hay sesiones activas.</p>
        ) : (
          <ul className="pt-sessions">
            {list.map((item) => {
              const device = deviceLabel(item.userAgent);
              return (
                <li key={item.id} className={item.current ? 'pt-session--current' : undefined}>
                  <div className="pt-session-info">
                    <strong>{device}</strong>
                    {item.current && <span className="pt-tag">✓ Esta sesión</span>}
                    <small>
                      Iniciada: {formatDate(item.createdAt)} · Última actividad:{' '}
                      {formatDate(item.lastActivityAt)}
                    </small>
                  </div>
                  <button
                    type="button"
                    className="pt-button pt-button--danger"
                    disabled={busy !== null}
                    aria-busy={busy === item.id}
                    aria-label={
                      item.current
                        ? 'Revocar esta sesión y salir'
                        : `Revocar la sesión de ${device} iniciada el ${formatDate(item.createdAt)}`
                    }
                    onClick={() => void revoke(item)}
                  >
                    {busy === item.id ? 'Revocando…' : item.current ? 'Revocar y salir' : 'Revocar'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="pt-card">
        <h3>Renovar esta sesión</h3>
        <p className="pt-hint">
          Confirma tu contraseña para rotar la sesión: se crea una nueva y la actual deja de ser
          válida.
        </p>
        {rotationDone && (
          <Message kind="success">Sesión renovada. La anterior dejó de ser válida.</Message>
        )}
        <LoginForm
          key={current.session.id}
          fixedEmail={current.user.email}
          submitLabel="Renovar sesión"
          busyLabel="Renovando sesión…"
          feedback={rotationFeedback}
          onSubmit={rotate}
        />
      </div>

      <details className="pt-details">
        <summary>Detalles técnicos</summary>
        <div className="pt-details-body">
          <dl className="pt-facts">
            <dt>Identificador de la sesión actual</dt>
            <dd>
              <code>{current.session.id}</code>
            </dd>
            {rotation && (
              <>
                <dt>Última rotación: anterior (revocada)</dt>
                <dd>
                  <code>{rotation.before}</code>
                </dd>
                <dt>Última rotación: nueva</dt>
                <dd>
                  <code>{rotation.after}</code>
                </dd>
              </>
            )}
          </dl>
          {list && list.length > 0 && (
            <ul className="pt-diagnostics">
              {list.map((item) => (
                <li key={item.id}>
                  <code>{item.id}</code>
                  <small>
                    {item.current ? 'Esta sesión · ' : ''}IP: {item.ip ?? 'n/d'}
                  </small>
                  <small>{item.userAgent ?? 'Agente de usuario no disponible'}</small>
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </section>
  );
}
