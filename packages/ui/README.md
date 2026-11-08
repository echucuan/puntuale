# `@puntuale/ui`

> **Estado: Parcial (1.0-a).** Solo tokens de marca. Los componentes compartidos llegan con las primeras pantallas (1.0-b en adelante).

## Propósito

Mantener la identidad visual de Puntuale (la de la landing) en la aplicación web, desde una sola fuente.

## Responsabilidades

- Colores y tipografía (`tokens.ts`) y su forma de variables CSS (`--pt-*`).
- **No** contiene reglas de negocio ni llamadas a la API.
- **No** modifica la landing: copia sus valores de `styles.css` (ADR 0008).

## Dependencias

Ninguna en tiempo de ejecución.

## Reglas

1. Los colores coinciden con las variables `:root` de la landing (`--navy`, `--blue`, `--pale`, `--gray`, `--ink`, `--muted`, `--line`).
2. No se descargan fuentes externas. Montserrat se usa solo si está instalada; si no, Arial o la del sistema.

## Entradas y salidas

| Exporta          | Descripción                 |
| ---------------- | --------------------------- |
| `colors`         | Paleta de marca             |
| `fontFamily`     | Pila tipográfica            |
| `cssVariables()` | Bloque `:root` con `--pt-*` |

## Pruebas relacionadas

`src/tokens.test.ts`: formato de colores, colores principales, variables CSS y ausencia de fuentes externas.

## Cómo extenderlo

1. Agrega el token en `tokens.ts` y su prueba.
2. Un componente nuevo va en `src/components/`, sin lógica de negocio: recibe datos y emite eventos.
