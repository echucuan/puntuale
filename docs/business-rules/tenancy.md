# Regla: aislamiento entre empresas

> **Estado: Implementado (1.0-a).** Decisión en [ADR 0003](../adr/0003-tenant-is-company-with-fail-closed-rls.md). Código en `apps/api/src/modules/tenancy/` y `db/migrations/0001_base_multitenant.sql`.

## Reglas

1. **Un tenant es una empresa** (razón social). Una persona (`app_user`) puede pertenecer a varias mediante `user_tenant`.
2. **La autorización ocurre en la aplicación.** `TenantGuard` exige sesión (401) y membresía activa en una empresa activa (404). El `tenantId` de la URL solo dice qué se pide; nunca concede acceso.
3. **La RLS es una defensa adicional.** Cada transacción fija `app.tenant_id` con `set_config(..., true)`. Las políticas comparan con `app_current_tenant()`.
4. **Falla cerrada.** Sin contexto, o con un valor que no es UUID, `app_current_tenant()` devuelve `NULL`: las consultas devuelven 0 filas sin error y las inserciones se rechazan.
5. **Llaves compuestas.** Una fila solo puede referirse a otra de la misma empresa: `(tenant_id, x_id)`.
6. **`tenant_id` no cambia** después de crear la fila.
7. **El rol de aplicación** (`puntuale_app`) no es superusuario, no tiene `BYPASSRLS` y no es dueño de tablas.

## Casos probados

| Caso                                                     | Resultado esperado           | Prueba                         |
| -------------------------------------------------------- | ---------------------------- | ------------------------------ |
| Leer filas de B desde A                                  | 0 filas                      | `tenant-isolation.int.test.ts` |
| Actualizar o borrar filas de B desde A                   | 0 filas afectadas; B intacto | `tenant-isolation.int.test.ts` |
| Insertar con el `tenant_id` de B desde A                 | Rechazado (`42501`)          | `tenant-isolation.int.test.ts` |
| Marcación de A con un empleado de B                      | `EmployeeNotFoundError` (FK) | `tenant-isolation.int.test.ts` |
| Sin contexto                                             | 0 filas; inserción rechazada | `tenant-isolation.int.test.ts` |
| `tenant_id` inválido (texto, vacío, inyección, truncado) | 0 filas sin error            | `tenant-isolation.int.test.ts` |
| Mismos números y `client_event_id` en A y B              | Independientes               | `tenant-isolation.int.test.ts` |
| Contexto de una transacción anterior                     | No persiste                  | `tenant-isolation.int.test.ts` |
| `row_security = off` con el rol de aplicación            | Error, no lectura total      | `tenant-isolation.int.test.ts` |
| Petición HTTP a otra empresa                             | 404                          | `tenant-context.e2e.test.ts`   |
