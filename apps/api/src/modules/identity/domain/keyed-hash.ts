import { createHmac, timingSafeEqual } from 'node:crypto';

/** HMAC-SHA-256 con separación por propósito: un valor de un propósito no sirve para otro. */
export function keyedHash(secret: string, purpose: string, value: string): string {
  return createHmac('sha256', secret).update(`${purpose}\0${value}`).digest('hex');
}

/** Compara dos cadenas en tiempo constante respecto a su contenido. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
