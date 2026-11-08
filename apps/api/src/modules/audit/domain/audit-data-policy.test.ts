import { describe, expect, it } from 'vitest';
import {
  AUDITABLE_FIELDS,
  assertAuditPolicyIsSafe,
  isSensitiveField,
  projectAuditData,
} from './audit-data-policy';

describe('lista permitida de auditoría', () => {
  it('conserva solo los campos permitidos y descarta el resto', () => {
    expect(
      projectAuditData('employee', {
        id: 'e1',
        employeeNumber: 'E-001',
        displayName: 'Persona',
        status: 'active',
        rfc: 'XAXX010101000',
        password: 'no-debe-guardarse',
      }),
    ).toEqual({ id: 'e1', employeeNumber: 'E-001', displayName: 'Persona', status: 'active' });
  });

  it('devuelve null sin datos', () => {
    expect(projectAuditData('employee', null)).toBeNull();
    expect(projectAuditData('employee', undefined)).toBeNull();
  });

  it('rechaza un tipo de entidad sin lista y datos que no son objeto', () => {
    expect(() => projectAuditData('app_user', { id: 'u1' })).toThrow(RangeError);
    expect(() => projectAuditData('employee', ['x'])).toThrow(TypeError);
  });

  it.each([
    'password',
    'passwordHash',
    'mfaSecret',
    'totpSeed',
    'accessToken',
    'refresh_token',
    'sessionCookie',
    'credentials',
    'apiKey',
  ])('%s es un campo sensible', (field) => {
    expect(isSensitiveField(field)).toBe(true);
  });

  it('payloadHash es una huella de evidencia, no un secreto', () => {
    expect(isSensitiveField('payloadHash')).toBe(false);
    expect(isSensitiveField('incomingPayloadHash')).toBe(false);
  });

  it('la lista vigente no contiene campos sensibles', () => {
    expect(() => assertAuditPolicyIsSafe(AUDITABLE_FIELDS)).not.toThrow();
  });

  it('una lista con un campo sensible se rechaza', () => {
    expect(() => assertAuditPolicyIsSafe({ app_user: ['id', 'passwordHash'] })).toThrow(
      /Campo sensible/,
    );
  });
});
