import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  MfaConfirmRequestSchema,
  type MfaConfirmResponse,
  MfaDisableRequestSchema,
  MfaEnrollmentRequestSchema,
  type MfaEnrollmentResponse,
  type MfaStatusResponse,
  MfaVerifyRequestSchema,
} from '@puntuale/contracts';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { RateLimitedException } from '../application/auth.service';
import { MfaService } from '../application/mfa.service';
import { SessionAuthenticator } from '../application/session-authenticator.service';
import type { ActiveSessionRecord } from '../domain/active-session';
import { requestMeta } from './request-meta';

function parse<T extends z.ZodType>(schema: T, body: unknown): z.output<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new UnprocessableEntityException();
  return parsed.data;
}

/** Endpoints del segundo factor. Solo traduce HTTP: las reglas están en `MfaService`. */
@Controller('auth/mfa')
export class MfaController {
  constructor(
    @Inject(MfaService) private readonly mfa: MfaService,
    @Inject(SessionAuthenticator) private readonly authenticator: SessionAuthenticator,
  ) {}

  private async requireSession(request: Request): Promise<ActiveSessionRecord> {
    const session = await this.authenticator.authenticate(request);
    if (!session) throw new UnauthorizedException();
    return session;
  }

  private async limited<T>(response: Response, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof RateLimitedException) {
        response.setHeader('Retry-After', String(error.retryAfterSeconds));
      }
      throw error;
    }
  }

  @Get()
  async status(@Req() request: Request): Promise<MfaStatusResponse> {
    return this.mfa.status(await this.requireSession(request));
  }

  @Post('enrollment')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async startEnrollment(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: unknown,
  ): Promise<MfaEnrollmentResponse> {
    const session = await this.requireSession(request);
    const input = parse(MfaEnrollmentRequestSchema, body);
    return this.limited(response, () =>
      this.mfa.startEnrollment(session, input, requestMeta(request)),
    );
  }

  @Post('enrollment/confirm')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async confirmEnrollment(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: unknown,
  ): Promise<MfaConfirmResponse> {
    const session = await this.requireSession(request);
    const { code } = parse(MfaConfirmRequestSchema, body);
    return this.limited(response, () =>
      this.mfa.confirmEnrollment(session, code, requestMeta(request)),
    );
  }

  @Post('verify')
  @HttpCode(204)
  async verify(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: unknown,
  ): Promise<void> {
    const session = await this.requireSession(request);
    const factor = parse(MfaVerifyRequestSchema, body);
    await this.limited(response, () => this.mfa.verify(session, factor, requestMeta(request)));
  }

  @Post('disable')
  @HttpCode(204)
  async disable(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: unknown,
  ): Promise<void> {
    const session = await this.requireSession(request);
    const input = parse(MfaDisableRequestSchema, body);
    await this.limited(response, () => this.mfa.disable(session, input, requestMeta(request)));
  }
}
