import { type MyTenant, ROLE_LABELS_ES } from '@puntuale/contracts';
import { useEffect, useState } from 'react';
import { accessFailureMessage } from '../api/auth';
import { Message } from '../components/message';
import { PageFrame, type PageContext } from '../components/page-frame';
import { tenantPath } from '../routing';

/** Selección explícita de empresa. La API la valida y la registra en auditoría. */
export function TenantSelectPage(context: PageContext) {
  const { api, navigate, onEnded } = context;
  const [tenants, setTenants] = useState<MyTenant[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api.myTenants().then((result) => {
      if (!active) return;
      if (result.ok) setTenants(result.value);
      else if (result.failure.code === 'unauthenticated') {
        onEnded(accessFailureMessage(result.failure));
      } else setError(accessFailureMessage(result.failure));
    });
    return () => {
      active = false;
    };
  }, [api, onEnded]);

  async function select(tenant: MyTenant) {
    setBusy(tenant.tenantId);
    setError(null);
    const result = await api.selectTenant(tenant.tenantId);
    if (result.ok) {
      navigate(tenantPath(tenant.tenantId));
      return;
    }
    if (result.failure.code === 'unauthenticated') {
      onEnded(accessFailureMessage(result.failure));
      return;
    }
    setError(accessFailureMessage(result.failure));
    setBusy(null);
  }

  return (
    <PageFrame {...context} title="Elige una empresa">
      {error && <Message kind="error">{error}</Message>}
      {tenants === null && !error && (
        <p className="pt-loading" role="status">
          Cargando empresas…
        </p>
      )}
      {tenants?.length === 0 && (
        <Message kind="info">Tu cuenta no tiene acceso activo a ninguna empresa.</Message>
      )}
      {tenants && tenants.length > 0 && (
        <ul className="pt-list">
          {tenants.map((tenant) => (
            <li key={tenant.tenantId} className="pt-card pt-tenant">
              <div className="pt-tenant-info">
                <h2>{tenant.legalName}</h2>
                <div className="pt-tags">
                  {tenant.roles.map((role) => (
                    <span key={role} className="pt-tag">
                      {ROLE_LABELS_ES[role]}
                    </span>
                  ))}
                </div>
                {tenant.requiresMfa && (
                  <small className="pt-note">Requiere verificación en dos pasos</small>
                )}
              </div>
              <button
                type="button"
                className="pt-button pt-button--secondary"
                disabled={busy !== null}
                aria-busy={busy === tenant.tenantId}
                aria-label={`Entrar a ${tenant.legalName}`}
                onClick={() => void select(tenant)}
              >
                {busy === tenant.tenantId ? 'Entrando…' : 'Entrar'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </PageFrame>
  );
}
