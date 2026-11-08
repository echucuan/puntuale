# Changelog

Todos los cambios relevantes del proyecto se registran aquí. El formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Las versiones siguen los pasos del plan (1.0-a, 1.0-b, …).

## [Sin publicar] · 1.0-a Base del monorepo

### Agregado

- Repositorio inicializado sobre `echucuan/puntuale` (`main` en `725ac2d`), con la landing preservada byte a byte en la raíz y `.nojekyll` para GitHub Pages.
- Documentación base:
  - ADRs 0001–0012;
  - alcance de la V1 y frontera con la V2;
  - convenciones;
  - diseño planificado;
  - riesgos del modo sin conexión;
  - inventario de referencias legales;
  - documentación de la landing;
  - propuesta original archivada como histórica.
- Herramientas del monorepo: workspaces de pnpm 12, TypeScript 6.0 estricto (`tsconfig.base.json`), ESLint 10 con `typescript-eslint`, Prettier 3 y el comando `pnpm check`.
- Guía de incorporación (`docs/development/onboarding.md`).
- `@puntuale/contracts`: enumeraciones (cuatro estados de asistencia con etiquetas en español), validación de tiempo (IANA, hora local, instante), contrato de marcación que separa evidencia y transporte, y contratos HTTP base.
- `@puntuale/domain-rules`: JSON canónico (RFC 8785) y SHA-256, UUIDv7, ingesta idempotente y detección de `CLOCK_SKEW`, precedencia de estados, identidad estable de la jornada y alertas sin duplicados.
- `@puntuale/db`: migración `0001_base_multitenant` (`tenant`, `app_user`, `user_tenant`, `employee` mínimo, `attendance_event`, `audit_event`), `app_current_tenant()` que falla cerrada, RLS `ENABLE` + `FORCE`, triggers de solo inserción y de `tenant_id` inmutable, permisos mínimos de `puntuale_app`; ejecutor de migraciones con checksum y `startTestDatabase()` con Testcontainers.
- Infraestructura local: `infra/docker-compose.yml` (PostgreSQL 18), `.env.example` con valores ficticios y los comandos `db:up`, `db:down`, `db:migrate` y `test:integration`.
