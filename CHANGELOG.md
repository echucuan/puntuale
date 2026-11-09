# Changelog

Todos los cambios relevantes del proyecto se registran aquí. El formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Las versiones siguen los pasos del plan (1.0-a, 1.0-b, …).

## [Sin publicar] · 1.0-b.1 Sesiones y protecciones HTTP

### Agregado

- ADR 0014: sesiones en PostgreSQL y acceso controlado a la identidad.
- Migración `0002_sessions_security`: `app_user_credential`, `auth_session`, `security_event` (solo inserción), `login_failure`, `rate_limit_bucket`, el rol `puntuale_auth_definer` y las funciones `SECURITY DEFINER` `auth_*`.
- Módulo `identity`: login, logout, sesión actual, listado y revocación de sesiones propias, rotación, Argon2id, CSRF, límites de tasa y eventos de seguridad.
- Helmet, CORS con lista explícita y un identificador por petición (`X-Request-Id`).
- Pantalla web de acceso, sesiones activas, revocación y rotación.
- `pnpm db:seed` con cuentas ficticias de desarrollo.
- Un cuerpo JSON mayor a 100 KB responde 413 `payload_too_large` con el formato estándar de error.

### Cambiado

- Identidad visual en la web: pantalla de acceso de dos columnas y «Mi cuenta» con «Seguridad y sesiones», logo original y tokens centralizados en `@puntuale/ui`. Identificadores y diagnóstico pasan a «Detalles técnicos».
- Montserrat autoalojada en la web con `@fontsource/montserrat` 5.3.0 (subconjunto latino, pesos 400, 600 y 700), sin solicitudes a servicios externos, con Arial como alternativa y con su aviso OFL-1.1 incluido en el build.
- La web muestra un mensaje específico para `payload_too_large` y una cuenta regresiva durante la espera por demasiados intentos.
- Migración `0003_separate_login_failures`: separa `login_failure` en `login_failure_account` y `login_failure_ip`, conserva el historial y agrega `auth_release_login_ip_attempt`.
- El límite de login por IP es exacto entre conexiones e instancias: la reserva bloquea cuenta e IP en orden fijo, sin mantener los bloqueos durante Argon2id.
- Un login correcto ya no borra fallos de IP ajenos: reinicia su cuenta y retira solo su propio intento.
- Rotación de un solo uso: el intento perdedor responde 409 `conflict`, sin sesión ni cookie. Una cookie de otra persona ya no se rota.
- El ADR 0014 documenta el alcance del `SELECT` de `puntuale_app` sobre `auth_session`.
- `puntuale_app` ya no tiene `SELECT` sobre `app_user` (R5).
- `CookieSessionResolver` reemplaza a `NoSessionResolver`: las rutas de empresa aceptan una sesión real.
- La configuración exige `AUTH_SECRET` y `CORS_ORIGINS`.

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
  - módulo `tenancy`: `TenantGuard` (401/404), `NoSessionResolver` y `GET /api/t/:tenantId/context`;
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

### Seguridad (revisión de Codex de 1.0-a)

- `TestSessionResolver` sale de `src/`: vive en `apps/api/test/support/` y solo lo registra la composición explícita `createTestApp`. Exige `NODE_ENV=test`, `VITEST=true`, `PUNTUALE_TEST_COMPOSITION=explicit-test-composition` y una base local. El módulo productivo usa siempre `NoSessionResolver` (revisión del ADR 0007).
- Las acciones de CI se fijan por SHA completo de commit con la versión legible; `pnpm check:ci-pins` (dentro de `pnpm check`) lo verifica.
- `overrides` de `glob` (^14.0.2) y `minimatch` (^11.0.1) para los avisos `GHSA-3g3m-2fjr-6pw4` y `GHSA-g3hv-75wg-m249`; `pnpm audit --prod` y `pnpm audit --dev` quedan sin vulnerabilidades.
- Riesgos aceptados con límites (R2–R7, R10) documentados en `docs/security/README.md`.
