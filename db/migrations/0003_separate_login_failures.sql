-- 0003 · Separa los fallos de login por cuenta y por IP (ADR 0014).
--
-- En 0002 una misma fila alimentaba ambos límites, y borrar los fallos de una cuenta tras un login
-- exitoso reducía también el conteo de la IP. Desde aquí cada límite tiene su propia tabla: un
-- login exitoso reinicia su cuenta y solo retira su propio intento de la IP.

ALTER TABLE login_failure RENAME TO login_failure_account;
ALTER INDEX login_failure_occurred_idx RENAME TO login_failure_account_occurred_idx;

CREATE TABLE login_failure_ip (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ip_key       text NOT NULL CHECK (ip_key ~ '^[0-9a-f]{64}$'),
  occurred_at  timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- El historial de IP vigente se conserva.
INSERT INTO login_failure_ip (ip_key, occurred_at)
SELECT ip_key, occurred_at FROM login_failure_account;

-- Elimina también el índice login_failure_ip_idx de 0002.
ALTER TABLE login_failure_account DROP COLUMN ip_key;

CREATE INDEX login_failure_ip_key_idx ON login_failure_ip (ip_key, occurred_at);
CREATE INDEX login_failure_ip_occurred_idx ON login_failure_ip (occurred_at);

REVOKE ALL ON login_failure_ip FROM PUBLIC;
GRANT SELECT, DELETE ON login_failure_ip TO puntuale_auth_definer;
GRANT SELECT, INSERT ON login_failure_ip TO puntuale_app;

-- CREATE OR REPLACE conserva el dueño y los permisos asignados en 0002.
CREATE OR REPLACE FUNCTION auth_clear_login_failures(p_account_key text)
  RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
AS $$
  DELETE FROM public.login_failure_account WHERE account_key = p_account_key;
$$;

CREATE OR REPLACE FUNCTION auth_purge_throttle()
  RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
AS $$
  DELETE FROM public.login_failure_account WHERE occurred_at < statement_timestamp() - interval '1 day';
  DELETE FROM public.login_failure_ip WHERE occurred_at < statement_timestamp() - interval '1 day';
  DELETE FROM public.rate_limit_bucket WHERE window_start < statement_timestamp() - interval '1 hour';
$$;

-- Retira de la IP únicamente el intento reservado por un login con contraseña correcta.
CREATE FUNCTION auth_release_login_ip_attempt(p_attempt_id bigint, p_ip_key text)
  RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
AS $$
  DELETE FROM public.login_failure_ip WHERE id = p_attempt_id AND ip_key = p_ip_key;
$$;

ALTER FUNCTION auth_release_login_ip_attempt(bigint, text) OWNER TO puntuale_auth_definer;
REVOKE ALL ON FUNCTION auth_release_login_ip_attempt(bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_release_login_ip_attempt(bigint, text) TO puntuale_app;
