import { randomBytes } from 'node:crypto';
import { Secret, TOTP } from 'otpauth';
import { keyedHash } from './keyed-hash';

const PERIOD_SECONDS = 30;
/** Un paso antes y uno después, para tolerar la diferencia de reloj del teléfono. */
const DRIFT_WINDOW = 1;
const ISSUER = 'Puntuale';
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RECOVERY_LENGTH = 16;

export const RECOVERY_CODE_COUNT = 10;

function totp(secret: string, label: string): TOTP {
  return new TOTP({
    issuer: ISSUER,
    label,
    algorithm: 'SHA1',
    digits: 6,
    period: PERIOD_SECONDS,
    secret: Secret.fromBase32(secret),
  });
}

export function generateTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

export function provisioningUri(secret: string, accountLabel: string): string {
  return totp(secret, accountLabel).toString();
}

/**
 * Devuelve el paso de 30 s al que corresponde el código, o null si no coincide con ninguno de la
 * ventana. Quien llama compara ese paso con el último aceptado para impedir la reutilización.
 */
export function matchTotpStep(secret: string, code: string, nowMs: number): number | null {
  const delta = totp(secret, 'verify').validate({
    token: code,
    timestamp: nowMs,
    window: DRIFT_WINDOW,
  });
  return delta === null ? null : Math.floor(nowMs / (PERIOD_SECONDS * 1000)) + delta;
}

export function generateRecoveryCode(): string {
  // 32 símbolos: cada byte se reduce sin sesgo porque 256 es múltiplo de 32.
  const symbols = [...randomBytes(RECOVERY_LENGTH)]
    .map((byte) => RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length])
    .join('');
  return symbols.match(/.{4}/g)!.join('-');
}

export function normalizeRecoveryCode(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase();
}

/** La huella depende de la persona: el mismo código en otra cuenta produce otra huella. */
export function hashRecoveryCode(secret: string, userId: string, code: string): string {
  return keyedHash(secret, 'mfa:recovery', `${userId}\0${normalizeRecoveryCode(code)}`);
}
