# `@puntuale/contracts`

> **Estado: Implementado (1.0-a).**

## Propósito

Única fuente de verdad de los tipos, las enumeraciones y los esquemas Zod que comparten la API y la web. Si un contrato cambia aquí, TypeScript marca a todos sus consumidores.

## Responsabilidades

- Enumeraciones con los mismos valores que los `CHECK` de la base de datos (`enums.ts`).
- Validación de tiempo: zona IANA, hora local sin zona, instante con zona y desfase UTC (`time.ts`, [ADR 0010](../../docs/adr/0010-time-and-language.md)).
- Contrato de la marcación, que separa **evidencia** de **transporte** (`attendance-event.ts`, [ADR 0011](../../docs/adr/0011-offline-ingest-and-idempotency.md)).
- Contratos HTTP: `HealthResponse`, `TenantContextResponse` y `ApiError` (`api.ts`).

**No** contiene lógica de negocio. Eso vive en `@puntuale/domain-rules`.

## Dependencias

| Depende de | Para qué                   |
| ---------- | -------------------------- |
| `zod` 4    | Esquemas y tipos inferidos |

## Reglas

1. `attendance_status` tiene exactamente cuatro valores: `pending`, `incomplete`, `needs_review` y `complete` ([ADR 0012](../../docs/adr/0012-attendance-status-and-precedence.md)).
2. Las zonas horarias deben tener la forma IANA `Área/Ubicación` (o `UTC`). Se rechazan alias como `CST`.
3. `declaredLocalTime` no lleva zona ni desfase; `deviceSentAt` sí debe llevarlos.
4. Los metadatos de una marcación son controlados: como máximo 20 claves `snake_case`, con valores escalares y sin anidar.
5. El hash de idempotencia se calcula **solo sobre la evidencia** (`AttendanceEventEvidenceSchema`), nunca sobre los campos de transporte.

## Entradas y salidas

| Exporta                                                                 | Descripción                                       |
| ----------------------------------------------------------------------- | ------------------------------------------------- |
| `AttendanceEventInputSchema`                                            | Entrada de una marcación (evidencia + transporte) |
| `AttendanceEventRecordSchema`                                           | Marcación persistida                              |
| `IngestResultSchema`                                                    | `created`, `duplicate` o `conflict`               |
| `HealthResponseSchema`, `TenantContextResponseSchema`, `ApiErrorSchema` | Contratos HTTP                                    |
| `ATTENDANCE_STATUSES`, `ATTENDANCE_STATUS_LABELS_ES`, …                 | Enumeraciones y etiquetas                         |

## Pruebas relacionadas

`src/contracts.test.ts`: los estados y sus etiquetas, la validación de horas y zonas, los metadatos, la separación entre evidencia y transporte, y los códigos de error.

## Cómo extenderlo

1. Agrega el esquema en el archivo que corresponda (o en uno nuevo), exporta el esquema y su tipo inferido, y reexpórtalo en `src/index.ts`.
2. Si es una enumeración que también existe en la base de datos, actualiza el `CHECK` en una **migración nueva**, nunca en una que ya se aplicó.
3. Agrega pruebas de valores válidos e inválidos.
4. Documenta el contrato en `docs/api/` si se expone por HTTP.
