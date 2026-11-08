# ADR 0005 · La auditoría se escribe en la misma transacción que el cambio

- **Fecha:** 2026-11-07
- **Estado:** Aceptado

## Contexto

La auditoría debe registrar quién cambió qué, cuándo, desde dónde y por qué. Si existe un registro de auditoría sin el cambio, o un cambio sin su registro, la bitácora pierde validez.

## Problema

¿Dónde y en qué momento se escribe la auditoría para que siempre coincida con los datos?

## Alternativas consideradas

1. **Logs técnicos de la aplicación:** no son transaccionales, son difíciles de consultar y se pueden perder.
2. **Triggers genéricos en la base de datos:** no conocen al actor, el motivo, el canal ni la IP.
3. **Inserción desde la capa de aplicación, dentro de la misma transacción.**

## Decisión

- `audit_event` se inserta con el mismo cliente y en la misma transacción que la operación. Si la transacción se revierte, la auditoría también.
- **Campos:**
  - actor y tipo de actor;
  - `channel`: `online`, `offline_sync`, `job` o `system`;
  - acción, con la forma `<módulo>.<entidad>.<verbo-en-pasado>`;
  - entidad, valores anterior y posterior, y motivo;
  - `request_ip`, `user_agent` y `request_id`;
  - `subject_occurred_at` y `recorded_at`.
- **En los eventos sincronizados desde un dispositivo sin conexión, `request_ip` es la IP desde la que se sincronizó**, no la del momento original del evento. Ese momento declarado se guarda en `subject_occurred_at`.
- **Inmutable:** el rol de la aplicación solo tiene `INSERT` y `SELECT`, y un trigger rechaza `UPDATE`, `DELETE` y `TRUNCATE`.
- **Identificación:**
  - `id bigint generated always as identity` es una secuencia **global**. **Puede tener huecos**, **no es una secuencia por tenant** y **no debe usarse como único criterio de orden lógico**.
  - `public_id` (UUIDv7) es el identificador que se expone.
  - `recorded_at` (`clock_timestamp()`) guarda el momento del registro.
  - Se descartó una secuencia por tenant porque requiere bloqueos que obligan a las escrituras concurrentes a esperar turno.

## Consecuencias

- Todo servicio que modifique datos debe llamar al servicio de auditoría dentro de su transacción. Esto lo vigilan las pruebas y la revisión de código.
- La cadena de hashes contra alteraciones queda **fuera del paso 1.0-a** y se evaluará en la 1.x.
