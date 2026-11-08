import { describe, expect, it } from 'vitest';
import { canonicalHash, canonicalJson, sha256Hex } from './canonical-json';

describe('canonicalJson (RFC 8785)', () => {
  it('ordena las llaves y elimina espacios', () => {
    expect(canonicalJson({ b: 1, a: { d: true, c: null } })).toBe(
      '{"a":{"c":null,"d":true},"b":1}',
    );
  });

  it('produce la misma salida sin importar el orden de inserción', () => {
    expect(canonicalJson({ x: 1, y: [1, 'a'] })).toBe(canonicalJson({ y: [1, 'a'], x: 1 }));
  });

  it('serializa números como ECMAScript', () => {
    expect(canonicalJson([1.0, -0, 1e21, 0.000001])).toBe('[1,0,1e+21,0.000001]');
  });

  it('omite propiedades undefined y rechaza valores no representables', () => {
    expect(canonicalJson({ a: undefined, b: 2 })).toBe('{"b":2}');
    expect(() => canonicalJson(Number.NaN)).toThrow(TypeError);
    expect(() => canonicalJson([undefined])).toThrow(TypeError);
    expect(() => canonicalJson(10n)).toThrow(TypeError);
  });

  it('calcula SHA-256 en hexadecimal', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(canonicalHash({ b: 1, a: 2 })).toBe(canonicalHash({ a: 2, b: 1 }));
  });
});
