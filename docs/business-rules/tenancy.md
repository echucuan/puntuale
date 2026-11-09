# Regla: aislamiento entre empresas

> **Estado: Implementado (1.0-a, ampliado en 1.0-b.2).** Decisiones en [ADR 0003](../adr/0003-tenant-is-company-with-fail-closed-rls.md) y [ADR 0015](../adr/0015-access-control-and-mfa.md). Código en `apps/api/src/modules/tenancy/` y `db/migrations/0001_base_multitenant.sql`.

## Reglas

1. **Un tenant es una empresa** (razón social). Una persona (`app_user`) puede pertenecer a varias mediante `user_tenant`.
2. **La autorización ocurre en la aplicación.** `TenantGuard` exige sesión (401) y membresía activa en una empresa activa (404). El `tenantId` de la URL solo dice qué se pide; nunca concede acceso.
3. **La RLS es una defensa adicional.** Cada transacción fija `app.tenant_id` con `set_config(..., true)`. Las políticas comparan con `app_current_tenant()`.
4. **Falla cerrada.** Sin contexto, o con un valor que no es UUID, `app_current_tenant()` devuelve `NULL`: las consultas devuelven 0 filas sin error y las inserciones se rechazan.
5. **Llaves compuestas.** Una fila solo puede referirse a otra de la misma empresa: `(tenant_id, x_id)`.
6. **`tenant_id` no cambia** después de crear la fila.
7. **El rol de aplicación** (`puntuale_app`) no es superusuario, no tiene `BYPASSRLS` y no es dueño de tablas.
8. **Denegación predeterminada.** Cada ruta administrativa declara un permiso; sin él, se deniega. Los permisos de módulos futuros están reservados y nunca se conceden.
9. **Membresía inactiva.** Pierde el acceso en la siguiente petición, aunque la sesión siga abierta.
10. **Nadie cambia su propio acceso.** Tocar un rol administrativo, o a quien lo tiene, exige `access.manage_admins`.
11. **Último propietario.** Cada empresa conserva al menos un `company_owner` con acceso efectivo: membresía activa, rol vigente y credencial activa. Una operación futura que deshabilite credenciales debe respetar esta misma garantía.
12. **MFA.** Los permisos de un rol que exige MFA solo se ejercen en una sesión que lo completó.
13. **Alcance.** Solo existe el alcance de empresa. El supervisor no tiene permisos activos hasta que existan centros y áreas: no se sustituye por acceso a toda la empresa.

## Casos probados

| Caso                                                                       | Resultado esperado            | Prueba                         |
| -------------------------------------------------------------------------- | ----------------------------- | ------------------------------ |
| Leer filas de B desde A                                                    | 0 filas                       | `tenant-isolation.int.test.ts` |
| Actualizar o borrar filas de B desde A                                     | 0 filas afectadas; B intacto  | `tenant-isolation.int.test.ts` |
| Insertar con el `tenant_id` de B desde A                                   | Rechazado (`42501`)           | `tenant-isolation.int.test.ts` |
| Marcación de A con un empleado de B                                        | `EmployeeNotFoundError` (FK)  | `tenant-isolation.int.test.ts` |
| Sin contexto                                                               | 0 filas; inserción rechazada  | `tenant-isolation.int.test.ts` |
| `tenant_id` inválido (texto, vacío, inyección, truncado)                   | 0 filas sin error             | `tenant-isolation.int.test.ts` |
| Mismos números y `client_event_id` en A y B                                | Independientes                | `tenant-isolation.int.test.ts` |
| Contexto de una transacción anterior                                       | No persiste                   | `tenant-isolation.int.test.ts` |
| `row_security = off` con el rol de aplicación                              | Error, no lectura total       | `tenant-isolation.int.test.ts` |
| Petición HTTP a otra empresa                                               | 404                           | `tenant-context.e2e.test.ts`   |
| Listar o modificar membresías de otra empresa                              | 404                           | `access-mfa.e2e.test.ts`       |
| Membresía desactivada con sesión abierta                                   | 404                           | `access-mfa.e2e.test.ts`       |
| Autoasignarse un rol o RH asignando un rol administrativo                  | 403                           | `access-mfa.e2e.test.ts`       |
| Retirar al último propietario, también en concurrencia                     | 409; queda al menos uno       | `access-mfa.e2e.test.ts`       |
| Retirar al único propietario con credencial activa, con otro deshabilitado | 409; sin cambios ni auditoría | `access-mfa.e2e.test.ts`       |
| Contraseña correcta sin MFA en un rol administrativo                       | 403                           | `access-mfa.e2e.test.ts`       |
