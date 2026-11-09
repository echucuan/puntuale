import { Secret, TOTP } from 'otpauth';
import { describe, expect, it } from 'vitest';
import { decryptMfaSecret, encryptMfaSecret } from './mfa-cipher';
import {
  generateRecoveryCode,
  generateTotpSecret,
  hashRecoveryCode,
  matchTotpStep,
  normalizeRecoveryCode,
  provisioningUri,
} from './totp';

const KEY = 'llave-ficticia-de-pruebas-0123456789';
const USER = '0190f5e2-0000-7000-8000-000000000001';
const OTHER = '0190f5e2-0000-7000-8000-000000000002';

describe('cifrado del secreto', () => {
  it('descifra lo que cifró y el valor guardado no contiene el secreto', () => {
    const stored = encryptMfaSecret(KEY, USER, 'JBSWY3DPEHPK3PXP');
    expect(stored.startsWith('v1.')).toBe(true);
    expect(stored).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptMfaSecret(KEY, USER, stored)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('cada cifrado es distinto', () => {
    expect(encryptMfaSecret(KEY, USER, 'A')).not.toBe(encryptMfaSecret(KEY, USER, 'A'));
  });

  it('rechaza otra persona, otra llave y un valor alterado', () => {
    const stored = encryptMfaSecret(KEY, USER, 'SECRETO');
    expect(() => decryptMfaSecret(KEY, OTHER, stored)).toThrow();
    expect(() => decryptMfaSecret(`${KEY}x`, USER, stored)).toThrow();
    const parts = stored.split('.');
    parts[3] = Buffer.from('alterado').toString('base64url');
    expect(() => decryptMfaSecret(KEY, USER, parts.join('.'))).toThrow();
    expect(() => decryptMfaSecret(KEY, USER, 'sin-formato')).toThrow();
  });
});

describe('TOTP', () => {
  const secret = generateTotpSecret();
  const now = 1_800_000_000_000;
  const step = Math.floor(now / 30_000);
  const codeAt = (counter: number) =>
    new TOTP({ secret: Secret.fromBase32(secret) }).generate({ timestamp: counter * 30_000 });

  it('reconoce el paso actual y uno de tolerancia a cada lado', () => {
    expect(matchTotpStep(secret, codeAt(step), now)).toBe(step);
    expect(matchTotpStep(secret, codeAt(step - 1), now)).toBe(step - 1);
    expect(matchTotpStep(secret, codeAt(step + 1), now)).toBe(step + 1);
  });

  it('rechaza un código fuera de la ventana', () => {
    expect(matchTotpStep(secret, codeAt(step - 3), now)).toBeNull();
    expect(matchTotpStep(secret, codeAt(step + 3), now)).toBeNull();
  });

  it('genera un URI de aprovisionamiento con emisor y cuenta', () => {
    const uri = provisioningUri(secret, 'persona@example.test');
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain('issuer=Puntuale');
  });
});

describe('códigos de recuperación', () => {
  it('tienen 16 símbolos en grupos de 4 y no se repiten', () => {
    const codes = Array.from({ length: 50 }, generateRecoveryCode);
    for (const code of codes) expect(code).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
    expect(new Set(codes).size).toBe(50);
  });

  it('la huella ignora formato, depende de la persona y no contiene el código', () => {
    const code = 'ABCD-EFGH-JKLM-NPQR';
    expect(normalizeRecoveryCode(' abcd efgh-jklm npqr ')).toBe('ABCDEFGHJKLMNPQR');
    const hash = hashRecoveryCode(KEY, USER, code);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashRecoveryCode(KEY, USER, 'abcdefghjklmnpqr'));
    expect(hash).not.toBe(hashRecoveryCode(KEY, OTHER, code));
  });
});
