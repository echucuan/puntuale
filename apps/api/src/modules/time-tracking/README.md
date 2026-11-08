# Módulo `time-tracking`

> **Estado: Parcial (1.0-a).** Solo existe el caso de uso de ingesta idempotente, sin endpoint HTTP. El endpoint, la cola sin conexión de la PWA y la alerta `CLOCK_SKEW` persistida llegan en 1.0-d.

## Propósito

Registrar marcaciones de entrada y salida como evidencia inmutable, sin duplicarlas cuando un dispositivo reintenta.

## Responsabilidades

- `IngestAttendanceEventService.ingest(context, input)`: valida el contrato, deriva los campos de tiempo, inserta de forma idempotente y audita.
- `AttendanceEventRepository`: `INSERT ... ON CONFLICT DO NOTHING` y lectura por `client_event_id`.
- **No** forma pares ni jornadas (1.0-d, `@puntuale/domain-rules`).
- **No** corrige marcaciones (las correcciones son eventos nuevos, 1.0-e).

## Dependencias

| Depende de                  | Para qué                                                      |
| --------------------------- | ------------------------------------------------------------- |
| `audit` (`AuditRepository`) | Auditoría en la misma transacción                             |
| `database` (`withTenant`)   | Transacción con contexto de tenant                            |
| `@puntuale/contracts`       | `AttendanceEventInputSchema`, `IngestResult`                  |
| `@puntuale/domain-rules`    | Hash de evidencia, clasificación, hora UTC derivada y desfase |
| Tabla `attendance_event`    | Solo `INSERT` y `SELECT`                                      |

## Reglas de negocio

1. **Mismo `client_event_id` y mismo hash → `duplicate`.** Devuelve la marcación original y no escribe nada (ADR 0011).
2. **Mismo `client_event_id` y otro hash → `conflict`.** No sobrescribe; audita `time_tracking.attendance_event.rejected`.
3. **El hash cubre solo la evidencia.** Cambiar `deviceSentAt` o `ingestMode` en un reintento no es conflicto.
4. **`received_at` es la hora del servidor** y la referencia confiable; `occurred_at_utc` se deriva de lo declarado y solo sirve para ordenar (ADR 0010).
5. **Un empleado de otra empresa no existe** para este tenant: la FK compuesta lo impide y se traduce a `EmployeeNotFoundError`.
6. Dos envíos simultáneos con la misma llave producen una sola fila.

## Entradas y salidas

| Tipo            | Nombre                                    | Contrato                                |
| --------------- | ----------------------------------------- | --------------------------------------- |
| Caso de uso     | `IngestAttendanceEventService.ingest`     | `AttendanceEventInput` → `IngestResult` |
| Endpoint        | No aplica en 1.0-a (llega en 1.0-d)       |                                         |
| Acción auditada | `time_tracking.attendance_event.recorded` | Al crear                                |
| Acción auditada | `time_tracking.attendance_event.rejected` | Al rechazar por conflicto               |

## Pruebas relacionadas

| Archivo                               | Qué verifica                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------ |
| `test/integration/ingest.int.test.ts` | Creado, duplicado, conflicto, reintento con otro transporte, concurrencia y empleado ajeno |

## Cómo extenderlo

1. El endpoint de 1.0-d va en `presentation/`, bajo `t/:tenantId/...` con `TenantGuard`, y solo traduce el `IngestResult` a 201, 200 o 409.
2. Toda regla nueva de tiempo va en `@puntuale/domain-rules` como función pura, no en el servicio.
3. Nunca agregues `UPDATE` ni `DELETE` sobre `attendance_event`.
