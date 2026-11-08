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
- `@puntuale/api` (NestJS 12):
  - `GET /health`;
  - configuración validada con Zod;
  - `withTenant` (transacción con `app.tenant_id` local);
  - módulo `tenancy`: `TenantGuard` (401/404), `NoSessionResolver`, `TestSessionResolver` solo con `NODE_ENV=test`, y `GET /api/t/:tenantId/context`;
  - módulo `audit`: auditoría en la misma transacción;
  - módulo `time-tracking`: ingesta idempotente `created`/`duplicate`/`conflict`, sin endpoint;
  - errores con la forma `ApiError`.
- `@puntuale/ui`: tokens de marca tomados de la landing (sin fuentes externas).
- `@puntuale/web` (React 19 + Vite 8): pantalla base con la marca y el estado de la API.
- Pruebas de integración de aislamiento, inmutabilidad, auditoría e ingesta, y pruebas e2e del guard.
- Reglas de negocio documentadas en `docs/business-rules/` (aislamiento, inmutabilidad y auditoría).
- CI (GitHub Actions): `pnpm check` y `pnpm build` sin Docker; integración y e2e con Testcontainers; búsqueda de secretos con gitleaks.
- `pnpm check:boundary` (incluido en `pnpm check`): falla si el código ejecutable contiene términos de nómina.
- Documentación: visión general de la arquitectura, contratos de la API, controles de seguridad, operación local, y guía de incorporación con todos los comandos.
- Infraestructura local: `infra/docker-compose.yml` (PostgreSQL 18), `.env.example` con valores ficticios y los comandos `db:up`, `db:down`, `db:migrate` y `test:integration`.
