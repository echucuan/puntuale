import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { TenantAccessService, type TenantAccess } from '../application/tenant-access.service';
import { SESSION_RESOLVER, type SessionResolver, type TenantContext } from '../domain/session';

export type TenantRequest = Request & { tenantContext?: TenantContext };

/**
 * Autorización por empresa para toda ruta `/api/t/:tenantId/...` (ADR 0003).
 * - Sin sesión → 401.
 * - Sin membresía activa, empresa inexistente o identificador inválido → 404 (no revela si existe).
 * - La URL nunca concede acceso: solo dice qué empresa se pide; la membresía se valida en la base.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    @Inject(SESSION_RESOLVER) private readonly sessions: SessionResolver,
    @Inject(TenantAccessService) private readonly access: TenantAccess,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<TenantRequest>();
    const session = await this.sessions.resolve(request);
    if (!session) throw new UnauthorizedException();

    const tenantId = request.params['tenantId'];
    if (typeof tenantId !== 'string') throw new NotFoundException();

    const tenantContext = await this.access.resolve(tenantId, session.userId);
    if (!tenantContext) throw new NotFoundException();

    request.tenantContext = tenantContext;
    return true;
  }
}
