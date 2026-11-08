import { createHash, randomBytes } from 'node:crypto';

/** Genera un token de sesión de 256 bits. Solo existe en la cookie; a la base va su hash. */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 del token: es lo único que se guarda (ADR 0014). */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
