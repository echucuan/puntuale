import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client, Pool } from 'pg';
import { APP_ROLE, bootstrapAppRole } from './bootstrap';
import { runMigrations } from './migrations';

/** Contraseña ficticia del rol de aplicación. Solo existe en contenedores de prueba efímeros. */
const TEST_APP_PASSWORD = 'puntuale_app_test_only';

export interface TestDatabase {
  container: StartedPostgreSqlContainer;
  /** Conexión administrativa (superusuario). Solo sirve para preparar datos y verificar. */
  adminUrl: string;
  /** Conexión con el rol de aplicación: la que usan la API y las pruebas de aislamiento. */
  appUrl: string;
  adminPool: Pool;
  appPool: Pool;
  stop(): Promise<void>;
}

/**
 * Levanta PostgreSQL 18 en un contenedor efímero, crea el rol de aplicación y aplica las migraciones.
 * Requiere Docker. Solo para pruebas de integración y e2e.
 */
export async function startTestDatabase(): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer('postgres:18-alpine')
    .withDatabase('puntuale_test')
    .withUsername('puntuale_admin')
    .withPassword('puntuale_admin_test_only')
    .start();
  const adminUrl = container.getConnectionUri();

  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await bootstrapAppRole(admin, TEST_APP_PASSWORD);
    await runMigrations(admin);
  } finally {
    await admin.end();
  }

  const url = new URL(adminUrl);
  url.username = APP_ROLE;
  url.password = TEST_APP_PASSWORD;
  const appUrl = url.toString();

  const adminPool = new Pool({ connectionString: adminUrl, max: 4 });
  const appPool = new Pool({ connectionString: appUrl, max: 8 });

  return {
    container,
    adminUrl,
    appUrl,
    adminPool,
    appPool,
    async stop() {
      await Promise.allSettled([adminPool.end(), appPool.end()]);
      await container.stop();
    },
  };
}
