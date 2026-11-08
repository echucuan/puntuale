-- 0001 · Base multiempresa del paso 1.0-a
--
-- Contenido: tenant, app_user, user_tenant, employee (mínimo, E1), attendance_event y audit_event.
-- Reglas:
--   * RLS ENABLE + FORCE en toda tabla con tenant; falla cerrada sin contexto (ADR 0003).
--   * attendance_event y audit_event solo aceptan inserciones (ADR 0004, ADR 0005).
--   * Llaves foráneas compuestas (tenant_id, x_id) entre tablas con tenant.
--   * Horas en UTC (timestamptz) y zonas IANA (ADR 0010).
-- El rol puntuale_app lo crea el bootstrap antes de aplicar las migraciones.
-- Una migración aplicada nunca se modifica: los cambios van en una migración nueva.

CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------------------
-- Contexto de tenant
-- ---------------------------------------------------------------------------

-- Devuelve el tenant de la transacción actual, o NULL si no hay contexto o no es un UUID válido.
-- NULL hace que toda política "tenant_id = app_current_tenant()" sea falsa: falla cerrada.
-- Nunca lanza un error por un valor inválido.
CREATE FUNCTION app_current_tenant() RETURNS uuid
  LANGUAGE plpgsql STABLE PARALLEL SAFE
AS $$
DECLARE
  raw text := current_setting('app.tenant_id', true);
BEGIN
  IF raw IS NULL
     OR raw !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NULL;
  END IF;
  RETURN raw::uuid;
END;
$$;

-- Rechaza cualquier UPDATE, DELETE o TRUNCATE (tablas de solo inserción). Protege contra cambios
-- accidentales de cualquier rol; un superusuario podría desactivar el trigger de forma deliberada,
-- lo cual solo se permite con el procedimiento de emergencia de docs/operations/emergency-changes.md.
CREATE FUNCTION reject_mutation() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'La tabla % solo acepta inserciones (operación % rechazada)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

-- Rechaza el borrado físico de colaboradores: se dan de baja con status = 'terminated'.
-- Igual que reject_mutation(), protege contra borrados accidentales de cualquier rol; un bypass
-- deliberado de un superusuario solo se admite con docs/operations/emergency-changes.md.
CREATE FUNCTION reject_employee_delete() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'employee no admite borrado físico (operación % rechazada); usa la baja lógica con status = ''terminated''', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

-- Impide cambiar el tenant_id de una fila existente.
CREATE FUNCTION reject_tenant_change() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'tenant_id no se puede modificar en %', TG_TABLE_NAME
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- tenant: una empresa (razón social)
-- ---------------------------------------------------------------------------

CREATE TABLE tenant (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  legal_name  text NOT NULL CHECK (length(btrim(legal_name)) BETWEEN 1 AND 200),
  timezone    text NOT NULL CHECK (timezone ~ '^(UTC|[A-Za-z]+(/[A-Za-z0-9_+-]+)+)$'),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- app_user: identidad global (una persona puede pertenecer a varias empresas)
-- Sin tenant_id y sin RLS: el acceso a datos de una empresa siempre pasa por user_tenant.
-- ---------------------------------------------------------------------------

CREATE TABLE app_user (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  email         citext NOT NULL UNIQUE CHECK (length(email) BETWEEN 3 AND 254),
  display_name  text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 200),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- employee: mínimo para 1.0-a (E1). Sin endpoints en este paso.
-- ---------------------------------------------------------------------------

CREATE TABLE employee (
  id               uuid NOT NULL DEFAULT uuidv7() PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES tenant (id),
  employee_number  text NOT NULL CHECK (length(btrim(employee_number)) BETWEEN 1 AND 50),
  display_name     text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 200),
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'terminated')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT employee_tenant_number_key UNIQUE (tenant_id, employee_number)
);

-- ---------------------------------------------------------------------------
-- user_tenant: membresía de un usuario en una empresa
-- ---------------------------------------------------------------------------

