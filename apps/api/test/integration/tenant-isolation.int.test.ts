import { startTestDatabase, type TestDatabase } from '@puntuale/db/testing';
import { DatabaseError, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../src/database/tenant-transaction';
import { EmployeeNotFoundError } from '../../src/modules/time-tracking/application/ingest-attendance-event.service';
import { createIngestService, requestMeta, sampleInput } from '../support/attendance';
import { seedTenant, type SeededTenant } from '../support/seed';

/**
 * Aislamiento entre empresas con el rol de aplicación `puntuale_app` (ADR 0003).
 * Cada consulta corre como la API: sin superusuario, sin BYPASSRLS y sin ser dueña de tablas.
 */
let db: TestDatabase;
let a: SeededTenant;
let b: SeededTenant;

beforeAll(async () => {
  db = await startTestDatabase();
  a = await seedTenant(db.adminPool, 'A');
  b = await seedTenant(db.adminPool, 'B');
  await db.adminPool.query(
    `CREATE ROLE puntuale_rls_probe NOLOGIN NOSUPERUSER NOBYPASSRLS;
     GRANT USAGE ON SCHEMA public TO puntuale_rls_probe;
     GRANT SELECT, DELETE ON employee TO puntuale_rls_probe;`,
  );
  const ingest = createIngestService(db.appPool);
  await ingest.ingest(
    { tenantId: a.tenantId, actorUserId: a.userId, request: requestMeta },
    sampleInput(a.employeeId),
  );
  await ingest.ingest(
    { tenantId: b.tenantId, actorUserId: b.userId, request: requestMeta },
    sampleInput(b.employeeId),
  );
});

afterAll(async () => {
  await db?.stop();
});

const asTenant = <T>(tenantId: string, work: (client: PoolClient) => Promise<T>) =>
  withTenant(db.appPool, tenantId, work);

/** Ejecuta `work` en una transacción del rol de aplicación con un valor arbitrario de contexto (o ninguno). */
async function withRawContext<T>(
  value: string | null,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db.appPool.connect();
  try {
    await client.query('BEGIN');
    if (value !== null) await client.query("SELECT set_config('app.tenant_id', $1, true)", [value]);
    return await work(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

/** Ejecuta `work` como el rol de pruebas `puntuale_rls_probe`, con el contexto de `tenantId`. */
async function asRlsProbe<T>(tenantId: string, work: (client: PoolClient) => Promise<T>) {
  const client = await db.adminPool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE puntuale_rls_probe');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

const TENANT_TABLES = ['tenant', 'employee', 'user_tenant', 'attendance_event', 'audit_event'];

async function countVisible(client: PoolClient): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of TENANT_TABLES) {
    const { rows } = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
    counts[table] = rows[0]!.n;
  }
  return counts;
}

describe('lectura cruzada', () => {
  it('en el contexto de A solo se ven filas de A en todas las tablas', async () => {
    await asTenant(a.tenantId, async (client) => {
      for (const table of TENANT_TABLES) {
        const column = table === 'tenant' ? 'id' : 'tenant_id';
        const { rows } = await client.query<{ other: number }>(
          `SELECT count(*)::int AS other FROM ${table} WHERE ${column} <> $1`,
          [a.tenantId],
        );
        expect(rows[0]!.other, table).toBe(0);
      }
    });
  });

  it('buscar por id una fila de B desde A devuelve 0 filas', async () => {
    await asTenant(a.tenantId, async (client) => {
      const employee = await client.query('SELECT * FROM employee WHERE id = $1', [b.employeeId]);
      const membership = await client.query('SELECT * FROM user_tenant WHERE id = $1', [
        b.membershipId,
      ]);
      const tenant = await client.query('SELECT * FROM tenant WHERE id = $1', [b.tenantId]);
      expect([employee.rowCount, membership.rowCount, tenant.rowCount]).toEqual([0, 0, 0]);
    });
  });
});

describe('escritura cruzada', () => {
  it('UPDATE de una fila de B desde A afecta 0 filas y B no cambia', async () => {
    const affected = await asTenant(a.tenantId, async (client) => {
      const result = await client.query(
        `UPDATE employee SET display_name = 'Alterado' WHERE id = $1`,
        [b.employeeId],
      );
      return result.rowCount;
    });
    expect(affected).toBe(0);
    const { rows } = await db.adminPool.query('SELECT display_name FROM employee WHERE id = $1', [
      b.employeeId,
    ]);
    expect(rows[0].display_name).toBe('Empleado B');
  });

  it('la política RLS de DELETE aísla empresas (probada con un rol exclusivo de pruebas)', async () => {
    // puntuale_rls_probe solo existe en este contenedor efímero, no puede iniciar sesión y no lo
    // crea ninguna migración. Sirve únicamente para ejercer la política RLS de DELETE; el borrado
    // en sí lo sigue rechazando el trigger employee_reject_delete (ver employee-deletion.int.test.ts).
    const extra = await db.adminPool.query<{ id: string }>(
      `INSERT INTO employee (tenant_id, employee_number, display_name)
       VALUES ($1, 'E-DEL', 'Empleado sin historial') RETURNING id`,
      [b.tenantId],
    );
    const id = extra.rows[0]!.id;

    // Desde A, la fila de B no es visible para DELETE: 0 filas y el trigger ni siquiera se dispara.
    const affected = await asRlsProbe(a.tenantId, async (client) => {
      const result = await client.query('DELETE FROM employee WHERE id = $1', [id]);
      return result.rowCount;
    });
    expect(affected).toBe(0);

    // Desde B, la fila sí es visible: la política filtra, no bloquea todo. El trigger la rechaza.
    await expect(
      asRlsProbe(b.tenantId, (client) => client.query('DELETE FROM employee WHERE id = $1', [id])),
    ).rejects.toThrow(/no admite borrado físico/);

    const { rowCount } = await db.adminPool.query('SELECT 1 FROM employee WHERE id = $1', [id]);
    expect(rowCount).toBe(1);
  });

  it('INSERT con el tenant_id de B desde el contexto de A es rechazado por la RLS', async () => {
    await expect(
      asTenant(a.tenantId, (client) =>
        client.query(
          `INSERT INTO employee (tenant_id, employee_number, display_name)
           VALUES ($1, 'E-X', 'Intruso')`,
          [b.tenantId],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('una marcación de A no puede apuntar a un empleado de B (FK compuesta)', async () => {
    const ingest = createIngestService(db.appPool);
    await expect(
      ingest.ingest(
        { tenantId: a.tenantId, actorUserId: a.userId, request: requestMeta },
        sampleInput(b.employeeId),
      ),
    ).rejects.toBeInstanceOf(EmployeeNotFoundError);
  });

  it('tenant_id no se puede cambiar, ni siquiera con la conexión administrativa', async () => {
    await expect(
      db.adminPool.query('UPDATE employee SET tenant_id = $1 WHERE id = $2', [
        b.tenantId,
        a.employeeId,
      ]),
    ).rejects.toThrow(/tenant_id no se puede modificar/);
  });
});

describe('contexto ausente o inválido: falla cerrada', () => {
  it('sin contexto no se ve ninguna fila', async () => {
    const counts = await withRawContext(null, countVisible);
    expect(Object.values(counts)).toEqual(TENANT_TABLES.map(() => 0));
  });

  it('sin contexto un INSERT es rechazado', async () => {
    await expect(
      withRawContext(null, (client) =>
        client.query(
          `INSERT INTO employee (tenant_id, employee_number, display_name) VALUES ($1, 'E-Y', 'X')`,
          [a.tenantId],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it.each(['not-a-uuid', '', "' OR 1=1 --", '0190f5e2-0000-7000-8000'])(
    'un tenant_id inválido (%j) devuelve 0 filas sin error',
    async (value) => {
      const counts = await withRawContext(value, countVisible);
      expect(Object.values(counts)).toEqual(TENANT_TABLES.map(() => 0));
    },
  );

  it('un UUID válido de una empresa inexistente devuelve 0 filas', async () => {
    const counts = await withRawContext('0190f5e2-0000-7000-8000-00000000dead', countVisible);
    expect(Object.values(counts)).toEqual(TENANT_TABLES.map(() => 0));
  });

  it('el contexto es local a la transacción: no se filtra a la siguiente en la misma conexión', async () => {
    const client = await db.appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [a.tenantId]);
      await client.query('COMMIT');
      const { rows } = await client.query<{ n: number }>('SELECT count(*)::int AS n FROM employee');
      expect(rows[0]!.n).toBe(0);
    } finally {
      client.release();
    }
  });
});

describe('mismos identificadores en empresas distintas', () => {
  it('el mismo número de empleado existe en A y B, y cada contexto ve solo el suyo', async () => {
    const seen = await Promise.all(
      [a, b].map((t) =>
        asTenant(t.tenantId, async (client) => {
          const { rows } = await client.query<{ id: string }>(
            `SELECT id FROM employee WHERE employee_number = 'E-001'`,
          );
          return rows.map((row) => row.id);
        }),
      ),
    );
    expect(seen).toEqual([[a.employeeId], [b.employeeId]]);
  });

  it('el mismo client_event_id se acepta en A y en B como marcaciones distintas', async () => {
    const ingest = createIngestService(db.appPool);
    const clientEventId = '0190f5e2-0000-7000-8000-00000000c0de';
    const resultA = await ingest.ingest(
      { tenantId: a.tenantId, actorUserId: a.userId, request: requestMeta },
      sampleInput(a.employeeId, { clientEventId }),
    );
    const resultB = await ingest.ingest(
      { tenantId: b.tenantId, actorUserId: b.userId, request: requestMeta },
      sampleInput(b.employeeId, { clientEventId }),
    );
    expect([resultA.outcome, resultB.outcome]).toEqual(['created', 'created']);
    expect(resultA.event.id).not.toBe(resultB.event.id);
  });
});

describe('el rol de aplicación no puede saltarse la RLS', () => {
  it('no puede desactivar la RLS ni cambiar de rol', async () => {
    await expect(
      db.appPool.query('ALTER TABLE employee DISABLE ROW LEVEL SECURITY'),
    ).rejects.toBeInstanceOf(DatabaseError);
    await expect(db.appPool.query('SET ROLE puntuale_admin')).rejects.toBeInstanceOf(DatabaseError);
    await expect(db.appPool.query('SET row_security = off')).resolves.toBeDefined();
    // Con row_security = off, un rol sujeto a RLS recibe un error en lugar de ver todo.
    const client = await db.appPool.connect();
    try {
      await client.query('SET row_security = off');
      await expect(client.query('SELECT * FROM employee')).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      await client.query('RESET row_security');
      client.release();
    }
  });
});
