import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ActivePermission } from '@puntuale/contracts';
import { ApiCodedException } from '../../../common/http/api-coded.exception';
import { AccessService } from '../application/access.service';
import { SESSION_MFA_RESOLVER, type SessionMfaResolver } from '../domain/session';
import type { TenantRequest } from './tenant.guard';

const PERMISSION_KEY = 'puntuale:required-permission';

/** Declara el permiso de una ruta. Sin esta marca, `PermissionGuard` deniega. */
export const RequirePermission = (permission: ActivePermission) =>
  SetMetadata(PERMISSION_KEY, permission);

/**
 * Autorización por permiso. Va siempre después de `TenantGuard` y evalúa los roles vigentes en cada
 * petición: denegación predeterminada, también si a la ruta le falta el permiso o el contexto.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AccessService) private readonly access: Pick<AccessService, 'authorize'>,
    @Inject(SESSION_MFA_RESOLVER) private readonly mfa: SessionMfaResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const permission = this.reflector.getAllAndOverride<ActivePermission | undefined>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    const request = context.switchToHttp().getRequest<TenantRequest>();
    if (!permission || !request.tenantContext) {
      throw new ApiCodedException(HttpStatus.FORBIDDEN, 'permission_denied');
    }
    const decision = await this.access.authorize(
      request.tenantContext,
      permission,
      await this.mfa.resolve(request),
    );
    if (!decision.allowed) throw new ApiCodedException(HttpStatus.FORBIDDEN, decision.reason);
    return true;
  }
}
