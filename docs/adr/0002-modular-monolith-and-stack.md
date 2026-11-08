# ADR 0002 · Monolito modular en TypeScript con NestJS, PostgreSQL y React

- **Fecha:** 2026-11-07
- **Estado:** Aceptado

## Contexto

La V1 tiene unos doce módulos de dominio con reglas transaccionales estrictas: inmutabilidad, auditoría dentro de la misma transacción y aislamiento por empresa. La V2 (nómina) debe poder agregarse como un módulo más, y el equipo es pequeño.

## Problema

¿Qué arquitectura y qué stack permiten fronteras claras entre módulos, transacciones confiables y una operación sencilla para un equipo pequeño?

## Alternativas consideradas

1. **Microservicios:** exigen demasiada operación para un equipo pequeño y obligan a usar transacciones distribuidas sin necesidad.
2. **Supabase con la lógica en la base de datos:** permite avanzar rápido, pero ata las reglas de dominio a funciones SQL y complica la V2.
3. **Next.js full-stack:** tiene menos piezas, pero las fronteras entre módulos quedan menos marcadas.
4. **Monolito modular:** NestJS (API), PostgreSQL y React + Vite (PWA), todo en TypeScript, en un monorepo con pnpm.

## Decisión

- **Arquitectura:** monolito modular. Cada módulo se divide en las capas `domain / application / infrastructure / http`. Un módulo usa otro solo a través de su servicio de aplicación o de eventos, nunca leyendo sus tablas directamente.
- **API:** NestJS. Las dependencias se inyectan con `@Inject(TOKEN)` explícito, sin depender de `emitDecoratorMetadata`, para que se comporten igual con `tsc`, `tsx` y Vitest.
- **Base de datos:** PostgreSQL **18**. Se eligió en lugar de la versión 16 que indicaba la propuesta porque incluye `uuidv7()` nativo, y así se evita una dependencia.
- **Migraciones:** SQL versionado escrito a mano en `db/migrations/`. Las políticas RLS, los triggers y las restricciones de exclusión se expresan mejor en SQL. Las aplica un ejecutor pequeño propio, `@puntuale/db`.
- **Acceso a datos:** la propuesta contempla Drizzle ORM. En el paso 1.0-a se usa `pg` directamente porque solo hay tres consultas. Drizzle se incorporará, con su propio ADR, cuando llegue el primer módulo con CRUD (1.0-b).
- **Validación y contratos:** Zod en `packages/contracts`, compartido entre la API y la web.
- **Web:** React + Vite. La PWA llega en el paso 1.0-d.
- **Monorepo:** workspaces de pnpm, **sin Turborepo**. Con cinco paquetes basta `pnpm -r`. Turborepo puede agregarse si los tiempos de compilación lo justifican.
- **Pruebas:** Vitest para las pruebas unitarias, Testcontainers para la integración con un PostgreSQL real y supertest para las pruebas e2e de la API.

## Consecuencias

- Hay un solo despliegue y una sola base de datos, con transacciones locales.
- Las fronteras entre módulos dependen de las convenciones ([ADR 0009](0009-naming-conventions.md)) y de la revisión de código, no de un aislamiento físico.
- Las pruebas de integración y las e2e requieren Docker.
- Los paquetes internos se consumen como código TypeScript fuente, sin compilarlos por separado. El empaquetado para producción está **planificado** y no forma parte del paso 1.0-a.
