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

## Revisión del 2026-11-08 (revisión arquitectónica de 1.0-a)

- **`client_event_id` es obligatorio en toda marcación de la PWA**, tanto en línea como sin conexión. Lo exigen el contrato (`AttendanceEventEvidenceSchema`) y el CHECK `attendance_event_pwa_shape`.
- **Un `duplicate` no se audita:** no cambia datos. Se devuelve el evento original.
- **Un `conflict` se rechaza:** no sobrescribe nada y se audita como `time_tracking.attendance_event.rejected`, con `reason = 'client_event_id_conflict'` y el hash recibido. El evento guardado no cambia.
- **El hash cubre solo la evidencia.** Un reintento con otro `deviceSentAt` u otro `ingestMode` es `duplicate`, no `conflict`.
- **`received_at` lo fija la base de datos** (`statement_timestamp()`), nunca el dispositivo. El contrato de entrada no tiene ese campo y descarta cualquier campo desconocido ([ADR 0010](0010-time-and-language.md)).
- **`CLOCK_SKEW` en 1.0-a:** el caso de uso calcula y conserva `clock_offset_seconds`, clasifica el desfase (`DEVICE_CLOCK_OFFSET`, `FUTURE_EVENT`) y devuelve esa clasificación, pero no la persiste ni rechaza el evento. La alerta persistida llega en 1.0-d.

## Consecuencias

- Reintentar un envío es seguro.
- En el paso 1.0-a, la detección de `CLOCK_SKEW` es una función pura con pruebas. Guardar la alerta en la tabla `review_flag` llega en el paso 1.0-d.
