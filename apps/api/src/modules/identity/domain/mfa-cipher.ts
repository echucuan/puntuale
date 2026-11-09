import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const IV_BYTES = 12;
const KEY_INFO = 'puntuale:mfa-secret:v1';

function deriveKey(masterKey: string): Buffer {
  return Buffer.from(hkdfSync('sha256', masterKey, Buffer.alloc(0), KEY_INFO, 32));
}

/**
 * Cifra el secreto TOTP con AES-256-GCM. El identificador de la persona se autentica junto con el
 * dato, así que un valor copiado a otra cuenta no se puede descifrar.
 */
export function encryptMfaSecret(masterKey: string, userId: string, secret: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(masterKey), iv);
  cipher.setAAD(Buffer.from(userId));
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), data]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.');
}

/** Lanza un error si el valor fue alterado, pertenece a otra persona o se cifró con otra llave. */
export function decryptMfaSecret(masterKey: string, userId: string, stored: string): string {
  const [version, iv, tag, data] = stored.split('.');
  if (version !== VERSION || !iv || !tag || !data)
    throw new Error('Secreto MFA con formato inválido.');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    deriveKey(masterKey),
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAAD(Buffer.from(userId));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(data, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
