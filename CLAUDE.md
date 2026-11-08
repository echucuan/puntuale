# Instrucciones para agentes y colaboradores

Este archivo resume las reglas permanentes del proyecto. Se aplica a cualquier persona o agente que modifique el repositorio.

## Equipo y flujo

- **Propietario:** define las prioridades, prueba y aprueba.
- **Arquitecto:** diseña la arquitectura, las reglas y los criterios de aceptación.
- **Implementador:** escribe el código, las pruebas y la documentación, y hace los commits.
- **Revisor:** revisa el código y la seguridad, sin modificarlo.

Se trabaja una funcionalidad a la vez. Cada paso entrega un objetivo, criterios de aceptación, código con pruebas, una revisión y la aceptación del propietario.

## Reglas que no se negocian

1. **Separación V1/V2.** La V1 no maneja dinero. No se crean módulos, tablas, endpoints ni lógica de nómina en el código ejecutable. Ver `docs/versions/`.
2. **Multiempresa.**
   - Toda tabla operativa lleva `tenant_id`, con llaves foráneas compuestas `(tenant_id, x_id)`.
   - La autorización ocurre en la aplicación (`TenantGuard`). La RLS que falla cerrada es una defensa adicional, no un sustituto.
   - Nunca se confía en un `tenant_id` enviado por el cliente sin validar la membresía.
3. **Inmutabilidad.** `attendance_event` y `audit_event` solo aceptan inserciones. Una corrección crea un evento nuevo.
4. **Auditoría.** Todo cambio de datos se audita **dentro de la misma transacción**.
5. **Tiempo.** Los instantes se guardan en UTC y las zonas como identificadores IANA. La hora que declara el dispositivo es evidencia, no una fuente confiable. Ver ADR 0010 y ADR 0011.
6. **Capas.** Las reglas de negocio no van en los controladores ni en los componentes visuales.
7. **Legal.** La información legal es contexto de producto. No se inventan obligaciones ni se presentan las decisiones técnicas como asesoría legal.
8. **Repositorio público.**
   - No se suben secretos, datos reales ni los PDF legales.
   - La landing de la raíz (`index.html`, `script.js`, `styles.css`, `assets/`) **no se modifica** sin aprobación.
   - No se agrega un `LICENSE` sin aprobación.
9. **No se hace `push`** sin autorización explícita del propietario.

## Definición de terminado

Una tarea está terminada solo si:

- El código funciona y tiene pruebas de sus reglas críticas: multiempresa, inmutabilidad, auditoría, cierres y permisos.
- `pnpm check` pasa y, si hubo cambios en la base de datos o la API, también `pnpm test:integration` y `pnpm test:e2e`.
- En el mismo commit se actualizó la documentación que corresponda: arquitectura, modelo de datos, contratos de API, guía de desarrollo, el README del módulo y `CHANGELOG.md`.
- Toda decisión relevante quedó registrada en un ADR (`docs/adr/0000-template.md`).
- La documentación **solo describe lo que existe**. Cada documento marca su estado: Aprobado, Planificado, Implementado o Histórico.
- Cada commit tiene un solo propósito, con un mensaje en español y prefijo convencional.

## Módulos nuevos

Cada módulo en `apps/api/src/modules/<modulo>/` incluye un `README.md` con estas secciones: propósito, responsabilidades, dependencias, reglas de negocio, entradas y salidas, pruebas relacionadas y cómo extenderlo. La plantilla está en `docs/development/module-template.md`.

## Convenciones

Ver `docs/architecture/conventions.md` (ADR 0009).
