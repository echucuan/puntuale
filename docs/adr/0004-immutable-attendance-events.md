# ADR 0004 · Las marcaciones son eventos inmutables y las correcciones son eventos nuevos

- **Fecha:** 2026-11-07
- **Estado:** Aceptado

## Contexto

Las marcaciones de entrada y salida son la evidencia principal de la asistencia. Si se editan o se borran, esa evidencia se pierde y ya no se puede reconstruir lo que pasó.

## Problema

¿Cómo se permiten correcciones sin perder el valor original?

## Alternativas consideradas

1. **Editar la fila y guardar el valor anterior en la auditoría:** el valor vigente y su historial terminan en lugares distintos.
2. **Una bandera `voided` mutable en el evento** (propuesta original): sigue siendo una modificación dentro de una tabla que debía ser inmutable.
3. **Solo inserciones:** una corrección crea un evento nuevo con `supersedes_event_id`, o una anulación ligada a la corrección. El conjunto efectivo de marcaciones se calcula.

## Decisión

- El rol `puntuale_app` solo tiene `INSERT` y `SELECT` sobre `attendance_event`.
- Como defensa adicional, los triggers `BEFORE UPDATE OR DELETE` y `BEFORE TRUNCATE` lanzan una excepción para cualquier rol.
- Una corrección (planificada para el paso 1.0-f) inserta un evento nuevo con `source = 'correction'` y `supersedes_event_id`. Guarda quién la hizo, cuándo, por qué y qué valor reemplaza.
- La jornada (`workday`) es una **proyección derivada** que se puede recalcular. Su duración no es fuente de verdad.

## Consecuencias

- El historial completo siempre está disponible.
- El cálculo del conjunto efectivo debe ser determinista y estar probado (paso 1.0-d).
- La tabla solo crece. Se acepta; el particionamiento se evaluará cuando el volumen lo justifique.
