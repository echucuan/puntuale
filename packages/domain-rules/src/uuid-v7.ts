/**
 * UUID versión 7 (RFC 9562): los primeros 48 bits son el instante en milisegundos,
 * así que los identificadores se ordenan en el tiempo. La base de datos genera los suyos
 * con `uuidv7()` (PostgreSQL 18); esta función es para el cliente y las pruebas.
 */
export function generateUuidV7(nowMs: number = Date.now()): string {
  if (!Number.isInteger(nowMs) || nowMs < 0 || nowMs > 0xffffffffffff) {
    throw new RangeError('Instante fuera del rango de 48 bits');
  }
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let ts = nowMs;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ts & 0xff;
    ts = Math.floor(ts / 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // versión 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variante RFC 9562
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidV7(value: string): boolean {
  return UUID_V7_PATTERN.test(value);
}