CREATE TABLE user_tenant (
  id           uuid NOT NULL DEFAULT uuidv7() PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenant (id),
  user_id      uuid NOT NULL REFERENCES app_user (id),
  employee_id  uuid NULL,
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_tenant_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT user_tenant_tenant_user_key UNIQUE (tenant_id, user_id),
  CONSTRAINT user_tenant_employee_fk FOREIGN KEY (tenant_id, employee_id)
    REFERENCES employee (tenant_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX user_tenant_tenant_employee_key
  ON user_tenant (tenant_id, employee_id) WHERE employee_id IS NOT NULL;
CREATE INDEX user_tenant_user_idx ON user_tenant (user_id);

-- ---------------------------------------------------------------------------
-- attendance_event: marcación inmutable (ADR 0004, 0010, 0011)
-- ---------------------------------------------------------------------------

CREATE TABLE attendance_event (
  id                           uuid NOT NULL DEFAULT uuidv7() PRIMARY KEY,
  tenant_id                    uuid NOT NULL REFERENCES tenant (id),
  employee_id                  uuid NOT NULL,
  event_type                   text NOT NULL CHECK (event_type IN ('in', 'out')),
  source                       text NOT NULL CHECK (source IN ('pwa', 'correction')),
  ingest_mode                  text NULL CHECK (ingest_mode IN ('online', 'offline_sync')),
  -- Evidencia declarada por el dispositivo (no confiable).
  declared_local_time          timestamp without time zone NULL,
  declared_utc_offset_minutes  smallint NULL CHECK (declared_utc_offset_minutes BETWEEN -720 AND 840),
  declared_timezone            text NOT NULL
    CHECK (declared_timezone ~ '^(UTC|[A-Za-z]+(/[A-Za-z0-9_+-]+)+)$'),
  -- Derivada de la evidencia. Sirve para ordenar; no es confiable.
  occurred_at_utc              timestamptz NOT NULL,
  device_sent_at               timestamptz NULL,
  -- Hora del servidor: la referencia confiable para auditoría.
  received_at                  timestamptz NOT NULL DEFAULT statement_timestamp(),
  clock_offset_seconds         integer NULL,
  client_event_id              uuid NULL,
  payload_hash                 text NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  device_id                    text NULL CHECK (length(device_id) BETWEEN 1 AND 128),
  supersedes_event_id          uuid NULL,
  created_by_user_id           uuid NULL REFERENCES app_user (id),
  metadata                     jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object'),

  CONSTRAINT attendance_event_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT attendance_event_employee_fk FOREIGN KEY (tenant_id, employee_id)
    REFERENCES employee (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT attendance_event_supersedes_fk FOREIGN KEY (tenant_id, supersedes_event_id)
    REFERENCES attendance_event (tenant_id, id),

  -- Hora local y desfase van juntos, y la hora UTC debe coincidir con ellos.
  CONSTRAINT attendance_event_declared_pair CHECK (
    (declared_local_time IS NULL) = (declared_utc_offset_minutes IS NULL)
  ),
  CONSTRAINT attendance_event_utc_consistency CHECK (
    declared_local_time IS NULL
    OR occurred_at_utc =
       (declared_local_time - make_interval(mins => declared_utc_offset_minutes)) AT TIME ZONE 'UTC'
  ),
  -- El desfase de reloj existe si y solo si el dispositivo informó su hora de envío.
  CONSTRAINT attendance_event_clock_offset_pair CHECK (
    (device_sent_at IS NULL) = (clock_offset_seconds IS NULL)
  ),
  -- La llave de idempotencia y su hash van juntos.
  CONSTRAINT attendance_event_idempotency_pair CHECK (
    (client_event_id IS NULL) = (payload_hash IS NULL)
  ),
  -- Reglas por origen.
  CONSTRAINT attendance_event_pwa_shape CHECK (
    source <> 'pwa' OR (
      ingest_mode IS NOT NULL
      AND declared_local_time IS NOT NULL
      AND client_event_id IS NOT NULL
      AND supersedes_event_id IS NULL
    )
  ),
  CONSTRAINT attendance_event_correction_shape CHECK (
    source <> 'correction' OR (
      ingest_mode IS NULL
      AND created_by_user_id IS NOT NULL
    )
  ),
  CONSTRAINT attendance_event_not_self_superseding CHECK (supersedes_event_id IS DISTINCT FROM id)
);

-- Idempotencia de la ingesta: un client_event_id por empresa (ADR 0011).
CREATE UNIQUE INDEX attendance_event_tenant_client_event_key
  ON attendance_event (tenant_id, client_event_id) WHERE client_event_id IS NOT NULL;
CREATE INDEX attendance_event_employee_occurred_idx
  ON attendance_event (tenant_id, employee_id, occurred_at_utc);

CREATE TRIGGER attendance_event_reject_update_delete
  BEFORE UPDATE OR DELETE ON attendance_event
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER attendance_event_reject_truncate
  BEFORE TRUNCATE ON attendance_event
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();

-- ---------------------------------------------------------------------------
-- audit_event: bitácora inmutable, escrita en la misma transacción (ADR 0005)
-- id: secuencia GLOBAL, puede tener huecos, no es por tenant y no es el único criterio de orden.
-- ---------------------------------------------------------------------------

CREATE TABLE audit_event (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id            uuid NOT NULL DEFAULT uuidv7() UNIQUE,
  tenant_id            uuid NOT NULL REFERENCES tenant (id),
  actor_type           text NOT NULL CHECK (actor_type IN ('user', 'system', 'job')),
  actor_user_id        uuid NULL REFERENCES app_user (id),
  channel              text NOT NULL CHECK (channel IN ('online', 'offline_sync', 'job', 'system')),
  action               text NOT NULL CHECK (action ~ '^[a-z][a-z_]*\.[a-z][a-z_]*\.[a-z][a-z_]*$'),
  entity_type          text NOT NULL CHECK (entity_type ~ '^[a-z][a-z_]*$'),
  entity_id            uuid NULL,
  before_data          jsonb NULL,
  after_data           jsonb NULL,
  reason               text NULL CHECK (length(reason) <= 1000),
  request_ip           inet NULL,
  user_agent           text NULL CHECK (length(user_agent) <= 512),
  request_id           text NULL CHECK (length(request_id) <= 128),
  subject_occurred_at  timestamptz NULL,
  recorded_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT audit_event_user_actor CHECK (actor_type <> 'user' OR actor_user_id IS NOT NULL)
);

CREATE INDEX audit_event_tenant_recorded_idx ON audit_event (tenant_id, recorded_at);
CREATE INDEX audit_event_tenant_entity_idx ON audit_event (tenant_id, entity_type, entity_id);

CREATE TRIGGER audit_event_reject_update_delete
  BEFORE UPDATE OR DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER audit_event_reject_truncate
  BEFORE TRUNCATE ON audit_event
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();

-- ---------------------------------------------------------------------------
-- tenant_id inmutable en las tablas que sí admiten UPDATE
-- ---------------------------------------------------------------------------

CREATE TRIGGER employee_reject_tenant_change
  BEFORE UPDATE OF tenant_id ON employee
  FOR EACH ROW EXECUTE FUNCTION reject_tenant_change();
CREATE TRIGGER user_tenant_reject_tenant_change
  BEFORE UPDATE OF tenant_id ON user_tenant
  FOR EACH ROW EXECUTE FUNCTION reject_tenant_change();

-- ---------------------------------------------------------------------------
-- employee: sin borrado físico (baja lógica)
-- ---------------------------------------------------------------------------

CREATE TRIGGER employee_reject_delete
  BEFORE DELETE ON employee
  FOR EACH ROW EXECUTE FUNCTION reject_employee_delete();
CREATE TRIGGER employee_reject_truncate
  BEFORE TRUNCATE ON employee
  FOR EACH STATEMENT EXECUTE FUNCTION reject_employee_delete();

-- ---------------------------------------------------------------------------
-- Row Level Security: ENABLE + FORCE, una política por tabla (<tabla>_tenant_isolation)
-- ---------------------------------------------------------------------------

ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_tenant_isolation ON tenant
  USING (id = app_current_tenant())
  WITH CHECK (id = app_current_tenant());

ALTER TABLE employee ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee FORCE ROW LEVEL SECURITY;
CREATE POLICY employee_tenant_isolation ON employee
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE user_tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_tenant FORCE ROW LEVEL SECURITY;
CREATE POLICY user_tenant_tenant_isolation ON user_tenant
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE attendance_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_event FORCE ROW LEVEL SECURITY;
CREATE POLICY attendance_event_tenant_isolation ON attendance_event
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

ALTER TABLE audit_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_event FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_event_tenant_isolation ON audit_event
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- ---------------------------------------------------------------------------
-- Permisos del rol de aplicación (mínimos para 1.0-a)
-- puntuale_app no es dueño de ninguna tabla, no es superusuario y no tiene BYPASSRLS.
-- ---------------------------------------------------------------------------

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO puntuale_app;
GRANT EXECUTE ON FUNCTION app_current_tenant() TO puntuale_app;

GRANT SELECT ON tenant TO puntuale_app;
GRANT SELECT ON app_user TO puntuale_app;
GRANT SELECT, INSERT, UPDATE ON user_tenant TO puntuale_app;
-- employee no admite DELETE: un colaborador se da de baja con status = 'terminated' (baja lógica).
-- Además, el trigger employee_reject_delete rechaza el borrado de cualquier rol, y las FK con
-- ON DELETE RESTRICT impiden borrar a quien tenga marcaciones o membresía.
GRANT SELECT, INSERT, UPDATE ON employee TO puntuale_app;
-- Solo inserción y lectura (ADR 0004, ADR 0005).
GRANT SELECT, INSERT ON attendance_event TO puntuale_app;
GRANT SELECT, INSERT ON audit_event TO puntuale_app;
