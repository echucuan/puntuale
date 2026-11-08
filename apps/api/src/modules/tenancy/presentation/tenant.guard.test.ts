import { type ExecutionContext, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { TenantAccess } from '../application/tenant-access.service';
import type { SessionResolver, TenantContext } from '../domain/session';
import { TenantGuard, type TenantRequest } from './tenant.guard';

const TENANT = '0190f5e2-0000-7000-8000-0000000000aa';
const USER = '0190f5e2-0000-7000-8000-0000000000bb';
const MEMBERSHIP = '0190f5e2-0000-7000-8000-0000000000cc';

function httpContext(request: Partial<TenantRequest>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function guardWith(session: { userId: string } | null, context: TenantContext | null) {
  const sessions: SessionResolver = { resolve: vi.fn(async () => session) };
  const access: TenantAccess = { resolve: vi.fn(async () => context) };
  return { guard: new TenantGuard(sessions, access), access };
}

describe('TenantGuard', () => {
  it('sin sesión responde 401 y no consulta la membresía', async () => {
    const { guard, access } = guardWith(null, null);
    await expect(
      guard.canActivate(httpContext({ params: { tenantId: TENANT }, headers: {} })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(access.resolve).not.toHaveBeenCalled();
  });

  it('con sesión pero sin membresía responde 404', async () => {
    const { guard } = guardWith({ userId: USER }, null);
    await expect(
      guard.canActivate(httpContext({ params: { tenantId: TENANT }, headers: {} })),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sin parámetro tenantId responde 404', async () => {
    const { guard } = guardWith({ userId: USER }, null);
    await expect(
      guard.canActivate(httpContext({ params: {}, headers: {} })),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('con membresía adjunta el contexto validado, no el que viene en la URL', async () => {
    const validated = { tenantId: TENANT, userId: USER, membershipId: MEMBERSHIP };
    const { guard, access } = guardWith({ userId: USER }, validated);
    const request: Partial<TenantRequest> = {
      params: { tenantId: TENANT.toUpperCase() },
      headers: {},
    };
    await expect(guard.canActivate(httpContext(request))).resolves.toBe(true);
    expect(access.resolve).toHaveBeenCalledWith(TENANT.toUpperCase(), USER);
    expect(request.tenantContext).toEqual(validated);
  });
});
