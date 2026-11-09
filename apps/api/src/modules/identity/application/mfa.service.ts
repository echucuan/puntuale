import { randomInt } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  MfaConfirmResponse,
  MfaEnrollmentResponse,
  MfaStatusResponse,
} from '@puntuale/contracts';
import type { ClientBase, Pool } from 'pg';
import { ApiCodedException } from '../../../common/http/api-coded.exception';
import { APP_CONFIG, type AppConfig } from '../../../config/app-config';
import { PG_POOL } from '../../../database/tenant-transaction';
import { withTransaction } from '../../../database/transaction';
import type { ActiveSessionRecord, RequestMeta } from '../domain/active-session';
import { decryptMfaSecret, encryptMfaSecret } from '../domain/mfa-cipher';
import {
  generateRecoveryCode,
  generateTotpSecret,
  hashRecoveryCode,
  matchTotpStep,
  provisioningUri,
  RECOVERY_CODE_COUNT,
} from '../domain/totp';
import { findLoginAccount } from '../infrastructure/account.repository';
import {
  acceptTotpStep,
  activatePendingSecret,
  clearMfaAttempts,
  clearUserMfa,
  consumeRecoveryCode,
  countUsableRecoveryCodes,
  insertMfaAttempt,
  insertRecoveryCodes,
  invalidateRecoveryCodes,
  lockUserMfa,
  markSessionMfaVerified,
  purgeMfaAttempts,
  readMfaAttempts,
  readUserMfa,
  resetSessionsMfa,
  savePendingSecret,
  type UserMfaRow,
} from '../infrastructure/mfa.repository';
import { PasswordHasher } from '../infrastructure/password-hasher';
import { recordSecurityEvent } from '../infrastructure/security-event.repository';
import { RateLimitedException } from './auth.service';

const PURGE_ONE_IN = 100;

export interface MfaFactorInput {
  code?: string | undefined;
  recoveryCode?: string | undefined;
}

type ConsumedFactor = 'totp' | 'recovery';

const invalidCode = () => new ApiCodedException(HttpStatus.FORBIDDEN, 'invalid_mfa_code');
/** 403 y no 401: la sesión sigue vigente, lo que falló es la reautenticación. */
const invalidPassword = () => new ApiCodedException(HttpStatus.FORBIDDEN, 'invalid_credentials');
const notEnrolled = () => new ApiCodedException(HttpStatus.FORBIDDEN, 'mfa_enrollment_required');

/**
 * Casos de uso del segundo factor (ADR 0015). Cada cambio y su evento van en la misma transacción.
 * Nunca escribe en un evento, registro o error el secreto, un código o la contraseña.
 */
