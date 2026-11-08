import { HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { LoginRequest } from '@puntuale/contracts';
import type { Pool } from 'pg';
import { ApiCodedException } from '../../../common/http/api-coded.exception';
import { APP_CONFIG, type AppConfig } from '../../../config/app-config';
import { PG_POOL } from '../../../database/tenant-transaction';
import { withTransaction } from '../../../database/transaction';
import type { ActiveSessionRecord, RequestMeta } from '../domain/active-session';
import { keyedHash } from '../domain/keyed-hash';
import { evaluateLoginThrottle } from '../domain/login-throttle';
import { generateSessionToken, hashSessionToken } from '../domain/session-token';
import { findLoginAccount } from '../infrastructure/account.repository';
import {
  clearLoginFailures,
  insertLoginFailure,
  lockAccountThrottle,
  readThrottleSnapshot,
} from '../infrastructure/login-throttle.repository';
import { PasswordHasher } from '../infrastructure/password-hasher';
import { recordSecurityEvent } from '../infrastructure/security-event.repository';
import {
  findActiveSession,
  insertSession,
  listActiveSessions,
  revokeSession,
  type SessionListItem,
} from '../infrastructure/session.repository';

export class RateLimitedException extends ApiCodedException {
  constructor(readonly retryAfterSeconds: number) {
    super(HttpStatus.TOO_MANY_REQUESTS, 'rate_limited');
  }
}

export interface LoginResult {
  token: string;
  session: ActiveSessionRecord;
}

/** Casos de uso de sesión. Todo cambio y su evento de seguridad van en la misma transacción. */
@Injectable()
export class AuthService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
  ) {}

  private key(purpose: string, value: string): string {
    return keyedHash(this.config.security.authSecret, purpose, value);
  }

  /**
   * Inicia sesión. Fallar por contraseña o por cuenta inexistente produce la misma respuesta.
   * `previousToken` es el token que traía la petición: si sigue vigente, se revoca (rotación).
   */
  async login(
    credentials: LoginRequest,
    previousToken: string | null,
    meta: RequestMeta,
  ): Promise<LoginResult> {
    const accountKey = this.key('throttle:account', credentials.email);
    const ipKey = this.key('throttle:ip', meta.ip ?? 'unknown');
    const identifierHash = this.key('identifier', credentials.email);

    await this.reserveAttempt(accountKey, ipKey, identifierHash, meta);

    const account = await findLoginAccount(this.pool, credentials.email);
    const valid = await this.hasher.verify(account?.passwordHash ?? null, credentials.password);
    if (!account || !valid) {
      await recordSecurityEvent(this.pool, {
        eventType: 'login_failed',
        failureReason: account ? 'bad_password' : 'unknown_or_disabled_account',
        userId: account?.userId ?? null,
        identifierHash: account ? null : identifierHash,
        meta,
      });
      throw new ApiCodedException(HttpStatus.UNAUTHORIZED, 'invalid_credentials');
    }

    const token = generateSessionToken();
    const tokenHash = hashSessionToken(token);
    const session = await withTransaction(this.pool, async (client) => {
      if (previousToken) {
        const previous = await findActiveSession(client, hashSessionToken(previousToken));
        if (previous && (await revokeSession(client, previous.id, 'rotated'))) {
          await recordSecurityEvent(client, {
            eventType: 'session_revoked',
            userId: previous.userId,
            sessionId: previous.id,
            meta,
          });
        }
      }
      const sessionId = await insertSession(
        client,
        account.userId,
        tokenHash,
        this.config.security.session,
        meta,
      );
      await clearLoginFailures(client, accountKey);
      await recordSecurityEvent(client, {
        eventType: 'login_succeeded',
        userId: account.userId,
        sessionId,
        meta,
      });
      return findActiveSession(client, tokenHash);
    });
    return { token, session: session! };
  }

  /**
   * Revisa los límites y registra el intento **antes** de verificar la contraseña, para que
   * peticiones concurrentes no los superen. Un login exitoso borra después esos registros.
   */
  private async reserveAttempt(
    accountKey: string,
    ipKey: string,
    identifierHash: string,
    meta: RequestMeta,
  ): Promise<void> {
    const limits = this.config.security.login;
    const decision = await withTransaction(this.pool, async (client) => {
      await lockAccountThrottle(client, accountKey);
      const snapshot = await readThrottleSnapshot(client, accountKey, ipKey, limits.windowSeconds);
      const result = evaluateLoginThrottle(snapshot, limits);
      if (result.allowed) {
        await insertLoginFailure(client, accountKey, ipKey);
      } else {
        await recordSecurityEvent(client, {
          eventType: 'login_failed',
          failureReason: 'rate_limited',
          identifierHash,
          meta,
        });
      }
      return result;
    });
    if (!decision.allowed) throw new RateLimitedException(decision.retryAfterSeconds);
  }

  async logout(session: ActiveSessionRecord, meta: RequestMeta): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      if (await revokeSession(client, session.id, 'logout')) {
        await recordSecurityEvent(client, {
          eventType: 'logout',
          userId: session.userId,
          sessionId: session.id,
          meta,
        });
      }
    });
  }

  listSessions(userId: string): Promise<SessionListItem[]> {
    return listActiveSessions(this.pool, userId);
  }

  /** Revoca una sesión propia. La de otra persona responde 404: no se revela que existe. */
  async revokeOwnSession(
    owner: ActiveSessionRecord,
    sessionId: string,
    meta: RequestMeta,
  ): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      if (!(await revokeSession(client, sessionId, 'user_revoked', owner.userId))) {
        throw new NotFoundException();
      }
      await recordSecurityEvent(client, {
        eventType: 'session_revoked',
        userId: owner.userId,
        sessionId,
        meta,
      });
    });
  }
}
