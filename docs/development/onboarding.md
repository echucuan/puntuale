# Guía de incorporación

> **Estado: Implementado.** Esta guía describe solo los comandos que existen hoy y se actualiza en cada paso.

## 1. Requisitos

| Herramienta | Versión                              | Para qué                            |
| ----------- | ------------------------------------ | ----------------------------------- |
| Node.js     | ≥ 24                                 | Ejecutar las herramientas y la API  |
| pnpm        | 12.18.0 (fijada en `packageManager`) | Gestor de paquetes del monorepo     |
| Git         | Cualquier versión reciente           | Control de versiones                |
| Docker      | Con `docker compose` v2              | Base local y pruebas de integración |

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

| Comando                  | Qué hace                                                                                                                      | ¿Requiere Docker? |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `pnpm check`             | Formato, lint, tipos, pruebas unitarias, frontera V1/V2 y acciones de CI fijadas. **Debe pasar antes de cada commit.**        | No                |
| `pnpm format`            | Aplica el formato de Prettier                                                                                                 | No                |
| `pnpm lint`              | ESLint en todo el monorepo                                                                                                    | No                |
| `pnpm typecheck`         | Ejecuta `tsc --noEmit` en cada paquete                                                                                        | No                |
| `pnpm test`              | Pruebas unitarias (Vitest) de cada paquete                                                                                    | No                |
| `pnpm check:boundary`    | Falla si el código ejecutable contiene términos de nómina ([ADR 0006](../adr/0006-v1-v2-separation-and-versioned-closure.md)) | No                |
| `pnpm check:ci-pins`     | Falla si una acción de `.github/workflows/` no está fijada a un SHA completo con `# vX.Y.Z`                                   | No                |
| `pnpm build`             | Compila la web                                                                                                                | No                |
| `pnpm test:integration`  | Integración contra PostgreSQL 18 (Testcontainers): RLS, inmutabilidad, auditoría, ingesta                                     | **Sí**            |
| `pnpm test:e2e`          | API por HTTP (supertest) contra PostgreSQL 18                                                                                 | **Sí**            |
| `pnpm db:up` / `db:down` | Levanta o detiene la base local (`infra/docker-compose.yml`)                                                                  | **Sí**            |
| `pnpm db:migrate`        | Crea el rol de aplicación y aplica las migraciones                                                                            | **Sí** (base)     |
| `pnpm dev`               | API (`:3000`) y web (`:5173`) en modo desarrollo                                                                              | **Sí** (base)     |

Si cambias la base de datos o la API, además de `pnpm check` deben pasar `pnpm test:integration` y `pnpm test:e2e`. Para arrancar el entorno local, ver [`docs/operations/local.md`](../operations/local.md).

## 4. Configuración compartida

Las herramientas comunes se configuran en la raíz. No hay un paquete `packages/config` aparte: con un monorepo de este tamaño, sería una pieza más sin beneficio ([ADR 0002](../adr/0002-modular-monolith-and-stack.md)).

| Archivo                                | Contenido                                               |
| -------------------------------------- | ------------------------------------------------------- |
| `tsconfig.base.json`                   | TypeScript estricto. Cada paquete lo extiende.          |
| `eslint.config.js`                     | ESLint con `typescript-eslint`. Ignora la landing.      |
| `.prettierrc.json` / `.prettierignore` | Formato. Ignora la landing y los documentos históricos. |
| `.editorconfig` / `.gitattributes`     | Fin de línea LF. La landing se preserva byte a byte.    |

**Versiones fijadas:** TypeScript queda en 6.0.3 porque `typescript-eslint` 8 todavía no admite TypeScript ≥ 6.1.

**Scripts de instalación:** `pnpm-workspace.yaml` deniega explícitamente (`allowBuilds`) los scripts de instalación de las dependencias. **Hoy no hay ninguna dependencia autorizada** para ejecutar scripts:

| Dependencia    | Viene de                    | Por qué no hace falta su script                                     |
| -------------- | --------------------------- | ------------------------------------------------------------------- |
| `esbuild`      | `tsx`, Vite                 | Su binario llega como dependencia opcional de la plataforma         |
| `ssh2`         | Testcontainers              | Solo se usa para Docker remoto por SSH; su parte nativa es opcional |
| `cpu-features` | `ssh2`                      | Optimización nativa opcional                                        |
| `protobufjs`   | Testcontainers (transitiva) | No se usa directamente; las pruebas pasan sin su script             |

Una instalación limpia (`pnpm install --frozen-lockfile`) ejecuta `pnpm check`, `pnpm build`, `pnpm test:integration` y `pnpm test:e2e` sin esos scripts; CI lo comprueba en cada cambio. Si una dependencia nueva necesita compilar, se autoriza en `allowBuilds` con una justificación en esta tabla.

**TypeScript** está fijado en `6.0.3` exacto (`package.json` y `pnpm-lock.yaml`).

**Overrides de seguridad:** `pnpm-workspace.yaml` fuerza `glob` ≥ 14.0.2 y `minimatch` ≥ 11.0.1 en las dependencias de desarrollo que los traen. El motivo y los avisos están en [`docs/security/README.md`](../security/README.md). Revisa con `pnpm audit --prod` y `pnpm audit --dev` por separado.

**Pruebas con sesión:** la aplicación productiva no tiene ningún atajo de sesión. Las pruebas e2e que necesitan una sesión usan `createTestApp` (`apps/api/test/support/create-test-app.ts`), que sustituye el resolvedor por `TestSessionResolver`. Este solo funciona con la configuración de `vitest.e2e.config.ts` y una base local ([ADR 0007](../adr/0007-own-authentication.md)).

**Decoradores en la API:** NestJS usa decoradores heredados (`experimentalDecorators`) sin `emitDecoratorMetadata`. Por eso cada dependencia se inyecta con `@Inject(TOKEN)` explícito.

## 5. Antes de contribuir

1. Lee [`CLAUDE.md`](../../CLAUDE.md): reglas permanentes y definición de terminado.
2. Lee [`docs/architecture/conventions.md`](../architecture/conventions.md).
3. Revisa los ADRs en [`docs/adr/`](../adr/).
4. **No modifiques la landing de la raíz** (`index.html`, `script.js`, `styles.css`, `assets/`) sin aprobación.
