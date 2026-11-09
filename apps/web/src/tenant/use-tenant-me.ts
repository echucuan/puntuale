import type { TenantMeResponse } from '@puntuale/contracts';
import { useCallback, useEffect, useState } from 'react';
import { accessFailureMessage, type AuthApi } from '../api/auth';
import type { NavItem } from '../components/page-frame';
import { accessPath, tenantPath } from '../routing';

/** Carga la identidad propia en la empresa de la URL. La API decide si hay acceso. */
export function useTenantMe(
  api: AuthApi,
  tenantId: string,
  onEnded: (message: string | null) => void,
) {
  const [me, setMe] = useState<TenantMeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const result = await api.tenantMe(tenantId);
    if (result.ok) {
      setMe(result.value);
      setError(null);
    } else if (result.failure.code === 'unauthenticated') {
      onEnded(accessFailureMessage(result.failure));
    } else {
      setMe(null);
      setError(accessFailureMessage(result.failure));
    }
  }, [api, tenantId, onEnded]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { me, error, reload };
}

/** «Accesos» solo aparece si la persona puede usarlo, o si solo le falta completar MFA. */
export function tenantNavFor(tenantId: string, me: TenantMeResponse | null): NavItem[] {
  const items: NavItem[] = [{ path: tenantPath(tenantId), label: 'Mi acceso' }];
  const admin =
    me?.permissions.includes('access.read') ||
    me?.mfa === 'verify' ||
    me?.mfa === 'enrollment_required';
  if (admin) items.push({ path: accessPath(tenantId), label: 'Accesos' });
  return items;
}
