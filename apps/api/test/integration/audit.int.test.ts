import { startTestDatabase, type TestDatabase } from '@puntuale/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../src/database/tenant-transaction';
import { AuditRepository } from '../../src/modules/audit/infrastructure/audit.repository';
import { seedTenant, type SeededTenant } from '../support/seed';

/** La auditoría vive y muere con la transacción principal (ADR 0005). */
let db: TestDatabase;
let a: SeededTenant;
const audit = new AuditRepository();

beforeAll(async () => {
  db = await startTestDatabase();
  a = await seedTenant(db.adminPool, 'A');
});

afterAll(async () => {
  await db?.stop();
});

async function auditCount(action: string): Promise<number> {
  const { rows } = await db.adminPool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM audit_event WHERE action = $1',
    [action],
  );
  return rows[0]!.n;
}

function entry(action: string, entityId: string | null) {
  return {
    tenantId: a.tenantId,
    actorType: 'user' as const,
    actorUserId: a.userId,
    channel: 'online' as const,
    action,
    entityType: 'employee',
    entityId,
    before: null,
    after: { employee_number: 'E-RB' },
    reason: null,
    request: { ip: '198.51.100.7', userAgent: 'vitest', requestId: 'req-audit' },
    subjectOccurredAt: null,
  };
}

describe('auditoría transaccional', () => {
  it('si la operación falla después de auditar, se revierten el cambio y la auditoría', async () => {
    const action = 'test_support.employee.created';
    await expect(
      withTenant(db.appPool, a.tenantId, async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO employee (tenant_id, employee_number, display_name)
           VALUES ($1, 'E-RB', 'Reversión') RETURNING id`,
          [a.tenantId],
        );
        await audit.record(client, entry(action, rows[0]!.id));
        throw new Error('falla simulada después de auditar');
      }),
    ).rejects.toThrow('falla simulada');

    expect(await auditCount(action)).toBe(0);
    const { rowCount } = await db.adminPool.query(
      `SELECT 1 FROM employee WHERE employee_number = 'E-RB'`,
    );
    expect(rowCount).toBe(0);
  });

  it('si la operación termina bien, el cambio y la auditoría quedan juntos', async () => {
    const action = 'test_support.employee.registered';
    const recorded = await withTenant(db.appPool, a.tenantId, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO employee (tenant_id, employee_number, display_name)
         VALUES ($1, 'E-OK', 'Confirmado') RETURNING id`,
        [a.tenantId],
      );
      return audit.record(client, entry(action, rows[0]!.id));
    });
    expect(await auditCount(action)).toBe(1);
    expect(recorded.publicId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(recorded.id).toMatch(/^\d+$/);
  });

  it('no se puede auditar en otra empresa desde el contexto actual', async () => {
    const b = await seedTenant(db.adminPool, 'B');
    await expect(
      withTenant(db.appPool, a.tenantId, (client) =>
        audit.record(client, {
          ...entry('test_support.employee.created', null),
          tenantId: b.tenantId,
        }),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('rechaza una acción mal formada antes de llegar a la base', async () => {
    await expect(
      withTenant(db.appPool, a.tenantId, (client) => audit.record(client, entry('creado', null))),
    ).rejects.toBeInstanceOf(RangeError);
  });
});
