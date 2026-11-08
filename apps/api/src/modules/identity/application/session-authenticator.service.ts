import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { APP_CONFIG, type AppConfig } from '../../../config/app-config';
import { PG_POOL } from '../../../database/tenant-transaction';
import type { SessionRequest } from '../../tenancy/domain/session';
import type { ActiveSessionRecord } from '../domain/active-session';
import { cookieNames, readCookie } from '../domain/auth-cookies';
import { hashSessionToken } from '../domain/session-token';
import { findActiveSession, touchSession } from '../infrastructure/session.repository';

/** Autentica una petición por su cookie. El resultado se recuerda para no repetir la consulta. */
@Injectable()
export class SessionAuthenticator {
  private readonly cache = new WeakMap<object, Promise<ActiveSessionRecord | null>>();

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  authenticate(request: SessionRequest): Promise<ActiveSessionRecord | null> {
    let result = this.cache.get(request);
    if (!result) {
      result = this.lookup(request);
      this.cache.set(request, result);
    }
    return result;
  }

  /** Olvida el resultado después de que la petición cambió la sesión (login o logout). */
  forget(request: SessionRequest): void {
    this.cache.delete(request);
  }

  private async lookup(request: SessionRequest): Promise<ActiveSessionRecord | null> {
    const token = this.sessionToken(request);
    if (!token) return null;
    const session = await findActiveSession(this.pool, hashSessionToken(token));
    if (!session) return null;
    return touchSession(this.pool, session, this.config.security.session.idleTtlSeconds);
  }

  sessionToken(request: SessionRequest): string | null {
    const header = request.headers['cookie'];
    return readCookie(
      typeof header === 'string' ? header : undefined,
      cookieNames(this.config.nodeEnv).session,
    );
  }
}
