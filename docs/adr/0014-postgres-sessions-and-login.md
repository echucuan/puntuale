# ADR 0014 · Sesiones en PostgreSQL y acceso controlado a la identidad

- **Fecha:** 2026-11-08
- **Estado:** Aceptado

## Contexto

El ADR 0007 fijó autenticación propia con sesiones en PostgreSQL y dejó la implementación para 1.0-b. El arquitecto dividió ese paso en dos entregas: 1.0-b.1 (sesiones y protecciones HTTP) y 1.0-b.2 (membresías, roles, permisos y MFA). Esta decisión cubre **solo 1.0-b.1**.

La revisión de seguridad de 1.0-a dejó tres riesgos que este paso debe cerrar o reducir: R2 (sin autenticación real), R5 (`app_user` legible por el rol de la aplicación) y R6 (sin límites de tasa, Helmet ni CORS).

## Problema

¿Cómo se autentica una persona, cómo se protege la sesión y cómo se evita que el rol de la aplicación pueda leer todas las identidades?

## Alternativas consideradas

1. **JWT sin estado:** no requiere consultar la base, pero la revocación inmediata obliga a mantener una lista en servidor, lo que elimina la ventaja.
2. **Sesiones en PostgreSQL:** una consulta por petición, revocación inmediata y una sola fuente de verdad. Es la opción elegida (ADR 0007).
3. **`SELECT` sobre `app_user` filtrado por la aplicación:** simple, pero un fallo en la aplicación expondría todos los correos.
4. **Funciones `SECURITY DEFINER` con un dueño sin privilegios:** el rol de la aplicación solo obtiene lo que cada función devuelve. Es la opción elegida.

## Decisión

### Sesión

- El token es de 256 bits aleatorios. En la base solo se guarda su SHA-256 (`auth_session.token_hash`), nunca el token.
- Duración absoluta de 12 horas e inactividad de 30 minutos, configurables. Los instantes los calcula la base (`statement_timestamp()`, ADR 0010).
- `last_activity_at` se actualiza como máximo una vez por minuto, para no escribir en cada petición. La inactividad puede vencer hasta un minuto antes de lo exacto, nunca después.
- Cada inicio de sesión crea un identificador nuevo. Si la petición traía una sesión válida, esa sesión se revoca en la misma transacción (rotación).
- El cierre de sesión y la revocación toman efecto de inmediato. Una persona puede listar y revocar **sus propias** sesiones; otra sesión responde 404.
- Sin «recordarme».
- Una sesión expirada o revocada requiere iniciar sesión nuevamente: no existe recuperación de sesión ni un evento para ella. La recuperación de MFA es un flujo diferente, reservado para 1.0-b.2.
- `auth_session` es global (sin `tenant_id`): una sesión identifica a una persona, no a una empresa. La empresa activa se valida por petición en la URL (`TenantGuard`).

### Cookie

| Entorno    | Nombre                    | Atributos                                      |
| ---------- | ------------------------- | ---------------------------------------------- |
| Producción | `__Host-puntuale_session` | `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/` |
| Desarrollo | `puntuale_session`        | `HttpOnly`, `SameSite=Lax`, `Path=/`           |

Nunca se configura `Domain`. El prefijo `__Host-` exige `Secure`, por lo que no sirve en `http://localhost`. `Secure=false` solo es posible fuera de producción, y la configuración rechaza fuera de producción cualquier origen que no sea `localhost` o `127.0.0.1`.

### Contraseñas

Argon2id con 64 MiB, 3 iteraciones y paralelismo 1, sujeto a medición en el entorno real. Si la cuenta no existe, se verifica contra un hash ficticio con los mismos parámetros, para igualar el tiempo de respuesta.

### Acceso a la identidad

- `puntuale_app` **no tiene** `SELECT` sobre `app_user` ni acceso alguno a `app_user_credential`.
- Las funciones `auth_find_account`, `auth_session_identity`, `auth_clear_login_failures` y `auth_purge_throttle` son `SECURITY DEFINER`, con `search_path` fijo, `EXECUTE` revocado de `PUBLIC` y concedido solo a `puntuale_app`.
- Su dueño es `puntuale_auth_definer`: `NOLOGIN`, sin superusuario, sin `BYPASSRLS` y con permisos solo sobre las columnas y tablas que necesitan.
- `auth_session_identity` recibe el hash del token: solo devuelve la identidad de quien posee una sesión activa.

