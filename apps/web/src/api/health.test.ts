import { describe, expect, it } from 'vitest';
import { fetchHealth, toHealthView } from './health';

describe('toHealthView', () => {
  it('traduce las respuestas válidas del contrato', () => {
    expect(toHealthView({ status: 'ok', database: 'up' })).toEqual({ state: 'ok' });
    expect(toHealthView({ status: 'degraded', database: 'down' })).toEqual({ state: 'degraded' });
  });

  it('trata una respuesta fuera de contrato como inalcanzable', () => {
    expect(toHealthView({ status: 'maybe' })).toEqual({ state: 'unreachable' });
    expect(toHealthView(null)).toEqual({ state: 'unreachable' });
  });
});

describe('fetchHealth', () => {
  it('devuelve unreachable si la red falla', async () => {
    const failing = (() => Promise.reject(new Error('sin red'))) as unknown as typeof fetch;
    await expect(fetchHealth(failing)).resolves.toEqual({ state: 'unreachable' });
  });
});
