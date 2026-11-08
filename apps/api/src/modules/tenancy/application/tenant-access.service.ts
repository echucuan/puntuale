import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL, withTenant } from '../../../database/tenant-transaction';
import type { TenantContext } from '../domain/session';
import { findActiveMembership } from '../infrastructure/membership.repository';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Puerto de acceso a un tenant, para que el guard no dependa de la base de datos. */
export interface TenantAccess {
  resolve(tenantId: string, userId: string): Promise<TenantContext | null>;
}

/**
 * Decide si un usuario puede actuar en una empresa. Devuelve `null` cuando el identificador no es
 * un UUID, la empresa no existe o no hay membresía activa: los tres casos se ven igual desde fuera.
 */
@Injectable()
export class TenantAccessService implements TenantAccess {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async resolve(tenantId: string, userId: string): Promise<TenantContext | null> {
    if (!UUID.test(tenantId) || !UUID.test(userId)) return null;
    const normalizedTenantId = tenantId.toLowerCase();
    const membership = await withTenant(this.pool, normalizedTenantId, (client) =>
      findActiveMembership(client, normalizedTenantId, userId.toLowerCase()),
    );
    return membership;
  }
}
