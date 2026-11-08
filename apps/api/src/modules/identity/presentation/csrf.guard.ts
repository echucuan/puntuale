import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../../../config/app-config';
import { SessionAuthenticator } from '../application/session-authenticator.service';
import { cookieNames, readCookie } from '../domain/auth-cookies';
import { type CsrfBinding, verifyCsrfToken } from '../domain/csrf';
import { isOriginAllowed, isSafeMethod } from '../domain/origin-policy';

/**
 * Protección CSRF de `/api` (ADR 0014): valida el origen en toda petición y exige
 * `X-CSRF-Token` en los métodos mutables, incluidos login y logout.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly allowedOrigins: ReadonlySet<string>;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SessionAuthenticator) private readonly authenticator: SessionAuthenticator,
  ) {
    this.allowedOrigins = new Set(config.security.corsOrigins);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    if (!request.path.startsWith('/api/')) return true;

    const originAllowed = isOriginAllowed({
      method: request.method,
      origin: request.headers.origin,
      referer: request.headers.referer,
      allowed: this.allowedOrigins,
    });
    if (!originAllowed) throw new ForbiddenException();
    if (isSafeMethod(request.method)) return true;

    const token = request.headers['x-csrf-token'];
    const binding = await this.binding(request);
    if (
      typeof token !== 'string' ||
      !binding ||
      !verifyCsrfToken(this.config.security.authSecret, binding, token)
    ) {
      throw new ForbiddenException();
    }
    return true;
  }

  private async binding(request: Request): Promise<CsrfBinding | null> {
    const session = await this.authenticator.authenticate(request);
    if (session) return { kind: 'session', sessionId: session.id };
    const nonce = readCookie(request.headers.cookie, cookieNames(this.config.nodeEnv).csrf);
    return nonce ? { kind: 'anonymous', nonce } : null;
  }
}
