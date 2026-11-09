import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SESSION_RESOLVER } from '../tenancy/domain/session';
import { AuthService } from './application/auth.service';
import { SessionAuthenticator } from './application/session-authenticator.service';
import { RATE_LIMIT_STORE } from './domain/rate-limit-store';
import { CookieSessionResolver } from './infrastructure/cookie-session.resolver';
import { PasswordHasher } from './infrastructure/password-hasher';
import { PostgresRateLimitStore } from './infrastructure/postgres-rate-limit.store';
import { AuthController } from './presentation/auth.controller';
import { CsrfGuard } from './presentation/csrf.guard';
import { RateLimitGuard } from './presentation/rate-limit.guard';

@Module({
  controllers: [AuthController],
  providers: [
    PasswordHasher,
    SessionAuthenticator,
    AuthService,
    { provide: RATE_LIMIT_STORE, useClass: PostgresRateLimitStore },
    { provide: SESSION_RESOLVER, useClass: CookieSessionResolver },
    // Los guards globales corren en este orden: primero el límite de tasa, luego CSRF.
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
  exports: [SESSION_RESOLVER],
})
export class IdentityModule {}
