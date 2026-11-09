# Operación local

> **Estado: Implementado (1.0-b.1).** No existe todavía ningún ambiente desplegado.

## Requisitos

Node.js ≥ 24, pnpm 12.18.0 y Docker (para la base local y las pruebas de integración). Ver la [guía de incorporación](../development/onboarding.md).

## Primer arranque

```bash
cp .env.example .env
pnpm db:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

| Paso         | Qué hace                                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------------------------- |
| `.env`       | Valores ficticios de desarrollo. Si el puerto 5432 está ocupado, cambia `PUNTUALE_DB_PORT` y las URL.           |
| `db:up`      | Levanta PostgreSQL 18 (`infra/docker-compose.yml`) y espera a que esté sano                                     |
| `db:migrate` | Crea o actualiza el rol `puntuale_app` y aplica las migraciones pendientes                                      |
| `db:seed`    | Crea las cuentas ficticias de desarrollo. Es idempotente y se niega a correr en producción o fuera de localhost |
| `dev`        | API en `http://localhost:3000` y web en `http://localhost:5173`                                                 |

`GET http://localhost:3000/health` debe responder `{"status":"ok","database":"up"}`. Las rutas `/api/t/...` responden 401 sin sesión.

## Cuentas ficticias

| Correo                     | Contraseña        | Estado        |
| -------------------------- | ----------------- | ------------- |
| `ana.demo@puntuale.test`   | `Demo-Ana-2027`   | Activa        |
| `luis.demo@puntuale.test`  | `Demo-Luis-2027`  | Activa        |
| `baja.demo@puntuale.test`  | `Demo-Baja-2027`  | Deshabilitada |
| `admin.demo@puntuale.test` | `Demo-Admin-2027` | Activa        |

La semilla crea «Empresa Piloto Demo» con Ana y Luis como colaboradores y `admin.demo@puntuale.test` como propietario, sin registro de colaborador. Repetirla no cambia membresías, roles ni MFA existentes.

`MFA_ENCRYPTION_KEY` es obligatoria: si tu `.env` es anterior a 1.0-b.2, cópiala de `.env.example`. No la cambies después de inscribir MFA: la custodia está en [`docs/security/README.md`](../security/README.md).

Solo sirven en local. Las variables opcionales de duración y límites están comentadas en `.env.example`.

## Detener y limpiar

```bash
pnpm db:down
```

Los datos quedan en el volumen `puntuale-db`. Para borrarlos: `docker volume rm puntuale_puntuale-db`.

## Migraciones

- Viven en `db/migrations/NNNN_descripcion.sql` y se aplican en orden, cada una en su transacción.
- Una migración aplicada **no se edita**: el ejecutor compara checksums y se detiene si cambió.
