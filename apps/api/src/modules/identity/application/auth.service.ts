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
import { decideRotation, ROTATION_CONFLICT_WINDOW_SECONDS } from '../domain/session-rotation';
import {
  clearLoginFailures,
  insertLoginAttempt,
  lockThrottleKeys,
  readThrottleSnapshot,
  releaseIpAttempt,
} from '../infrastructure/login-throttle.repository';
import { PasswordHasher } from '../infrastructure/password-hasher';
import { recordSecurityEvent } from '../infrastructure/security-event.repository';
import {
  findActiveSession,
  insertSession,
  listActiveSessions,
  lockPresentedSession,
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
   * `previousToken` es el token que traía la petición: si es una sesión vigente de la misma persona,
   * se consume una sola vez (rotación). Quien pierde esa carrera recibe 409, sin sesión ni cookie.
   */
  async login(
    credentials: LoginRequest,
    previousToken: string | null,
    meta: RequestMeta,
  ): Promise<LoginResult> {
    const accountKey = this.key('throttle:account', credentials.email);
    const ipKey = this.key('throttle:ip', meta.ip ?? 'unknown');
    const identifierHash = this.key('identifier', credentials.email);

    const ipAttemptId = await this.reserveAttempt(accountKey, ipKey, identifierHash, meta);

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
      // Orden fijo: primero la sesión presentada y después el bloqueo de la cuenta. La reserva nunca
      // toca sesiones, así que no puede formarse un ciclo de espera.
      const presented = previousToken
        ? await lockPresentedSession(
            client,
            hashSessionToken(previousToken),
            ROTATION_CONFLICT_WINDOW_SECONDS,
          )
        : null;

      // La contraseña fue correcta: este intento no cuenta como fallo, aunque pierda la rotación.
      await lockThrottleKeys(client, [accountKey]);
      await clearLoginFailures(client, accountKey);
      await releaseIpAttempt(client, ipAttemptId, ipKey);

      const rotation = decideRotation(presented, account.userId);
      if (rotation.kind === 'conflict') {
        await recordSecurityEvent(client, {
          eventType: 'login_failed',
          failureReason: 'session_rotation_conflict',
          userId: account.userId,
          sessionId: rotation.sessionId,
          meta,
        });
        return null;
      }
      if (rotation.kind === 'rotate') {
        await revokeSession(client, rotation.sessionId, 'rotated');
        await recordSecurityEvent(client, {
          eventType: 'session_revoked',
          userId: account.userId,
          sessionId: rotation.sessionId,
          meta,
        });
      }
      const sessionId = await insertSession(
        client,
        account.userId,
        tokenHash,
        this.config.security.session,
        meta,
      );
      await recordSecurityEvent(client, {
        eventType: 'login_succeeded',
        userId: account.userId,
        sessionId,
        meta,
      });
      return findActiveSession(client, tokenHash);
    });
    if (!session) throw new ApiCodedException(HttpStatus.CONFLICT, 'conflict');
    return { token, session };
  }

  /**
   * Revisa los límites y registra el intento **antes** de verificar la contraseña, para que
   * peticiones concurrentes no los superen. Comprobar y registrar es atómico entre conexiones e
   * instancias: los bloqueos de cuenta e IP duran solo esta transacción, nunca durante Argon2id.
   * Devuelve el id del intento en la IP, que un login correcto retira después.
   */
  private async reserveAttempt(
    accountKey: string,
    ipKey: string,
    identifierHash: string,
    meta: RequestMeta,
  ): Promise<string> {
    const limits = this.config.security.login;
    const reservation = await withTransaction(this.pool, async (client) => {
      await lockThrottleKeys(client, [accountKey, ipKey]);
      const snapshot = await readThrottleSnapshot(client, accountKey, ipKey, limits.windowSeconds);
      const decision = evaluateLoginThrottle(snapshot, limits);
      if (decision.allowed) {
        return { decision, ipAttemptId: await insertLoginAttempt(client, accountKey, ipKey) };
      }
      await recordSecurityEvent(client, {
        eventType: 'login_failed',
        failureReason: 'rate_limited',
        identifierHash,
        meta,
      });
      return { decision, ipAttemptId: null };
    });
    if (!reservation.decision.allowed) {
      throw new RateLimitedException(reservation.decision.retryAfterSeconds);
    }
    return reservation.ipAttemptId!;
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
