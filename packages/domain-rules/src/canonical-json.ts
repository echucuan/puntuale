import { createHash } from 'node:crypto';

/**
 * Serialización canónica de JSON según RFC 8785 (JCS):
 * - las llaves de los objetos se ordenan por unidades de código UTF-16;
 * - no hay espacios en blanco;
 * - los números y las cadenas se serializan como en ECMAScript (`JSON.stringify`).
 *
 * Rechaza valores que JSON no puede representar sin ambigüedad (NaN, Infinity,
 * `undefined` dentro de arreglos, funciones, símbolos, bigint).
 * Las propiedades `undefined` de un objeto se omiten, como en `JSON.stringify`.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('JCS no admite números no finitos');
      return JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value
          .map((item) => {
            if (item === undefined) throw new TypeError('JCS no admite undefined en arreglos');
            return canonicalJson(item);
          })
          .join(',')}]`;
      }
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
    }
    default:
      throw new TypeError(`JCS no admite valores de tipo ${typeof value}`);
  }
}

/** SHA-256 en hexadecimal (minúsculas) de una cadena UTF-8. Solo para el servidor (usa `node:crypto`). */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Hash de contenido: SHA-256 de la serialización canónica. */
export function canonicalHash(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
