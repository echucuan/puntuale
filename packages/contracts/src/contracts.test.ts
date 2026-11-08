import { describe, expect, it } from 'vitest';
import {
  ATTENDANCE_STATUSES,
  ATTENDANCE_STATUS_LABELS_ES,
  ApiErrorSchema,
  AttendanceEventEvidenceSchema,
  AttendanceEventInputSchema,
  IanaTimezoneSchema,
  LocalDateTimeSchema,
} from './index';

const validInput = {
  clientEventId: '0190f5e2-7c4a-7b3e-8a1d-2f6b9c0d4e5f',
  employeeId: '0190f5e2-7c4a-7b3e-8a1d-2f6b9c0d4e60',
  eventType: 'in',
  declaredLocalTime: '2026-11-09T08:58:12.345',
  declaredUtcOffsetMinutes: -360,
  declaredTimezone: 'America/Mexico_City',
  deviceId: 'device-abc',
  metadata: { app_version: '1.0.0' },
  deviceSentAt: '2026-11-09T14:58:13.000Z',
  ingestMode: 'online',
} as const;

describe('estados de asistencia (ADR 0012)', () => {
  it('tiene exactamente cuatro estados con nombres técnicos en inglés', () => {
    expect(ATTENDANCE_STATUSES).toEqual(['pending', 'incomplete', 'needs_review', 'complete']);
  });

  it('tiene una etiqueta en español para cada estado', () => {
    expect(Object.keys(ATTENDANCE_STATUS_LABELS_ES).sort()).toEqual(
      [...ATTENDANCE_STATUSES].sort(),
    );
    expect(ATTENDANCE_STATUS_LABELS_ES.needs_review).toBe('Por revisar');
  });
});

describe('AttendanceEventInputSchema', () => {
  it('acepta una marcación válida', () => {
    expect(AttendanceEventInputSchema.parse(validInput)).toEqual(validInput);
  });

  it('rechaza una hora local con zona o desfase', () => {
    for (const declaredLocalTime of ['2026-11-09T08:58:12Z', '2026-11-09T08:58:12-06:00']) {
      expect(
        AttendanceEventInputSchema.safeParse({ ...validInput, declaredLocalTime }).success,
      ).toBe(false);
    }
  });

  it('rechaza fechas que no existen en el calendario', () => {
    expect(LocalDateTimeSchema.safeParse('2026-02-30T08:00:00').success).toBe(false);
    expect(LocalDateTimeSchema.safeParse('2026-11-09T24:00:00').success).toBe(false);
  });

  it('exige que deviceSentAt sea un instante con zona explícita', () => {
    expect(
      AttendanceEventInputSchema.safeParse({ ...validInput, deviceSentAt: '2026-11-09T14:58:13' })
        .success,
    ).toBe(false);
  });

  it('rechaza zonas horarias que no son IANA', () => {
    expect(IanaTimezoneSchema.safeParse('CST').success).toBe(false);
    expect(IanaTimezoneSchema.safeParse('America/Not_A_Zone').success).toBe(false);
    expect(IanaTimezoneSchema.safeParse('America/Tijuana').success).toBe(true);
  });

  it('rechaza metadatos anidados o con claves no controladas', () => {
    expect(
      AttendanceEventInputSchema.safeParse({ ...validInput, metadata: { nested: { a: 1 } } })
        .success,
    ).toBe(false);
    expect(
      AttendanceEventInputSchema.safeParse({ ...validInput, metadata: { 'Bad-Key': 'x' } }).success,
    ).toBe(false);
  });

  it('separa la evidencia del transporte', () => {
    const evidenceKeys = Object.keys(AttendanceEventEvidenceSchema.shape);
    expect(evidenceKeys).not.toContain('deviceSentAt');
    expect(evidenceKeys).not.toContain('ingestMode');
  });
});

describe('ApiErrorSchema', () => {
  it('solo acepta códigos de error conocidos', () => {
    expect(
      ApiErrorSchema.safeParse({ error: { code: 'not_found', message: 'No encontrado' } }).success,
    ).toBe(true);
    expect(ApiErrorSchema.safeParse({ error: { code: 'teapot', message: '' } }).success).toBe(
      false,
    );
  });
});
