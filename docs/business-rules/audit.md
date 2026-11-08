# Regla: auditoría transaccional

> **Estado: Implementado (1.0-a).** Decisión en [ADR 0005](../adr/0005-transactional-audit.md). Código en `apps/api/src/modules/audit/`.

## Regla

Todo cambio de datos inserta un `audit_event` **con el mismo cliente y en la misma transacción**. Si la transacción se revierte, no queda auditoría; si se confirma, el cambio y su auditoría quedan juntos.

## Acciones registradas

| Acción                                    | Módulo          | Cuándo                                                       | Canal                     |
| ----------------------------------------- | --------------- | ------------------------------------------------------------ | ------------------------- |
| `time_tracking.attendance_event.recorded` | `time-tracking` | Se crea una marcación                                        | `online` o `offline_sync` |
| `time_tracking.attendance_event.rejected` | `time-tracking` | Un `client_event_id` repetido llega con otra evidencia (409) | `online` o `offline_sync` |

Un `duplicate` (reintento idéntico) **no** se audita: no cambia datos.

## Campos clave

- `id`: secuencia global; puede tener huecos; no es por tenant; no es el único criterio de orden.
- `public_id`: UUIDv7 que se expone fuera de la base.
- `recorded_at`: `clock_timestamp()` del servidor.
- `subject_occurred_at`: el momento declarado del hecho (por ejemplo, la marcación sin conexión).
- `request_ip`: en sincronizaciones sin conexión, la IP de la sincronización.

## Pruebas

- `apps/api/test/integration/audit.int.test.ts`: reversión conjunta, confirmación conjunta y rechazo de auditar en otra empresa.
- `apps/api/test/integration/ingest.int.test.ts`: acciones `recorded` y `rejected`, y la ausencia de auditoría en `duplicate`.
- `apps/api/test/integration/immutability.int.test.ts`: la bitácora no se puede modificar.
