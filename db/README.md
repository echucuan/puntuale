# `@puntuale/db`

> **Estado: Implementado (1.0-a).**

## Propósito

Esquema de la base de datos como migraciones SQL versionadas, el bootstrap del rol de aplicación, el ejecutor de migraciones y la utilidad de base de datos efímera para pruebas.

## Responsabilidades

| Archivo                 | Qué hace                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| `migrations/NNNN_*.sql` | Esquema, RLS, triggers y permisos. Una migración aplicada **no se edita**.                                    |
| `src/bootstrap.ts`      | Crea `puntuale_app` (`LOGIN`, sin superusuario, sin `BYPASSRLS`, sin ser dueño de tablas).                    |
| `src/migrations.ts`     | Aplica cada migración pendiente en su transacción, con advisory lock, y falla si una aplicada cambió.         |
| `src/cli.ts`            | `pnpm db:migrate`: bootstrap y migraciones con `DATABASE_ADMIN_URL`.                                          |
| `src/testing.ts`        | `startTestDatabase()`: PostgreSQL 18 en Testcontainers, ya migrado, con pools administrativo y de aplicación. |

## Dependencias

| Depende de                   | Para qué                                        |
| ---------------------------- | ----------------------------------------------- |
| `pg`                         | Conexión a PostgreSQL                           |
| `@testcontainers/postgresql` | Base efímera en pruebas (solo desarrollo)       |
| `tsx`                        | Ejecutar la CLI en TypeScript (solo desarrollo) |

## Reglas

1. **Dos conexiones.** La administrativa (`DATABASE_ADMIN_URL`) solo crea roles y migra. La API usa `DATABASE_URL` con `puntuale_app`.
2. **RLS ENABLE + FORCE** en toda tabla con `tenant_id` (y en `tenant`). `app_current_tenant()` devuelve `NULL` sin contexto o con un valor que no es UUID, y la consulta devuelve 0 filas sin error (ADR 0003).
3. **Solo inserción** en `attendance_event` y `audit_event`: el rol no tiene `UPDATE`/`DELETE` y un trigger rechaza `UPDATE`, `DELETE` y `TRUNCATE` de cualquier rol en el flujo normal (ADR 0004, ADR 0005). Un superusuario podría desactivar el trigger a propósito: eso solo se admite con el [procedimiento de emergencia](../docs/operations/emergency-changes.md).
4. **`tenant_id` no cambia** en las tablas que admiten `UPDATE` (trigger `reject_tenant_change`).
5. **`employee` no admite borrado físico**: sin `DELETE`/`TRUNCATE` para el rol y trigger `reject_employee_delete` para cualquier rol en el flujo normal. La baja es lógica (`status = 'terminated'`).
6. **Llaves foráneas compuestas** `(tenant_id, x_id)` entre tablas con tenant.
7. El checksum de una migración ignora el fin de línea (`CRLF`/`LF`).

## Entradas y salidas

- Entrada: `DATABASE_ADMIN_URL` y `APP_DB_PASSWORD` (ver `.env.example`, valores ficticios).
- Salida: base migrada y la tabla `schema_migration` con versión, nombre, checksum y fecha.

## Pruebas relacionadas

`test/integration/migrations.int.test.ts` (requiere Docker): idempotencia del ejecutor, detección de migraciones editadas, atributos del rol y RLS forzada en todas las tablas con tenant. Las pruebas de aislamiento, inmutabilidad y auditoría están en `apps/api/test/integration/`.

## Cómo extenderlo

1. Crea `migrations/NNNN_descripcion.sql` con el siguiente número.
2. Toda tabla operativa nueva lleva `tenant_id`, `UNIQUE (tenant_id, id)`, llaves compuestas, RLS `ENABLE` + `FORCE` y la política `<tabla>_tenant_isolation`.
3. Otorga a `puntuale_app` solo los permisos necesarios. Las tablas de solo inserción reciben `SELECT, INSERT` y los triggers de `reject_mutation()`.
4. Si cambia una enumeración, actualiza también `@puntuale/contracts`.
5. Documenta el cambio en `docs/data-model/README.md` y en `CHANGELOG.md`.
