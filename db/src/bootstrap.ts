import type { ClientBase } from 'pg';

/** Nombre del rol con que se conecta la API. */
export const APP_ROLE = 'puntuale_app';

/**
 * Crea el rol de la aplicación, o actualiza su contraseña si ya existe.
 * El rol puede iniciar sesión, pero no es superusuario, no tiene BYPASSRLS, no crea bases ni roles
 * y no es dueño de ninguna tabla. Así la RLS siempre le aplica (ADR 0003).
 * Se ejecuta con la conexión administrativa antes de las migraciones.
 */
export async function bootstrapAppRole(client: ClientBase, appPassword: string): Promise<void> {
  if (appPassword.length < 12) {
    throw new Error('La contraseña del rol de aplicación debe tener al menos 12 caracteres.');
  }
  // DDL no admite parámetros: la contraseña se escapa como literal.
  const password = client.escapeLiteral(appPassword);
  const { rowCount } = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [APP_ROLE]);
  const verb = rowCount === 0 ? 'CREATE' : 'ALTER';
  await client.query(
    `${verb} ROLE ${APP_ROLE} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${password}`,
  );
}
