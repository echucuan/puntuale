# Changelog

Todos los cambios relevantes del proyecto se registran aquí. El formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Las versiones siguen los pasos del plan (1.0-a, 1.0-b, …).

## [Sin publicar] · 1.0-a Base del monorepo

### Agregado

- Repositorio inicializado sobre `echucuan/puntuale` (`main` en `725ac2d`), con la landing preservada byte a byte en la raíz y `.nojekyll` para GitHub Pages.
- Documentación base:
  - ADRs 0001–0012;
  - alcance de la V1 y frontera con la V2;
  - convenciones;
  - diseño planificado;
  - riesgos del modo sin conexión;
  - inventario de referencias legales;
  - documentación de la landing;
  - propuesta original archivada como histórica.
- Herramientas del monorepo: workspaces de pnpm 12, TypeScript 6.0 estricto (`tsconfig.base.json`), ESLint 10 con `typescript-eslint`, Prettier 3 y el comando `pnpm check`.
- Guía de incorporación (`docs/development/onboarding.md`).
- `@puntuale/contracts`: enumeraciones (cuatro estados de asistencia con etiquetas en español), validación de tiempo (IANA, hora local, instante), contrato de marcación que separa evidencia y transporte, y contratos HTTP base.
