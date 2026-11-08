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

### Cambiado (revisión arquitectónica de 1.0-a)

- `puntuale_app` ya no tiene `DELETE` sobre `employee`: los colaboradores solo se dan de baja lógica (`status`). Los triggers `employee_reject_delete` y `employee_reject_truncate` rechazan el borrado físico de cualquier rol en el flujo normal, y las FK hacia `employee` son `ON DELETE RESTRICT`. La política RLS de `DELETE` se prueba con un rol exclusivo de pruebas (`puntuale_rls_probe`) que no crea ninguna migración. La migración `0001` se ajustó en sitio porque nunca se publicó ni se aplicó fuera de bases efímeras o locales.
- `received_at` lo fija la base de datos (`statement_timestamp()`) mediante el puerto `ServerClock`; el reloj fijo solo existe en pruebas.
- La ingesta devuelve la clasificación `clockSkew` (`DEVICE_CLOCK_OFFSET`, `FUTURE_EVENT`) sin rechazar ni persistir la alerta.
- La auditoría proyecta `before_data` y `after_data` a una lista permitida por entidad y rechaza los campos sensibles.
- La documentación de inmutabilidad ya no afirma protección frente a un superusuario que actúe deliberadamente; se agregó el procedimiento de cambios de emergencia.
- ADR 0013 (PostgreSQL 18 como versión oficial) y revisiones de los ADR 0010 (fuente de la hora del servidor) y 0011 (idempotencia: `client_event_id` obligatorio, `duplicate` sin auditoría, `conflict` rechazado y auditado).
- Documentados los scripts de instalación denegados y la versión exacta de TypeScript.
