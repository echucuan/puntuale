# `@puntuale/web`

> **Estado: Parcial (1.0-a).** Solo existe la pantalla base con la marca y el estado de la API. Las pantallas de producto y la PWA de marcación llegan desde 1.0-b.

## Propósito

Interfaz web de Puntuale (React 19 + Vite 8), con la identidad visual de la landing.

## Responsabilidades

- Mostrar información y capturar acciones. **No** contiene reglas de negocio: esas viven en la API y en `@puntuale/domain-rules`.
- Validar con `@puntuale/contracts` lo que responde la API.

## Dependencias

| Depende de            | Para qué                    |
| --------------------- | --------------------------- |
| `@puntuale/contracts` | Contratos de las respuestas |
| `@puntuale/ui`        | Tokens de marca (`--pt-*`)  |
| API (`pnpm dev`)      | Proxy de `/health` y `/api` |

## Entradas y salidas

| Llamada       | Contrato               |
| ------------- | ---------------------- |
| `GET /health` | `HealthResponseSchema` |

## Pruebas relacionadas

`src/api/health.test.ts`: traducción de la respuesta de salud y falla de red.

## Cómo extenderlo

1. Cada llamada a la API va en `src/api/`, valida la respuesta con su esquema de `@puntuale/contracts` y devuelve un modelo de vista.
2. Los componentes solo reciben modelos de vista; no calculan estados de asistencia ni aplican reglas.
3. Los textos visibles van en español de México.
