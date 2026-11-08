import { Injectable } from '@nestjs/common';
import type { AttendanceEventRecord } from '@puntuale/contracts';
import type { PoolClient } from 'pg';

/** Fila nueva de una marcación de la PWA, ya derivada por el servicio de aplicación. */
export interface NewPwaAttendanceEvent {
  tenantId: string;
  employeeId: string;
  eventType: AttendanceEventRecord['eventType'];
  ingestMode: NonNullable<AttendanceEventRecord['ingestMode']>;
  declaredLocalTime: string;
  declaredUtcOffsetMinutes: number;
  declaredTimezone: string;
  occurredAtUtc: Date;
  deviceSentAt: Date;
  receivedAt: Date;
  clockOffsetSeconds: number;
  clientEventId: string;
  payloadHash: string;
  deviceId: string | null;
  metadata: AttendanceEventRecord['metadata'];
}

const RECORD_COLUMNS = `
  id, tenant_id AS "tenantId", employee_id AS "employeeId", event_type AS "eventType", source,
  ingest_mode AS "ingestMode",
  to_char(declared_local_time, 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS "declaredLocalTime",
  declared_utc_offset_minutes AS "declaredUtcOffsetMinutes", declared_timezone AS "declaredTimezone",
  occurred_at_utc AS "occurredAtUtc", device_sent_at AS "deviceSentAt", received_at AS "receivedAt",
  clock_offset_seconds AS "clockOffsetSeconds", client_event_id AS "clientEventId",
  payload_hash AS "payloadHash", device_id AS "deviceId", supersedes_event_id AS "supersedesEventId",
  created_by_user_id AS "createdByUserId", metadata`;

interface AttendanceEventRow extends Omit<
  AttendanceEventRecord,
  'occurredAtUtc' | 'deviceSentAt' | 'receivedAt'
> {
  occurredAtUtc: Date;
  deviceSentAt: Date | null;
  receivedAt: Date;
}

function toRecord(row: AttendanceEventRow): AttendanceEventRecord {
  return {
    ...row,
    occurredAtUtc: row.occurredAtUtc.toISOString(),
    deviceSentAt: row.deviceSentAt ? row.deviceSentAt.toISOString() : null,
    receivedAt: row.receivedAt.toISOString(),
  };
}

/** Acceso a `attendance_event`. Solo inserta y lee: la tabla es inmutable (ADR 0004). */
@Injectable()
export class AttendanceEventRepository {
  /**
   * Inserta si no existe otra marcación con el mismo `client_event_id` en la empresa.
   * `ON CONFLICT DO NOTHING` espera a una transacción concurrente con la misma llave, así que dos
   * envíos simultáneos nunca crean dos filas. Devuelve `null` si ya existía.
   */
  async insertIfAbsent(
    client: PoolClient,
    event: NewPwaAttendanceEvent,
  ): Promise<AttendanceEventRecord | null> {
    const { rows } = await client.query<AttendanceEventRow>(
      `INSERT INTO attendance_event (
         tenant_id, employee_id, event_type, source, ingest_mode,
         declared_local_time, declared_utc_offset_minutes, declared_timezone, occurred_at_utc,
         device_sent_at, received_at, clock_offset_seconds, client_event_id, payload_hash,
         device_id, metadata
       ) VALUES ($1, $2, $3, 'pwa', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (tenant_id, client_event_id) WHERE client_event_id IS NOT NULL DO NOTHING
       RETURNING ${RECORD_COLUMNS}`,
      [
        event.tenantId,
        event.employeeId,
        event.eventType,
        event.ingestMode,
        event.declaredLocalTime,
        event.declaredUtcOffsetMinutes,
        event.declaredTimezone,
        event.occurredAtUtc,
        event.deviceSentAt,
        event.receivedAt,
        event.clockOffsetSeconds,
        event.clientEventId,
        event.payloadHash,
        event.deviceId,
        JSON.stringify(event.metadata),
      ],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async findByClientEventId(
    client: PoolClient,
    tenantId: string,
    clientEventId: string,
  ): Promise<AttendanceEventRecord | null> {
    const { rows } = await client.query<AttendanceEventRow>(
      `SELECT ${RECORD_COLUMNS} FROM attendance_event WHERE tenant_id = $1 AND client_event_id = $2`,
      [tenantId, clientEventId],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }
}
