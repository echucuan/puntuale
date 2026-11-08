# Módulo `tenancy`

> **Estado: Parcial (1.0-a).** Ya existen el `TenantGuard`, la resolución de membresía y `GET /api/t/:tenantId/context`. La autenticación real (sesiones, login) llega en 1.0-b (ADR 0007).

## Propósito

Decidir, en cada petición, **qué empresa** se pide y **si la persona de la sesión pertenece a ella**, antes de que cualquier otro módulo toque datos.

## Responsabilidades

- `TenantGuard`: protege toda ruta `/api/t/:tenantId/...`.
- `TenantAccessService`: valida la membresía activa contra la base, dentro de `withTenant`.
- Puerto `SessionResolver`. El módulo registra **siempre** `NoSessionResolver`. El adaptador de pruebas (`TestSessionResolver`) no es parte del módulo: vive en `apps/api/test/support/` (ver la regla 4).
- **No** autentica personas ni emite sesiones: eso es del módulo `identity` (1.0-b).
- **No** gestiona roles ni permisos finos (1.0-b).

## Dependencias

| Depende de                           | Para qué                                      |
| ------------------------------------ | --------------------------------------------- |
| `database` (`PG_POOL`, `withTenant`) | Consultar la membresía con contexto de tenant |
| `@puntuale/contracts`                | `TenantContextResponse`                       |
| Tablas `tenant`, `user_tenant`       | Membresía activa en empresa activa            |

## Reglas de negocio

1. **Sin sesión → 401.** No se consulta la base (ADR 0003, `tenant.guard.test.ts`).
2. **Sin membresía activa, empresa inactiva o inexistente, o identificador que no es UUID → 404.** Los casos no se distinguen desde fuera (`tenant-context.e2e.test.ts`).
3. **La URL nunca concede acceso.** El contexto que usa el resto de la API es el que validó el guard, no el parámetro (`tenant.guard.test.ts`).
4. **Sin atajos de sesión en la aplicación.** El módulo productivo usa `NoSessionResolver` con cualquier `NODE_ENV`. `TestSessionResolver` solo se registra con la composición explícita de pruebas (`test/support/create-test-app.ts`) y exige `NODE_ENV=test`, `VITEST=true`, `PUNTUALE_TEST_COMPOSITION=explicit-test-composition` y una base local (ADR 0007, `session-resolver.test.ts`, `test/unit/test-session.resolver.test.ts`).
5. La consulta de membresía corre dentro de `withTenant`: la RLS es una segunda barrera.

## Entradas y salidas

| Tipo            | Nombre                                                | Contrato                                             |
| --------------- | ----------------------------------------------------- | ---------------------------------------------------- |
| Endpoint        | `GET /api/t/:tenantId/context`                        | `TenantContextResponseSchema`, `ApiErrorSchema`      |
| Encabezado      | `x-test-user-id` (solo con la composición de pruebas) | UUID del usuario; la aplicación productiva lo ignora |
| Evento emitido  | No aplica (solo lectura)                              |                                                      |
| Acción auditada | No aplica (no modifica datos)                         |                                                      |

## Pruebas relacionadas

| Archivo                                         | Qué verifica                                                                                                      |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `presentation/tenant.guard.test.ts`             | 401, 404 y contexto validado (unitaria)                                                                           |
| `infrastructure/session-resolver.test.ts`       | El módulo productivo usa `NoSessionResolver` con cualquier `NODE_ENV`; `src/` no contiene el adaptador de pruebas |
| `test/unit/test-session.resolver.test.ts`       | Cada condición que exige el adaptador de pruebas                                                                  |
| `test/e2e/tenant-context.e2e.test.ts`           | 401, 404 entre empresas, inválido, revocado y 200; 401 con la composición productiva aunque llegue el encabezado  |
| `test/integration/tenant-isolation.int.test.ts` | RLS con el rol de aplicación                                                                                      |

## Cómo extenderlo

1. Una ruta nueva de empresa va bajo `t/:tenantId/...` con `@UseGuards(TenantGuard)` y lee el contexto con `@CurrentTenant()`.
2. Para acceder a datos, usa `withTenant(pool, tenant.tenantId, ...)` con el `tenantId` del contexto, nunca el del cuerpo o la URL.
3. Un resolvedor de sesión nuevo implementa `SessionResolver` y se registra en `session-resolver.provider.ts`. Nunca agregues a `src/` uno que acepte identidades sin verificar; los dobles de prueba van en `test/support/`.
