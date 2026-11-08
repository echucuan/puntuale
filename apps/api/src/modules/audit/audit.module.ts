import { Module } from '@nestjs/common';
import { AuditRepository } from './infrastructure/audit.repository';

/** Auditoría transaccional. Otros módulos la usan dentro de su propia transacción. */
@Module({
  providers: [AuditRepository],
  exports: [AuditRepository],
})
export class AuditModule {}
