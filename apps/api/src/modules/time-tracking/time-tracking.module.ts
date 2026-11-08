import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import {
  IngestAttendanceEventService,
  SERVER_CLOCK,
  databaseClock,
} from './application/ingest-attendance-event.service';
import { AttendanceEventRepository } from './infrastructure/attendance-event.repository';

/** Marcaciones. En 1.0-a solo existe el caso de uso de ingesta idempotente, sin endpoint HTTP. */
@Module({
  imports: [AuditModule],
  providers: [
    AttendanceEventRepository,
    IngestAttendanceEventService,
    // received_at siempre viene de la base. Solo las pruebas construyen el servicio con otro reloj.
    { provide: SERVER_CLOCK, useValue: databaseClock },
  ],
  exports: [IngestAttendanceEventService],
})
export class TimeTrackingModule {}
