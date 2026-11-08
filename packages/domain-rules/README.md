# `@puntuale/domain-rules`

> **Estado: Implementado (1.0-a), parcial.** `buildWorkday` (formación de pares y asignación a jornadas) llega en el paso 1.0-d. Ver [`docs/architecture/planned-design-v1.md`](../../docs/architecture/planned-design-v1.md).

## Propósito

Reglas de dominio **puras y deterministas**: la misma entrada siempre produce la misma salida. No acceden a la red ni a la base de datos, y se prueban sin infraestructura.

## Responsabilidades

| Archivo                | Regla                                                                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `canonical-json.ts`    | JSON canónico (RFC 8785) y SHA-256 para los hashes de contenido                                                                                                                                        |
| `uuid-v7.ts`           | Generación y validación de UUIDv7 (para el cliente y las pruebas)                                                                                                                                      |
| `attendance-ingest.ts` | Hash de evidencia, clasificación `created`/`duplicate`/`conflict`, hora UTC derivada, desfase de reloj y detección de `CLOCK_SKEW` ([ADR 0011](../../docs/adr/0011-offline-ingest-and-idempotency.md)) |
| `attendance-status.ts` | Precedencia de los cuatro estados ([ADR 0012](../../docs/adr/0012-attendance-status-and-precedence.md))                                                                                                |
| `workday-key.ts`       | Identidad estable de una jornada, que no depende de los eventos                                                                                                                                        |
| `review-flags.ts`      | Planeación idempotente de alertas: una recomputación no duplica nada                                                                                                                                   |

## Dependencias

| Depende de            | Para qué                                                 |
| --------------------- | -------------------------------------------------------- |
| `@puntuale/contracts` | Tipos (`AttendanceStatus`, `AttendanceEventEvidence`, …) |
| `node:crypto`         | SHA-256. Por eso el hash solo se ejecuta en el servidor. |

## Reglas

1. **El hash de idempotencia cubre solo la evidencia.** Normaliza los UUID a minúsculas y la hora local a milisegundos fijos (`.SSS`).
2. **`CLOCK_SKEW` nunca rechaza un evento.** Solo lo marca para revisión cuando `|received_at − device_sent_at|` supera 300 s o la marcación está más de 120 s en el futuro. Que un evento sin conexión sea antiguo **no** cuenta como desfase.
3. **Precedencia de estados:** `needs_review` > `pending` > `incomplete` > `complete`.
4. **La llave natural de una jornada no recibe eventos.** Por eso una marcación tardía nunca cambia la identidad de una jornada.
5. **Una alerta se identifica por `(jornada, código, versión de reglas)`.** Volver a calcular no crea duplicados y cierra las alertas que ya no aplican.

## Entradas y salidas

Solo funciones. Ninguna tiene efectos secundarios, salvo `generateUuidV7`, que usa una fuente aleatoria.

## Pruebas relacionadas

Un archivo `*.test.ts` por módulo:

- `attendance-status.test.ts` cubre los 8 casos combinados de precedencia.
- `workday-key.test.ts` cubre la identidad ante eventos tardíos y los turnos nocturnos.
- `review-flags.test.ts` cubre la recomputación sin duplicados.
- `attendance-ingest.test.ts` cubre el hash, la clasificación y el desfase.

## Cómo extenderlo

1. Una regla nueva va en su propio archivo, como función pura, con sus tipos de entrada y salida explícitos.
2. Si la regla depende de valores configurables (umbrales, márgenes), recíbelos como parámetro con valores por defecto documentados. No los dejes fijos en el código.
3. Si la regla afecta resultados ya cerrados, versiónala (`rules_version`).
4. Pruébala con tablas de casos, incluidos los límites.
