import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../../../database/tenant-transaction';
import type { SessionMfaState } from '../../tenancy/domain/access-policy';
import type { SessionMfaResolver, SessionRequest } from '../../tenancy/domain/session';
import { SessionAuthenticator } from '../application/session-authenticator.service';
import { isMfaEnrolled } from './mfa.repository';

/** Estado del segundo factor según la cookie. Sin sesión de cookie, se trata como no inscrito. */
@Injectable()
export class CookieSessionMfaResolver implements SessionMfaResolver {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(SessionAuthenticator) private readonly authenticator: SessionAuthenticator,
  ) {}

  async resolve(request: SessionRequest): Promise<SessionMfaState> {
    const session = await this.authenticator.authenticate(request);
    if (!session) return 'not_enrolled';
    if (session.mfaVerifiedAt) return 'verified';
    return (await isMfaEnrolled(this.pool, session.userId)) ? 'enrolled' : 'not_enrolled';
  }
}
