import { IngestResultSchema } from '@puntuale/contracts';
import { startTestDatabase, type TestDatabase } from '@puntuale/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  InvalidAttendanceEventError,
  databaseClock,
} from '../../src/modules/time-tracking/application/ingest-attendance-event.service';
import { createIngestService, requestMeta, sampleInput } from '../support/attendance';
import { seedTenant, type SeededTenant } from '../support/seed';

/** Ingesta idempotente de marcaciones (ADR 0011). */
let db: TestDatabase;
let a: SeededTenant;

beforeAll(async () => {
  db = await startTestDatabase();
  a = await seedTenant(db.adminPool, 'A');
});

afterAll(async () => {
  await db?.stop();
});

const ctx = () => ({ tenantId: a.tenantId, actorUserId: a.userId, request: requestMeta });

async function rowsFor(clientEventId: string) {
  const events = await db.adminPool.query(
    'SELECT * FROM attendance_event WHERE client_event_id = $1',
    [clientEventId],
  );
  const audits = await db.adminPool.query(
    `SELECT * FROM audit_event WHERE entity_type = 'attendance_event' AND entity_id = ANY($1::uuid[])
     ORDER BY recorded_at, id`,
    [events.rows.map((row) => row.id)],
  );
  return { events: events.rows, audits: audits.rows };
}

