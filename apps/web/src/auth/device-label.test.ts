import { describe, expect, it } from 'vitest';
import { deviceLabel } from './device-label';

describe('deviceLabel', () => {
  it.each([
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36',
      'Chrome en Windows',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/140.0 Safari/537.36 Edg/140.0',
      'Edge en Windows',
    ],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0', 'Firefox en Linux'],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
      'Safari en iOS',
    ],
    [
      'Mozilla/5.0 (Linux; Android 15; Pixel) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36',
      'Chrome en Android',
    ],
  ])('reconoce %s', (userAgent, expected) => {
    expect(deviceLabel(userAgent)).toBe(expected);
  });

  it('sin datos o sin coincidencias responde de forma genérica', () => {
    expect(deviceLabel(null)).toBe('Navegador desconocido');
    expect(deviceLabel('curl/8.0')).toBe('Navegador desconocido');
  });
});
