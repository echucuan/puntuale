# Operación local

> **Estado: Implementado (1.0-a).** No existe todavía ningún ambiente desplegado.

## Requisitos

Node.js ≥ 24, pnpm 12.18.0 y Docker (para la base local y las pruebas de integración). Ver la [guía de incorporación](../development/onboarding.md).

## Primer arranque

```bash
cp .env.example .env
pnpm db:up
pnpm db:migrate
pnpm dev
```

| Paso         | Qué hace                                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| `.env`       | Valores ficticios de desarrollo. Si el puerto 5432 está ocupado, cambia `PUNTUALE_DB_PORT` y las URL. |
| `db:up`      | Levanta PostgreSQL 18 (`infra/docker-compose.yml`) y espera a que esté sano                           |
| `db:migrate` | Crea o actualiza el rol `puntuale_app` y aplica las migraciones pendientes                            |
| `dev`        | API en `http://localhost:3000` y web en `http://localhost:5173`                                       |

`GET http://localhost:3000/health` debe responder `{"status":"ok","database":"up"}`. Las rutas `/api/t/...` responden 401 porque en 1.0-a no hay autenticación.

## Detener y limpiar

```bash
pnpm db:down
```

Los datos quedan en el volumen `puntuale-db`. Para borrarlos: `docker volume rm puntuale_puntuale-db`.

## Migraciones

- Viven en `db/migrations/NNNN_descripcion.sql` y se aplican en orden, cada una en su transacción.
- Una migración aplicada **no se edita**: el ejecutor compara checksums y se detiene si cambió.
