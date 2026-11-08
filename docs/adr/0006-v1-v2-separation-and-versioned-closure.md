# ADR 0006 · Separación entre V1 y V2, con el cierre de periodo versionado como contrato

- **Fecha:** 2026-11-07
- **Estado:** Aceptado

## Contexto

La V1 controla la asistencia y no maneja dinero. La V2 agregará la nómina. El riesgo es que la nómina se filtre al núcleo de asistencia o que la V2 modifique datos de la V1.

## Problema

¿Cómo se prepara la V1 para la V2 sin construir nada de nómina?

## Alternativas consideradas

1. **La V2 lee directamente las tablas vivas de la V1:** las versiones quedan acopladas y los resultados cambian si cambian los datos.
2. **Agregar desde ya a la V1 campos de nómina “para después”:** se sale del alcance y expone datos sensibles sin necesidad.
3. **Un contrato explícito:** el cierre de periodo, inmutable y versionado, más eventos de dominio.

## Decisión

- La V2 consumirá únicamente `period_closure` (planificado para el paso 1.0-e).
  - Es un snapshot que guarda `snapshot_schema_version`, `rules_version`, `contract_version`, `generated_at` y `content_hash` (SHA-256 del JSON canónico, según RFC 8785).
  - Su estructura se valida con un esquema Zod.
  - Incluye el calendario, las asignaciones, los horarios y las reglas que se usaron.
- **La versión vigente de un cierre se calcula** como `max(version)` de su periodo. No hay columna `superseded_by`, porque actualizarla rompería la inmutabilidad.
- Reabrir un periodo es una acción explícita, autorizada y auditada, que produce el cierre `v+1`.
- En la V1 no existe ningún módulo, tabla, endpoint ni lógica de nómina. Ver [`docs/versions/v2-boundary.md`](../versions/v2-boundary.md).

## Consecuencias

- La V2 se podrá desarrollar sin tocar las tablas de la V1.
- El formato del snapshot se vuelve una API pública interna: cualquier cambio obliga a subir `contract_version`.
