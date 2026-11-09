import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiCodedException } from '../../../common/http/api-coded.exception';
import { APP_CONFIG, type AppConfig } from '../../../config/app-config';
import { SessionAuthenticator } from '../application/session-authenticator.service';
import { keyedHash } from '../domain/keyed-hash';
import {
  RATE_LIMIT_STORE,
  type RateLimitScope,
  type RateLimitStore,
} from '../domain/rate-limit-store';
import { requestMeta } from './request-meta';

/** Límite de peticiones por minuto en `/api`, por IP y por sesión (ADR 0014). */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    @Inject(RATE_LIMIT_STORE) private readonly store: RateLimitStore,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SessionAuthenticator) private readonly authenticator: SessionAuthenticator,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    if (!request.path.startsWith('/api/')) return true;

    const { api, authSecret } = this.config.security;
    const response = http.getResponse<Response>();
    const ip = requestMeta(request).ip ?? 'unknown';
    await this.enforce(
      'api_ip',
      keyedHash(authSecret, 'rate:ip', ip),
      api.perIpPerMinute,
      response,
    );

    const token = this.authenticator.sessionToken(request);
    if (token) {
      await this.enforce(
        'api_session',
        keyedHash(authSecret, 'rate:session', token),
        api.perSessionPerMinute,
        response,
      );
    }
    return true;
  }

  private async enforce(
    scope: RateLimitScope,
    key: string,
    limit: number,
    response: Response,
  ): Promise<void> {
    const { hits, retryAfterSeconds } = await this.store.hit(scope, key);
    if (hits > limit) {
      response.setHeader('Retry-After', String(retryAfterSeconds));
      throw new ApiCodedException(HttpStatus.TOO_MANY_REQUESTS, 'rate_limited');
    }
  }
}
