import {
  type AccessMember,
  type AccessMembersResponse,
  ROLE_CODES,
  ROLE_LABELS_ES,
  type RoleCode,
} from '@puntuale/contracts';
import { useCallback, useEffect, useId, useState } from 'react';
import { accessFailureMessage, type AuthFailure, type AuthResult } from '../api/auth';
import { Message } from '../components/message';
import { PageFrame, type PageContext } from '../components/page-frame';
import { MfaNotice } from './mfa-notice';
import { tenantNavFor, useTenantMe } from './use-tenant-me';

interface AccessPageProps extends PageContext {
  tenantId: string;
  onSessionRefresh: () => Promise<void>;
}

type Outcome = { kind: 'success' | 'error'; message: string };

/** Vista de accesos. Oculta lo que no se puede hacer, pero quien decide siempre es la API. */
export function AccessPage({ tenantId, onSessionRefresh, ...context }: AccessPageProps) {
  const { api, navigate, onEnded } = context;
  const { me, error: meError, reload: reloadMe } = useTenantMe(api, tenantId, onEnded);
  const [data, setData] = useState<AccessMembersResponse | null>(null);
  const [denied, setDenied] = useState<AuthFailure | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await api.accessMembers(tenantId);
    if (result.ok) {
      setData(result.value);
      setDenied(null);
    } else if (result.failure.code === 'unauthenticated') {
      onEnded(accessFailureMessage(result.failure));
    } else {
      setData(null);
      setDenied(result.failure);
    }
  }, [api, tenantId, onEnded]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(key: string, action: () => Promise<AuthResult<null>>, done: string) {
    setBusy(key);
    setOutcome(null);
    const result = await action();
    if (result.ok) setOutcome({ kind: 'success', message: done });
    else if (result.failure.code === 'unauthenticated') {
      onEnded(accessFailureMessage(result.failure));
      return;
    } else setOutcome({ kind: 'error', message: accessFailureMessage(result.failure) });
    await load();
    setBusy(null);
  }

  const needsMfa = me?.mfa === 'verify' || me?.mfa === 'enrollment_required';
  const showDenied = denied && !needsMfa && !meError;

  return (
    <PageFrame {...context} title="Accesos de la empresa" tenantNav={tenantNavFor(tenantId, me)}>
      {meError && <Message kind="error">{meError}</Message>}
      {me && (
        <>
          <p className="pt-lead pt-lead--flush">{me.tenant.legalName}</p>
          <MfaNotice
            situation={me.mfa}
            api={api}
            navigate={navigate}
            onVerified={async () => {
              await reloadMe();
              await load();
              await onSessionRefresh();
            }}
            onSessionEnded={onEnded}
          />
        </>
      )}
      {showDenied && <Message kind="error">{accessFailureMessage(denied)}</Message>}
      {outcome && <Message kind={outcome.kind}>{outcome.message}</Message>}
      {data && (
        <ul className="pt-list">
          {data.members.map((member) => (
            <MemberCard
              key={member.membershipId}
              member={member}
              data={data}
              busy={busy}
              onAssign={(role) =>
                void run(
                  `assign:${member.membershipId}`,
                  () => api.assignRole(tenantId, member.membershipId, role),
                  `Se asignó «${ROLE_LABELS_ES[role]}» a ${member.displayName}.`,
                )
              }
              onRetire={(role) =>
                void run(
                  `retire:${member.membershipId}:${role}`,
                  () => api.retireRole(tenantId, member.membershipId, role),
                  `Se retiró «${ROLE_LABELS_ES[role]}» a ${member.displayName}.`,
                )
              }
              onStatus={(status) =>
                void run(
                  `status:${member.membershipId}`,
                  () => api.setMembershipStatus(tenantId, member.membershipId, status),
                  status === 'active'
                    ? `Se activó la membresía de ${member.displayName}.`
                    : `Se desactivó la membresía de ${member.displayName}. Perdió el acceso de inmediato.`,
                )
              }
            />
          ))}
        </ul>
      )}
    </PageFrame>
  );
}

