# Contratos de la API

> **Estado: Implementado (1.0-b.2).** Salud, sesiones, empresas, accesos y MFA. Los esquemas viven en `@puntuale/contracts`.

## Convenciones

- Prefijo `/api`, salvo `GET /health`.
- Las rutas de una empresa tienen la forma `/api/t/:tenantId/...` y pasan por `TenantGuard`.
- Errores con una sola forma, `ApiErrorSchema`: `{ "error": { "code": "...", "message": "..." } }`. El mensaje está en español y no expone detalles internos.

| HTTP | `code`                | Cuándo                                                                                                                          |
| ---- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 401  | `unauthenticated`     | No hay sesión                                                                                                                   |
| 401  | `invalid_credentials` | Login rechazado (misma respuesta para cualquier causa)                                                                          |
| 403  | `forbidden`           | Falla CSRF o el origen no está permitido                                                                                        |
| 404  | `not_found`           | No existe **o** no tienes acceso (no se distingue)                                                                              |
| 409  | `conflict`            | Login que perdió la rotación de una sesión (sin `Set-Cookie`). Reservado: `client_event_id` repetido con otra evidencia (1.0-d) |
| 413  | `payload_too_large`   | Cuerpo JSON mayor al límite de 100 KB; no llega a los controladores                                                             |
| 422  | `validation_failed`   | Entrada fuera de contrato                                                                                                       |
| 429  | `rate_limited`        | Límite de tasa; incluye `Retry-After` en segundos                                                                               |
| 500  | `internal_error`      | Error inesperado                                                                                                                |

## Endpoints

### `GET /health`

Sin sesión. Respuesta `HealthResponseSchema`.

| Situación          | HTTP | Cuerpo                                         |
| ------------------ | ---- | ---------------------------------------------- |
| Base disponible    | 200  | `{ "status": "ok", "database": "up" }`         |
| Base no disponible | 503  | `{ "status": "degraded", "database": "down" }` |

### `GET /api/t/:tenantId/context`

Devuelve el contexto que validó el `TenantGuard`. Respuesta `TenantContextResponseSchema`:

```json
{ "tenantId": "uuid", "userId": "uuid", "membershipId": "uuid" }
```

| Situación                                            | HTTP |
| ---------------------------------------------------- | ---- |
| Sin sesión                                           | 401  |
| Sin membresía activa, empresa inexistente o inactiva | 404  |
| `tenantId` que no es UUID                            | 404  |
| Membresía activa                                     | 200  |

La sesión la resuelve la cookie ([ADR 0014](../adr/0014-postgres-sessions-and-login.md)).

## Sesiones

Toda petición `POST`, `PUT`, `PATCH` o `DELETE` a `/api/` exige `X-CSRF-Token` y un `Origin` permitido o, si falta, un `Referer` permitido. Un `Origin` desconocido responde 403 en cualquier método.

| Endpoint                               | Sesión | CSRF | Éxito | Contrato                                                |
| -------------------------------------- | ------ | ---- | ----- | ------------------------------------------------------- |
| `GET /api/auth/csrf`                   | No     | No   | 200   | `CsrfResponseSchema`                                    |
| `POST /api/auth/login`                 | No     | Sí   | 200   | `LoginRequestSchema` → `CurrentSessionResponseSchema`   |
| `POST /api/auth/logout`                | Sí     | Sí   | 204   | Sin cuerpo                                              |
| `GET /api/auth/session`                | Sí     | No   | 200   | `CurrentSessionResponseSchema`                          |
| `GET /api/auth/sessions`               | Sí     | No   | 200   | `ActiveSessionsResponseSchema`                          |
| `DELETE /api/auth/sessions/:sessionId` | Sí     | Sí   | 204   | Sin cuerpo; una sesión ajena o inexistente responde 404 |

`GET /api/auth/csrf` entrega un token ligado a la sesión o, si no hay sesión, a una cookie `HttpOnly` anónima. El token cambia al iniciar sesión.

La cookie de sesión se llama `puntuale_session` en desarrollo y `__Host-puntuale_session` en producción. El token nunca aparece en el cuerpo de una respuesta.

Si `POST /api/auth/login` llega con una sesión vigente de la misma persona, la consume una sola vez (rotación). Si otra petición ya la consumió en los últimos 30 segundos, responde 409 `conflict`: no crea sesión ni envía `Set-Cookie`. Según el momento, la petición perdedora también puede responder 403 por CSRF o 429 por la espera progresiva, siempre sin cookie. Sin sesión propia vigente, el login es independiente y no afecta otras sesiones.

## Empresas y accesos

Todas las rutas exigen sesión. Las de `/api/t/:tenantId` responden 404 sin membresía activa. Las mutaciones exigen CSRF. Los permisos se evalúan en cada petición ([ADR 0015](../adr/0015-access-control-and-mfa.md)).

| Endpoint                                                           | Permiso         | Éxito | Contrato                              |
| ------------------------------------------------------------------ | --------------- | ----- | ------------------------------------- |
| `GET /api/me/tenants`                                              | Sesión          | 200   | `MyTenantsResponseSchema`             |
| `GET /api/t/:tenantId/me`                                          | Membresía       | 200   | `TenantMeResponseSchema`              |
| `POST /api/t/:tenantId/selection`                                  | Membresía       | 204   | Sin cuerpo; auditado                  |
| `GET /api/t/:tenantId/access/members`                              | `access.read`   | 200   | `AccessMembersResponseSchema`         |
| `PUT /api/t/:tenantId/access/members/:membershipId/roles/:role`    | `access.manage` | 204   | Sin cuerpo; idempotente               |
| `DELETE /api/t/:tenantId/access/members/:membershipId/roles/:role` | `access.manage` | 204   | Sin cuerpo; idempotente               |
| `PUT /api/t/:tenantId/access/members/:membershipId/status`         | `access.manage` | 204   | `UpdateMembershipStatusRequestSchema` |

Rechazos: 403 `permission_denied`, `mfa_required`, `mfa_enrollment_required` o `self_modification`; 409 `last_admin`, o `conflict` si se asigna un rol a una membresía inactiva.

## Verificación en dos pasos

Todas exigen sesión y las mutaciones, CSRF.

| Endpoint                                | Éxito | Contrato                                                     |
| --------------------------------------- | ----- | ------------------------------------------------------------ |
| `GET /api/auth/mfa`                     | 200   | `MfaStatusResponseSchema`; nunca incluye el secreto          |
| `POST /api/auth/mfa/enrollment`         | 200   | `MfaEnrollmentRequestSchema` → `MfaEnrollmentResponseSchema` |
| `POST /api/auth/mfa/enrollment/confirm` | 200   | `MfaConfirmRequestSchema` → `MfaConfirmResponseSchema`       |
| `POST /api/auth/mfa/verify`             | 204   | `MfaVerifyRequestSchema`                                     |
| `POST /api/auth/mfa/disable`            | 204   | `MfaDisableRequestSchema`                                    |

Inscribir y confirmar responden con `Cache-Control: no-store`. Si ya hay MFA activo, inscribir exige contraseña y factor actual. Rechazos: 403 `invalid_mfa_code`, `invalid_credentials` o `mfa_enrollment_required`; 409 `conflict` si no hay inscripción vigente; 429 con `Retry-After` al superar el límite. `GET /api/auth/session` incluye `session.mfaVerified`.
