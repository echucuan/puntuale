# `@puntuale/ui`

> **Estado: Parcial (1.0-b.1).** Solo tokens de marca. Los componentes de las pantallas actuales viven en `apps/web`.

## Propósito

Mantener la identidad visual de Puntuale (la del kit y la landing) en la aplicación web, desde una sola fuente.

## Responsabilidades

- Colores, radios, pesos y tipografía (`tokens.ts`) y su forma de variables CSS (`--pt-*`).
- **No** contiene reglas de negocio ni llamadas a la API.
- **No** modifica la landing: copia sus valores de `styles.css` (ADR 0008).

## Dependencias

Ninguna en tiempo de ejecución.

## Reglas

1. Los colores de marca coinciden con el kit de identidad y con las variables `:root` de la landing (`--navy`, `--blue`, `--pale`, `--gray`, `--ink`, `--muted`, `--line`). `control`, `success`, `warning` y `danger`, con sus fondos, son tokens funcionales de la aplicación y no forman parte del kit.
2. No se descargan fuentes externas. Montserrat se usa solo si está instalada; si no, Arial o la del sistema.

## Entradas y salidas

| Exporta          | Descripción                 |
| ---------------- | --------------------------- |
| `colors`         | Paleta de marca             |
| `fontFamily`     | Pila tipográfica            |
| `fontWeights`    | Pesos tipográficos          |
| `radii`          | Radios de borde             |
| `cssVariables()` | Bloque `:root` con `--pt-*` |

## Pruebas relacionadas

`src/tokens.test.ts`: formato y valores de los colores, variables CSS, ausencia de fuentes externas y contraste AA de las combinaciones de tokens. Esa comprobación de contraste no es una auditoría completa de accesibilidad.

## Cómo extenderlo

1. Agrega el token en `tokens.ts` y su prueba.
2. Un componente nuevo va en `src/components/`, sin lógica de negocio: recibe datos y emite eventos.
