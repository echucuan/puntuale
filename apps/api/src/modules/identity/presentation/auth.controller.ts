import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  type ActiveSessionsResponse,
  type CsrfResponse,
  type CurrentSessionResponse,
  LoginRequestSchema,
} from '@puntuale/contracts';
import type { CookieOptions, Request, Response } from 'express';
import { z } from 'zod';
import { APP_CONFIG, type AppConfig } from '../../../config/app-config';
import { AuthService, RateLimitedException } from '../application/auth.service';
import { SessionAuthenticator } from '../application/session-authenticator.service';
import type { ActiveSessionRecord } from '../domain/active-session';
import { cookieNames, readCookie } from '../domain/auth-cookies';
import { type CsrfBinding, generateCsrfNonce, issueCsrfToken } from '../domain/csrf';
import { requestMeta } from './request-meta';

const CSRF_COOKIE_MAX_AGE_MS = 3_600_000;

/** Endpoints de sesión. Solo traduce HTTP: las reglas están en `AuthService` y en el dominio. */
@Controller('auth')
export class AuthController {
  private readonly names: ReturnType<typeof cookieNames>;
  private readonly baseCookie: CookieOptions;

  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SessionAuthenticator) private readonly authenticator: SessionAuthenticator,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.names = cookieNames(config.nodeEnv);
    // Sin `domain`, en ningún entorno (ADR 0014).
    this.baseCookie = {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: config.nodeEnv === 'production',
    };
  }

  private csrfFor(binding: CsrfBinding): string {
    return issueCsrfToken(this.config.security.authSecret, binding);
  }

  private currentSessionBody(session: ActiveSessionRecord): CurrentSessionResponse {
    return {
      user: { id: session.userId, email: session.email, displayName: session.displayName },
      session: {
        id: session.id,
        createdAt: session.createdAt.toISOString(),
        lastActivityAt: session.lastActivityAt.toISOString(),
        idleExpiresAt: session.idleExpiresAt.toISOString(),
        expiresAt: session.expiresAt.toISOString(),
        mfaVerified: session.mfaVerifiedAt !== null,
      },
      csrfToken: this.csrfFor({ kind: 'session', sessionId: session.id }),
    };
  }

  private async requireSession(request: Request): Promise<ActiveSessionRecord> {
    const session = await this.authenticator.authenticate(request);
    if (!session) throw new UnauthorizedException();
    return session;
  }

  /** Entrega el token CSRF: ligado a la sesión si existe, o a una cookie anónima si no. */
  @Get('csrf')
  async csrf(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CsrfResponse> {
    const session = await this.authenticator.authenticate(request);
    if (session) return { csrfToken: this.csrfFor({ kind: 'session', sessionId: session.id }) };
    const nonce = readCookie(request.headers.cookie, this.names.csrf) ?? generateCsrfNonce();
    response.cookie(this.names.csrf, nonce, {
      ...this.baseCookie,
      maxAge: CSRF_COOKIE_MAX_AGE_MS,
    });
    return { csrfToken: this.csrfFor({ kind: 'anonymous', nonce }) };
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: unknown,
  ): Promise<CurrentSessionResponse> {
    const parsed = LoginRequestSchema.safeParse(body);
    if (!parsed.success) throw new UnprocessableEntityException();
    try {
      const { token, session } = await this.auth.login(
        parsed.data,
        this.authenticator.sessionToken(request),
        requestMeta(request),
      );
      this.authenticator.forget(request);
      response.cookie(this.names.session, token, {
        ...this.baseCookie,
        maxAge: this.config.security.session.absoluteTtlSeconds * 1000,
      });
      response.clearCookie(this.names.csrf, this.baseCookie);
      return this.currentSessionBody(session);
    } catch (error) {
      if (error instanceof RateLimitedException) {
        response.setHeader('Retry-After', String(error.retryAfterSeconds));
      }
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const session = await this.requireSession(request);
    await this.auth.logout(session, requestMeta(request));
    this.authenticator.forget(request);
    response.clearCookie(this.names.session, this.baseCookie);
  }

  @Get('session')
  async session(@Req() request: Request): Promise<CurrentSessionResponse> {
    return this.currentSessionBody(await this.requireSession(request));
  }

  @Get('sessions')
  async sessions(@Req() request: Request): Promise<ActiveSessionsResponse> {
    const current = await this.requireSession(request);
    const sessions = await this.auth.listSessions(current.userId);
    return {
      sessions: sessions.map((item) => ({
        id: item.id,
        createdAt: item.createdAt.toISOString(),
        lastActivityAt: item.lastActivityAt.toISOString(),
        idleExpiresAt: item.idleExpiresAt.toISOString(),
        expiresAt: item.expiresAt.toISOString(),
        ip: item.ip,
        userAgent: item.userAgent,
        current: item.id === current.id,
      })),
    };
  }

  @Delete('sessions/:sessionId')
  @HttpCode(204)
  async revoke(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param('sessionId') sessionId: string,
  ): Promise<void> {
    const current = await this.requireSession(request);
    if (!z.uuid().safeParse(sessionId).success) throw new NotFoundException();
    await this.auth.revokeOwnSession(current, sessionId, requestMeta(request));
    if (sessionId === current.id) response.clearCookie(this.names.session, this.baseCookie);
  }
}
