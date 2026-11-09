import { Inject, Injectable } from '@nestjs/common';
import type { Session, SessionRequest, SessionResolver } from '../../tenancy/domain/session';
import { SessionAuthenticator } from '../application/session-authenticator.service';

/** Resolvedor de sesión productivo: solo acepta una cookie de sesión válida (ADR 0014). */
@Injectable()
export class CookieSessionResolver implements SessionResolver {
  constructor(@Inject(SessionAuthenticator) private readonly authenticator: SessionAuthenticator) {}

  async resolve(request: SessionRequest): Promise<Session | null> {
    const session = await this.authenticator.authenticate(request);
    return session ? { userId: session.userId } : null;
  }
}
