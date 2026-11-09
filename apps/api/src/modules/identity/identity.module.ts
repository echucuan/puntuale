import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SESSION_MFA_RESOLVER, SESSION_RESOLVER } from '../tenancy/domain/session';
import { AuthService } from './application/auth.service';
import { MfaService } from './application/mfa.service';
import { SessionAuthenticator } from './application/session-authenticator.service';
import { RATE_LIMIT_STORE } from './domain/rate-limit-store';
import { CookieSessionMfaResolver } from './infrastructure/cookie-session-mfa.resolver';
import { CookieSessionResolver } from './infrastructure/cookie-session.resolver';
import { PasswordHasher } from './infrastructure/password-hasher';
import { PostgresRateLimitStore } from './infrastructure/postgres-rate-limit.store';
import { AuthController } from './presentation/auth.controller';
import { CsrfGuard } from './presentation/csrf.guard';
import { MfaController } from './presentation/mfa.controller';
import { RateLimitGuard } from './presentation/rate-limit.guard';

@Module({
  controllers: [AuthController, MfaController],
  providers: [
    PasswordHasher,
    SessionAuthenticator,
    AuthService,
    MfaService,
    { provide: RATE_LIMIT_STORE, useClass: PostgresRateLimitStore },
    { provide: SESSION_RESOLVER, useClass: CookieSessionResolver },
    { provide: SESSION_MFA_RESOLVER, useClass: CookieSessionMfaResolver },
    // Los guards globales corren en este orden: primero el límite de tasa, luego CSRF.
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
  exports: [SESSION_RESOLVER, SESSION_MFA_RESOLVER, SessionAuthenticator],
})
export class IdentityModule {}
