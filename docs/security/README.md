# Seguridad

> **Estado: Implementado (1.0-a)**, salvo donde se indica. Los riesgos del modo sin conexión están en [`offline.md`](offline.md) (**Planificado**).

## Controles vigentes

| Control                     | Implementación                                                                                                                                                                                                                                                                    | Prueba                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Autorización por empresa    | `TenantGuard`: 401 sin sesión, 404 sin membresía                                                                                                                                                                                                                                  | `tenant.guard.test.ts`, e2e                                     |
| Aislamiento en la base      | RLS `ENABLE` + `FORCE`, `app_current_tenant()` que falla cerrada                                                                                                                                                                                                                  | `tenant-isolation.int.test.ts`                                  |
| Rol de mínimo privilegio    | `puntuale_app`: sin superusuario, sin `BYPASSRLS`, sin ser dueño, permisos por tabla; sin `DELETE` ni `TRUNCATE` en ninguna tabla                                                                                                                                                 | `migrations.int.test.ts`                                        |
| Inmutabilidad               | Sin `UPDATE`/`DELETE` para el rol y trigger `reject_mutation()` contra cambios accidentales; un bypass de superusuario solo con el [procedimiento de emergencia](../operations/emergency-changes.md)                                                                              | `immutability.int.test.ts`                                      |
| Auditoría                   | Misma transacción que el cambio                                                                                                                                                                                                                                                   | `audit.int.test.ts`                                             |
| Sin atajos de autenticación | `NoSessionResolver` fuera de pruebas; `TestSessionResolver` falla si `NODE_ENV` no es `test`                                                                                                                                                                                      | `session-resolver.test.ts`                                      |
| Errores sin fugas           | `ApiExceptionFilter`: sin SQL, pilas ni valores en las respuestas                                                                                                                                                                                                                 | e2e                                                             |
| Colaboradores               | Sin borrado físico: sin `DELETE` ni `TRUNCATE` para el rol, trigger `reject_employee_delete()` para cualquier rol en el flujo normal y FK `ON DELETE RESTRICT`. La RLS de `DELETE` se prueba con un rol exclusivo de pruebas (`puntuale_rls_probe`) que no crea ninguna migración | `employee-deletion.int.test.ts`, `tenant-isolation.int.test.ts` |
| Auditoría sin secretos      | Lista permitida por entidad (`audit-data-policy.ts`); nunca contraseñas, MFA, tokens, cookies ni credenciales                                                                                                                                                                     | `audit-data-policy.test.ts`, `audit.int.test.ts`                |
| Hora del servidor           | `received_at` = `statement_timestamp()` de la base; el contrato no acepta ese campo                                                                                                                                                                                               | `ingest.int.test.ts`                                            |
| Configuración               | Validada al arrancar; el error no muestra valores                                                                                                                                                                                                                                 | `app-config.test.ts`                                            |
| Secretos                    | `.env` ignorado; `.env.example` ficticio; gitleaks en CI                                                                                                                                                                                                                          | CI (`secrets`)                                                  |
| Dependencias                | Versiones fijadas; scripts de instalación denegados (`allowBuilds`)                                                                                                                                                                                                               | `pnpm install`                                                  |

## Reglas para contribuir

1. Nunca uses la conexión administrativa desde la API.
2. Nunca confíes en un `tenant_id` del cliente: usa el del `TenantContext`.
3. Nunca agregues un resolvedor de sesión que acepte identidades sin verificar fuera de `test`.
4. No subas secretos, datos reales ni los PDF legales (repositorio público).

## Pendiente (Planificado)

- Autenticación, sesiones, roles y permisos (1.0-b, [ADR 0007](../adr/0007-own-authentication.md)).
- Límites de tasa y cabeceras de seguridad HTTP (1.0-b).
- Cadena de hashes en la auditoría (1.x, [ADR 0005](../adr/0005-transactional-audit.md)).
