import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { TenantContext } from '../domain/session';
import type { TenantRequest } from './tenant.guard';

/** Inyecta el `TenantContext` que validó el `TenantGuard`. Falla si la ruta no usa el guard. */
export const CurrentTenant = createParamDecorator(
  (_data: unknown, context: ExecutionContext): TenantContext => {
    const request = context.switchToHttp().getRequest<TenantRequest>();
    if (!request.tenantContext) {
      throw new Error('CurrentTenant requiere TenantGuard en la ruta.');
    }
    return request.tenantContext;
  },
);
