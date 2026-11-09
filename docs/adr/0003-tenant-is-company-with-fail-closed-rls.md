# ADR 0003 · Cada empresa es un tenant, con autorización en la aplicación y RLS que falla cerrada

- **Fecha:** 2026-11-07
- **Estado:** Aceptado. Reemplaza la decisión D11 de la propuesta histórica (“una cuenta agrupa varias empresas”).

## Contexto

Puntuale guarda los datos laborales de varias empresas en la misma base de datos. Una fuga de datos entre empresas sería el peor incidente posible. Además, un mismo usuario puede trabajar con varias empresas; por ejemplo, un despacho de RH.

## Problema

¿Cuál es la unidad de aislamiento? ¿Cómo se determina y se valida la empresa activa sin confiar en lo que envía el cliente?

## Alternativas consideradas

1. **Una cuenta que agrupa varias empresas** (propuesta original): permitiría reportes consolidados por grupo, pero agrega un nivel de tenancy que la V1 no necesita.
2. **Una base de datos o un esquema por empresa:** el aislamiento es fuerte, pero se opera mal con muchas empresas y complica las migraciones.
3. **Tenant = empresa:** una columna `tenant_id`, autorización en la aplicación y RLS como defensa adicional.

## Decisión

- **El tenant es una empresa o una entidad legal independiente.** Puede tener varios centros de trabajo, áreas y calendarios. La consolidación entre empresas **queda fuera de la V1**.
- **`tenant_id`:** lo genera el servidor (UUIDv7) al crear la empresa. Toda tabla operativa lo incluye, y forma parte de las llaves foráneas compuestas `(tenant_id, x_id)` y de las restricciones de unicidad.
- **La autorización principal ocurre en la aplicación.** Las rutas tienen la forma `/api/t/:tenantId/...`, y el `TenantGuard` hace tres comprobaciones:
  1. Resuelve el usuario de la sesión. Si no hay sesión, responde **401**.
  2. Valida el formato de `:tenantId`.
  3. Busca un `user_tenant` activo para ese usuario y ese tenant. Si no existe, responde **404**, para no revelar si la empresa existe.

  **La URL nunca da acceso por sí sola.**

- **RLS como defensa adicional que falla cerrada:**
  - Cada transacción fija `app.tenant_id` con `set_config(..., true)`, el equivalente a `SET LOCAL`.
  - `app_current_tenant()` devuelve `NULL`, sin lanzar errores, cuando la variable falta o no es un UUID válido.
  - Las políticas comparan `tenant_id = app_current_tenant()`. Como `x = NULL` nunca es verdadero, sin un contexto válido no se ve ninguna fila y no se puede escribir nada.
  - Las tablas tienen `FORCE ROW LEVEL SECURITY`. La aplicación se conecta con el rol `puntuale_app`, que no es dueño de las tablas ni superusuario.
- **`tenant_id` no se puede modificar:** el rol de la aplicación no tiene privilegio de `UPDATE` sobre esa columna, y un trigger rechaza cualquier cambio.
- **Cambio de empresa:** el usuario navega a la ruta `/t/:otroTenantId`. El endpoint para listar membresías (`GET /api/me/tenants`) está **planificado** para el paso 1.0-b.

## Consecuencias

- Dos pestañas pueden trabajar con empresas distintas sin interferir entre sí.
- Si la aplicación falla (por ejemplo, alguien olvida un filtro), la RLS contiene el error; si falla la RLS, lo contiene el guard.
- Los reportes consolidados por grupo requerirían un ADR nuevo.
- El alcance por centro o área **no** lo cubre la RLS de tenant. Lo resolverá una `ScopePolicy` en la aplicación, con sus pruebas, cuando existan esas entidades. En 1.0-b.2 solo existe el alcance de empresa ([ADR 0015](0015-access-control-and-mfa.md)).
