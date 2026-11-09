import type { ActivePermission, MfaSituation, RoleCode } from '@puntuale/contracts';

/** Rol que debe conservar al menos una membresía activa en cada empresa. */
export const LAST_ADMIN_ROLE: RoleCode = 'company_owner';

/** Un rol vigente de la membresía, con sus permisos activos. Los reservados no llegan aquí. */
export interface RoleGrant {
  role: RoleCode;
  requiresMfa: boolean;
  isAdmin: boolean;
  permissions: ActivePermission[];
}

/** Estado del segundo factor de la persona en esta sesión. */
export type SessionMfaState = 'verified' | 'enrolled' | 'not_enrolled';

export type AuthorizationDecision =
  | { allowed: true }
  | { allowed: false; reason: 'permission_denied' | 'mfa_required' | 'mfa_enrollment_required' };

/**
 * Denegación predeterminada: solo concede un permiso que venga de un rol vigente. Si ese rol exige
 * MFA, la sesión debe haberlo completado.
 */
export function authorize(
  grants: readonly RoleGrant[],
  permission: ActivePermission,
  mfa: SessionMfaState,
): AuthorizationDecision {
  const sources = grants.filter((grant) => grant.permissions.includes(permission));
  if (sources.length === 0) return { allowed: false, reason: 'permission_denied' };
  if (mfa === 'verified' || sources.some((grant) => !grant.requiresMfa)) return { allowed: true };
  return {
    allowed: false,
    reason: mfa === 'enrolled' ? 'mfa_required' : 'mfa_enrollment_required',
  };
}

export function effectivePermissions(grants: readonly RoleGrant[]): ActivePermission[] {
  return [...new Set(grants.flatMap((grant) => grant.permissions))].sort();
}

/** Permisos que la sesión puede ejercer ahora: los de roles con MFA exigen haberlo completado. */
export function grantedPermissions(
  grants: readonly RoleGrant[],
  mfa: SessionMfaState,
): ActivePermission[] {
  return effectivePermissions(grants.filter((grant) => !grant.requiresMfa || mfa === 'verified'));
}

/** Qué debe hacer la persona con su segundo factor para usar todos sus roles en esta empresa. */
export function mfaSituation(grants: readonly RoleGrant[], mfa: SessionMfaState): MfaSituation {
  if (!grants.some((grant) => grant.requiresMfa)) return 'not_required';
  if (mfa === 'verified') return 'ok';
  return mfa === 'enrolled' ? 'verify' : 'enrollment_required';
}

export interface AccessActor {
  membershipId: string;
  permissions: readonly ActivePermission[];
}

export interface AccessTarget {
  membershipId: string;
  status: 'active' | 'revoked';
  roles: readonly { code: RoleCode; isAdmin: boolean }[];
}

export type AccessChange =
  | { kind: 'assign_role'; role: RoleCode; roleIsAdmin: boolean }
  | { kind: 'retire_role'; role: RoleCode; roleIsAdmin: boolean }
  | { kind: 'set_status'; status: 'active' | 'revoked' };

export type AccessChangeDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: 'permission_denied' | 'self_modification' | 'last_admin' | 'membership_inactive';
    };

/** Solo importa si el destino es el único con acceso efectivo: retirar a otro no deja a nadie fuera. */
function removesLastEffectiveOwner(
  target: AccessTarget,
  change: AccessChange,
  effectiveOwners: ReadonlySet<string>,
): boolean {
  if (effectiveOwners.size !== 1 || !effectiveOwners.has(target.membershipId)) return false;
  if (change.kind === 'set_status') return change.status === 'revoked';
  return change.kind === 'retire_role' && change.role === LAST_ADMIN_ROLE;
}

/**
 * Reglas de un cambio de acceso. Se evalúa dentro del bloqueo por empresa, con datos releídos.
 * - El único propietario con acceso efectivo (membresía activa, rol vigente y credencial activa)
 *   no se puede retirar ni desactivar, ni siquiera a sí mismo.
 * - Nadie cambia su propio acceso: así nadie puede elevarse.
 * - Tocar un rol administrativo, o a quien lo tiene, exige `access.manage_admins`.
 */
export function decideAccessChange(
  actor: AccessActor,
  target: AccessTarget,
  change: AccessChange,
  effectiveOwners: ReadonlySet<string>,
): AccessChangeDecision {
  if (!actor.permissions.includes('access.manage')) {
    return { allowed: false, reason: 'permission_denied' };
  }
  const touchesAdmin =
    target.roles.some((role) => role.isAdmin) ||
    (change.kind !== 'set_status' && change.roleIsAdmin);
  if (touchesAdmin && !actor.permissions.includes('access.manage_admins')) {
    return { allowed: false, reason: 'permission_denied' };
  }
  if (removesLastEffectiveOwner(target, change, effectiveOwners)) {
    return { allowed: false, reason: 'last_admin' };
  }
  if (actor.membershipId === target.membershipId) {
    return { allowed: false, reason: 'self_modification' };
  }
  if (change.kind === 'assign_role' && target.status !== 'active') {
    return { allowed: false, reason: 'membership_inactive' };
  }
  return { allowed: true };
}