function MemberCard({
  member,
  data,
  busy,
  onAssign,
  onRetire,
  onStatus,
}: {
  member: AccessMember;
  data: AccessMembersResponse;
  busy: string | null;
  onAssign: (role: RoleCode) => void;
  onRetire: (role: RoleCode) => void;
  onStatus: (status: 'active' | 'revoked') => void;
}) {
  const selectId = useId();
  const [selected, setSelected] = useState('');
  const adminRoles = new Set(data.adminRoles);
  const targetIsAdmin = member.roles.some((role) => adminRoles.has(role));
  const editable = data.canManage && !member.isSelf && (data.canManageAdmins || !targetIsAdmin);
  const active = member.status === 'active';
  const assignable = ROLE_CODES.filter(
    (role) => !member.roles.includes(role) && (data.canManageAdmins || !adminRoles.has(role)),
  );
  const disabled = busy !== null;

  return (
    <li className="pt-card pt-member">
      <div className="pt-card-head">
        <div className="pt-member-name">
          <h2>{member.displayName}</h2>
          {member.isSelf && <span className="pt-tag">Tú</span>}
        </div>
        <span className={`pt-tag${active ? '' : ' pt-tag--muted'}`}>
          {active ? 'Activa' : 'Inactiva'}
        </span>
      </div>
      <p className="pt-hint">
        {member.email}
        {member.employeeNumber ? ` · Colaborador ${member.employeeNumber}` : ''}
      </p>

      {member.roles.length === 0 ? (
        <p className="pt-hint">Sin roles asignados.</p>
      ) : (
        <ul className="pt-roles">
          {member.roles.map((role) => (
            <li key={role}>
              <span>{ROLE_LABELS_ES[role]}</span>
              {editable && (
                <button
                  type="button"
                  className="pt-link-button pt-link-button--danger"
                  disabled={disabled}
                  aria-label={`Retirar ${ROLE_LABELS_ES[role]} a ${member.displayName}`}
                  onClick={() => onRetire(role)}
                >
                  Retirar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!active && (
        <Message kind="info">
          {member.roles.length > 0
            ? `Al activar esta membresía recuperará: ${member.roles
                .map((role) => ROLE_LABELS_ES[role])
                .join(', ')}.`
            : 'Al activar esta membresía no tendrá roles asignados.'}
          {data.canManage && targetIsAdmin && !data.canManageAdmins
            ? ' Activarla requiere el permiso de gestionar accesos administrativos.'
            : ''}
        </Message>
      )}

      {editable && (
        <div className="pt-member-actions">
          {active && assignable.length > 0 && (
            <form
              className="pt-assign"
              onSubmit={(event) => {
                event.preventDefault();
                if (selected) onAssign(selected as RoleCode);
                setSelected('');
              }}
            >
              <label htmlFor={selectId}>Asignar rol</label>
              <select
                id={selectId}
                value={selected}
                onChange={(event) => setSelected(event.target.value)}
              >
                <option value="">Elige un rol</option>
                {assignable.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS_ES[role]}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="pt-button pt-button--quiet"
                disabled={disabled || !selected}
              >
                Asignar
              </button>
            </form>
          )}
          <button
            type="button"
            className={`pt-button ${active ? 'pt-button--danger' : 'pt-button--secondary'}`}
            disabled={disabled}
            aria-label={`${active ? 'Desactivar' : 'Activar'} la membresía de ${member.displayName}`}
            onClick={() => onStatus(active ? 'revoked' : 'active')}
          >
            {active ? 'Desactivar membresía' : 'Activar membresía'}
          </button>
        </div>
      )}
      {member.isSelf && data.canManage && (
        <small className="pt-note">Tu propio acceso lo cambia otra persona administradora.</small>
      )}
    </li>
  );
}
