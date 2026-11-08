# Puntuale

**Plataforma de control de asistencia para empresas en México.** Registra entradas y salidas, organiza las jornadas, permite revisarlas, aclararlas y corregirlas con historial, y cierra cada periodo con un reporte de asistencia e incidencias. Con ese reporte, cada empresa prepara su nómina en su propio sistema.

> **Estado:** en construcción, paso **1.0-a** (base del monorepo: multiempresa con RLS, auditoría e ingesta idempotente, sin autenticación todavía). Todavía no hay funcionalidad de negocio utilizable. El avance por módulo está en [`docs/README.md`](docs/README.md).

## Versiones

| Versión  | Alcance                                                                                                                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **V1.x** | Control de asistencia: empresas, usuarios, colaboradores, horarios, marcaciones, jornadas, incidencias, correcciones auditadas, cierres de periodo y reportes. **No maneja dinero.** |
| **V2.x** | Nómina como módulo separado. Consumirá el cierre de periodo versionado de la V1 sin modificarlo.                                                                                     |

Más detalle en [`docs/versions/v1-scope.md`](docs/versions/v1-scope.md) y [`docs/versions/v2-boundary.md`](docs/versions/v2-boundary.md).

## Contenido del repositorio

| Ruta                                               | Contenido                                                                                                                                                                          |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.html`, `styles.css`, `script.js`, `assets/` | **Landing pública**, publicada en <https://echucuan.github.io/puntuale/>. Es una demostración ilustrativa, no una aplicación productiva. Ver [`docs/landing.md`](docs/landing.md). |
| `apps/api/`                                        | API (NestJS): salud, contexto de empresa, auditoría e ingesta idempotente de marcaciones.                                                                                          |
| `apps/web/`                                        | Aplicación web (React + Vite): por ahora, solo la pantalla base.                                                                                                                   |
| `packages/`                                        | `contracts` (esquemas compartidos), `domain-rules` (reglas puras) y `ui` (tokens de marca).                                                                                        |
| `db/`, `infra/`                                    | Migraciones SQL con RLS y PostgreSQL 18 local con docker compose.                                                                                                                  |
| `docs/`                                            | Arquitectura, decisiones (ADRs), alcance de cada versión y referencias.                                                                                                            |

## Desarrollo

Ver la [guía de incorporación](docs/development/onboarding.md). En resumen: `pnpm install`, `pnpm check` (sin Docker) y, con Docker, `pnpm test:integration` y `pnpm test:e2e`.

## Documentación

- [Índice de la documentación](docs/README.md)
- [Decisiones de arquitectura (ADRs)](docs/adr/)
- [Convenciones](docs/architecture/conventions.md)

## Licencia

**Pendiente.** Ver [ADR 0008](docs/adr/0008-public-repo-landing-at-root-license-pending.md). Mientras no haya un archivo `LICENSE`, no se otorga ningún permiso de uso, copia o redistribución del código.
