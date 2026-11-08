# ADR 0012 · Cuatro estados de asistencia, con precedencia explícita y dimensiones separadas

- **Fecha:** 2026-11-07
- **Estado:** Aceptado. Reemplaza la propuesta C (el estado “justificada”), que fue rechazada.

## Contexto

Una jornada puede estar en curso, incompleta, por revisar o completa. Además tiene incidencias, correcciones, aclaraciones, revisión y cierre, y cada uno de esos elementos tiene su propio ciclo de vida.

## Problema

¿Cuántos estados de asistencia hay? ¿Cuál prevalece cuando se combinan varias condiciones? ¿Dónde se registra una ausencia justificada?

## Alternativas consideradas

1. **Un quinto estado, `justified`:** se rechazó, porque describe cómo se resolvió una incidencia y no qué tan completa está la asistencia. Una jornada puede estar incompleta y, al mismo tiempo, tener una ausencia justificada aprobada.
2. **Cuatro estados más dimensiones separadas.**

## Decisión

- `attendance_status` admite exactamente cuatro valores: `pending`, `incomplete`, `needs_review` y `complete`. En la interfaz se muestran como “Pendiente”, “Incompleta”, “Por revisar” y “Completa”.
- **Precedencia única.** Está implementada en `packages/domain-rules` (`resolveAttendanceStatus`) y tiene pruebas de los casos combinados:
  1. `needs_review`, si hay una alerta, una corrección o una aclaración abierta;
  2. `pending`, si la ventana del turno sigue abierta;
  3. `incomplete`, si la ventana ya cerró y faltan pares de entrada y salida;
  4. `complete`, en cualquier otro caso (pares válidos y nada abierto).
- **Dimensiones separadas (planificadas):**
  - `review_status`;
  - `incident.status`: `detected`, `requested`, `in_clarification`, `resolved_justified`, `resolved_unjustified` o `cancelled`;
  - `correction.status`;
  - el bloqueo por cierre, que se calcula.
- **Ausencia justificada:** es una incidencia `ABSENCE` con `status = resolved_justified`, que registra quién la resolvió, cuándo, el motivo y la evidencia. `JUSTIFIED_ABSENCE` es una clasificación **derivada** que aparece en los reportes.

## Consecuencias

- Una ausencia justificada sigue mostrando la jornada como `incomplete`, o como `needs_review` mientras haya algo abierto. El reporte la clasifica por separado.
- Cambiar la precedencia requiere un ADR nuevo y actualizar las pruebas de los casos combinados.
