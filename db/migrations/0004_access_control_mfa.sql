-- 0004 · Roles, permisos, alcance y MFA TOTP (1.0-b.2, ADR 0015)
--
-- Reglas:
--   * Catálogo global y cerrado de roles y permisos: no hay roles personalizados.
--   * Los permisos de módulos futuros quedan como 'reserved' y nunca se conceden.
--   * membership_role lleva tenant_id, llave compuesta y RLS que falla cerrada.
--   * Sin DELETE para puntuale_app: una asignación se retira marcando revoked_at.
--   * El secreto TOTP solo se guarda cifrado por la API. Los códigos de recuperación, como hash.

-- ---------------------------------------------------------------------------
-- Catálogo de roles y permisos
-- ---------------------------------------------------------------------------

CREATE TABLE role (
  code          text PRIMARY KEY CHECK (code ~ '^[a-z][a-z_]*$'),
  requires_mfa  boolean NOT NULL,
  -- Asignar, retirar o afectar a quien tiene este rol exige access.manage_admins.
  is_admin      boolean NOT NULL
);

CREATE TABLE permission (
  code    text PRIMARY KEY CHECK (code ~ '^[a-z][a-z_]*\.[a-z][a-z_]*$'),
  status  text NOT NULL CHECK (status IN ('active', 'reserved'))
);

CREATE TABLE role_permission (
  role_code        text NOT NULL REFERENCES role (code),
  permission_code  text NOT NULL REFERENCES permission (code),
  PRIMARY KEY (role_code, permission_code)
);

INSERT INTO role (code, requires_mfa, is_admin) VALUES
  ('company_owner', true,  true),
  ('hr_admin',      true,  true),
  -- El auditor consulta el directorio de accesos de la empresa: también exige MFA.
  ('auditor',       true,  false),
  ('supervisor',    false, false),
  ('employee',      false, false);

INSERT INTO permission (code, status) VALUES
  ('access.read',               'active'),
  ('access.manage',             'active'),
  ('access.manage_admins',      'active'),
  ('attendance.read',           'reserved'),
  ('attendance.correct',        'reserved'),
  ('incident.read',             'reserved'),
  ('incident.review',           'reserved'),
  ('period.close',              'reserved'),
  ('period.reopen',             'reserved'),
  ('period.correct_after_close','reserved');

INSERT INTO role_permission (role_code, permission_code) VALUES
  ('company_owner', 'access.read'),
  ('company_owner', 'access.manage'),
  ('company_owner', 'access.manage_admins'),
  ('company_owner', 'attendance.read'),
  ('company_owner', 'attendance.correct'),
  ('company_owner', 'incident.read'),
  ('company_owner', 'incident.review'),
  ('company_owner', 'period.close'),
  ('company_owner', 'period.reopen'),
  ('company_owner', 'period.correct_after_close'),
  ('hr_admin',      'access.read'),
  ('hr_admin',      'access.manage'),
  ('hr_admin',      'attendance.read'),
  ('hr_admin',      'attendance.correct'),
  ('hr_admin',      'incident.read'),
  ('hr_admin',      'incident.review'),
  ('hr_admin',      'period.close'),
  ('hr_admin',      'period.reopen'),
  ('auditor',       'access.read'),
  ('auditor',       'attendance.read'),
  ('auditor',       'incident.read'),
  ('supervisor',    'attendance.read'),
  ('supervisor',    'incident.read'),
  ('supervisor',    'incident.review');

-- ---------------------------------------------------------------------------
-- membership_role: roles de una membresía
-- ---------------------------------------------------------------------------

