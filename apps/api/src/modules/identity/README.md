# Módulo `identity`

> **Estado: Implementado (1.0-b.2).** Login, logout, sesiones en PostgreSQL, rotación, revocación, CSRF, límites de tasa y MFA TOTP ([ADR 0015](../../../../../docs/adr/0015-access-control-and-mfa.md)). Membresías, roles y permisos están en `tenancy`.

## Propósito

Autenticar a una persona y mantener su sesión de forma segura, sin que el rol de la aplicación pueda leer las identidades de todas las personas ([ADR 0014](../../../../../docs/adr/0014-postgres-sessions-and-login.md)).

## Responsabilidades

- `AuthService`: casos de uso de login, logout, listado y revocación de sesiones.
- `SessionAuthenticator`: valida la cookie, renueva la inactividad y guarda el resultado por petición.
- `CookieSessionResolver`: implementa el puerto `SessionResolver` que consume `TenantGuard`.
- `CsrfGuard` y `RateLimitGuard`: guards globales de todas las rutas `/api/`.
- Registra los eventos de `security_event` en la misma transacción que el cambio.
- **No** decide a qué empresa pertenece una persona: eso es de `tenancy`.
- `MfaService`: inscripción, verificación, recuperación, reemplazo y desactivación del segundo factor.
- `CookieSessionMfaResolver`: informa a `tenancy` el estado de MFA de la sesión.
- **No** gestiona roles ni permisos: eso es de `tenancy`.

## Dependencias

| Depende de                                                                                                                                  | Para qué                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `database` (`PG_POOL`, `withTransaction`)                                                                                                   | Consultas y transacciones como `puntuale_app` |
| `config` (`APP_CONFIG`)                                                                                                                     | Secreto, orígenes, duraciones y límites       |
| `tenancy` (puerto `SessionResolver`)                                                                                                        | Entregar la sesión a `TenantGuard`            |
| `@puntuale/contracts`                                                                                                                       | `auth.ts`: esquemas de entrada y salida       |
| `@node-rs/argon2`                                                                                                                           | Argon2id                                      |
| `otpauth`                                                                                                                                   | Códigos TOTP                                  |
| Tablas `user_mfa`, `mfa_recovery_code`, `mfa_attempt`                                                                                       | Segundo factor                                |
| Tablas `auth_session`, `security_event`, `login_failure_account`, `login_failure_ip`, `rate_limit_bucket`                                   | Estado propio                                 |
| Funciones `auth_find_account`, `auth_session_identity`, `auth_clear_login_failures`, `auth_release_login_ip_attempt`, `auth_purge_throttle` | Acceso controlado a `app_user` y credenciales |

## Reglas de negocio

Todas están en el ADR 0014.

1. **El token nunca se guarda.** En la base solo está su SHA-256 (`auth-schema.int.test.ts`, `auth.e2e.test.ts`).
2. **12 horas absolutas y 30 minutos de inactividad.** La actividad renueva solo la inactividad (`auth.e2e.test.ts`).
3. **Rotación de un solo uso.** Cada login crea un identificador nuevo. Una sesión vigente de la misma persona se consume una sola vez; quien pierde responde 409 sin sesión ni cookie. Sin sesión propia vigente, el login es independiente (`identity-domain.test.ts`, `auth-concurrency.e2e.test.ts`).
4. **Revocación inmediata y sesiones ajenas.** Logout y revocación toman efecto en la siguiente petición. Una persona no puede listar, revocar ni rotar sesiones de otra; revocar una ajena responde 404 (`auth.e2e.test.ts`). El alcance del `SELECT` sobre `auth_session` está en el ADR 0014.
5. **Respuesta genérica.** Contraseña incorrecta, cuenta inexistente y cuenta deshabilitada responden igual. Con cuenta inexistente también se ejecuta Argon2id (`auth.e2e.test.ts`, `password-hasher.test.ts`).
6. **Argon2id** con 64 MiB, 3 iteraciones y paralelismo 1 (`password-hasher.test.ts`).
7. **CSRF.** `POST`, `PUT`, `PATCH` y `DELETE` exigen `X-CSRF-Token` y un `Origin` permitido o, si falta, un `Referer` permitido, incluidos login y logout (`identity-domain.test.ts`, `auth.e2e.test.ts`).
8. **Límites de login:** 5 fallos por cuenta y 20 por IP en 15 minutos, espera progresiva y sin bloqueo permanente. El intento se reserva antes de verificar la contraseña, con bloqueos de cuenta e IP en orden fijo que no se mantienen durante Argon2id. Ambos límites son exactos entre instancias. Un login correcto reinicia su cuenta y retira solo su propio intento de la IP (`identity-domain.test.ts`, `login-throttle.int.test.ts`, `auth-concurrency.e2e.test.ts`).
9. **Límites de API:** 120 peticiones por minuto por IP y 300 por sesión, configurables (`auth.e2e.test.ts`).
10. **Mínimo privilegio.** `puntuale_app` no lee `app_user` ni `app_user_credential` (`auth-schema.int.test.ts`).
11. **Sin atajos.** `src/` no contiene ningún resolvedor que acepte identidades sin verificar (`session-resolver.test.ts`).
12. **El hash Argon2id no sale de la API.** Se recibe internamente solo para verificar la contraseña; nunca se envía al navegador, se registra ni se audita (`auth.e2e.test.ts`).
13. **Sin recuperación de sesión.** Una sesión expirada o revocada requiere iniciar sesión nuevamente (`auth.e2e.test.ts`). La recuperación de MFA es un flujo diferente.
14. **Secreto TOTP cifrado.** AES-256-GCM ligado a la persona; nunca se registra (`mfa.test.ts`, `access-mfa.e2e.test.ts`).
15. **Un código no se reutiliza.** El paso aceptado solo avanza, bajo bloqueo por persona (`access-mfa.e2e.test.ts`).
16. **Códigos de recuperación** como HMAC y de un solo uso, con consumo atómico (`access-mfa.e2e.test.ts`).
17. **Límite compartido.** Verificación, recuperación y reautenticación: 5 intentos en 15 minutos por persona, configurable (`access-mfa.e2e.test.ts`).
18. **Deshabilitar credenciales.** Hoy no existe esa operación. Si se agrega, debe respetar la garantía del último propietario con acceso efectivo de cada empresa (ADR 0015).
19. **Reautenticación.** Reemplazar o desactivar exige contraseña y factor actual; una sesión nueva o rotada empieza sin verificar (`access-mfa.e2e.test.ts`).

