import { Inject, Injectable } from '@nestjs/common';
import {
  AttendanceEventInputSchema,
  type AttendanceEventRecord,
  type IngestResult,
} from '@puntuale/contracts';
import {
  type ClockSkewAssessment,
  classifyIngest,
  computeClockOffsetSeconds,
  detectClockSkew,
  computeEvidenceHash,
  deriveOccurredAtUtc,
  normalizeLocalTime,
} from '@puntuale/domain-rules';
import { DatabaseError, type Pool, type PoolClient } from 'pg';
import { PG_POOL, withTenant } from '../../../database/tenant-transaction';
import type { RequestMetadata } from '../../audit/domain/audit-entry';
import { AuditRepository } from '../../audit/infrastructure/audit.repository';
import { AttendanceEventRepository } from '../infrastructure/attendance-event.repository';

/**
 * Fuente de `received_at`: el momento en que **el servidor** recibe la marcación (ADR 0010).
 * Nunca proviene del dispositivo: el contrato de entrada no tiene ese campo.
 */
export interface ServerClock {
  now(client: PoolClient): Promise<Date>;
}
export const SERVER_CLOCK = Symbol('SERVER_CLOCK');

/** Fuente productiva: la hora de la base de datos (`statement_timestamp()`). */
export const databaseClock: ServerClock = {
  async now(client) {
    const { rows } = await client.query<{ now: Date }>('SELECT statement_timestamp() AS now');
    const now = rows[0]?.now;
    if (!now) throw new Error('La base no devolvió la hora del servidor.');
    return now;
  },
};

/**
 * Resultado del caso de uso: el contrato `IngestResult` más la evaluación de `CLOCK_SKEW`
 * para que la capa de dominio la use. En 1.0-a la alerta no se persiste: eso llega en 1.0-d.
 */
export interface IngestOutcome extends IngestResult {
  clockSkew: ClockSkewAssessment;
}

export interface IngestContext {
  tenantId: string;
  actorUserId: string;
  request: RequestMetadata;
}

/** La entrada no cumple el contrato `AttendanceEventInputSchema`. */
export class InvalidAttendanceEventError extends Error {
  constructor(readonly issues: string[]) {
    super('Marcación inválida');
  }
}

/** El empleado no existe en esta empresa (la FK compuesta lo garantiza). */
export class EmployeeNotFoundError extends Error {
  constructor() {
    super('Empleado no encontrado');
  }
}

/**
 * Caso de uso: registrar una marcación de la PWA, en línea o sincronizada (ADR 0011).
 * - `created`: se inserta y se audita en la misma transacción.
 * - `duplicate`: mismo `client_event_id` y mismo hash; devuelve la original y no escribe nada.
 * - `conflict`: mismo `client_event_id` con otra evidencia; no sobrescribe y audita el rechazo.
 *
 * En 1.0-a no hay endpoint HTTP: el caso de uso se prueba en integración. El endpoint llega en 1.0-d.
 */
@Injectable()
export class IngestAttendanceEventService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(AttendanceEventRepository) private readonly events: AttendanceEventRepository,
    @Inject(AuditRepository) private readonly audit: AuditRepository,
    @Inject(SERVER_CLOCK) private readonly clock: ServerClock,
  ) {}

  async ingest(context: IngestContext, rawInput: unknown): Promise<IngestOutcome> {
    const parsed = AttendanceEventInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new InvalidAttendanceEventError(
        parsed.error.issues.map((issue) => issue.path.join('.') || '(raíz)'),
      );
    }
    const input = parsed.data;
    const payloadHash = computeEvidenceHash(input);
    const deviceSentAt = new Date(input.deviceSentAt);
    const occurredAtUtc = deriveOccurredAtUtc(
      input.declaredLocalTime,
      input.declaredUtcOffsetMinutes,
    );
    const clientEventId = input.clientEventId.toLowerCase();

    return withTenant(this.pool, context.tenantId, async (client) => {
      const receivedAt = await this.clock.now(client);
      const inserted = await this.insertOrTranslate(client, {
        tenantId: context.tenantId,
        employeeId: input.employeeId.toLowerCase(),
        eventType: input.eventType,
        ingestMode: input.ingestMode,
        declaredLocalTime: normalizeLocalTime(input.declaredLocalTime),
        declaredUtcOffsetMinutes: input.declaredUtcOffsetMinutes,
        declaredTimezone: input.declaredTimezone,
        occurredAtUtc,
        deviceSentAt,
        receivedAt,
        clockOffsetSeconds: computeClockOffsetSeconds(receivedAt, deviceSentAt),
        clientEventId,
        payloadHash,
        deviceId: input.deviceId,
        metadata: input.metadata,
      });

      if (inserted) {
        await this.audit.record(client, {
          tenantId: context.tenantId,
          actorType: 'user',
          actorUserId: context.actorUserId,
          channel: input.ingestMode,
          action: 'time_tracking.attendance_event.recorded',
          entityType: 'attendance_event',
          entityId: inserted.id,
          before: null,
          after: inserted,
          reason: null,
          request: context.request,
          subjectOccurredAt: occurredAtUtc,
        });
        return withSkew({ outcome: 'created', duplicate: false, event: inserted });
      }

      const existing = await this.events.findByClientEventId(
        client,
        context.tenantId,
        clientEventId,
      );
      if (!existing?.payloadHash) {
        throw new Error('La marcación existente no se encontró después del conflicto de llave.');
      }
      const outcome = classifyIngest(existing.payloadHash, payloadHash);
      if (outcome === 'duplicate') {
        return withSkew({ outcome, duplicate: true, event: existing });
      }

      await this.audit.record(client, {
        tenantId: context.tenantId,
        actorType: 'user',
        actorUserId: context.actorUserId,
        channel: input.ingestMode,
        action: 'time_tracking.attendance_event.rejected',
        entityType: 'attendance_event',
        entityId: existing.id,
        before: null,
        after: { clientEventId, incomingPayloadHash: payloadHash },
        reason: 'client_event_id_conflict',
        request: context.request,
        subjectOccurredAt: occurredAtUtc,
      });
      return withSkew({ outcome: 'conflict', duplicate: false, event: existing });
    });
  }

  private async insertOrTranslate(
    client: PoolClient,
    row: Parameters<AttendanceEventRepository['insertIfAbsent']>[1],
  ): Promise<AttendanceEventRecord | null> {
    try {
      return await this.events.insertIfAbsent(client, row);
    } catch (error) {
      if (
        error instanceof DatabaseError &&
        error.code === '23503' &&
        error.constraint === 'attendance_event_employee_fk'
      ) {
        throw new EmployeeNotFoundError();
      }
      throw error;
    }
  }
}

/** Evalúa `CLOCK_SKEW` con los datos guardados del evento. Nunca rechaza: solo clasifica. */
function withSkew(result: IngestResult): IngestOutcome {
  const { event } = result;
  const clockSkew =
    event.clockOffsetSeconds === null
      ? { flagged: false, reasons: [] }
      : detectClockSkew({
          clockOffsetSeconds: event.clockOffsetSeconds,
          occurredAtUtc: new Date(event.occurredAtUtc),
          receivedAt: new Date(event.receivedAt),
        });
  return { ...result, clockSkew };
}
