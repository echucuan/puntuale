# Seguridad

> **Estado: Implementado (1.0-b.2)**, salvo donde se indica. Los riesgos del modo sin conexión están en [`offline.md`](offline.md) (**Planificado**).

## Controles vigentes

| Control                     | Implementación                                                                                                                                                                                                                                                                    | Prueba                                                                                                     |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Autorización por empresa    | `TenantGuard`: 401 sin sesión, 404 sin membresía                                                                                                                                                                                                                                  | `tenant.guard.test.ts`, e2e                                                                                |
| Permisos por empresa        | `PermissionGuard` con denegación predeterminada; catálogo cerrado; permisos reservados nunca concedidos; cambios bajo bloqueo por empresa, con relectura de quien actúa (ADR 0015)                                                                                                | `access-policy.test.ts`, `permission.guard.test.ts`, `access-mfa.e2e.test.ts`, `access-schema.int.test.ts` |
| MFA TOTP                    | Obligatorio por rol; secreto cifrado con AES-256-GCM; paso aceptado que solo avanza; 10 códigos de recuperación como HMAC y de un solo uso; límite compartido por persona; reautenticación para reemplazar o desactivar (ADR 0015)                                                | `mfa.test.ts`, `access-mfa.e2e.test.ts`                                                                    |
| Aislamiento en la base      | RLS `ENABLE` + `FORCE`, `app_current_tenant()` que falla cerrada                                                                                                                                                                                                                  | `tenant-isolation.int.test.ts`                                                                             |
| Rol de mínimo privilegio    | `puntuale_app`: sin superusuario, sin `BYPASSRLS`, sin ser dueño, permisos por tabla; sin `DELETE` ni `TRUNCATE` en ninguna tabla                                                                                                                                                 | `migrations.int.test.ts`                                                                                   |
| Inmutabilidad               | Sin `UPDATE`/`DELETE` para el rol y trigger `reject_mutation()` contra cambios accidentales; un bypass de superusuario solo con el [procedimiento de emergencia](../operations/emergency-changes.md)                                                                              | `immutability.int.test.ts`                                                                                 |
| Auditoría                   | Misma transacción que el cambio                                                                                                                                                                                                                                                   | `audit.int.test.ts`                                                                                        |
| Sin atajos de autenticación | La aplicación registra siempre `CookieSessionResolver`. `TestSessionResolver` vive fuera de `src/` (`apps/api/test/support/`), solo lo registra `createTestApp` y exige `NODE_ENV=test`, `VITEST=true`, la marca de composición y una base local                                  | `session-resolver.test.ts`, `test-session.resolver.test.ts`, e2e                                           |
| Sesiones                    | Cookie `HttpOnly` y `SameSite=Lax`, `__Host-` y `Secure` en producción; solo el SHA-256 del token en la base; 12 h absolutas y 30 min de inactividad; rotación de un solo uso y revocación inmediata; aislamiento entre personas en la aplicación (ADR 0014)                      | `auth.e2e.test.ts`                                                                                         |
| Contraseñas                 | Argon2id (64 MiB, 3 iteraciones, paralelismo 1); misma respuesta y mismo trabajo si la cuenta no existe                                                                                                                                                                           | `password-hasher.test.ts`, `auth.e2e.test.ts`                                                              |
| Acceso a identidades        | `puntuale_app` no lee `app_user` ni credenciales; funciones `SECURITY DEFINER` con `search_path` fijo y dueño sin privilegios                                                                                                                                                     | `auth-schema.int.test.ts`                                                                                  |
| CSRF                        | `X-CSRF-Token` ligado a la sesión más validación de `Origin` o `Referer`, incluidos login y logout                                                                                                                                                                                | `identity-domain.test.ts`, `auth.e2e.test.ts`                                                              |
| CORS y cabeceras            | Lista explícita de orígenes con credenciales; Helmet con CSP de API; HSTS solo en producción                                                                                                                                                                                      | `app-config.test.ts`, `auth.e2e.test.ts`                                                                   |
| Límites de tasa             | Login por cuenta e IP con espera progresiva y sin bloqueo permanente; API por IP y sesión; PostgreSQL compartido entre instancias; límites de login exactos entre instancias, con historial de cuenta e IP separado (ADR 0014)                                                    | `identity-domain.test.ts`, `auth.e2e.test.ts`                                                              |
| Eventos de seguridad        | `security_event` de solo inserción, en la misma transacción; HMAC del identificador si no hay persona                                                                                                                                                                             | `auth-schema.int.test.ts`, `auth.e2e.test.ts`                                                              |
| Errores sin fugas           | `ApiExceptionFilter`: sin SQL, pilas ni valores en las respuestas; un cuerpo mayor a 100 KB responde 413 sin registrar su contenido                                                                                                                                               | e2e                                                                                                        |
| Colaboradores               | Sin borrado físico: sin `DELETE` ni `TRUNCATE` para el rol, trigger `reject_employee_delete()` para cualquier rol en el flujo normal y FK `ON DELETE RESTRICT`. La RLS de `DELETE` se prueba con un rol exclusivo de pruebas (`puntuale_rls_probe`) que no crea ninguna migración | `employee-deletion.int.test.ts`, `tenant-isolation.int.test.ts`                                            |
| Auditoría sin secretos      | Lista permitida por entidad (`audit-data-policy.ts`); nunca contraseñas, MFA, tokens, cookies ni credenciales                                                                                                                                                                     | `audit-data-policy.test.ts`, `audit.int.test.ts`                                                           |
| Hora del servidor           | `received_at` = `statement_timestamp()` de la base; el contrato no acepta ese campo                                                                                                                                                                                               | `ingest.int.test.ts`                                                                                       |
| Configuración               | Validada al arrancar; el error no muestra valores                                                                                                                                                                                                                                 | `app-config.test.ts`                                                                                       |
| Secretos                    | `.env` ignorado; `.env.example` ficticio; gitleaks en CI                                                                                                                                                                                                                          | CI (`secrets`)                                                                                             |
| Dependencias                | Versiones fijadas; scripts de instalación denegados (`allowBuilds`); `overrides` de seguridad para `glob` y `minimatch` (ver abajo)                                                                                                                                               | `pnpm audit --prod`, `pnpm audit --dev`                                                                    |
| Acciones de CI              | Cada `uses:` fijado a un SHA completo de commit con la versión legible en un comentario                                                                                                                                                                                           | `pnpm check:ci-pins` (dentro de `pnpm check`)                                                              |

