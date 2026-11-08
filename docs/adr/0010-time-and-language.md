# ADR 0010 · Manejo del tiempo e idioma

- **Fecha:** 2026-11-07
- **Estado:** Aceptado

## Contexto

Algunas jornadas cruzan la medianoche. México tiene varias zonas horarias, y los municipios fronterizos usan horario de verano. Los registros hechos sin conexión llegan tarde y con la hora de un reloj que no está validado.

## Problema

¿Cómo se guarda y se interpreta el tiempo? ¿En qué idioma se escribe el código?

## Alternativas consideradas

1. **Guardar solo la hora local, sin zona:** es ambigua y falla con los cambios de horario.
2. **Guardar solo la hora UTC:** se pierde la hora local que declaró el dispositivo.
3. **Guardar por separado, con nombres explícitos, la hora UTC, la hora local declarada, el desfase y la zona IANA.**

## Decisión

- Los instantes se guardan como `timestamptz` (UTC) y las zonas horarias como identificadores IANA (`America/Mexico_City`), nunca como abreviaturas del tipo “CST”.
- Cada marcación guarda estos datos por separado (detalle en [ADR 0011](0011-offline-ingest-and-idempotency.md)):
  - la **hora local declarada** (`declared_local_time`);
  - el **desfase declarado** (`declared_utc_offset_minutes`);
  - la **zona declarada** (`declared_timezone`);
  - la **hora UTC derivada** (`occurred_at_utc`), cuya consistencia garantiza un `CHECK`;
  - la **hora de envío** que declara el dispositivo (`device_sent_at`);
  - la **hora en que la recibe el servidor** (`received_at`);
  - el **desfase de reloj calculado** (`clock_offset_seconds`).
- **`occurred_at_utc` viene de un reloj que no está validado.** Sirve para **ordenar** los eventos de una jornada, pero no se presenta como hora confiable. La hora confiable para **auditoría** es `received_at`.
- La fecha operativa de una jornada es la fecha local en que **empieza** el turno.
- Los identificadores técnicos van en inglés; los textos de la interfaz, en español.

## Consecuencias

- Las consultas siempre indican en qué zona se interpreta la hora.
- Las pruebas cubren los cambios de día y los turnos nocturnos a partir del paso 1.0-d.
