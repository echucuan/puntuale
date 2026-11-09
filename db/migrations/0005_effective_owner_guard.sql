-- 0005 · Propietarios con acceso efectivo (1.0-b.2, ADR 0015)
--
-- La protección del último propietario exige membresía activa, rol vigente y credencial activa.
-- La aplicación sigue sin leer app_user_credential: esta función solo devuelve identificadores de
-- membresía del tenant de la transacción. Sin contexto de tenant, ninguna fila.

CREATE FUNCTION access_effective_owner_memberships()
  RETURNS TABLE (membership_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT ut.id
    FROM public.user_tenant ut
    JOIN public.membership_role mr
      ON mr.tenant_id = ut.tenant_id AND mr.membership_id = ut.id
    JOIN public.app_user_credential c ON c.user_id = ut.user_id
   WHERE ut.tenant_id = public.app_current_tenant()
     AND ut.status = 'active'
     AND mr.role_code = 'company_owner'
     AND mr.revoked_at IS NULL
     AND c.status = 'active';
$$;

ALTER FUNCTION access_effective_owner_memberships() OWNER TO puntuale_auth_definer;
REVOKE ALL ON FUNCTION access_effective_owner_memberships() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION access_effective_owner_memberships() TO puntuale_app;
