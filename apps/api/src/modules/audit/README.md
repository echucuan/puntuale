# Módulo `audit`

> **Estado: Implementado (1.0-a).** La consulta de la bitácora por HTTP y la cadena de hashes quedan para pasos posteriores (ADR 0005).

## Propósito

Registrar quién cambió qué, cuándo, desde dónde y por qué, **en la misma transacción** que el cambio.

## Responsabilidades

- `AuditRepository.record(client, entry)`: inserta en `audit_event` con el cliente de la transacción del llamador.
- Validar la forma de la acción (`<modulo>.<entidad>.<verbo-en-pasado>`).
- **No** abre transacciones propias: si lo hiciera, la auditoría podría quedar sin el cambio o al revés.
- **No** expone endpoints en 1.0-a.

## Dependencias

| Depende de            | Para qué                             |
| --------------------- | ------------------------------------ |
| `@puntuale/contracts` | `AuditChannel`, `AuditActorType`     |
| Tabla `audit_event`   | Solo `INSERT` y `SELECT` (inmutable) |

## Reglas de negocio

1. **Misma transacción.** Si la operación se revierte, la auditoría también (ADR 0005, `audit.int.test.ts`).
2. **Inmutable.** El rol de aplicación no puede modificar ni borrar (`immutability.int.test.ts`).
3. **`id` es global y puede tener huecos.** No es por tenant ni es el único criterio de orden; se expone `public_id` y se ordena también por `recorded_at`.
4. En eventos sincronizados sin conexión, `request_ip` es la IP de la sincronización y `subject_occurred_at` guarda el momento declarado.

## Entradas y salidas

| Tipo            | Nombre                                  | Contrato                       |
| --------------- | --------------------------------------- | ------------------------------ |
| Función         | `AuditRepository.record(client, entry)` | `AuditEntry` → `RecordedAudit` |
| Endpoint        | No aplica en 1.0-a                      |                                |
| Acción auditada | La que indique el llamador              |                                |

## Pruebas relacionadas

| Archivo                                     | Qué verifica                                    |
| ------------------------------------------- | ----------------------------------------------- |
| `domain/audit-entry.test.ts`                | Forma de la acción                              |
| `test/integration/audit.int.test.ts`        | Reversión conjunta con la transacción principal |
| `test/integration/immutability.int.test.ts` | `UPDATE`, `DELETE` y `TRUNCATE` rechazados      |

## Cómo extenderlo

1. En el servicio que modifica datos, llama a `audit.record(client, ...)` con el **mismo** `client` de `withTenant`.
2. Nombra la acción `<modulo>.<entidad>.<verbo-en-pasado>` y regístrala en la tabla de acciones de `docs/business-rules/audit.md`.
3. No guardes en `before`/`after` secretos ni datos que no se necesiten para reconstruir el cambio.