## Reglas para contribuir

1. Nunca uses la conexión administrativa desde la API.
2. Nunca confíes en un `tenant_id` del cliente: usa el del `TenantContext`.
3. Nunca agregues a `src/` un resolvedor de sesión que acepte identidades sin verificar. Los dobles de prueba van en `apps/api/test/support/`.
4. No subas secretos, datos reales ni los PDF legales (repositorio público).
5. Toda acción nueva de CI se fija por SHA completo con `# vX.Y.Z`; obtén el SHA con `git ls-remote --tags https://github.com/<owner>/<repo>.git`.
6. El hash Argon2id solo se usa dentro de la API para verificar contraseñas: nunca se envía al navegador, se registra ni se audita (ADR 0014).

## Dependencias con vulnerabilidades conocidas

Al cierre de 1.0-a, `pnpm audit --prod` y `pnpm audit --dev` no reportan vulnerabilidades. Dos avisos moderados de dependencias **de desarrollo** se resolvieron con `overrides` en `pnpm-workspace.yaml`, sin aceptación temporal:

| Aviso                 | Paquete y versión anterior | Llegaba por                                      | Override  | Versión instalada |
| --------------------- | -------------------------- | ------------------------------------------------ | --------- | ----------------- |
| `GHSA-3g3m-2fjr-6pw4` | `glob` 10.5.0              | `testcontainers` → `archiver` → `archiver-utils` | `^14.0.2` | 14.0.4            |
| `GHSA-g3hv-75wg-m249` | `minimatch` 9.0.9 y 10.2.6 | `eslint`, `typescript-eslint`                    | `^11.0.1` | 11.0.5            |

