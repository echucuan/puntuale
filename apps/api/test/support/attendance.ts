import type { AttendanceEventInput } from '@puntuale/contracts';
import { generateUuidV7 } from '@puntuale/domain-rules';
import type { Pool } from 'pg';
import { AuditRepository } from '../../src/modules/audit/infrastructure/audit.repository';
import {
  IngestAttendanceEventService,
  type ServerClock,
} from '../../src/modules/time-tracking/application/ingest-attendance-event.service';
import { AttendanceEventRepository } from '../../src/modules/time-tracking/infrastructure/attendance-event.repository';

/** Reloj fijo **solo para pruebas**: hace deterministas `received_at` y el desfase. */
export const FIXED_NOW = new Date('2026-11-09T14:05:00.000Z');
export const fixedClock: ServerClock = { now: () => Promise.resolve(FIXED_NOW) };

export function createIngestService(appPool: Pool, clock: ServerClock = fixedClock) {
  return new IngestAttendanceEventService(
    appPool,
    new AttendanceEventRepository(),
    new AuditRepository(),
    clock,
  );
}

/** Marcación ficticia válida: 08:00 en Ciudad de México (UTC−6) = 14:00Z, enviada a las 14:04:58Z. */
export function sampleInput(
  employeeId: string,
  overrides: Partial<AttendanceEventInput> = {},
): AttendanceEventInput {
  return {
    clientEventId: generateUuidV7(),
    employeeId,
    eventType: 'in',
    declaredLocalTime: '2026-11-09T08:00:00',
    declaredUtcOffsetMinutes: -360,
    declaredTimezone: 'America/Mexico_City',
    deviceId: 'dispositivo-ficticio-1',
    metadata: { app_version: '0.0.0' },
    deviceSentAt: '2026-11-09T14:04:58.000Z',
    ingestMode: 'offline_sync',
    ...overrides,
  };
}

export const requestMeta = { ip: '203.0.113.10', userAgent: 'vitest', requestId: 'req-test-1' };
