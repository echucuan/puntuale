import { randomBytes } from 'node:crypto';
import { keyedHash, safeEqual } from './keyed-hash';

/**
 * A qué queda ligado un token CSRF: a la sesión, o antes del login a un valor aleatorio guardado
 * en una cookie `HttpOnly`. Un token de una vinculación no sirve para otra (ADR 0014).
 */
export type CsrfBinding =
  { kind: 'session'; sessionId: string } | { kind: 'anonymous'; nonce: string };

function bindingValue(binding: CsrfBinding): string {
  return binding.kind === 'session' ? `session:${binding.sessionId}` : `anon:${binding.nonce}`;
}

export function generateCsrfNonce(): string {
  return randomBytes(32).toString('base64url');
}

export function issueCsrfToken(secret: string, binding: CsrfBinding): string {
  return keyedHash(secret, 'csrf', bindingValue(binding));
}

export function verifyCsrfToken(secret: string, binding: CsrfBinding, token: string): boolean {
  return safeEqual(issueCsrfToken(secret, binding), token);
}