@Injectable()
export class MfaService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
  ) {}

  private get settings(): AppConfig['security']['mfa'] {
    return this.config.security.mfa;
  }

  private read(client: ClientBase | Pool, userId: string): Promise<UserMfaRow | null> {
    return readUserMfa(client, userId, this.settings.enrollmentTtlSeconds);
  }

  async status(session: ActiveSessionRecord): Promise<MfaStatusResponse> {
    const mfa = await this.read(this.pool, session.userId);
    return {
      enrolled: Boolean(mfa?.secretCiphertext),
      pendingEnrollment: mfa?.pendingActive === true,
      verifiedThisSession: session.mfaVerifiedAt !== null,
      recoveryCodesRemaining: await countUsableRecoveryCodes(this.pool, session.userId),
    };
  }

  /**
   * Reserva un intento **antes** de verificar nada, para que peticiones concurrentes no superen el
   * límite. Verificación, recuperación y reautenticación comparten el mismo contador por persona.
   */
  private async reserveAttempt(session: ActiveSessionRecord, meta: RequestMeta): Promise<void> {
    const { maxAttempts, windowSeconds } = this.settings;
    const retryAfter = await withTransaction(this.pool, async (client) => {
      await lockUserMfa(client, session.userId);
      const attempts = await readMfaAttempts(client, session.userId, windowSeconds);
      if (attempts.count >= maxAttempts) {
        await this.recordFailure(client, session, 'rate_limited', meta);
        return attempts.retryAfterSeconds;
      }
      await insertMfaAttempt(client, session.userId);
      return null;
    });
    if (retryAfter !== null) throw new RateLimitedException(retryAfter);
    if (randomInt(PURGE_ONE_IN) === 0) await purgeMfaAttempts(this.pool);
  }

  private recordFailure(
    db: ClientBase | Pool,
    session: ActiveSessionRecord,
    failureReason: string,
    meta: RequestMeta,
  ): Promise<void> {
    return recordSecurityEvent(db, {
      eventType: 'mfa_failed',
      failureReason,
      userId: session.userId,
      sessionId: session.id,
      meta,
    });
  }

  private async passwordMatches(
    session: ActiveSessionRecord,
    password: string,
    meta: RequestMeta,
  ): Promise<boolean> {
    const account = await findLoginAccount(this.pool, session.email);
    const valid = await this.hasher.verify(account?.passwordHash ?? null, password);
    if (!valid) await this.recordFailure(this.pool, session, 'bad_password', meta);
    return valid;
  }

  /** Consume el factor. Debe ejecutarse con el bloqueo de MFA de la persona. */
  private async consumeFactor(
    client: ClientBase,
    userId: string,
    secretCiphertext: string,
    factor: MfaFactorInput,
  ): Promise<ConsumedFactor | null> {
    if (factor.recoveryCode !== undefined) {
      const hash = hashRecoveryCode(this.settings.encryptionKey, userId, factor.recoveryCode);
      return (await consumeRecoveryCode(client, userId, hash)) ? 'recovery' : null;
    }
    if (factor.code === undefined) return null;
    const secret = decryptMfaSecret(this.settings.encryptionKey, userId, secretCiphertext);
    const step = matchTotpStep(secret, factor.code, Date.now());
    if (step === null) return null;
    return (await acceptTotpStep(client, userId, step)) ? 'totp' : null;
  }

  /** Completa el segundo factor en esta sesión. */
  async verify(
    session: ActiveSessionRecord,
    factor: MfaFactorInput,
    meta: RequestMeta,
  ): Promise<void> {
    await this.reserveAttempt(session, meta);
    const outcome = await withTransaction(this.pool, async (client) => {
      await lockUserMfa(client, session.userId);
      const mfa = await this.read(client, session.userId);
      if (!mfa?.secretCiphertext) return 'not_enrolled' as const;
      const used = await this.consumeFactor(client, session.userId, mfa.secretCiphertext, factor);
      if (!used) {
        await this.recordFailure(client, session, 'bad_code', meta);
        return 'invalid' as const;
      }
      await markSessionMfaVerified(client, session.id);
      await clearMfaAttempts(client, session.userId);
      await recordSecurityEvent(client, {
        eventType: used === 'recovery' ? 'mfa_recovery_used' : 'mfa_verified',
        userId: session.userId,
        sessionId: session.id,
        meta,
      });
      return 'ok' as const;
    });
    if (outcome === 'not_enrolled') throw notEnrolled();
    if (outcome === 'invalid') throw invalidCode();
  }

  /**
   * Inicia una inscripción. Exige la contraseña y, si ya hay MFA activo, también el factor actual.
   * El secreto activo sigue funcionando hasta que se confirme el nuevo.
   */
  async startEnrollment(
    session: ActiveSessionRecord,
    input: MfaFactorInput & { password: string },
    meta: RequestMeta,
  ): Promise<MfaEnrollmentResponse> {
    await this.reserveAttempt(session, meta);
    if (!(await this.passwordMatches(session, input.password, meta))) throw invalidPassword();

    const secret = generateTotpSecret();
    const ciphertext = encryptMfaSecret(this.settings.encryptionKey, session.userId, secret);
    const accepted = await withTransaction(this.pool, async (client) => {
      await lockUserMfa(client, session.userId);
      const mfa = await this.read(client, session.userId);
      if (mfa?.secretCiphertext) {
        const used = await this.consumeFactor(client, session.userId, mfa.secretCiphertext, input);
        if (!used) {
          await this.recordFailure(client, session, 'bad_code', meta);
          return false;
        }
      }
      await savePendingSecret(client, session.userId, ciphertext);
      await clearMfaAttempts(client, session.userId);
      await recordSecurityEvent(client, {
        eventType: 'mfa_enrollment_started',
        userId: session.userId,
        sessionId: session.id,
        meta,
      });
      return true;
    });
    if (!accepted) throw invalidCode();
    return { secret, otpauthUri: provisioningUri(secret, session.email) };
  }

  /**
   * Confirma el secreto pendiente con un código. Activa MFA, marca esta sesión como verificada,
   * sustituye los códigos de recuperación y quita la verificación de las demás sesiones.
   */
  async confirmEnrollment(
    session: ActiveSessionRecord,
    code: string,
    meta: RequestMeta,
  ): Promise<MfaConfirmResponse> {
    await this.reserveAttempt(session, meta);
    const { encryptionKey } = this.settings;
    const outcome = await withTransaction(this.pool, async (client) => {
      await lockUserMfa(client, session.userId);
      const mfa = await this.read(client, session.userId);
      if (!mfa?.pendingCiphertext || !mfa.pendingActive) return { kind: 'no_pending' } as const;
      const secret = decryptMfaSecret(encryptionKey, session.userId, mfa.pendingCiphertext);
      const step = matchTotpStep(secret, code, Date.now());
      if (step === null) {
        await this.recordFailure(client, session, 'bad_code', meta);
        return { kind: 'invalid' } as const;
      }
      await activatePendingSecret(client, session.userId, step);
      await invalidateRecoveryCodes(client, session.userId);
      const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
      await insertRecoveryCodes(
        client,
        session.userId,
        recoveryCodes.map((item) => hashRecoveryCode(encryptionKey, session.userId, item)),
      );
      await markSessionMfaVerified(client, session.id);
      await resetSessionsMfa(client, session.userId, session.id);
      await clearMfaAttempts(client, session.userId);
      await recordSecurityEvent(client, {
        eventType: mfa.secretCiphertext ? 'mfa_replaced' : 'mfa_enrolled',
        userId: session.userId,
        sessionId: session.id,
        meta,
      });
      return { kind: 'ok', recoveryCodes } as const;
    });
    if (outcome.kind === 'no_pending') throw new ApiCodedException(HttpStatus.CONFLICT, 'conflict');
    if (outcome.kind === 'invalid') throw invalidCode();
    return { recoveryCodes: outcome.recoveryCodes };
  }

  /** Desactiva MFA con contraseña y factor actual. Ninguna sesión conserva la verificación. */
  async disable(
    session: ActiveSessionRecord,
    input: MfaFactorInput & { password: string },
    meta: RequestMeta,
  ): Promise<void> {
    await this.reserveAttempt(session, meta);
    if (!(await this.passwordMatches(session, input.password, meta))) throw invalidPassword();

    const outcome = await withTransaction(this.pool, async (client) => {
      await lockUserMfa(client, session.userId);
      const mfa = await this.read(client, session.userId);
      if (!mfa?.secretCiphertext) return 'not_enrolled' as const;
      const used = await this.consumeFactor(client, session.userId, mfa.secretCiphertext, input);
      if (!used) {
        await this.recordFailure(client, session, 'bad_code', meta);
        return 'invalid' as const;
      }
      await clearUserMfa(client, session.userId);
      await invalidateRecoveryCodes(client, session.userId);
      await resetSessionsMfa(client, session.userId, null);
      await clearMfaAttempts(client, session.userId);
      await recordSecurityEvent(client, {
        eventType: 'mfa_disabled',
        userId: session.userId,
        sessionId: session.id,
        meta,
      });
      return 'ok' as const;
    });
    if (outcome === 'not_enrolled') throw notEnrolled();
    if (outcome === 'invalid') throw invalidCode();
  }
}
