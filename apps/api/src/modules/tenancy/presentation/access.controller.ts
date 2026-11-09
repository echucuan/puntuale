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
  Put,
  Req,
  UnauthorizedException,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import {
  type AccessMembersResponse,
  type MyTenantsResponse,
  type RoleCode,
  RoleCodeSchema,
  type TenantMeResponse,
  UpdateMembershipStatusRequestSchema,
} from '@puntuale/contracts';
import type { Request } from 'express';
import { z } from 'zod';
import { SessionAuthenticator } from '../../identity/application/session-authenticator.service';
import { requestMeta } from '../../identity/presentation/request-meta';
import { type AccessChangeRequest, AccessService } from '../application/access.service';
import {
  SESSION_MFA_RESOLVER,
  type SessionMfaResolver,
  type TenantContext,
} from '../domain/session';
import { CurrentTenant } from './current-tenant.decorator';
import { PermissionGuard, RequirePermission } from './permission.guard';
import { TenantGuard } from './tenant.guard';

/** `GET /api/me/tenants`: solo existe sin empresa en la URL porque sirve para elegirla. */
@Controller('me')
export class MyTenantsController {
  constructor(
    @Inject(AccessService) private readonly access: AccessService,
    @Inject(SessionAuthenticator) private readonly authenticator: SessionAuthenticator,
  ) {}

  @Get('tenants')
  async tenants(@Req() request: Request): Promise<MyTenantsResponse> {
    const session = await this.authenticator.authenticate(request);
    const tokenHash = this.authenticator.sessionTokenHash(request);
    if (!session || !tokenHash) throw new UnauthorizedException();
    return { tenants: await this.access.listMyTenants(tokenHash) };
  }
}

/** Identidad propia y selección de empresa: basta una membresía activa. */
@Controller('t/:tenantId')
@UseGuards(TenantGuard)
export class TenantMeController {
  constructor(
    @Inject(AccessService) private readonly access: AccessService,
    @Inject(SESSION_MFA_RESOLVER) private readonly mfa: SessionMfaResolver,
  ) {}

  @Get('me')
  async me(
    @Req() request: Request,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<TenantMeResponse> {
    return this.access.me(tenant, await this.mfa.resolve(request));
  }

  @Post('selection')
  @HttpCode(204)
  async select(@Req() request: Request, @CurrentTenant() tenant: TenantContext): Promise<void> {
    await this.access.select(tenant, requestMeta(request));
  }
}

function membershipParam(value: string): string {
  if (!z.uuid().safeParse(value).success) throw new NotFoundException();
  return value.toLowerCase();
}

function roleParam(value: string): RoleCode {
  const parsed = RoleCodeSchema.safeParse(value);
  if (!parsed.success) throw new NotFoundException();
  return parsed.data;
}

/** Vista de accesos. Cada ruta declara su permiso; las reglas están en `AccessService`. */
@Controller('t/:tenantId/access')
@UseGuards(TenantGuard, PermissionGuard)
export class AccessController {
  constructor(
    @Inject(AccessService) private readonly access: AccessService,
    @Inject(SESSION_MFA_RESOLVER) private readonly mfa: SessionMfaResolver,
  ) {}

  private async change(
    request: Request,
    tenant: TenantContext,
    membershipId: string,
    change: AccessChangeRequest,
  ): Promise<void> {
    await this.access.change(
      tenant,
      membershipParam(membershipId),
      change,
      await this.mfa.resolve(request),
      requestMeta(request),
    );
  }

  @Get('members')
  @RequirePermission('access.read')
  async members(
    @Req() request: Request,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<AccessMembersResponse> {
    return this.access.listMembers(tenant, await this.mfa.resolve(request));
  }

  @Put('members/:membershipId/roles/:role')
  @RequirePermission('access.manage')
  @HttpCode(204)
  assign(
    @Req() request: Request,
    @CurrentTenant() tenant: TenantContext,
    @Param('membershipId') membershipId: string,
    @Param('role') role: string,
  ): Promise<void> {
    return this.change(request, tenant, membershipId, {
      kind: 'assign_role',
      role: roleParam(role),
    });
  }

  @Delete('members/:membershipId/roles/:role')
  @RequirePermission('access.manage')
  @HttpCode(204)
  retire(
    @Req() request: Request,
    @CurrentTenant() tenant: TenantContext,
    @Param('membershipId') membershipId: string,
    @Param('role') role: string,
  ): Promise<void> {
    return this.change(request, tenant, membershipId, {
      kind: 'retire_role',
      role: roleParam(role),
    });
  }

  @Put('members/:membershipId/status')
  @RequirePermission('access.manage')
  @HttpCode(204)
  setStatus(
    @Req() request: Request,
    @CurrentTenant() tenant: TenantContext,
    @Param('membershipId') membershipId: string,
    @Body() body: unknown,
  ): Promise<void> {
    const parsed = UpdateMembershipStatusRequestSchema.safeParse(body);
    if (!parsed.success) throw new UnprocessableEntityException();
    return this.change(request, tenant, membershipId, {
      kind: 'set_status',
      status: parsed.data.status,
    });
  }
}
