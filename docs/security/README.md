# Seguridad

> **Estado: Implementado (1.0-a)**, salvo donde se indica. Los riesgos del modo sin conexión están en [`offline.md`](offline.md) (**Planificado**).

## Controles vigentes

| Control                     | Implementación                                                                                                                                                                                                                                                                    | Prueba                                                           |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Autorización por empresa    | `TenantGuard`: 401 sin sesión, 404 sin membresía                                                                                                                                                                                                                                  | `tenant.guard.test.ts`, e2e                                      |
| Aislamiento en la base      | RLS `ENABLE` + `FORCE`, `app_current_tenant()` que falla cerrada                                                                                                                                                                                                                  | `tenant-isolation.int.test.ts`                                   |
| Rol de mínimo privilegio    | `puntuale_app`: sin superusuario, sin `BYPASSRLS`, sin ser dueño, permisos por tabla; sin `DELETE` ni `TRUNCATE` en ninguna tabla                                                                                                                                                 | `migrations.int.test.ts`                                         |
| Inmutabilidad               | Sin `UPDATE`/`DELETE` para el rol y trigger `reject_mutation()` contra cambios accidentales; un bypass de superusuario solo con el [procedimiento de emergencia](../operations/emergency-changes.md)                                                                              | `immutability.int.test.ts`                                       |
| Auditoría                   | Misma transacción que el cambio                                                                                                                                                                                                                                                   | `audit.int.test.ts`                                              |
| Sin atajos de autenticación | El módulo productivo registra siempre `NoSessionResolver`. `TestSessionResolver` vive fuera de `src/` (`apps/api/test/support/`), solo lo registra `createTestApp` y exige `NODE_ENV=test`, `VITEST=true`, la marca de composición y una base local                               | `session-resolver.test.ts`, `test-session.resolver.test.ts`, e2e |
| Errores sin fugas           | `ApiExceptionFilter`: sin SQL, pilas ni valores en las respuestas                                                                                                                                                                                                                 | e2e                                                              |
| Colaboradores               | Sin borrado físico: sin `DELETE` ni `TRUNCATE` para el rol, trigger `reject_employee_delete()` para cualquier rol en el flujo normal y FK `ON DELETE RESTRICT`. La RLS de `DELETE` se prueba con un rol exclusivo de pruebas (`puntuale_rls_probe`) que no crea ninguna migración | `employee-deletion.int.test.ts`, `tenant-isolation.int.test.ts`  |
| Auditoría sin secretos      | Lista permitida por entidad (`audit-data-policy.ts`); nunca contraseñas, MFA, tokens, cookies ni credenciales                                                                                                                                                                     | `audit-data-policy.test.ts`, `audit.int.test.ts`                 |
| Hora del servidor           | `received_at` = `statement_timestamp()` de la base; el contrato no acepta ese campo                                                                                                                                                                                               | `ingest.int.test.ts`                                             |
| Configuración               | Validada al arrancar; el error no muestra valores                                                                                                                                                                                                                                 | `app-config.test.ts`                                             |
| Secretos                    | `.env` ignorado; `.env.example` ficticio; gitleaks en CI                                                                                                                                                                                                                          | CI (`secrets`)                                                   |
| Dependencias                | Versiones fijadas; scripts de instalación denegados (`allowBuilds`); `overrides` de seguridad para `glob` y `minimatch` (ver abajo)                                                                                                                                               | `pnpm audit --prod`, `pnpm audit --dev`                          |
| Acciones de CI              | Cada `uses:` fijado a un SHA completo de commit con la versión legible en un comentario                                                                                                                                                                                           | `pnpm check:ci-pins` (dentro de `pnpm check`)                    |

## Reglas para contribuir

1. Nunca uses la conexión administrativa desde la API.
2. Nunca confíes en un `tenant_id` del cliente: usa el del `TenantContext`.
3. Nunca agregues a `src/` un resolvedor de sesión que acepte identidades sin verificar. Los dobles de prueba van en `apps/api/test/support/`.
4. No subas secretos, datos reales ni los PDF legales (repositorio público).
5. Toda acción nueva de CI se fija por SHA completo con `# vX.Y.Z`; obtén el SHA con `git ls-remote --tags https://github.com/<owner>/<repo>.git`.

## Dependencias con vulnerabilidades conocidas

Al cierre de 1.0-a, `pnpm audit --prod` y `pnpm audit --dev` no reportan vulnerabilidades. Dos avisos moderados de dependencias **de desarrollo** se resolvieron con `overrides` en `pnpm-workspace.yaml`, sin aceptación temporal:

| Aviso                 | Paquete y versión anterior | Llegaba por                                      | Override  | Versión instalada |
| --------------------- | -------------------------- | ------------------------------------------------ | --------- | ----------------- |
| `GHSA-3g3m-2fjr-6pw4` | `glob` 10.5.0              | `testcontainers` → `archiver` → `archiver-utils` | `^14.0.2` | 14.0.4            |
| `GHSA-g3hv-75wg-m249` | `minimatch` 9.0.9 y 10.2.6 | `eslint`, `typescript-eslint`                    | `^11.0.1` | 11.0.5            |

Con los overrides pasan `pnpm check`, `pnpm build`, `pnpm test:integration` y `pnpm test:e2e`. Se retiran cuando las dependencias que los traen publiquen versiones con el parche.

## Riesgos aceptados con límites (revisión de seguridad de 1.0-a)

Estos riesgos se aceptan **solo** para 1.0-a. Cada uno indica cuándo deja de ser aceptable.

| #   | Riesgo                                        | Límite de la aceptación                                                                                                                                             |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R2  | No hay autenticación real                     | Debe existir antes de exponer cualquier endpoint funcional en 1.0-b ([ADR 0007](../adr/0007-own-authentication.md)).                                                |
| R3  | Un superusuario puede saltarse triggers y RLS | Solo mediante el [procedimiento de emergencia](../operations/emergency-changes.md): fuera de la API, con respaldo, revisión, autorización y registro.               |
| R4  | Las migraciones corren con un superusuario    | Solo en desarrollo local y CI. Antes de producción se requiere un rol migrador separado, sin superusuario.                                                          |
| R5  | `app_user` no tiene RLS (identidad global)    | En 1.0-b se define cómo se limita el acceso a identidades. El rol de la aplicación no debe permitir que cualquier usuario autenticado vea todos los correos.        |
| R6  | Sin límites de tasa, Helmet ni CORS           | Obligatorios antes de exponer autenticación, marcaciones o cualquier endpoint de escritura.                                                                         |
| R7  | `trust proxy` sin resolver                    | Se resuelve antes de desplegar detrás de un proxy, con la lista de proxies de confianza documentada.                                                                |
| R8  | Acciones de CI por etiqueta                   | **Resuelto:** fijadas por SHA (ver «Acciones de CI»).                                                                                                               |
| R9  | `glob` y `minimatch` vulnerables (desarrollo) | **Resuelto:** overrides (ver la sección anterior).                                                                                                                  |
| R10 | Registros sin estructura                      | Antes de producción: registros estructurados, sin secretos ni datos personales, un identificador de error devuelto al cliente y acceso restringido a los registros. |

## Pendiente (Planificado)

- Autenticación, sesiones, roles y permisos (1.0-b, [ADR 0007](../adr/0007-own-authentication.md)).
- Límites de tasa y cabeceras de seguridad HTTP (1.0-b).
- Cadena de hashes en la auditoría (1.x, [ADR 0005](../adr/0005-transactional-audit.md)).
