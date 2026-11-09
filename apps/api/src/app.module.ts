import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ApiExceptionFilter } from './common/http/api-exception.filter';
import { APP_CONFIG, type AppConfig } from './config/app-config';
import { DatabaseModule } from './database/database.module';
import { AuditModule } from './modules/audit/audit.module';
import { HealthModule } from './modules/health/health.module';
import { IdentityModule } from './modules/identity/identity.module';
import { TenancyModule } from './modules/tenancy/tenancy.module';
import { TimeTrackingModule } from './modules/time-tracking/time-tracking.module';

@Module({})
export class AppModule {
  /** La configuración se valida antes (`loadConfig`) y se inyecta aquí; las pruebas pasan la suya. */
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      global: true,
      imports: [
        DatabaseModule,
        HealthModule,
        IdentityModule,
        TenancyModule,
        AuditModule,
        TimeTrackingModule,
      ],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
      ],
      exports: [APP_CONFIG],
    };
  }
}