CREATE TABLE membership_role (
  id                   uuid NOT NULL DEFAULT uuidv7() PRIMARY KEY,
  tenant_id            uuid NOT NULL REFERENCES tenant (id),
  membership_id        uuid NOT NULL,
  role_code            text NOT NULL REFERENCES role (code),
  -- Solo existe el alcance de empresa. Centro y área dependen de entidades que aún no existen.
  scope_type           text NOT NULL DEFAULT 'tenant' CHECK (scope_type = 'tenant'),
  assigned_at          timestamptz NOT NULL DEFAULT statement_timestamp(),
  assigned_by_user_id  uuid NULL REFERENCES app_user (id),
  revoked_at           timestamptz NULL,
  revoked_by_user_id   uuid NULL REFERENCES app_user (id),
  CONSTRAINT membership_role_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT membership_role_membership_fk FOREIGN KEY (tenant_id, membership_id)
    REFERENCES user_tenant (tenant_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX membership_role_active_key
  ON membership_role (tenant_id, membership_id, role_code) WHERE revoked_at IS NULL;

CREATE TRIGGER membership_role_reject_tenant_change
  BEFORE UPDATE OF tenant_id ON membership_role
  FOR EACH ROW EXECUTE FUNCTION reject_tenant_change();

ALTER TABLE membership_role ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_role FORCE ROW LEVEL SECURITY;
CREATE POLICY membership_role_tenant_isolation ON membership_role
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- ---------------------------------------------------------------------------
-- MFA: global por persona, como las credenciales
-- ---------------------------------------------------------------------------

CREATE TABLE user_mfa (
  user_id                    uuid PRIMARY KEY REFERENCES app_user (id),
  secret_ciphertext          text NULL CHECK (secret_ciphertext LIKE 'v1.%'),
  pending_secret_ciphertext  text NULL CHECK (pending_secret_ciphertext LIKE 'v1.%'),
  pending_created_at         timestamptz NULL,
  -- Último paso de 30 s aceptado: un código ya usado no se acepta otra vez.
  last_accepted_step         bigint NULL,
  activated_at               timestamptz NULL,
  created_at                 timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at                 timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT user_mfa_pending_pair
    CHECK ((pending_secret_ciphertext IS NULL) = (pending_created_at IS NULL)),
  CONSTRAINT user_mfa_active_pair
    CHECK ((secret_ciphertext IS NULL) = (activated_at IS NULL))
);

CREATE TABLE mfa_recovery_code (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id         uuid NOT NULL REFERENCES app_user (id),
  code_hash       text NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  created_at      timestamptz NOT NULL DEFAULT statement_timestamp(),
  used_at         timestamptz NULL,
  invalidated_at  timestamptz NULL,
  CONSTRAINT mfa_recovery_code_user_hash_key UNIQUE (user_id, code_hash)
);

CREATE INDEX mfa_recovery_code_usable_idx
  ON mfa_recovery_code (user_id) WHERE used_at IS NULL AND invalidated_at IS NULL;

CREATE TABLE mfa_attempt (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES app_user (id),
  occurred_at  timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX mfa_attempt_user_idx ON mfa_attempt (user_id, occurred_at);

-- Momento en que esta sesión completó MFA. Una sesión nueva empieza sin completarlo.
ALTER TABLE auth_session ADD COLUMN mfa_verified_at timestamptz NULL;

ALTER TABLE security_event DROP CONSTRAINT security_event_event_type_check;
ALTER TABLE security_event ADD CONSTRAINT security_event_event_type_check CHECK (event_type IN (
  'login_succeeded', 'login_failed', 'logout', 'session_revoked',
  'mfa_enrollment_started', 'mfa_enrolled', 'mfa_verified', 'mfa_failed',
  'mfa_recovery_used', 'mfa_replaced', 'mfa_disabled'
));

-- ---------------------------------------------------------------------------
-- Funciones SECURITY DEFINER
-- El dueño no tiene BYPASSRLS. Sus políticas de lectura son abiertas para que la función, y no la
-- política, decida: cada función filtra por una sesión vigente o por el tenant de la transacción.
-- ---------------------------------------------------------------------------

GRANT SELECT ON user_tenant, tenant, membership_role, role TO puntuale_auth_definer;
GRANT SELECT (user_id, occurred_at), DELETE ON mfa_attempt TO puntuale_auth_definer;

CREATE POLICY user_tenant_definer_read ON user_tenant
  FOR SELECT TO puntuale_auth_definer USING (true);
CREATE POLICY tenant_definer_read ON tenant
  FOR SELECT TO puntuale_auth_definer USING (true);
CREATE POLICY membership_role_definer_read ON membership_role
  FOR SELECT TO puntuale_auth_definer USING (true);

-- Agrega si esta sesión completó MFA. Cambia la forma de la función, por eso se reemplaza.
DROP FUNCTION auth_session_identity(text);

CREATE FUNCTION auth_session_identity(p_token_hash text)
  RETURNS TABLE (
    session_id uuid,
    user_id uuid,
    email text,
    display_name text,
    created_at timestamptz,
    last_activity_at timestamptz,
    idle_expires_at timestamptz,
    expires_at timestamptz,
    mfa_verified_at timestamptz
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT s.id, s.user_id, u.email::text, u.display_name,
         s.created_at, s.last_activity_at, s.idle_expires_at, s.expires_at, s.mfa_verified_at
    FROM public.auth_session s
    JOIN public.app_user u ON u.id = s.user_id
    JOIN public.app_user_credential c ON c.user_id = s.user_id AND c.status = 'active'
   WHERE s.token_hash = p_token_hash
     AND s.revoked_at IS NULL
     AND s.expires_at > statement_timestamp()
     AND s.idle_expires_at > statement_timestamp();
$$;

-- Empresas activas de quien posee el hash de una sesión vigente. Nada para cualquier otro valor.
CREATE FUNCTION auth_session_tenants(p_token_hash text)
  RETURNS TABLE (
    tenant_id uuid,
    legal_name text,
    membership_id uuid,
    roles text[],
    requires_mfa boolean
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT t.id, t.legal_name, ut.id,
         COALESCE(array_agg(r.code ORDER BY r.code) FILTER (WHERE r.code IS NOT NULL), '{}'),
         COALESCE(bool_or(r.requires_mfa), false)
    FROM public.auth_session s
    JOIN public.app_user_credential c ON c.user_id = s.user_id AND c.status = 'active'
    JOIN public.user_tenant ut ON ut.user_id = s.user_id AND ut.status = 'active'
    JOIN public.tenant t ON t.id = ut.tenant_id AND t.status = 'active'
    LEFT JOIN public.membership_role mr
      ON mr.tenant_id = ut.tenant_id AND mr.membership_id = ut.id AND mr.revoked_at IS NULL
    LEFT JOIN public.role r ON r.code = mr.role_code
   WHERE s.token_hash = p_token_hash
     AND s.revoked_at IS NULL
     AND s.expires_at > statement_timestamp()
     AND s.idle_expires_at > statement_timestamp()
   GROUP BY t.id, t.legal_name, ut.id
   ORDER BY t.legal_name, t.id;
$$;

-- Nombre y correo de los miembros del tenant de la transacción. Sin contexto, ninguna fila.
CREATE FUNCTION access_member_identities()
  RETURNS TABLE (user_id uuid, email text, display_name text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT u.id, u.email::text, u.display_name
    FROM public.user_tenant ut
    JOIN public.app_user u ON u.id = ut.user_id
   WHERE ut.tenant_id = public.app_current_tenant();
$$;

-- Retira los intentos de MFA de una persona después de un factor correcto.
CREATE FUNCTION auth_clear_mfa_attempts(p_user_id uuid)
  RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
AS $$
  DELETE FROM public.mfa_attempt WHERE user_id = p_user_id;
$$;

-- Limpia los intentos vencidos.
CREATE FUNCTION auth_purge_mfa_attempts()
  RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
AS $$
  DELETE FROM public.mfa_attempt WHERE occurred_at < statement_timestamp() - interval '1 day';
$$;

ALTER FUNCTION auth_session_identity(text) OWNER TO puntuale_auth_definer;
ALTER FUNCTION auth_session_tenants(text) OWNER TO puntuale_auth_definer;
ALTER FUNCTION access_member_identities() OWNER TO puntuale_auth_definer;
ALTER FUNCTION auth_clear_mfa_attempts(uuid) OWNER TO puntuale_auth_definer;
ALTER FUNCTION auth_purge_mfa_attempts() OWNER TO puntuale_auth_definer;

GRANT EXECUTE ON FUNCTION app_current_tenant() TO puntuale_auth_definer;

REVOKE ALL ON FUNCTION auth_session_identity(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_session_tenants(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION access_member_identities() FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_clear_mfa_attempts(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_purge_mfa_attempts() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION auth_session_identity(text) TO puntuale_app;
GRANT EXECUTE ON FUNCTION auth_session_tenants(text) TO puntuale_app;
GRANT EXECUTE ON FUNCTION access_member_identities() TO puntuale_app;
GRANT EXECUTE ON FUNCTION auth_clear_mfa_attempts(uuid) TO puntuale_app;
GRANT EXECUTE ON FUNCTION auth_purge_mfa_attempts() TO puntuale_app;

-- ---------------------------------------------------------------------------
-- Permisos del rol de aplicación
-- ---------------------------------------------------------------------------

REVOKE ALL ON role, permission, role_permission, membership_role,
              user_mfa, mfa_recovery_code, mfa_attempt FROM PUBLIC;

GRANT SELECT ON role, permission, role_permission TO puntuale_app;
GRANT SELECT, INSERT ON membership_role TO puntuale_app;
GRANT UPDATE (revoked_at, revoked_by_user_id) ON membership_role TO puntuale_app;

GRANT SELECT, INSERT ON user_mfa TO puntuale_app;
GRANT UPDATE (secret_ciphertext, pending_secret_ciphertext, pending_created_at,
              last_accepted_step, activated_at, updated_at) ON user_mfa TO puntuale_app;

GRANT SELECT, INSERT ON mfa_recovery_code TO puntuale_app;
GRANT UPDATE (used_at, invalidated_at) ON mfa_recovery_code TO puntuale_app;

GRANT SELECT, INSERT ON mfa_attempt TO puntuale_app;

GRANT UPDATE (mfa_verified_at) ON auth_session TO puntuale_app;

-- La aplicación solo cambia el estado de una membresía existente.
REVOKE UPDATE ON user_tenant FROM puntuale_app;
GRANT UPDATE (status) ON user_tenant TO puntuale_app;
