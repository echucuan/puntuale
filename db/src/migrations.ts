import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ClientBase } from 'pg';

/** Carpeta de migraciones SQL versionadas en el repositorio. */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));

const MIGRATION_FILE = /^(\d{4})_([a-z0-9_]+)\.sql$/;

/** Llave del advisory lock que impide aplicar migraciones en paralelo. */
const MIGRATION_LOCK_KEY = 727_202_701;

export interface MigrationFile {
  version: string;
  name: string;
  checksum: string;
  sql: string;
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

/** Lee y ordena las migraciones. Falla si un archivo no sigue la convención `NNNN_descripcion.sql`. */
export async function loadMigrations(dir: string = MIGRATIONS_DIR): Promise<MigrationFile[]> {
  const files = (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort();
  const migrations: MigrationFile[] = [];
  for (const file of files) {
    const match = MIGRATION_FILE.exec(file);
    if (!match?.[1] || !match[2]) throw new Error(`Nombre de migración inválido: ${file}`);
    const version = match[1];
    const name = match[2];
    if (migrations.some((m) => m.version === version)) {
      throw new Error(`Versión de migración duplicada: ${version}`);
    }
    // El checksum ignora el fin de línea para que Windows y Linux calculen lo mismo.
    const sql = (await readFile(join(dir, file), 'utf8')).replaceAll('\r\n', '\n');
    const checksum = createHash('sha256').update(sql).digest('hex');
    migrations.push({ version, name, checksum, sql });
  }
  return migrations;
}

/**
 * Aplica las migraciones pendientes, cada una en su propia transacción.
 * Si una migración ya aplicada cambió (checksum distinto), se detiene: una migración aplicada no se edita.
 * Se ejecuta con la conexión administrativa, nunca con el rol de la aplicación.
 */
export async function runMigrations(
  client: ClientBase,
  dir: string = MIGRATIONS_DIR,
): Promise<MigrationResult> {
  const migrations = await loadMigrations(dir);
  await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migration (
        version     text PRIMARY KEY,
        name        text NOT NULL,
        checksum    text NOT NULL,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )`);
    const { rows } = await client.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM schema_migration',
    );
    const applied = new Map(rows.map((row) => [row.version, row.checksum]));
    const result: MigrationResult = { applied: [], skipped: [] };

    for (const migration of migrations) {
      const existing = applied.get(migration.version);
      if (existing !== undefined) {
        if (existing !== migration.checksum) {
          throw new Error(
            `La migración ${migration.version}_${migration.name} cambió después de aplicarse. ` +
              'Crea una migración nueva en lugar de editarla.',
          );
        }
        result.skipped.push(migration.version);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO schema_migration (version, name, checksum) VALUES ($1, $2, $3)',
          [migration.version, migration.name, migration.checksum],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Falló la migración ${migration.version}_${migration.name}`, {
          cause: error,
        });
      }
      result.applied.push(migration.version);
    }
    return result;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
  }
}
