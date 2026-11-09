import { PERMISSION_LABELS_ES, ROLE_LABELS_ES } from '@puntuale/contracts';
import { Message } from '../components/message';
import { PageFrame, type PageContext } from '../components/page-frame';
import { MfaNotice } from './mfa-notice';
import { tenantNavFor, useTenantMe } from './use-tenant-me';

interface MyAccessPageProps extends PageContext {
  tenantId: string;
  onSessionRefresh: () => Promise<void>;
}

/** «Mi acceso»: identidad y accesos propios en la empresa de la URL. */
export function MyAccessPage({ tenantId, onSessionRefresh, ...context }: MyAccessPageProps) {
  const { api, navigate, onEnded } = context;
  const { me, error, reload } = useTenantMe(api, tenantId, onEnded);

  return (
    <PageFrame {...context} title="Mi acceso" tenantNav={tenantNavFor(tenantId, me)}>
      {error && <Message kind="error">{error}</Message>}
      {!me && !error && (
        <p className="pt-loading" role="status">
          Cargando…
        </p>
      )}
      {me && (
        <>
          <MfaNotice
            situation={me.mfa}
            api={api}
            navigate={navigate}
            onVerified={async () => {
              await reload();
              await onSessionRefresh();
            }}
            onSessionEnded={onEnded}
          />
          <section className="pt-card" aria-labelledby="pt-identity-title">
            <h2 id="pt-identity-title">{me.tenant.legalName}</h2>
            <dl className="pt-facts">
              <dt>Nombre</dt>
              <dd>{me.user.displayName}</dd>
              <dt>Correo</dt>
              <dd>{me.user.email}</dd>
              <dt>Membresía</dt>
              <dd>Activa</dd>
              <dt>Registro de colaborador</dt>
              <dd>
                {me.employee
                  ? `${me.employee.displayName} · ${me.employee.employeeNumber}`
                  : 'Sin registro de colaborador'}
              </dd>
              <dt>Zona horaria de la empresa</dt>
              <dd>{me.tenant.timezone}</dd>
            </dl>
          </section>
          <section className="pt-card" aria-labelledby="pt-roles-title">
            <h2 id="pt-roles-title">Roles y permisos</h2>
            {me.roles.length === 0 ? (
              <p className="pt-hint">No tienes roles asignados en esta empresa.</p>
            ) : (
              <div className="pt-tags">
                {me.roles.map((role) => (
                  <span key={role} className="pt-tag">
                    {ROLE_LABELS_ES[role]}
                  </span>
                ))}
              </div>
            )}
            {me.permissions.length > 0 ? (
              <ul className="pt-plain-list">
                {me.permissions.map((permission) => (
                  <li key={permission}>{PERMISSION_LABELS_ES[permission]}</li>
                ))}
              </ul>
            ) : (
              <p className="pt-hint">
                {me.mfa === 'verify' || me.mfa === 'enrollment_required'
                  ? 'Tus permisos se habilitan al completar la verificación en dos pasos.'
                  : 'Tu rol no incluye permisos de administración de accesos.'}
              </p>
            )}
          </section>
        </>
      )}
    </PageFrame>
  );
}
