# Convenciones del proyecto

> **Estado: Aprobado** ([ADR 0009](../adr/0009-naming-conventions.md)). Se aplican a todo el código nuevo.

## Idioma

- Identificadores de código, tablas, columnas, endpoints, eventos y permisos en **inglés**.
- Textos de la interfaz, mensajes de error al usuario y documentación en **español**.
- Comentarios en el código: en español, y solo cuando expliquen el *porqué*.

## Archivos y carpetas

| Elemento | Convención | Ejemplo |
|---|---|---|
| Archivos TS | `kebab-case` + sufijo de rol | `tenant-context.guard.ts`, `attendance-event.repository.ts` |
| Sufijos de rol | `.module`, `.controller`, `.service`, `.guard`, `.repository`, `.resolver`, `.schema`, `.types`, `.test`, `.int.test`, `.e2e.test` | — |
| Pruebas unitarias | Junto al archivo: `x.test.ts` | `status.test.ts` |
| Pruebas de integración | `test/integration/*.int.test.ts` (requieren Docker) | `rls.int.test.ts` |
| Pruebas e2e | `test/e2e/*.e2e.test.ts` (requieren Docker) | `tenancy.e2e.test.ts` |
| Migraciones | `db/migrations/NNNN_descripcion.sql` (4 dígitos, nunca se editan una vez integradas) | `0001_base_tenancy_attendance_audit.sql` |
| ADRs | `docs/adr/NNNN-titulo-en-kebab.md` | `0003-tenant-is-company-with-fail-closed-rls.md` |
| Módulos de la API | `apps/api/src/modules/<modulo>/` con `README.md` obligatorio | `modules/tenancy/` |

## Código TypeScript

| Elemento | Convención | Ejemplo |
|---|---|---|
| Clases, tipos e interfaces | `PascalCase` | `TenantGuard`, `AttendanceEventInput` |
| Funciones y variables | `camelCase` | `resolveAttendanceStatus` |
| Constantes y tokens de inyección | `SCREAMING_SNAKE_CASE` | `DB_POOL`, `SESSION_RESOLVER` |
| Esquemas Zod | `<Nombre>Schema` + tipo inferido `<Nombre>` | `AttendanceEventInputSchema` / `AttendanceEventInput` |
| Enumeraciones | Arreglo `as const` + tipo unión; valores en `snake_case` | `ATTENDANCE_STATUSES`, `'needs_review'` |
| Inyección en NestJS | Siempre `@Inject(TOKEN)` explícito ([ADR 0002](../adr/0002-modular-monolith-and-stack.md)) | — |

## Capas por módulo (API)

```
modules/<modulo>/
├── domain/          # reglas puras (o importadas de @puntuale/domain-rules); sin I/O
├── application/     # casos de uso; orquestan transacciones, auditoría y repositorios
├── infrastructure/  # repositorios SQL, adaptadores
├── http/            # controladores, guards, DTO; sin reglas de negocio
├── <modulo>.module.ts
└── README.md
```

En el paso 1.0-a, los módulos solo contienen las capas que ya necesitan. No se crean carpetas vacías.

## Base de datos

| Elemento | Convención | Ejemplo |
|---|---|---|
| Tablas | `snake_case`, **singular** | `attendance_event`, `user_tenant` |
| Columnas | `snake_case`; llaves foráneas como `<entidad>_id`; instantes con sufijo `_at` | `employee_id`, `received_at` |
| Columna de tenant | `tenant_id uuid not null` en toda tabla operativa | — |
| Llaves foráneas dentro del tenant | Compuestas `(tenant_id, x_id)` | `(tenant_id, employee_id) → employee (tenant_id, id)` |
| Valores enumerados | `text` + `CHECK (... in (...))` | `event_type in ('in','out')` |
| Funciones | `snake_case`; prefijo `app_` para las de contexto | `app_current_tenant()` |
| Políticas RLS | `<tabla>_tenant_isolation` | `employee_tenant_isolation` |

## API HTTP

- Rutas de tenant: `/api/t/:tenantId/<recurso-en-kebab-plural>`.
- Rutas sin tenant: `/health` y, en el futuro, `/api/me/...` y `/api/auth/...`.
- Respuestas en JSON con propiedades en `camelCase`.
- Los errores siguen el contrato `ApiError` de `@puntuale/contracts`.
- Códigos de estado: 401 si no hay sesión; 404 si no hay membresía o el recurso no existe en el tenant; 409 en un conflicto de idempotencia; 422 si la validación falla.

## Eventos de dominio y auditoría

- Acción o evento: `<modulo>.<entidad>.<verbo-en-pasado>`, por ejemplo `attendance.event.recorded` o `period.closure.created`.
- Permisos: `<modulo>.<accion>`, por ejemplo `period.reopen` o `correction.approve`.

## Git

- Ramas: `feat/<version>-<tema>`, `fix/<tema>`, `docs/<tema>`.
- Commits en español, con prefijo tipo *Conventional Commits* (`feat:`, `fix:`, `docs:`, `chore:`, `build:`, `test:`). Cada commit tiene **un solo propósito** e incluye su documentación.
- Ningún commit debe dejar `pnpm check` en rojo.
