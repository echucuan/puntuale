# Módulo `health`

> **Estado: Implementado (1.0-a).**

## Propósito

Indicar si la API está viva y si alcanza la base de datos, para el desarrollo local y futuros monitores.

## Responsabilidades

- `GET /health`, fuera del prefijo `/api` y sin sesión.
- **No** revela datos de ninguna empresa, versiones ni configuración.

## Dependencias

| Depende de             | Para qué               |
| ---------------------- | ---------------------- |
| `database` (`PG_POOL`) | `SELECT 1`             |
| `@puntuale/contracts`  | `HealthResponseSchema` |

## Reglas de negocio

1. Con la base disponible responde 200 `{ status: 'ok', database: 'up' }`; sin ella, 503 `{ status: 'degraded', database: 'down' }`.

## Entradas y salidas

| Tipo            | Nombre        | Contrato               |
| --------------- | ------------- | ---------------------- |
| Endpoint        | `GET /health` | `HealthResponseSchema` |
| Acción auditada | No aplica     |                        |

## Pruebas relacionadas

| Archivo                               | Qué verifica                                  |
| ------------------------------------- | --------------------------------------------- |
| `test/e2e/tenant-context.e2e.test.ts` | 200 con la base arriba; no existe bajo `/api` |

## Cómo extenderlo

Agrega comprobaciones solo de dependencias reales (por ejemplo, almacenamiento) y nunca incluyas datos sensibles en la respuesta.
