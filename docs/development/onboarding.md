# Guía de incorporación

> **Estado: Implementado.** Esta guía describe solo los comandos que existen hoy y se actualiza en cada paso.

## 1. Requisitos

| Herramienta | Versión                              | Para qué                           |
| ----------- | ------------------------------------ | ---------------------------------- |
| Node.js     | ≥ 24                                 | Ejecutar las herramientas y la API |
| pnpm        | 12.18.0 (fijada en `packageManager`) | Gestor de paquetes del monorepo    |
| Git         | Cualquier versión reciente           | Control de versiones               |

pnpm se obtiene con **corepack**, que viene incluido con Node.js:

```bash
corepack enable pnpm
```

En Windows, si falla con `EPERM` (porque Node está instalado en `C:\Program Files`), habilita pnpm en una carpeta de usuario que ya esté en el PATH:

```bash
corepack enable --install-directory "%APPDATA%\npm" pnpm
```

## 2. Instalación

```bash
git clone https://github.com/echucuan/puntuale.git
cd puntuale
pnpm install
```

## 3. Validaciones

| Comando          | Qué hace                                                                       | ¿Requiere Docker? |
| ---------------- | ------------------------------------------------------------------------------ | ----------------- |
| `pnpm check`     | Formato, lint, tipos y pruebas unitarias. **Debe pasar antes de cada commit.** | No                |
| `pnpm format`    | Aplica el formato de Prettier                                                  | No                |
| `pnpm lint`      | ESLint en todo el monorepo                                                     | No                |
| `pnpm typecheck` | Ejecuta `tsc --noEmit` en cada paquete                                         | No                |
| `pnpm test`      | Pruebas unitarias (Vitest) de cada paquete                                     | No                |

## 4. Configuración compartida

Las herramientas comunes se configuran en la raíz. No hay un paquete `packages/config` aparte: con un monorepo de este tamaño, sería una pieza más sin beneficio ([ADR 0002](../adr/0002-modular-monolith-and-stack.md)).

| Archivo                                | Contenido                                               |
| -------------------------------------- | ------------------------------------------------------- |
| `tsconfig.base.json`                   | TypeScript estricto. Cada paquete lo extiende.          |
| `eslint.config.js`                     | ESLint con `typescript-eslint`. Ignora la landing.      |
| `.prettierrc.json` / `.prettierignore` | Formato. Ignora la landing y los documentos históricos. |
| `.editorconfig` / `.gitattributes`     | Fin de línea LF. La landing se preserva byte a byte.    |

**Versiones fijadas:** TypeScript queda en 6.0.x porque `typescript-eslint` 8 todavía no admite TypeScript ≥ 6.1.

## 5. Antes de contribuir

1. Lee [`CLAUDE.md`](../../CLAUDE.md): reglas permanentes y definición de terminado.
2. Lee [`docs/architecture/conventions.md`](../architecture/conventions.md).
3. Revisa los ADRs en [`docs/adr/`](../adr/).
4. **No modifiques la landing de la raíz** (`index.html`, `script.js`, `styles.css`, `assets/`) sin aprobación.
