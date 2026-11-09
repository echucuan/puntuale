import { describe, expect, it } from 'vitest';
import { accessPath, parseRoute, tenantPath } from './routing';

describe('parseRoute', () => {
  it('reconoce las pantallas', () => {
    expect(parseRoute('/')).toEqual({ kind: 'tenants' });
    expect(parseRoute('/cuenta')).toEqual({ kind: 'account' });
    expect(parseRoute('/t/abc')).toEqual({ kind: 'my-access', tenantId: 'abc' });
    expect(parseRoute('/t/abc/accesos')).toEqual({ kind: 'access', tenantId: 'abc' });
  });

  it('una ruta desconocida vuelve al selector', () => {
    expect(parseRoute('/t')).toEqual({ kind: 'tenants' });
    expect(parseRoute('/t/abc/otra')).toEqual({ kind: 'tenants' });
    expect(parseRoute('/nada')).toEqual({ kind: 'tenants' });
  });

  it('construye rutas que vuelven a interpretarse igual', () => {
    expect(parseRoute(tenantPath('a b'))).toEqual({ kind: 'my-access', tenantId: 'a b' });
    expect(parseRoute(accessPath('xyz'))).toEqual({ kind: 'access', tenantId: 'xyz' });
  });
});
