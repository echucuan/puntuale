# ADR 0007 · Autenticación propia con sesiones en el servidor

- **Fecha:** 2026-11-07
- **Estado:** Aceptado. **Su implementación está planificada para el paso 1.0-b**; en el 1.0-a no hay autenticación.

## Contexto

Los usuarios son administradores, personal de RH, supervisores y colaboradores. Como el repositorio es público, el código de seguridad será visible para cualquiera.

## Problema

¿Usamos autenticación propia o un proveedor gestionado?

## Alternativas consideradas

1. **Proveedor gestionado** (Auth0, Clerk o Cognito): requiere menos código propio, pero cobra por usuario activo y deja los datos en manos de un tercero.
2. **Autenticación propia**, construida con librerías probadas.

## Decisión

- **Mecanismo:** sesiones guardadas en PostgreSQL con una cookie `httpOnly`, `Secure` y `SameSite`. Contraseñas con Argon2id y MFA (TOTP) obligatorio para administradores.
- **Librerías:** se usan librerías probadas; no se implementa criptografía propia.
- **En el paso 1.0-a no hay autenticación:**
  - El `TenantGuard` depende de un puerto `SessionResolver`. Su implementación de producción, `NoSessionResolver`, siempre responde que no hay sesión, así que toda ruta de tenant devuelve 401.
  - El módulo productivo registra **siempre** `NoSessionResolver`. No depende de ninguna variable de entorno.
  - Las pruebas usan `TestSessionResolver`, que **no existe en `src/`**: vive en `apps/api/test/support/` y solo se registra con la composición explícita de pruebas (`createTestApp`), que sobrescribe el proveedor. Su constructor exige además, todas a la vez, `NODE_ENV=test`, `VITEST=true`, la marca `PUNTUALE_TEST_COMPOSITION=explicit-test-composition` y una base en `localhost`, `127.0.0.1` o `::1`; si falta una, falla.
  - **No hay ningún atajo de desarrollo.**

## Revisión (revisión de seguridad de Codex, 1.0-a)

La primera versión registraba `TestSessionResolver` desde el módulo productivo cuando `NODE_ENV=test`. Una variable mal configurada habría bastado para aceptar identidades sin verificar. Se cambió a lo descrito arriba: el adaptador sale del código productivo y la protección ya no depende solo de una variable de entorno. Lo comprueban `src/modules/tenancy/infrastructure/session-resolver.test.ts` (el módulo productivo usa `NoSessionResolver` con cualquier `NODE_ENV`, y ningún archivo de `src/` menciona el adaptador ni su encabezado), `test/unit/test-session.resolver.test.ts` (cada condición por separado) y el e2e `composición productiva (createApp)` (401 aunque se envíe el encabezado de pruebas).

## Consecuencias

- Hasta el paso 1.0-b, las rutas de tenant solo se pueden ejercitar con pruebas automatizadas, no manualmente.
- Codex hará una revisión de seguridad específica en el paso 1.0-b.