## Entradas y salidas

| Tipo            | Nombre                                                                       | Contrato                                              |
| --------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------- |
| Endpoint        | `GET /api/auth/csrf`                                                         | `CsrfResponseSchema`                                  |
| Endpoint        | `POST /api/auth/login`                                                       | `LoginRequestSchema` → `CurrentSessionResponseSchema` |
| Endpoint        | `POST /api/auth/logout`                                                      | 204                                                   |
| Endpoint        | `GET /api/auth/session`                                                      | `CurrentSessionResponseSchema`                        |
| Endpoint        | `GET /api/auth/sessions`                                                     | `ActiveSessionsResponseSchema`                        |
| Endpoint        | `DELETE /api/auth/sessions/:sessionId`                                       | 204                                                   |
| Endpoint        | `/api/auth/mfa`, `/enrollment`, `/enrollment/confirm`, `/verify`, `/disable` | `access.ts`                                           |
| Evento emitido  | No aplica: aún no hay bus de eventos                                         |                                                       |
| Acción auditada | `security_event`: login, logout, sesiones y `mfa_*`                          | Global; no usa `audit_event`                          |

## Pruebas relacionadas

| Archivo                                       | Qué verifica                                                                                  |
| --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `domain/identity-domain.test.ts`              | Token, HMAC, CSRF, política de origen, límites de login y cookies                             |
| `infrastructure/password-hasher.test.ts`      | Parámetros de Argon2id y verificación                                                         |
| `infrastructure/session-resolver.test.ts`     | La composición productiva usa `CookieSessionResolver`; `src/` no contiene el doble de pruebas |
| `src/config/app-config.test.ts`               | Secreto y orígenes por entorno                                                                |
| `db/test/integration/auth-schema.int.test.ts` | `SECURITY DEFINER`, permisos, `security_event` de solo inserción y restricciones              |
| `test/e2e/auth.e2e.test.ts`                   | Login, cookies, expiración, rotación, revocación, CSRF, CORS, Helmet y límites de tasa        |
| `domain/mfa.test.ts`                          | Cifrado del secreto, ventana TOTP y códigos de recuperación                                   |
| `test/e2e/access-mfa.e2e.test.ts`             | Inscripción, reutilización, recuperación, límites, reautenticación y ausencia de secretos     |
| `test/e2e/auth-concurrency.e2e.test.ts`       | Dos instancias: límites exactos, reintentos, historial de IP y contrato de rotación           |
| `test/integration/login-throttle.int.test.ts` | Bloqueos entre conexiones, orden fijo y ausencia de interbloqueos                             |

## Cómo extenderlo

1. Una regla pura va en `domain/`, con su prueba unitaria. El SQL va en `infrastructure/`.
2. Un caso de uso nuevo va en `AuthService`, dentro de `withTransaction`, y registra su evento en esa misma transacción.
3. Un tipo de evento nuevo requiere una migración que amplíe el `CHECK` de `security_event`.
4. Toda lectura nueva de identidad se hace con una función `SECURITY DEFINER` con `search_path` fijo y `EXECUTE` solo para `puntuale_app`. No se devuelve `SELECT` sobre `app_user` al rol de la aplicación.
5. PostgreSQL coordina los límites entre instancias (ADR 0014). Redis es una alternativa opcional para los límites de la API: implementa el puerto `RateLimitStore` y regístralo en `identity.module.ts`.
