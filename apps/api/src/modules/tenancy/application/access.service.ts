import { HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AccessMembersResponse,
  ActivePermission,
  MyTenant,
  RoleCode,
  TenantMeResponse,
} from '@puntuale/contracts';
import type { Pool, PoolClient } from 'pg';
import { ApiCodedException } from '../../../common/http/api-coded.exception';
import { PG_POOL, withTenant } from '../../../database/tenant-transaction';
import type { RequestMetadata } from '../../audit/domain/audit-entry';
import { AuditRepository } from '../../audit/infrastructure/audit.repository';
import {
  type AccessChange,
  type AuthorizationDecision,
  authorize,
  decideAccessChange,
  grantedPermissions,
  mfaSituation,
  type SessionMfaState,
} from '../domain/access-policy';
import type { TenantContext } from '../domain/session';
import {
  assignRole,
  findAccessTarget,
  findLinkedEmployee,
  findMemberIdentity,
  findTenantSummary,
  isAdminRole,
  listAccessMembers,
  listAdminRoles,
  listEffectiveOwners,
  listTenantsForSession,
  loadRoleGrants,
  type LockedTarget,
  lockTenantAccess,
  retireRole,
  setMembershipStatus,
} from '../infrastructure/access.repository';
import { findActiveMembership } from '../infrastructure/membership.repository';

export type AccessChangeRequest =
  | { kind: 'assign_role'; role: RoleCode }
  | { kind: 'retire_role'; role: RoleCode }
  | { kind: 'set_status'; status: 'active' | 'revoked' };

const DENIAL_STATUS = {
  permission_denied: HttpStatus.FORBIDDEN,
  self_modification: HttpStatus.FORBIDDEN,
  last_admin: HttpStatus.CONFLICT,
} as const;

