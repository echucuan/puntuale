import { startTestDatabase, type TestDatabase } from '@puntuale/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../src/database/tenant-transaction';
import { createIngestService, requestMeta, sampleInput } from '../support/attendance';
import { seedTenant, type SeededTenant } from '../support/seed';

/**
 * Los colaboradores se dan de baja lógica (`status = 'terminated'`) y no se borran físicamente.
 * Barreras: el rol de aplicación no tiene DELETE ni TRUNCATE, y el trigger employee_reject_delete
 * rechaza el borrado de cualquier rol en el flujo normal. Un bypass deliberado de un superusuario
 * solo se admite con el procedimiento de emergencia (docs/operations/emergency-changes.md).
 */
let db: TestDatabase;
let a: SeededTenant;
let eventId: string;
let unreferencedEmployeeId: string;

beforeAll(async () => {
  db = await startTestDatabase();
  a = await seedTenant(db.adminPool, 'A');
  const result = await createIngestService(db.appPool).ingest(
    { tenantId: a.tenantId, actorUserId: a.userId, request: requestMeta },
    sampleInput(a.employeeId),
  );
  eventId = result.event.id;
  const extra = await db.adminPool.query<{ id: string }>(
    `INSERT INTO employee (tenant_id, employee_number, display_name)
     VALUES ($1, 'E-SIN-REF', 'Colaborador sin referencias') RETURNING id`,
    [a.tenantId],
  );
  unreferencedEmployeeId = extra.rows[0]!.id;
});

afterAll(async () => {
  await db?.stop();
});

async function employeeCount(): Promise<number> {
  const { rows } = await db.adminPool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM employee WHERE tenant_id = $1',
    [a.tenantId],
  );
  return rows[0]!.n;
}

describe('employee no admite borrado físico', () => {
  it('puntuale_app no puede borrar colaboradores (sin permiso DELETE)', async () => {
    for (const id of [a.employeeId, unreferencedEmployeeId]) {
      await expect(
        withTenant(db.appPool, a.tenantId, (client) =>
          client.query('DELETE FROM employee WHERE id = $1', [id]),
        ),
      ).rejects.toMatchObject({ code: '42501' });
    }
  });

  it('puntuale_app no puede vaciar la tabla (sin permiso TRUNCATE)', async () => {
    await expect(
      withTenant(db.appPool, a.tenantId, (client) => client.query('TRUNCATE employee CASCADE')),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('la conexión administrativa ordinaria no puede borrar un colaborador sin referencias', async () => {
    await expect(
      db.adminPool.query('DELETE FROM employee WHERE id = $1', [unreferencedEmployeeId]),
    ).rejects.toMatchObject({ code: '23001', message: expect.stringMatching(/borrado físico/) });
  });

  it('la conexión administrativa ordinaria no puede borrar un colaborador con historial', async () => {
    await expect(
      db.adminPool.query('DELETE FROM employee WHERE id = $1', [a.employeeId]),
    ).rejects.toMatchObject({ code: '23001' });
  });

  it('la conexión administrativa ordinaria no puede vaciar la tabla', async () => {
    await expect(db.adminPool.query('TRUNCATE employee CASCADE')).rejects.toMatchObject({
      code: '23001',
    });
  });

  it('después de los intentos no falta ningún colaborador', async () => {
    expect(await employeeCount()).toBe(2);
  });
});

describe('baja lógica: el colaborador terminado se conserva como histórico', () => {
  it('se da de baja con status y sigue consultable, con sus marcaciones e identidades intactas', async () => {
    await withTenant(db.appPool, a.tenantId, (client) =>
      client.query(`UPDATE employee SET status = 'terminated' WHERE id = $1`, [a.employeeId]),
    );

    const snapshot = await withTenant(db.appPool, a.tenantId, async (client) => {
      const employee = await client.query(
        'SELECT id, employee_number, display_name, status FROM employee WHERE id = $1',
        [a.employeeId],
      );
      const events = await client.query(
        'SELECT id, event_type FROM attendance_event WHERE employee_id = $1',
        [a.employeeId],
      );
      const membership = await client.query(
        'SELECT id, user_id, employee_id, status FROM user_tenant WHERE employee_id = $1',
        [a.employeeId],
      );
      const user = await client.query('SELECT id FROM app_user WHERE id = $1', [a.userId]);
      return {
        employee: employee.rows,
        events: events.rows,
        membership: membership.rows,
        user: user.rows,
      };
    });

    expect(snapshot.employee).toEqual([
      {
        id: a.employeeId,
        employee_number: 'E-001',
        display_name: 'Empleado A',
        status: 'terminated',
      },
    ]);
    expect(snapshot.events).toEqual([{ id: eventId, event_type: 'in' }]);
    expect(snapshot.membership).toEqual([
      { id: a.membershipId, user_id: a.userId, employee_id: a.employeeId, status: 'active' },
    ]);
    expect(snapshot.user).toEqual([{ id: a.userId }]);
  });
});
