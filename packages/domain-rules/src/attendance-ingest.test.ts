import type { AttendanceEventEvidence } from '@puntuale/contracts';
import { describe, expect, it } from 'vitest';
import {
  classifyIngest,
  computeClockOffsetSeconds,
  computeEvidenceHash,
  deriveOccurredAtUtc,
  detectClockSkew,
} from './attendance-ingest';

const evidence: AttendanceEventEvidence = {
  clientEventId: '0190f5e2-7c4a-7b3e-8a1d-2f6b9c0d4e5f',
  employeeId: '0190f5e2-7c4a-7b3e-8a1d-2f6b9c0d4e60',
  eventType: 'in',
  declaredLocalTime: '2026-11-09T08:58:12.345',
  declaredUtcOffsetMinutes: -360,
  declaredTimezone: 'America/Mexico_City',
  deviceId: 'device-abc',
  metadata: { app_version: '1.0.0' },
};

describe('computeEvidenceHash', () => {
  it('es determinista y no depende del orden de las llaves', () => {
    const reordered = Object.fromEntries(
      Object.entries(evidence).reverse(),
    ) as AttendanceEventEvidence;
    expect(computeEvidenceHash(reordered)).toBe(computeEvidenceHash(evidence));
  });

  it('no cambia con mayúsculas en los UUID ni con milisegundos implícitos', () => {
    const a = computeEvidenceHash({ ...evidence, declaredLocalTime: '2026-11-09T08:58:12' });
    const b = computeEvidenceHash({
      ...evidence,
      clientEventId: evidence.clientEventId.toUpperCase(),
      declaredLocalTime: '2026-11-09T08:58:12.000',
    });
    expect(a).toBe(b);
  });

  it('cambia si cambia cualquier dato de evidencia', () => {
    const base = computeEvidenceHash(evidence);
    expect(computeEvidenceHash({ ...evidence, eventType: 'out' })).not.toBe(base);
    expect(
      computeEvidenceHash({ ...evidence, declaredLocalTime: '2026-11-09T08:58:13.345' }),
    ).not.toBe(base);
    expect(computeEvidenceHash({ ...evidence, metadata: {} })).not.toBe(base);
  });
});

describe('classifyIngest (ADR 0011)', () => {
  it('created si no existe; duplicate con el mismo hash; conflict con otro hash', () => {
    expect(classifyIngest(null, 'h1')).toBe('created');
    expect(classifyIngest('h1', 'h1')).toBe('duplicate');
    expect(classifyIngest('h1', 'h2')).toBe('conflict');
  });
});

describe('deriveOccurredAtUtc', () => {
  it('convierte la hora local declarada a UTC con el desfase declarado', () => {
    expect(deriveOccurredAtUtc('2026-11-09T08:58:12.345', -360).toISOString()).toBe(
      '2026-11-09T14:58:12.345Z',
    );
  });

  it('maneja turnos nocturnos: 23:30 local a −06:00 es 05:30 UTC del día siguiente', () => {
    expect(deriveOccurredAtUtc('2026-11-09T23:30:00', -360).toISOString()).toBe(
      '2026-11-10T05:30:00.000Z',
    );
  });
});

describe('detectClockSkew: marca, nunca rechaza', () => {
  const receivedAt = new Date('2026-11-09T15:00:00Z');

  it('no marca un evento normal', () => {
    const offset = computeClockOffsetSeconds(receivedAt, new Date('2026-11-09T14:59:58Z'));
    expect(offset).toBe(2);
    expect(
      detectClockSkew({ clockOffsetSeconds: offset, occurredAtUtc: receivedAt, receivedAt }),
    ).toEqual({ flagged: false, reasons: [] });
  });

  it('marca un reloj del dispositivo desfasado más allá del umbral', () => {
    const offset = computeClockOffsetSeconds(receivedAt, new Date('2026-11-09T14:40:00Z'));
    const result = detectClockSkew({
      clockOffsetSeconds: offset,
      occurredAtUtc: receivedAt,
      receivedAt,
    });
    expect(result.flagged).toBe(true);
    expect(result.reasons).toContain('DEVICE_CLOCK_OFFSET');
  });

  it('marca un evento declarado en el futuro', () => {
    const result = detectClockSkew({
      clockOffsetSeconds: 0,
      occurredAtUtc: new Date('2026-11-09T16:00:00Z'),
      receivedAt,
    });
    expect(result).toEqual({ flagged: true, reasons: ['FUTURE_EVENT'] });
  });

  it('no marca un evento offline antiguo con el reloj correcto (la antigüedad no es un desfase)', () => {
    const result = detectClockSkew({
      clockOffsetSeconds: 1,
      occurredAtUtc: new Date('2026-11-08T15:00:00Z'),
      receivedAt,
    });
    expect(result.flagged).toBe(false);
  });
});
