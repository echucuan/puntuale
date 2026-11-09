import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { IdentityModule } from '../identity/identity.module';
import { AccessService } from './application/access.service';
import { TenantAccessService } from './application/tenant-access.service';
import {
  AccessController,
  MyTenantsController,
  TenantMeController,
} from './presentation/access.controller';
import { PermissionGuard } from './presentation/permission.guard';
import { TenantContextController } from './presentation/tenant-context.controller';
import { TenantGuard } from './presentation/tenant.guard';

@Module({
  imports: [IdentityModule, AuditModule],
  controllers: [TenantContextController, MyTenantsController, TenantMeController, AccessController],
  providers: [TenantAccessService, TenantGuard, AccessService, PermissionGuard],
  exports: [TenantAccessService, TenantGuard],
})
export class TenancyModule {}