describe('ingesta idempotente', () => {
  it('created: inserta, deriva los tiempos y audita en la misma transacción', async () => {
    const input = sampleInput(a.employeeId);
    const result = IngestResultSchema.parse(
      await createIngestService(db.appPool).ingest(ctx(), input),
    );

    expect(result.outcome).toBe('created');
    expect(result.duplicate).toBe(false);
    expect(result.event).toMatchObject({
      source: 'pwa',
      ingestMode: 'offline_sync',
      declaredLocalTime: '2026-11-09T08:00:00.000',
      occurredAtUtc: '2026-11-09T14:00:00.000Z',
      receivedAt: '2026-11-09T14:05:00.000Z',
      deviceSentAt: '2026-11-09T14:04:58.000Z',
      clockOffsetSeconds: 2,
    });

    const { events, audits } = await rowsFor(input.clientEventId);
    expect(events).toHaveLength(1);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: 'time_tracking.attendance_event.recorded',
      channel: 'offline_sync',
      actor_user_id: a.userId,
      request_ip: '203.0.113.10',
    });
    expect(audits[0].subject_occurred_at.toISOString()).toBe('2026-11-09T14:00:00.000Z');
  });

  it('duplicate: mismo client_event_id y misma evidencia devuelve la original y no escribe nada', async () => {
    const service = createIngestService(db.appPool);
    const input = sampleInput(a.employeeId);
    const first = await service.ingest(ctx(), input);
    const second = await service.ingest(ctx(), input);

    expect(second).toMatchObject({ outcome: 'duplicate', duplicate: true, event: first.event });
    const { events, audits } = await rowsFor(input.clientEventId);
    expect(events).toHaveLength(1);
    expect(audits).toHaveLength(1);
  });

  it('un reintento con otro transporte (deviceSentAt, ingestMode) sigue siendo duplicate', async () => {
    const service = createIngestService(db.appPool);
    const input = sampleInput(a.employeeId, { ingestMode: 'online' });
    await service.ingest(ctx(), input);
    const retry = await service.ingest(ctx(), {
      ...input,
      ingestMode: 'offline_sync',
      deviceSentAt: '2026-11-09T18:30:00.000Z',
      // El mismo instante escrito sin milisegundos y con el UUID en mayúsculas.
      declaredLocalTime: '2026-11-09T08:00:00',
      clientEventId: input.clientEventId.toUpperCase(),
    });
    expect(retry.outcome).toBe('duplicate');
  });

  it('conflict: mismo client_event_id con otra evidencia no sobrescribe y audita el rechazo', async () => {
    const service = createIngestService(db.appPool);
    const input = sampleInput(a.employeeId);
    const first = await service.ingest(ctx(), input);
    const conflicting = await service.ingest(ctx(), { ...input, eventType: 'out' });

    expect(conflicting.outcome).toBe('conflict');
    expect(conflicting.duplicate).toBe(false);
    expect(conflicting.event).toEqual(first.event);
    const { events, audits } = await rowsFor(input.clientEventId);
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe('in');
    expect(audits.map((row) => row.action)).toEqual([
      'time_tracking.attendance_event.recorded',
      'time_tracking.attendance_event.rejected',
    ]);
    expect(audits[1].reason).toBe('client_event_id_conflict');
  });

  it('dos envíos simultáneos con la misma llave crean una sola fila', async () => {
    const service = createIngestService(db.appPool);
    const input = sampleInput(a.employeeId);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => service.ingest(ctx(), input)),
    );
    expect(results.filter((r) => r.outcome === 'created')).toHaveLength(1);
    expect(results.filter((r) => r.outcome === 'duplicate')).toHaveLength(4);
    const { events } = await rowsFor(input.clientEventId);
    expect(events).toHaveLength(1);
  });

  it('CLOCK_SKEW: calcula y conserva el desfase, clasifica y no rechaza la marcación', async () => {
    const input = sampleInput(a.employeeId, { deviceSentAt: '2026-11-09T13:00:00.000Z' });
    const result = await createIngestService(db.appPool).ingest(ctx(), input);
    expect(result.outcome).toBe('created');
    expect(result.event.clockOffsetSeconds).toBe(3900);
    expect(result.clockSkew).toEqual({ flagged: true, reasons: ['DEVICE_CLOCK_OFFSET'] });
    const { events } = await rowsFor(input.clientEventId);
    expect(events[0].clock_offset_seconds).toBe(3900);
  });

  it('CLOCK_SKEW: una marcación declarada en el futuro se clasifica, no se rechaza', async () => {
    const input = sampleInput(a.employeeId, {
      declaredLocalTime: '2026-11-09T08:30:00',
      deviceSentAt: '2026-11-09T14:04:58.000Z',
    });
    const result = await createIngestService(db.appPool).ingest(ctx(), input);
    expect(result.outcome).toBe('created');
    expect(result.clockSkew).toEqual({ flagged: true, reasons: ['FUTURE_EVENT'] });
  });

  it('sin desfase relevante no se marca CLOCK_SKEW', async () => {
    const result = await createIngestService(db.appPool).ingest(ctx(), sampleInput(a.employeeId));
    expect(result.clockSkew).toEqual({ flagged: false, reasons: [] });
  });

  it('received_at lo fija la base de datos, no el dispositivo', async () => {
    const service = createIngestService(db.appPool, databaseClock);
    const before = Date.now();
    const result = await service.ingest(ctx(), {
      ...sampleInput(a.employeeId),
      // Un payload malicioso que intenta fijar received_at: el contrato lo ignora.
      receivedAt: '2000-01-01T00:00:00.000Z',
      received_at: '2000-01-01T00:00:00.000Z',
    });
    const receivedAt = Date.parse(result.event.receivedAt);
    expect(receivedAt).toBeGreaterThanOrEqual(before - 5_000);
    expect(receivedAt).toBeLessThanOrEqual(Date.now() + 5_000);
    const { rows } = await db.adminPool.query<{ diff: number }>(
      `SELECT abs(extract(epoch FROM (received_at - now())))::int AS diff
         FROM attendance_event WHERE id = $1`,
      [result.event.id],
    );
    expect(rows[0]!.diff).toBeLessThan(60);
  });

  it('respeta el desfase declarado en zonas con horario de verano', async () => {
    // 1:30 a. m. del 1 de noviembre de 2026 ocurre dos veces en Tijuana; el desfase lo resuelve.
    const service = createIngestService(db.appPool);
    const pdt = await service.ingest(
      ctx(),
      sampleInput(a.employeeId, {
        declaredLocalTime: '2026-11-01T01:30:00',
        declaredUtcOffsetMinutes: -420,
        declaredTimezone: 'America/Tijuana',
      }),
    );
    const pst = await service.ingest(
      ctx(),
      sampleInput(a.employeeId, {
        declaredLocalTime: '2026-11-01T01:30:00',
        declaredUtcOffsetMinutes: -480,
        declaredTimezone: 'America/Tijuana',
      }),
    );
    expect(pdt.event.occurredAtUtc).toBe('2026-11-01T08:30:00.000Z');
    expect(pst.event.occurredAtUtc).toBe('2026-11-01T09:30:00.000Z');
  });

  it('rechaza una entrada que no cumple el contrato, sin escribir nada', async () => {
    const service = createIngestService(db.appPool);
    await expect(
      service.ingest(ctx(), { ...sampleInput(a.employeeId), declaredTimezone: 'CST' }),
    ).rejects.toBeInstanceOf(InvalidAttendanceEventError);
    await expect(
      service.ingest(ctx(), { ...sampleInput(a.employeeId), metadata: { nested: { x: 1 } } }),
    ).rejects.toBeInstanceOf(InvalidAttendanceEventError);
  });

  it('la base rechaza una hora UTC inconsistente con la hora declarada', async () => {
    await expect(
      db.adminPool.query(
        `INSERT INTO attendance_event (
           tenant_id, employee_id, event_type, source, ingest_mode, declared_local_time,
           declared_utc_offset_minutes, declared_timezone, occurred_at_utc, client_event_id, payload_hash
         ) VALUES ($1, $2, 'in', 'pwa', 'online', '2026-11-09 08:00', -360, 'America/Mexico_City',
                   '2026-11-09 15:00Z', uuidv7(), repeat('a', 64))`,
        [a.tenantId, a.employeeId],
      ),
    ).rejects.toThrow(/attendance_event_utc_consistency/);
  });
});