/** Consultas y cambios de acceso de una empresa (ADR 0015). Las reglas viven en `access-policy`. */
@Injectable()
export class AccessService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(AuditRepository) private readonly audit: AuditRepository,
  ) {}

  listMyTenants(tokenHash: string): Promise<MyTenant[]> {
    return listTenantsForSession(this.pool, tokenHash);
  }

  /** Evalúa un permiso en cada petición, con los roles vigentes de la membresía. */
  async authorize(
    tenant: TenantContext,
    permission: ActivePermission,
    mfa: SessionMfaState,
  ): Promise<AuthorizationDecision> {
    const grants = await withTenant(this.pool, tenant.tenantId, (client) =>
      loadRoleGrants(client, tenant.tenantId, tenant.membershipId),
    );
    return authorize(grants, permission, mfa);
  }

  me(tenant: TenantContext, mfa: SessionMfaState): Promise<TenantMeResponse> {
    return withTenant(this.pool, tenant.tenantId, async (client) => {
      const [summary, identity, employee, grants] = [
        await findTenantSummary(client, tenant.tenantId),
        await findMemberIdentity(client, tenant.userId),
        await findLinkedEmployee(client, tenant.tenantId, tenant.membershipId),
        await loadRoleGrants(client, tenant.tenantId, tenant.membershipId),
      ];
      return {
        tenant: summary,
        user: { id: tenant.userId, ...identity },
        membership: { id: tenant.membershipId, status: 'active' as const },
        employee,
        roles: grants.map((grant) => grant.role),
        permissions: grantedPermissions(grants, mfa),
        mfa: mfaSituation(grants, mfa),
      };
    });
  }

  /** Registra que la persona entró a trabajar en esta empresa. */
  async select(tenant: TenantContext, request: RequestMetadata): Promise<void> {
    await withTenant(this.pool, tenant.tenantId, (client) =>
      this.audit.record(client, {
        ...this.auditBase(tenant, request),
        action: 'tenancy.tenant.switched',
        entityType: 'user_tenant',
        entityId: tenant.membershipId,
        before: null,
        after: {
          id: tenant.membershipId,
          tenantId: tenant.tenantId,
          userId: tenant.userId,
          status: 'active',
        },
      }),
    );
  }

  listMembers(tenant: TenantContext, mfa: SessionMfaState): Promise<AccessMembersResponse> {
    return withTenant(this.pool, tenant.tenantId, async (client) => {
      const grants = await loadRoleGrants(client, tenant.tenantId, tenant.membershipId);
      const permissions = grantedPermissions(grants, mfa);
      return {
        members: await listAccessMembers(client, tenant.tenantId, tenant.membershipId),
        canManage: permissions.includes('access.manage'),
        canManageAdmins:
          permissions.includes('access.manage') && permissions.includes('access.manage_admins'),
        adminRoles: await listAdminRoles(client),
      };
    });
  }

  /**
   * Aplica un cambio de acceso. Todo ocurre bajo un bloqueo por empresa y con datos releídos: quien
   * perdió su acceso mientras esperaba ya no puede actuar, y dos propietarios que se retiran
   * mutuamente no dejan a la empresa sin ninguno con acceso efectivo. Sin cambio real no se escribe
   * ni se audita.
   */
  async change(
    tenant: TenantContext,
    membershipId: string,
    request: AccessChangeRequest,
    mfa: SessionMfaState,
    meta: RequestMetadata,
  ): Promise<void> {
    await withTenant(this.pool, tenant.tenantId, async (client) => {
      await lockTenantAccess(client, tenant.tenantId);

      const actor = await findActiveMembership(client, tenant.tenantId, tenant.userId);
      if (!actor) throw new NotFoundException();
      const grants = await loadRoleGrants(client, tenant.tenantId, actor.membershipId);

      const target = await findAccessTarget(client, tenant.tenantId, membershipId);
      if (!target) throw new NotFoundException();

      const change: AccessChange =
        request.kind === 'set_status'
          ? request
          : { ...request, roleIsAdmin: await isAdminRole(client, request.role) };

      const decision = decideAccessChange(
        { membershipId: actor.membershipId, permissions: grantedPermissions(grants, mfa) },
        target,
        change,
        await listEffectiveOwners(client),
      );
      if (!decision.allowed) {
        if (decision.reason === 'membership_inactive') {
          throw new ApiCodedException(HttpStatus.CONFLICT, 'conflict');
        }
        throw new ApiCodedException(DENIAL_STATUS[decision.reason], decision.reason);
      }
      await this.apply(client, tenant, target, request, meta);
    });
  }

  private async apply(
    client: PoolClient,
    tenant: TenantContext,
    target: LockedTarget,
    request: AccessChangeRequest,
    meta: RequestMetadata,
  ): Promise<void> {
    const base = this.auditBase(tenant, meta);
    if (request.kind === 'set_status') {
      const changed = await setMembershipStatus(
        client,
        tenant.tenantId,
        target.membershipId,
        request.status,
      );
      if (!changed) return;
      const snapshot = {
        id: target.membershipId,
        tenantId: tenant.tenantId,
        userId: target.userId,
        employeeId: target.employeeId,
      };
      await this.audit.record(client, {
        ...base,
        action:
          request.status === 'active'
            ? 'tenancy.membership.activated'
            : 'tenancy.membership.deactivated',
        entityType: 'user_tenant',
        entityId: target.membershipId,
        before: { ...snapshot, status: target.status },
        after: { ...snapshot, status: request.status },
      });
      return;
    }

    const snapshot = {
      tenantId: tenant.tenantId,
      membershipId: target.membershipId,
      role: request.role,
      scopeType: 'tenant',
    };
    if (request.kind === 'assign_role') {
      const id = await assignRole(
        client,
        tenant.tenantId,
        target.membershipId,
        request.role,
        tenant.userId,
      );
      if (!id) return;
      await this.audit.record(client, {
        ...base,
        action: 'tenancy.membership_role.assigned',
        entityType: 'membership_role',
        entityId: id,
        before: null,
        after: { id, ...snapshot },
      });
      return;
    }
    const id = await retireRole(
      client,
      tenant.tenantId,
      target.membershipId,
      request.role,
      tenant.userId,
    );
    if (!id) return;
    await this.audit.record(client, {
      ...base,
      action: 'tenancy.membership_role.retired',
      entityType: 'membership_role',
      entityId: id,
      before: { id, ...snapshot },
      after: null,
    });
  }

  private auditBase(tenant: TenantContext, request: RequestMetadata) {
    return {
      tenantId: tenant.tenantId,
      actorType: 'user' as const,
      actorUserId: tenant.userId,
      channel: 'online' as const,
      reason: null,
      request,
      subjectOccurredAt: null,
    };
  }
}
