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
  - Las pruebas usan `TestSessionResolver`, que se registra **solo** con `NODE_ENV=test`. Si se intenta activar en cualquier otro entorno, el arranque falla.
  - **No hay ningún atajo de desarrollo.**

## Consecuencias

- Hasta el paso 1.0-b, las rutas de tenant solo se pueden ejercitar con pruebas automatizadas, no manualmente.
- Codex hará una revisión de seguridad específica en el paso 1.0-b.
