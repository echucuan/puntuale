import { startTestDatabase, type TestDatabase } from '@puntuale/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../src/database/tenant-transaction';
import { createIngestService, requestMeta, sampleInput } from '../support/attendance';
import { seedTenant, type SeededTenant } from '../support/seed';

/** `attendance_event` y `audit_event` solo aceptan inserciones (ADR 0004, ADR 0005). */
let db: TestDatabase;
let a: SeededTenant;
let eventId: string;

beforeAll(async () => {
  db = await startTestDatabase();
  a = await seedTenant(db.adminPool, 'A');
  const result = await createIngestService(db.appPool).ingest(
    { tenantId: a.tenantId, actorUserId: a.userId, request: requestMeta },
    sampleInput(a.employeeId),
  );
  eventId = result.event.id;
});

afterAll(async () => {
  await db?.stop();
});

const STATEMENTS = {
  attendance_event: {
    update: `UPDATE attendance_event SET event_type = 'out'`,
    delete: 'DELETE FROM attendance_event',
    truncate: 'TRUNCATE attendance_event CASCADE',
  },
  audit_event: {
    update: `UPDATE audit_event SET reason = 'alterado'`,
    delete: 'DELETE FROM audit_event',
    truncate: 'TRUNCATE audit_event',
  },
} as const;

describe.each(Object.keys(STATEMENTS) as (keyof typeof STATEMENTS)[])('%s', (table) => {
  it.each(['update', 'delete', 'truncate'] as const)(
    'el rol de aplicación no tiene permiso de %s',
    async (op) => {
      await expect(
        withTenant(db.appPool, a.tenantId, (client) => client.query(STATEMENTS[table][op])),
      ).rejects.toMatchObject({ code: '42501' });
    },
  );

  it.each(['update', 'delete', 'truncate'] as const)(
    'el trigger rechaza %s incluso con la conexión administrativa',
    async (op) => {
      await expect(db.adminPool.query(STATEMENTS[table][op])).rejects.toThrow(
        /solo acepta inserciones/,
      );
    },
  );

  it('las filas siguen intactas', async () => {
    const { rows } = await db.adminPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`,
      [a.tenantId],
    );
    expect(rows[0]!.n).toBeGreaterThan(0);
  });
});

it('la marcación original conserva su tipo después de los intentos', async () => {
  const { rows } = await db.adminPool.query(
    'SELECT event_type FROM attendance_event WHERE id = $1',
    [eventId],
  );
  expect(rows[0].event_type).toBe('in');
});
