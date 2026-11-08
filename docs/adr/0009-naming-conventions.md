# ADR 0009 · Convenciones de nombres

- **Fecha:** 2026-11-07
- **Estado:** Aceptado

## Contexto

El código debe poder mantenerlo cualquier desarrollador. Si los nombres son inconsistentes, cuesta encontrar los archivos y las reglas.

## Problema

¿Qué convenciones seguimos para nombrar archivos, código, tablas, endpoints, eventos y permisos?

## Alternativas consideradas

1. **Convenciones implícitas:** cada quien nombra a su manera.
2. **Convenciones explícitas y documentadas,** aplicadas por el lint y la revisión de código.

## Decisión

Se adoptan las convenciones de [`docs/architecture/conventions.md`](../architecture/conventions.md). En resumen:

- Identificadores en inglés y textos de la interfaz en español.
- Archivos en `kebab-case` con sufijo de rol, por ejemplo `tenant-context.guard.ts`.
- Tablas en `snake_case` y en singular.
- Endpoints en `kebab-case` y en plural, bajo `/api/t/:tenantId/`.
- Eventos con la forma `<módulo>.<entidad>.<verbo-en-pasado>`.
- Permisos con la forma `<módulo>.<acción>`.

## Consecuencias

- La revisión de código verifica que se respeten.
- Cambiar una convención requiere un ADR nuevo.
