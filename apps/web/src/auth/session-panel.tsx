import type { ActiveSession, CurrentSessionResponse } from '@puntuale/contracts';
import { useCallback, useEffect, useState } from 'react';
import { type AuthApi, type AuthFailure, authFailureMessage } from '../api/auth';
import { LoginForm } from './login-form';

interface SessionPanelProps {
  api: AuthApi;
  current: CurrentSessionResponse;
  onChanged: (next: CurrentSessionResponse) => void;
  onEnded: (message: string | null) => void;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'medium' });
}

export function SessionPanel({ api, current, onChanged, onEnded }: SessionPanelProps) {
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rotationError, setRotationError] = useState<string | null>(null);
  const [rotation, setRotation] = useState<{ before: string; after: string } | null>(null);

  const handleFailure = useCallback(
    (failure: AuthFailure, show: (message: string) => void) => {
      if (failure.code === 'unauthenticated') onEnded(authFailureMessage(failure));
      else show(authFailureMessage(failure));
    },
    [onEnded],
  );

  const refresh = useCallback(async () => {
    const result = await api.listSessions();
    if (result.ok) {
      setSessions(result.value);
      setError(null);
    } else {
      handleFailure(result.failure, setError);
    }
  }, [api, handleFailure]);

  useEffect(() => {
    void refresh();
  }, [refresh, current.session.id]);

  async function logout() {
    const result = await api.logout();
    if (result.ok) onEnded('Sesión cerrada.');
    else handleFailure(result.failure, setError);
  }

  async function revoke(item: ActiveSession) {
    const result = await api.revokeSession(item.id);
    if (!result.ok) handleFailure(result.failure, setError);
    else if (item.current) onEnded('Revocaste la sesión actual.');
    else await refresh();
  }

  async function rotate(credentials: { email: string; password: string }) {
    const result = await api.login(credentials);
    if (result.ok) {
      setRotationError(null);
      setRotation({ before: current.session.id, after: result.value.session.id });
      onChanged(result.value);
    } else {
      handleFailure(result.failure, setRotationError);
    }
  }

  return (
    <>
      <section className="pt-card">
        <h2>Sesión actual</h2>
        <dl className="pt-facts">
          <dt>Persona</dt>
          <dd>
            {current.user.displayName} · {current.user.email}
          </dd>
          <dt>Identificador</dt>
          <dd>
            <code>{current.session.id}</code>
          </dd>
          <dt>Inicio</dt>
          <dd>{formatDate(current.session.createdAt)}</dd>
          <dt>Vence por inactividad</dt>
          <dd>{formatDate(current.session.idleExpiresAt)}</dd>
          <dt>Vence en definitiva</dt>
          <dd>{formatDate(current.session.expiresAt)}</dd>
        </dl>
        {error && (
          <p className="pt-error" role="alert">
            {error}
          </p>
        )}
        <button type="button" className="pt-button" onClick={() => void logout()}>
          Cerrar sesión
        </button>
      </section>

      <section className="pt-card">
        <div className="pt-card-head">
          <h2>Sesiones activas</h2>
          <button type="button" className="pt-link" onClick={() => void refresh()}>
            Actualizar
          </button>
        </div>
        <ul className="pt-sessions">
          {sessions.map((item) => (
            <li key={item.id}>
              <div>
                <strong>{item.current ? 'Esta sesión' : 'Otra sesión'}</strong>
                <code>{item.id}</code>
                <small>
                  Última actividad: {formatDate(item.lastActivityAt)} · IP: {item.ip ?? 'n/d'}
                </small>
                <small>{item.userAgent ?? 'Navegador desconocido'}</small>
              </div>
              <button type="button" className="pt-link" onClick={() => void revoke(item)}>
                Revocar
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="pt-card">
        <h2>Rotación de sesión</h2>
        <p className="pt-hint">
          Iniciar sesión de nuevo crea otro identificador y revoca el anterior.
        </p>
        {rotation && (
          <dl className="pt-facts" aria-live="polite">
            <dt>Anterior (revocada)</dt>
            <dd>
              <code>{rotation.before}</code>
            </dd>
            <dt>Nueva</dt>
            <dd>
              <code>{rotation.after}</code>
            </dd>
          </dl>
        )}
        <LoginForm
          key={current.session.id}
          fixedEmail={current.user.email}
          submitLabel="Volver a iniciar sesión"
          error={rotationError}
          onSubmit={rotate}
        />
      </section>
    </>
  );
}
