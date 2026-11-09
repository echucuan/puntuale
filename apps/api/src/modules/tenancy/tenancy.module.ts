import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { TenantAccessService } from './application/tenant-access.service';
import { TenantContextController } from './presentation/tenant-context.controller';
import { TenantGuard } from './presentation/tenant.guard';

@Module({
  imports: [IdentityModule],
  controllers: [TenantContextController],
  providers: [TenantAccessService, TenantGuard],
  exports: [TenantAccessService, TenantGuard],
})
export class TenancyModule {}
