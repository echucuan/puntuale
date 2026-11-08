# ADR 0013 · PostgreSQL 18 como versión oficial

- **Fecha:** 2026-11-08
- **Estado:** Aceptado

## Contexto

La propuesta técnica original ([histórica](../proposals/propuesta-tecnica-v1.md)) indicaba PostgreSQL 16. Al implementar el paso 1.0-a se usó PostgreSQL 18 ([ADR 0002](0002-modular-monolith-and-stack.md)). El arquitecto pidió registrar la decisión con sus versiones de desarrollo, CI y producción.

## Problema

¿Qué versión de PostgreSQL es la oficial y cuál es la mínima soportada?

## Alternativas consideradas

1. **PostgreSQL 16:** tiene más años de soporte de proveedores gestionados, pero no trae `uuidv7()`. Habría que generar UUIDv7 en la aplicación o instalar una extensión.
2. **PostgreSQL 17:** tampoco trae `uuidv7()` nativo.
3. **PostgreSQL 18:** trae `uuidv7()` nativo, que usa la migración `0001` como `DEFAULT` en todas las llaves primarias.

## Decisión

| Aspecto              | Versión                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------- |
| **Mínima soportada** | **PostgreSQL 18**. La migración `0001` usa `uuidv7()` y no corre en versiones anteriores. |
| Desarrollo local     | `postgres:18-alpine` (`infra/docker-compose.yml`)                                         |
| CI e integración     | `postgres:18-alpine` con Testcontainers (`db/src/testing.ts`)                             |
| Producción           | Un PostgreSQL 18 gestionado. El proveedor todavía no se elige (**Planificado**).          |

- Las funciones propias de PostgreSQL 18 que usa el esquema son `uuidv7()`. Todo lo demás (RLS, `FORCE ROW LEVEL SECURITY`, `citext`, triggers, índices parciales, `make_interval`) existe desde versiones anteriores.
- Cambiar de versión mayor requiere un ADR nuevo.

## Consecuencias

- Al elegir el proveedor de producción, debe ofrecer PostgreSQL 18 con soporte de `citext` y permitir un rol sin `BYPASSRLS` que no sea dueño de las tablas.
- Si el proveedor elegido no ofreciera la versión 18, habría que reemplazar `DEFAULT uuidv7()` por UUIDv7 generados en la aplicación (ya existe `generateUuidV7` en `@puntuale/domain-rules`), en una migración nueva y con su ADR.
