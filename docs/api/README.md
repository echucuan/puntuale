# Contratos de la API

> **Estado: Implementado (1.0-a).** Solo dos endpoints. Los esquemas viven en `@puntuale/contracts`.

## Convenciones

- Prefijo `/api`, salvo `GET /health`.
- Las rutas de una empresa tienen la forma `/api/t/:tenantId/...` y pasan por `TenantGuard`.
- Errores con una sola forma, `ApiErrorSchema`: `{ "error": { "code": "...", "message": "..." } }`. El mensaje está en español y no expone detalles internos.

| HTTP | `code`              | Cuándo                                                           |
| ---- | ------------------- | ---------------------------------------------------------------- |
| 401  | `unauthenticated`   | No hay sesión                                                    |
| 404  | `not_found`         | No existe **o** no tienes acceso (no se distingue)               |
| 409  | `conflict`          | Reservado: `client_event_id` repetido con otra evidencia (1.0-d) |
| 422  | `validation_failed` | Reservado: entrada fuera de contrato                             |
| 500  | `internal_error`    | Error inesperado                                                 |

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

En 1.0-a no existe autenticación real: fuera de las pruebas, toda ruta de empresa responde 401 ([ADR 0007](../adr/0007-own-authentication.md)).
