import { describe, expect, it } from 'vitest';
import { generateUuidV7, isUuidV7 } from './uuid-v7';

describe('generateUuidV7', () => {
  it('genera UUID versión 7 válidos y únicos', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateUuidV7()));
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(isUuidV7(id)).toBe(true);
  });

  it('codifica el instante en los primeros 48 bits, así que se ordenan en el tiempo', () => {
    const earlier = generateUuidV7(1_700_000_000_000);
    const later = generateUuidV7(1_700_000_000_001);
    expect(earlier < later).toBe(true);
    expect(earlier.slice(0, 13).replace('-', '')).toBe(
      (1_700_000_000_000).toString(16).padStart(12, '0'),
    );
  });

  it('rechaza instantes fuera de rango', () => {
    expect(() => generateUuidV7(-1)).toThrow(RangeError);
  });
});
