# Documentación de Puntuale

Toda la documentación del proyecto vive aquí, junto al código. **Debe reflejar el estado real del código:** una tarea no está terminada mientras su documentación no esté actualizada.

## Estados de un documento

Cada documento declara su estado al inicio:

| Estado           | Significado                                                                      |
| ---------------- | -------------------------------------------------------------------------------- |
| **Aprobado**     | Decisión o diseño aceptado (normalmente en un ADR). Puede no estar implementado. |
| **Planificado**  | Diseño previsto para un paso futuro. **No existe en el código.**                 |
| **Implementado** | Describe código que existe y tiene pruebas.                                      |
| **Histórico**    | Se conserva como referencia y no se actualiza.                                   |

## Índice

| Área         | Documento                                                                                                 | Estado       |
| ------------ | --------------------------------------------------------------------------------------------------------- | ------------ |
| Versiones    | [versions/v1-scope.md](versions/v1-scope.md): alcance de la V1                                            | Aprobado     |
| Versiones    | [versions/v2-boundary.md](versions/v2-boundary.md): frontera con la V2 (nómina)                           | Aprobado     |
| Decisiones   | [adr/](adr/): registro de decisiones (plantilla en `0000-template.md`)                                    | Aprobado     |
| Arquitectura | [architecture/conventions.md](architecture/conventions.md): convenciones de nombres y capas               | Aprobado     |
| Arquitectura | [architecture/planned-design-v1.md](architecture/planned-design-v1.md): diseño de los pasos 1.0-b a 1.0-g | Planificado  |
| Seguridad    | [security/offline.md](security/offline.md): riesgos del registro sin conexión                             | Planificado  |
| Landing      | [landing.md](landing.md): landing pública en la raíz                                                      | Implementado |
| Legal        | [legal-references.md](legal-references.md): inventario de referencias (contexto, no asesoría)             | Aprobado     |
| Histórico    | [proposals/propuesta-tecnica-v1.md](proposals/propuesta-tecnica-v1.md): propuesta original                | Histórico    |

## Estado de los módulos

| Módulo                                                 | Paso  | Estado          |
| ------------------------------------------------------ | ----- | --------------- |
| Base del monorepo                                      | 1.0-a | En construcción |
| `tenancy`, `audit`, persistencia de `attendance_event` | 1.0-a | En construcción |
| `identity` (autenticación, roles, permisos)            | 1.0-b | Planificado     |
| `employees`, `schedules`, `period-calendars`           | 1.0-c | Planificado     |
| `time-tracking` (ingesta, PWA), `workdays`             | 1.0-d | Planificado     |
| `periods` (cierre, conformidad, reapertura)            | 1.0-e | Planificado     |
| `incidents`, `clarifications`, `corrections`           | 1.0-f | Planificado     |
| `reports`                                              | 1.0-g | Planificado     |

## ADRs

| #                                                               | Decisión                                                         | Estado                        |
| --------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------- |
| [0001](adr/0001-record-decisions-with-adrs.md)                  | Registrar decisiones con ADRs                                    | Aceptado                      |
| [0002](adr/0002-modular-monolith-and-stack.md)                  | Monolito modular: NestJS, PostgreSQL 18, React                   | Aceptado                      |
| [0003](adr/0003-tenant-is-company-with-fail-closed-rls.md)      | Tenant = empresa; autorización en la app y RLS que falla cerrada | Aceptado                      |
| [0004](adr/0004-immutable-attendance-events.md)                 | Marcaciones inmutables                                           | Aceptado                      |
| [0005](adr/0005-transactional-audit.md)                         | Auditoría en la misma transacción                                | Aceptado                      |
| [0006](adr/0006-v1-v2-separation-and-versioned-closure.md)      | Separación V1/V2 y cierre versionado                             | Aceptado                      |
| [0007](adr/0007-own-authentication.md)                          | Autenticación propia (se implementa en 1.0-b)                    | Aceptado                      |
| [0008](adr/0008-public-repo-landing-at-root-license-pending.md) | Repositorio público, landing en la raíz, licencia pendiente      | Aceptado (licencia pendiente) |
| [0009](adr/0009-naming-conventions.md)                          | Convenciones de nombres                                          | Aceptado                      |
| [0010](adr/0010-time-and-language.md)                           | Manejo del tiempo e idioma                                       | Aceptado                      |
| [0011](adr/0011-offline-ingest-and-idempotency.md)              | Ingesta sin conexión e idempotencia                              | Aceptado                      |
| [0012](adr/0012-attendance-status-and-precedence.md)            | Cuatro estados y su precedencia                                  | Aceptado                      |