**Decisión cerrada:** la API puede recibir internamente el hash Argon2id, porque la verificación ocurre en la aplicación y PostgreSQL no implementa Argon2id. `auth_find_account` lo devuelve solo para ese fin. La API nunca debe enviarlo al navegador, registrarlo ni auditarlo. Riesgo residual: quien controlara el rol de la aplicación podría pedir el hash de un correo que ya conozca, pero no listar cuentas.

### CSRF

- Token en el encabezado `X-CSRF-Token`, obligatorio en `POST`, `PUT`, `PATCH` y `DELETE`, incluidos login y logout.
- El token es un HMAC con `AUTH_SECRET`, ligado a la sesión. Antes del login se liga a un valor aleatorio en una cookie `HttpOnly` (`puntuale_csrf`, o `__Host-puntuale_csrf` en producción).
- Además se valida `Origin` contra la lista permitida; si falta, se valida `Referer`. Si faltan ambos en un método mutable, la petición se rechaza.
- `SameSite` no es la única defensa.

### CORS y Helmet

- CORS permite solo los orígenes de `CORS_ORIGINS`, con credenciales. Nunca `*`. Un `Origin` desconocido se rechaza con 403 en cualquier método.
- Producción exige orígenes `https` y rechaza `localhost`.
- Helmet aplica una CSP de API (`default-src 'none'`, `frame-ancestors 'none'`), `X-Content-Type-Options`, `Referrer-Policy: no-referrer` y `X-Frame-Options: DENY`. HSTS solo en producción.

### Límites de tasa

| Alcance                  | Límite                                   |
| ------------------------ | ---------------------------------------- |
| Login, por cuenta        | 5 fallos en 15 minutos                   |
| Login, por IP            | 20 fallos en 15 minutos                  |
| Login, espera progresiva | 1 s, 2 s, 4 s… hasta 30 s entre intentos |
| API, por IP              | 120 peticiones por minuto                |
| API, por sesión          | 300 peticiones por minuto                |

- Todos los valores son configurables.
- Ninguna cuenta se bloquea de forma permanente: el límite se libera al salir de la ventana.
- La respuesta es la misma exista o no la cuenta.
- El intento se registra **antes** de verificar la contraseña, para que peticiones concurrentes no superen el límite, y se borra si el login es exitoso.
- Las llaves se guardan como HMAC, no como correo o IP en claro.
- El almacenamiento es PostgreSQL mientras exista una sola instancia. El puerto `RateLimitStore` permite sustituirlo por Redis.

### Eventos de seguridad

`security_event` es global y solo acepta inserciones (trigger `reject_mutation()`; `puntuale_app` solo tiene `INSERT`). Registra `login_succeeded`, `login_failed`, `logout` y `session_revoked`, en la misma transacción que el cambio. Cuando no se conoce a la persona, guarda un HMAC del identificador, nunca el correo. No guarda contraseñas ni tokens.

Los eventos de MFA y `audit_event` por empresa llegan en 1.0-b.2.

## Consecuencias

- Toda petición con cookie consulta la base. Es aceptable para una sola instancia.
- R2 se reduce: existe autenticación real, y las rutas de empresa aceptan una sesión válida. Roles y permisos siguen pendientes (1.0-b.2).
- R5 se resuelve para `app_user`. `tenant` y `user_tenant` conservan sus permisos de 1.0-a.
- R6 se resuelve.
- `auth_session` y `security_event` crecen sin purga; falta definir su retención antes de producción.
- R7 sigue abierto: la IP es la de la conexión hasta resolver `trust proxy`. Detrás de un proxy, todos los límites por IP compartirían una misma IP.
- La cuenta de una persona puede quedar limitada 15 minutos si alguien falla 5 veces con su correo. Es el costo aceptado de un límite por cuenta sin bloqueo permanente.