Con los overrides pasan `pnpm check`, `pnpm build`, `pnpm test:integration` y `pnpm test:e2e`. Se retiran cuando las dependencias que los traen publiquen versiones con el parche.

## Riesgos aceptados con límites (revisión de seguridad de 1.0-a)

Riesgos registrados en la revisión de 1.0-a, con su estado tras 1.0-b.1. Cada uno indica cuándo deja de ser aceptable.

| #   | Riesgo                                        | Límite de la aceptación                                                                                                                                                               |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R2  | Autenticación incompleta                      | **Reducido en 1.0-b.1:** existen sesiones reales ([ADR 0014](../adr/0014-postgres-sessions-and-login.md)). Faltan roles, permisos y MFA (1.0-b.2).                                    |
| R3  | Un superusuario puede saltarse triggers y RLS | Solo mediante el [procedimiento de emergencia](../operations/emergency-changes.md): fuera de la API, con respaldo, revisión, autorización y registro.                                 |
| R4  | Las migraciones corren con un superusuario    | Solo en desarrollo local y CI. Antes de producción se requiere un rol migrador separado, sin superusuario.                                                                            |
| R5  | `app_user` no tiene RLS (identidad global)    | **Resuelto en 1.0-b.1:** `puntuale_app` no tiene `SELECT`; solo funciones `SECURITY DEFINER`. La API recibe internamente el hash Argon2id solo para verificar contraseñas (ADR 0014). |
| R6  | Sin límites de tasa, Helmet ni CORS           | **Resuelto en 1.0-b.1.** Los límites por IP dependen de R7.                                                                                                                           |
| R7  | `trust proxy` sin resolver                    | Se resuelve antes de desplegar detrás de un proxy, con la lista de proxies de confianza documentada.                                                                                  |
| R8  | Acciones de CI por etiqueta                   | **Resuelto:** fijadas por SHA (ver «Acciones de CI»).                                                                                                                                 |
| R9  | `glob` y `minimatch` vulnerables (desarrollo) | **Resuelto:** overrides (ver la sección anterior).                                                                                                                                    |
| R10 | Registros sin estructura                      | Antes de producción: registros estructurados, sin secretos ni datos personales, un identificador de error devuelto al cliente y acceso restringido a los registros.                   |

## Custodia de la llave MFA y de los códigos de recuperación

**`MFA_ENCRYPTION_KEY`** descifra los secretos TOTP y también calcula las huellas de los códigos de recuperación. Si se pierde o cambia, ningún MFA inscrito funciona: ni los códigos de la aplicación ni los de recuperación, y hoy no existe un procedimiento de rotación.

- Guárdala en un gestor de secretos o de contraseñas, fuera del repositorio.
- Conserva su copia separada de los respaldos de la base: quien tenga ambos puede descifrar los secretos.
- No la compartas por chat ni la incluyas en capturas o reportes.
- No la cambies para resolver un fallo: las personas inscritas perderían el acceso administrativo.

**Códigos de recuperación.** Se muestran una sola vez. Guárdalos en un gestor de contraseñas o impresos en un lugar seguro, nunca junto al teléfono ni en capturas sincronizadas. Si quedan pocos, reemplazar la aplicación genera 10 nuevos e invalida los anteriores. Si se pierden el teléfono y todos los códigos, la aplicación no puede recuperar la cuenta.

Estas limitaciones se aceptaron solo para el piloto local y no autorizan exposición pública ([ADR 0015](../adr/0015-access-control-and-mfa.md)).

## Pendiente (Planificado)

- Alcance por centro o área, cuando existan esas entidades.
- Rotación de `MFA_ENCRYPTION_KEY` y soporte para quien pierde su teléfono y sus códigos.
- Retención y purga de `auth_session` y `security_event` (antes de producción).
- Cadena de hashes en la auditoría (1.x, [ADR 0005](../adr/0005-transactional-audit.md)).
