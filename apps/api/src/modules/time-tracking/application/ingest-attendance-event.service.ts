import { Inject, Injectable } from '@nestjs/common';
import {
  AttendanceEventInputSchema,
  type AttendanceEventRecord,
  type IngestResult,
} from '@puntuale/contracts';
import {
  classifyIngest,
  computeClockOffsetSeconds,
  computeEvidenceHash,
  deriveOccurredAtUtc,
  normalizeLocalTime,
} from '@puntuale/domain-rules';
import { DatabaseError, type Pool, type PoolClient } from 'pg';
import { PG_POOL, withTenant } from '../../../database/tenant-transaction';
import type { RequestMetadata } from '../../audit/domain/audit-entry';
import { AuditRepository } from '../../audit/infrastructure/audit.repository';
import { AttendanceEventRepository } from '../infrastructure/attendance-event.repository';

/** Reloj del servidor, inyectable para pruebas. `received_at` es la hora confiable (ADR 0010). */
export interface Clock {
  now(): Date;
}
export const CLOCK = Symbol('CLOCK');
export const systemClock: Clock = { now: () => new Date() };

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
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async ingest(context: IngestContext, rawInput: unknown): Promise<IngestResult> {
    const parsed = AttendanceEventInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new InvalidAttendanceEventError(
        parsed.error.issues.map((issue) => issue.path.join('.') || '(raíz)'),
      );
    }
    const input = parsed.data;
    const payloadHash = computeEvidenceHash(input);
    const receivedAt = this.clock.now();
    const deviceSentAt = new Date(input.deviceSentAt);
    const occurredAtUtc = deriveOccurredAtUtc(
      input.declaredLocalTime,
      input.declaredUtcOffsetMinutes,
    );
    const clientEventId = input.clientEventId.toLowerCase();

    return withTenant(this.pool, context.tenantId, async (client) => {
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
        return { outcome: 'created', duplicate: false, event: inserted };
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
        return { outcome, duplicate: true, event: existing };
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
      return { outcome: 'conflict', duplicate: false, event: existing };
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
