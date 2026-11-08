import { Controller, Get, UseGuards } from '@nestjs/common';
import type { TenantContextResponse } from '@puntuale/contracts';
import type { TenantContext } from '../domain/session';
import { CurrentTenant } from './current-tenant.decorator';
import { TenantGuard } from './tenant.guard';

/** `GET /api/t/:tenantId/context`: devuelve el contexto validado. Sirve para probar el guard de punta a punta. */
@Controller('t/:tenantId/context')
@UseGuards(TenantGuard)
export class TenantContextController {
  @Get()
  get(@CurrentTenant() tenant: TenantContext): TenantContextResponse {
    return {
      tenantId: tenant.tenantId,
      userId: tenant.userId,
      membershipId: tenant.membershipId,
    };
  }
}
