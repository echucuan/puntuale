# ADR 0011 · Ingesta sin conexión e idempotencia por `client_event_id`

- **Fecha:** 2026-11-07
- **Estado:** Aceptado. **En el paso 1.0-a se implementan el contrato, la persistencia y las pruebas.** La interfaz y la cola sin conexión están planificadas para el paso 1.0-d.

## Contexto

Los colaboradores pueden registrar su asistencia sin conexión. El mismo evento puede reenviarse varias veces, y el reloj del dispositivo puede estar mal o haber sido manipulado.

## Problema

¿Cómo se evitan los duplicados, cómo se responde siempre de la misma forma ante un mismo envío y qué valor tiene la hora del dispositivo?

## Alternativas consideradas

1. **Detectar duplicados por contenido** (empleado y hora): falla cuando hay dos eventos legítimos parecidos.
2. **Un identificador generado por el cliente, más un hash del contenido original.**
3. **Rechazar los eventos con reloj sospechoso:** se pierde evidencia y se castiga al colaborador.

## Decisión

- **Identificador:** cada evento del dispositivo lleva un `client_event_id` (un UUID generado en el dispositivo). Lo respalda el índice único parcial `UNIQUE (tenant_id, client_event_id) WHERE client_event_id IS NOT NULL`.
- **Hash:** `payload_hash` es el SHA-256 de la serialización canónica del contenido original.
- **Respuestas, siempre las mismas ante el mismo envío:**
  - **creado** (HTTP 201) si el evento es nuevo;
  - **duplicado** (HTTP 200, con `duplicate: true` y el evento existente) si coinciden el ID y el hash;
  - **conflicto** (HTTP 409, con el evento existente) si coincide el ID pero el hash es distinto. Los conflictos se auditan.
- **Envíos simultáneos:** `INSERT ... ON CONFLICT DO NOTHING` seguido de una lectura del evento existente.
- **La hora del dispositivo es evidencia declarada, no una fuente confiable:**
  - El desfase se calcula como `clock_offset_seconds = received_at − device_sent_at`.
  - Se marca `CLOCK_SKEW` para revisión si el desfase, en valor absoluto, supera `clock_skew_threshold_seconds` (300 por defecto), o si el evento declara una hora futura más allá de la tolerancia.
  - **El evento nunca se rechaza.**
- **Estados de sincronización:**
  - en el cliente: `queued`, `sending`, `synced`, `conflict` y `failed`;
  - en el servidor, el evento existe a partir de `received_at`, con su `ingest_mode` (`online` u `offline_sync`).
- Los riesgos de manipulación del reloj y de IndexedDB están descritos en [`docs/security/offline.md`](../security/offline.md).

## Consecuencias

- Reintentar un envío es seguro.
- En el paso 1.0-a, la detección de `CLOCK_SKEW` es una función pura con pruebas. Guardar la alerta en la tabla `review_flag` llega en el paso 1.0-d.
