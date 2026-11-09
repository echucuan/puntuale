import { describe, expect, it } from 'vitest';
import {
  type AccessActor,
  type AccessTarget,
  authorize,
  decideAccessChange,
  effectivePermissions,
  mfaSituation,
  type RoleGrant,
} from './access-policy';

const owner: RoleGrant = {
  role: 'company_owner',
  requiresMfa: true,
  isAdmin: true,
  permissions: ['access.read', 'access.manage', 'access.manage_admins'],
};
const hr: RoleGrant = {
  role: 'hr_admin',
  requiresMfa: true,
  isAdmin: true,
  permissions: ['access.read', 'access.manage'],
};
const employee: RoleGrant = {
  role: 'employee',
  requiresMfa: false,
  isAdmin: false,
  permissions: [],
};

describe('authorize', () => {
  it('deniega por defecto sin roles o sin el permiso', () => {
    expect(authorize([], 'access.read', 'verified')).toEqual({
      allowed: false,
      reason: 'permission_denied',
    });
    expect(authorize([employee], 'access.read', 'verified')).toEqual({
      allowed: false,
      reason: 'permission_denied',
    });
  });

  it('un rol con MFA no concede el permiso hasta completarlo', () => {
    expect(authorize([owner], 'access.read', 'not_enrolled')).toEqual({
      allowed: false,
      reason: 'mfa_enrollment_required',
    });
    expect(authorize([owner], 'access.read', 'enrolled')).toEqual({
      allowed: false,
      reason: 'mfa_required',
    });
    expect(authorize([owner], 'access.read', 'verified')).toEqual({ allowed: true });
  });

  it('no concede un permiso que el rol no incluye', () => {
    expect(authorize([hr], 'access.manage_admins', 'verified').allowed).toBe(false);
  });
});

describe('mfaSituation', () => {
  it('distingue no requerido, inscripción, verificación y completo', () => {
    expect(mfaSituation([employee], 'not_enrolled')).toBe('not_required');
    expect(mfaSituation([owner], 'not_enrolled')).toBe('enrollment_required');
    expect(mfaSituation([owner], 'enrolled')).toBe('verify');
    expect(mfaSituation([owner], 'verified')).toBe('ok');
  });
});

it('effectivePermissions une los permisos sin repetir', () => {
  expect(effectivePermissions([owner, hr])).toEqual([
    'access.manage',
    'access.manage_admins',
    'access.read',
  ]);
});

describe('decideAccessChange', () => {
  const ownerActor: AccessActor = { membershipId: 'a', permissions: owner.permissions };
  const hrActor: AccessActor = { membershipId: 'a', permissions: hr.permissions };
  const plain: AccessTarget = {
    membershipId: 'b',
    status: 'active',
    roles: [{ code: 'employee', isAdmin: false }],
  };
  const ownerTarget: AccessTarget = {
    membershipId: 'b',
    status: 'active',
    roles: [{ code: 'company_owner', isAdmin: true }],
  };
  const assign = (role: 'hr_admin' | 'auditor', roleIsAdmin: boolean) =>
    ({ kind: 'assign_role', role, roleIsAdmin }) as const;
  const both = new Set(['a', 'b']);
  const onlyTarget = new Set(['b']);
  const onlyActor = new Set(['a']);
  const retireOwner = { kind: 'retire_role', role: 'company_owner', roleIsAdmin: true } as const;

  it('sin access.manage se deniega', () => {
    const reader: AccessActor = { membershipId: 'a', permissions: ['access.read'] };
    expect(decideAccessChange(reader, plain, assign('auditor', false), both)).toEqual({
      allowed: false,
      reason: 'permission_denied',
    });
  });

  it('RH gestiona roles no administrativos, pero no asigna ni afecta administradores', () => {
    expect(decideAccessChange(hrActor, plain, assign('auditor', false), both).allowed).toBe(true);
    expect(decideAccessChange(hrActor, plain, assign('hr_admin', true), both)).toEqual({
      allowed: false,
      reason: 'permission_denied',
    });
    expect(
      decideAccessChange(hrActor, ownerTarget, { kind: 'set_status', status: 'revoked' }, both),
    ).toEqual({
      allowed: false,
      reason: 'permission_denied',
    });
  });

  it('nadie cambia su propio acceso', () => {
    const self = { ...plain, membershipId: 'a' };
    expect(decideAccessChange(ownerActor, self, assign('hr_admin', true), both)).toEqual({
      allowed: false,
      reason: 'self_modification',
    });
    expect(decideAccessChange(hrActor, self, assign('auditor', false), both)).toEqual({
      allowed: false,
      reason: 'self_modification',
    });
  });

  it('protege al único propietario con acceso efectivo, también de sí mismo', () => {
    expect(decideAccessChange(ownerActor, ownerTarget, retireOwner, onlyTarget)).toEqual({
      allowed: false,
      reason: 'last_admin',
    });
    expect(
      decideAccessChange(
        ownerActor,
        ownerTarget,
        { kind: 'set_status', status: 'revoked' },
        onlyTarget,
      ),
    ).toEqual({
      allowed: false,
      reason: 'last_admin',
    });
    const self = { ...ownerTarget, membershipId: 'a' };
    expect(decideAccessChange(ownerActor, self, retireOwner, onlyActor)).toEqual({
      allowed: false,
      reason: 'last_admin',
    });
  });

  it('permite retirar a un propietario deshabilitado si queda el habilitado', () => {
    expect(decideAccessChange(ownerActor, ownerTarget, retireOwner, onlyActor).allowed).toBe(true);
    expect(
      decideAccessChange(
        ownerActor,
        ownerTarget,
        { kind: 'set_status', status: 'revoked' },
        onlyActor,
      ).allowed,
    ).toBe(true);
  });

  it('reactivar o retirar otro rol no activa la protección', () => {
    const activate = { kind: 'set_status', status: 'active' } as const;
    expect(decideAccessChange(ownerActor, ownerTarget, activate, onlyTarget).allowed).toBe(true);
    const retireOther = { kind: 'retire_role', role: 'auditor', roleIsAdmin: false } as const;
    expect(decideAccessChange(ownerActor, ownerTarget, retireOther, onlyTarget).allowed).toBe(true);
  });

  it('con otro propietario activo se puede retirar', () => {
    expect(decideAccessChange(ownerActor, ownerTarget, retireOwner, both).allowed).toBe(true);
  });

  it('no asigna roles a una membresía inactiva', () => {
    expect(
      decideAccessChange(
        ownerActor,
        { ...plain, status: 'revoked' },
        assign('auditor', false),
        both,
      ),
    ).toEqual({ allowed: false, reason: 'membership_inactive' });
  });
});
