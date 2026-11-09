# `@puntuale/web`

> **Estado: Parcial (1.0-b.1).** Existen la pantalla de acceso y «Mi cuenta», con la gestión de sesiones. Las pantallas de asistencia y la PWA de marcación llegan en versiones posteriores.

## Propósito

Interfaz web de Puntuale (React 19 + Vite 8), con la identidad visual del kit y de la landing.

## Responsabilidades

- Mostrar información y capturar acciones. **No** contiene reglas de negocio: esas viven en la API y en `@puntuale/domain-rules`.
- Validar con `@puntuale/contracts` lo que responde la API.

## Dependencias

| Depende de            | Para qué                    |
| --------------------- | --------------------------- |
| `@puntuale/contracts` | Contratos de las respuestas |
| `@puntuale/ui`        | Tokens de marca (`--pt-*`)  |
| API (`pnpm dev`)      | Proxy de `/health` y `/api` |

## Marca

- `public/brand/logo.png` e `isotipo.png` son copias sin cambios de los originales de la landing y del kit. No se redibujan, recolorean ni deforman.
- El logo solo va sobre fondos claros: el kit define versiones monocromáticas para fondos oscuros, pero no existen como archivo.
- `.pt-logo` completa el área de protección del kit (X = altura de la «P»), proporcional al ancho, y conserva el tamaño mínimo digital.
- Los identificadores técnicos, la IP y el agente de usuario completo van en «Detalles técnicos». El estado de la API y la subversión son secundarios.
- El azul real del PNG (≈ `#0050BE`) y su texto (≈ `#25272A`) difieren de los tokens del kit (`#1769AA` y `#202124`). La diferencia se conserva: el logo original no se recolorea.
- Montserrat se usa solo si está instalada: la aplicación no descarga fuentes externas (`@puntuale/ui`).

## Entradas y salidas

| Llamada                                                                                   | Contrato                                        |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `GET /health`                                                                             | `HealthResponseSchema`                          |
| `GET /api/auth/csrf`, `POST /api/auth/login`, `POST /api/auth/logout`                     | Contratos de `auth.ts` en `@puntuale/contracts` |
| `GET /api/auth/session`, `GET /api/auth/sessions`, `DELETE /api/auth/sessions/:sessionId` | Contratos de `auth.ts` en `@puntuale/contracts` |

## Pruebas relacionadas

- `src/api/health.test.ts`: traducción de la respuesta de salud y falla de red.
- `src/api/auth.test.ts`: cliente de sesión, mensajes de error, espera por demasiados intentos y formato del tiempo restante.
- `src/auth/device-label.test.ts`: nombre orientativo del dispositivo.

## Cómo extenderlo

1. Cada llamada a la API va en `src/api/`, valida la respuesta con su esquema de `@puntuale/contracts` y devuelve un modelo de vista.
2. Los componentes solo reciben modelos de vista; no calculan estados de asistencia ni aplican reglas.
3. Los textos visibles van en español de México.
