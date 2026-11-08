# Riesgos del registro sin conexión

> **Estado: Planificado** para el paso 1.0-d. Solo el contrato y la idempotencia ya están implementados (1.0-a, ver [ADR 0011](../adr/0011-offline-ingest-and-idempotency.md)). Este documento existe desde ahora, a petición del arquitecto, para que los riesgos se conozcan antes de construir la cola.

## Principio

La hora que declara el dispositivo es **evidencia de lo que el dispositivo dice**, no una fuente confiable. El servidor nunca la corrige ni la descarta: la conserva, calcula el desfase y, si algo no cuadra, **pide revisión humana**.

## Riesgos y mitigaciones

| Riesgo | Escenario | Mitigación |
|---|---|---|
| **Reloj manipulado o incorrecto** | El colaborador adelanta o atrasa el reloj del teléfono antes de registrar. | `clock_offset_seconds = received_at − device_sent_at`. Si el valor absoluto supera `clock_skew_threshold` o la hora declarada está en el futuro, se genera la alerta `CLOCK_SKEW` y la jornada queda en `needs_review`. Nunca se rechaza el evento. Se conserva `received_at`, la hora confiable del servidor. |
| **Datos alterados en IndexedDB** | Alguien edita la cola local para fabricar o modificar eventos antes de sincronizar. | Cada evento conserva `payload_hash`. Un `client_event_id` repetido con otro contenido devuelve 409 y queda auditado. Los eventos más antiguos que `max_offline_age` (72 h por defecto) requieren revisión. El envío exige la sesión del colaborador y se audita cada lote. **Riesgo residual:** un evento fabricado antes de su primer envío no se puede detectar técnicamente; se mitiga con revisión, alertas y conformidad. |
| **Duplicados por reintento** | La red se cae después de que el servidor guardó el evento y el cliente reintenta. | Índice único `(tenant_id, client_event_id)`. Si el hash coincide, el servidor responde 200 con `duplicate: true` y el evento original. |
| **Sincronización parcial** | Un lote de 20 eventos falla a la mitad. | Cada evento recibe su propio resultado; el cliente reintenta solo los que fallaron, con espera exponencial. |
| **Pérdida del dispositivo** | Se pierde el teléfono con eventos aún sin enviar. | Esos eventos se pierden y no se pueden recuperar. Se puede revocar la sesión. IndexedDB guarda el mínimo de datos necesario: nada de catálogos de otros colaboradores. |
| **Respuesta tras un conflicto** | El servidor responde 409. | El cliente marca el evento como `conflict` y no lo reintenta. Un supervisor lo revisa. |
| **Evento para un periodo ya cerrado** | La sincronización llega después del cierre. | El evento se guarda como evidencia, el cierre no cambia y se genera `LATE_EVENT_AFTER_CLOSE` para RH, que decide si reabre. |

## Qué no se promete

Puntuale no puede garantizar técnicamente la veracidad de la hora declarada por un dispositivo sin conexión. Lo que hace es dejar visible cualquier inconsistencia y que una persona la revise. Esto se documenta como **limitación técnica**, no como interpretación legal.
