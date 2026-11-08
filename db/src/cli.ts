import { Client } from 'pg';
import { bootstrapAppRole } from './bootstrap';
import { runMigrations } from './migrations';

/**
 * `pnpm db:migrate`: crea el rol de la aplicación y aplica las migraciones pendientes.
 * Usa DATABASE_ADMIN_URL y APP_DB_PASSWORD (ver `.env.example`). Nunca usa la conexión de la API.
 */
async function main(): Promise<void> {
  const adminUrl = process.env['DATABASE_ADMIN_URL'];
  const appPassword = process.env['APP_DB_PASSWORD'];
  if (!adminUrl || !appPassword) {
    throw new Error('Faltan DATABASE_ADMIN_URL o APP_DB_PASSWORD. Copia .env.example a .env.');
  }
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await bootstrapAppRole(client, appPassword);
    const result = await runMigrations(client);
    process.stdout.write(
      `Migraciones aplicadas: ${result.applied.join(', ') || 'ninguna'}. Ya aplicadas: ${result.skipped.length}.\n`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
