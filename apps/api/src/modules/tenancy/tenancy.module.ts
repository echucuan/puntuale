import { Module } from '@nestjs/common';
import { TenantAccessService } from './application/tenant-access.service';
import { sessionResolverProvider } from './infrastructure/session-resolver.provider';
import { TenantContextController } from './presentation/tenant-context.controller';
import { TenantGuard } from './presentation/tenant.guard';
import { SESSION_RESOLVER } from './domain/session';

@Module({
  controllers: [TenantContextController],
  providers: [sessionResolverProvider, TenantAccessService, TenantGuard],
  exports: [SESSION_RESOLVER, TenantAccessService, TenantGuard],
})
export class TenancyModule {}
