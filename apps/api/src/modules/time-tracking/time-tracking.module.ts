import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import {
  CLOCK,
  IngestAttendanceEventService,
  systemClock,
} from './application/ingest-attendance-event.service';
import { AttendanceEventRepository } from './infrastructure/attendance-event.repository';

/** Marcaciones. En 1.0-a solo existe el caso de uso de ingesta idempotente, sin endpoint HTTP. */
@Module({
  imports: [AuditModule],
  providers: [
    AttendanceEventRepository,
    IngestAttendanceEventService,
    { provide: CLOCK, useValue: systemClock },
  ],
  exports: [IngestAttendanceEventService],
})
export class TimeTrackingModule {}
