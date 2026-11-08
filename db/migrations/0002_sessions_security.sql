-- 0002 · Sesiones, eventos de seguridad y acceso controlado a la identidad (1.0-b.1, ADR 0014)
--
-- Reglas:
--   * En la base solo se guarda el hash del token de sesión.
--   * security_event solo acepta inserciones.
--   * puntuale_app deja de leer app_user: la identidad se obtiene con funciones SECURITY DEFINER.
--   * El dueño de esas funciones es un rol sin login, sin superusuario y con permisos mínimos.
--   * Sin DELETE ni TRUNCATE para puntuale_app en ninguna tabla.

-- ---------------------------------------------------------------------------
-- Rol dueño de las funciones SECURITY DEFINER
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'puntuale_auth_definer') THEN
    CREATE ROLE puntuale_auth_definer
      NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
END;
$$;

GRANT USAGE ON SCHEMA public TO puntuale_auth_definer;

-- ---------------------------------------------------------------------------
-- app_user_credential: contraseña de una persona. puntuale_app no tiene acceso directo.
-- ---------------------------------------------------------------------------

CREATE TABLE app_user_credential (
  user_id        uuid PRIMARY KEY REFERENCES app_user (id),
  password_hash  text NOT NULL CHECK (password_hash LIKE '$argon2id$%'),
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- auth_session: sesión de una persona. Global: no identifica a una empresa (ADR 0014).
-- ---------------------------------------------------------------------------

CREATE TABLE auth_session (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id           uuid NOT NULL REFERENCES app_user (id),
  token_hash        text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at        timestamptz NOT NULL DEFAULT statement_timestamp(),
  last_activity_at  timestamptz NOT NULL DEFAULT statement_timestamp(),
  idle_expires_at   timestamptz NOT NULL,
  expires_at        timestamptz NOT NULL,
  revoked_at        timestamptz NULL,
  revoked_reason    text NULL CHECK (revoked_reason IN ('logout', 'rotated', 'user_revoked')),
  request_ip        inet NULL,
  user_agent        text NULL CHECK (length(user_agent) <= 512),
  CONSTRAINT auth_session_revoked_pair CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);

CREATE INDEX auth_session_user_active_idx ON auth_session (user_id) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- security_event: eventos de autenticación. Global y de solo inserción (ADR 0014).
-- No guarda contraseñas, tokens ni el correo: si la persona no se conoce, guarda un HMAC.
-- ---------------------------------------------------------------------------

CREATE TABLE security_event (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id        uuid NOT NULL DEFAULT uuidv7() UNIQUE,
  event_type       text NOT NULL
    CHECK (event_type IN ('login_succeeded', 'login_failed', 'logout', 'session_revoked')),
  result           text NOT NULL CHECK (result IN ('success', 'failure')),
  failure_reason   text NULL CHECK (length(failure_reason) <= 64),
  user_id          uuid NULL REFERENCES app_user (id),
  session_id       uuid NULL REFERENCES auth_session (id),
  identifier_hash  text NULL CHECK (identifier_hash ~ '^[0-9a-f]{64}$'),
  request_ip       inet NULL,
  user_agent       text NULL CHECK (length(user_agent) <= 512),
  request_id       text NULL CHECK (length(request_id) <= 128),
  occurred_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT security_event_failure_reason CHECK ((result = 'failure') = (failure_reason IS NOT NULL))
);

CREATE INDEX security_event_user_idx ON security_event (user_id, occurred_at);
CREATE INDEX security_event_occurred_idx ON security_event (occurred_at);

CREATE TRIGGER security_event_reject_update_delete
  BEFORE UPDATE OR DELETE ON security_event
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER security_event_reject_truncate
  BEFORE TRUNCATE ON security_event
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();

-- ---------------------------------------------------------------------------
-- Límites de tasa. Las llaves son HMAC: no contienen correos ni IP en claro.
-- ---------------------------------------------------------------------------

CREATE TABLE login_failure (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_key  text NOT NULL CHECK (account_key ~ '^[0-9a-f]{64}$'),
  ip_key       text NOT NULL CHECK (ip_key ~ '^[0-9a-f]{64}$'),
  occurred_at  timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX login_failure_account_idx ON login_failure (account_key, occurred_at);
CREATE INDEX login_failure_ip_idx ON login_failure (ip_key, occurred_at);
CREATE INDEX login_failure_occurred_idx ON login_failure (occurred_at);

CREATE TABLE rate_limit_bucket (
  scope         text NOT NULL CHECK (scope IN ('api_ip', 'api_session')),
  key_hash      text NOT NULL CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  window_start  timestamptz NOT NULL,
  hits          integer NOT NULL CHECK (hits > 0),
  PRIMARY KEY (scope, key_hash, window_start)
);

CREATE INDEX rate_limit_bucket_window_idx ON rate_limit_bucket (window_start);

-- ---------------------------------------------------------------------------
-- Permisos del dueño de las funciones: solo lo que cada función necesita
-- ---------------------------------------------------------------------------

GRANT SELECT (id, email, display_name) ON app_user TO puntuale_auth_definer;
GRANT SELECT (user_id, password_hash, status) ON app_user_credential TO puntuale_auth_definer;
GRANT SELECT ON auth_session TO puntuale_auth_definer;
GRANT SELECT, DELETE ON login_failure TO puntuale_auth_definer;
GRANT SELECT, DELETE ON rate_limit_bucket TO puntuale_auth_definer;

-- ---------------------------------------------------------------------------
-- Funciones SECURITY DEFINER
-- ---------------------------------------------------------------------------

-- Localiza una cuenta activa para el login. Sin fila si no existe o está deshabilitada: quien
-- llama no distingue un caso del otro. Devuelve el hash porque Argon2id se verifica en la API.
CREATE FUNCTION auth_find_account(p_email text)
  RETURNS TABLE (user_id uuid, password_hash text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT u.id, c.password_hash
    FROM public.app_user u
    JOIN public.app_user_credential c ON c.user_id = u.id
   WHERE u.email = p_email::public.citext
     AND c.status = 'active';
$$;

-- Devuelve la identidad solo a quien posee el hash de una sesión activa de una cuenta activa.
CREATE FUNCTION auth_session_identity(p_token_hash text)
  RETURNS TABLE (
    session_id uuid,
    user_id uuid,
    email text,
    display_name text,
    created_at timestamptz,
    last_activity_at timestamptz,
    idle_expires_at timestamptz,
    expires_at timestamptz
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT s.id, s.user_id, u.email::text, u.display_name,
         s.created_at, s.last_activity_at, s.idle_expires_at, s.expires_at
    FROM public.auth_session s
    JOIN public.app_user u ON u.id = s.user_id
    JOIN public.app_user_credential c ON c.user_id = s.user_id AND c.status = 'active'
   WHERE s.token_hash = p_token_hash
     AND s.revoked_at IS NULL
     AND s.expires_at > statement_timestamp()
     AND s.idle_expires_at > statement_timestamp();
$$;

-- Borra los fallos de una cuenta después de un login exitoso.
CREATE FUNCTION auth_clear_login_failures(p_account_key text)
  RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
AS $$
  DELETE FROM public.login_failure WHERE account_key = p_account_key;
$$;

-- Limpia los contadores vencidos. Solo toca datos de límites de tasa.
CREATE FUNCTION auth_purge_throttle()
  RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
AS $$
  DELETE FROM public.login_failure WHERE occurred_at < statement_timestamp() - interval '1 day';
  DELETE FROM public.rate_limit_bucket WHERE window_start < statement_timestamp() - interval '1 hour';
$$;

ALTER FUNCTION auth_find_account(text) OWNER TO puntuale_auth_definer;
ALTER FUNCTION auth_session_identity(text) OWNER TO puntuale_auth_definer;
ALTER FUNCTION auth_clear_login_failures(text) OWNER TO puntuale_auth_definer;
ALTER FUNCTION auth_purge_throttle() OWNER TO puntuale_auth_definer;

REVOKE ALL ON FUNCTION auth_find_account(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_session_identity(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_clear_login_failures(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_purge_throttle() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION auth_find_account(text) TO puntuale_app;
GRANT EXECUTE ON FUNCTION auth_session_identity(text) TO puntuale_app;
GRANT EXECUTE ON FUNCTION auth_clear_login_failures(text) TO puntuale_app;
GRANT EXECUTE ON FUNCTION auth_purge_throttle() TO puntuale_app;

-- ---------------------------------------------------------------------------
-- Permisos del rol de aplicación
-- ---------------------------------------------------------------------------

REVOKE ALL ON app_user_credential, auth_session, security_event, login_failure, rate_limit_bucket
  FROM PUBLIC;

-- La aplicación deja de leer app_user directamente (ADR 0014).
REVOKE SELECT ON app_user FROM puntuale_app;

-- Solo las columnas de actividad y revocación son modificables: el token, la persona y las fechas
-- de creación y expiración absoluta no cambian.
GRANT SELECT, INSERT ON auth_session TO puntuale_app;
GRANT UPDATE (last_activity_at, idle_expires_at, revoked_at, revoked_reason) ON auth_session TO puntuale_app;

GRANT INSERT ON security_event TO puntuale_app;
GRANT SELECT, INSERT ON login_failure TO puntuale_app;
GRANT SELECT, INSERT, UPDATE ON rate_limit_bucket TO puntuale_app;
