import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import type { TenantContext } from '../domain/session';
import { PermissionGuard } from './permission.guard';

const TENANT: TenantContext = { tenantId: 't', userId: 'u', membershipId: 'm' };

function run(permission: string | undefined, tenantContext: TenantContext | undefined) {
  const reflector = { getAllAndOverride: () => permission } as unknown as Reflector;
  const authorize = vi.fn(async () => ({ allowed: true }) as const);
  const guard = new PermissionGuard(
    reflector,
    { authorize },
    {
      resolve: async () => 'verified',
    },
  );
  const context = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ tenantContext, headers: {} }) }),
  } as unknown as ExecutionContext;
  return { result: guard.canActivate(context), authorize };
}

describe('PermissionGuard', () => {
  it('deniega si la ruta no declara permiso', async () => {
    const { result, authorize } = run(undefined, TENANT);
    await expect(result).rejects.toMatchObject({ code: 'permission_denied' });
    expect(authorize).not.toHaveBeenCalled();
  });

  it('deniega si falta el contexto de empresa', async () => {
    await expect(run('access.read', undefined).result).rejects.toMatchObject({
      code: 'permission_denied',
    });
  });

  it('permite cuando la política lo concede', async () => {
    await expect(run('access.read', TENANT).result).resolves.toBe(true);
  });
});
