import { describe, expect, it } from 'vitest';
import { workdayNaturalKey, type ScheduledWorkdayKeyInput } from './workday-key';

const scheduled: ScheduledWorkdayKeyInput = {
  kind: 'scheduled',
  tenantId: '0190f5e2-0000-7000-8000-000000000001',
  employeeId: '0190f5e2-0000-7000-8000-000000000002',
  operationalDate: '2026-11-09',
  assignmentId: '0190f5e2-0000-7000-8000-000000000003',
  scheduleVersionId: '0190f5e2-0000-7000-8000-000000000004',
  shiftInstance: 0,
};

describe('workdayNaturalKey: identidad estable (ajuste 2.2)', () => {
  it('es la misma antes y después de llegar un evento tardío', () => {
    // La llave no recibe eventos. Simulamos el flujo: la jornada se materializa
    // al abrir la ventana, después llega una marcación tardía y se recalcula.
    // El contexto de programación no cambia, así que la identidad tampoco.
    const keyAtMaterialization = workdayNaturalKey(scheduled);
    const keyAfterLateEvent = workdayNaturalKey({ ...scheduled });
    expect(keyAfterLateEvent).toBe(keyAtMaterialization);
  });

  it('un turno nocturno conserva la fecha operativa del inicio aunque la salida sea al día siguiente', () => {
    const night = workdayNaturalKey({ ...scheduled, operationalDate: '2026-11-09' });
    expect(night).toContain(':2026-11-09:');
    expect(night).not.toContain('2026-11-10');
  });

  it('distingue instancias de turno, asignaciones y versiones de horario', () => {
    const base = workdayNaturalKey(scheduled);
    expect(workdayNaturalKey({ ...scheduled, shiftInstance: 1 })).not.toBe(base);
    expect(
      workdayNaturalKey({ ...scheduled, assignmentId: '0190f5e2-0000-7000-8000-000000000009' }),
    ).not.toBe(base);
    expect(
      workdayNaturalKey({
        ...scheduled,
        scheduleVersionId: '0190f5e2-0000-7000-8000-00000000000a',
      }),
    ).not.toBe(base);
  });

  it('una jornada no programada tiene una sola identidad por empleado y fecha', () => {
    const unscheduled = {
      kind: 'unscheduled' as const,
      tenantId: scheduled.tenantId,
      employeeId: scheduled.employeeId,
      operationalDate: scheduled.operationalDate,
    };
    expect(workdayNaturalKey(unscheduled)).toBe(workdayNaturalKey({ ...unscheduled }));
    expect(workdayNaturalKey(unscheduled)).not.toBe(workdayNaturalKey(scheduled));
  });

  it('no distingue mayúsculas en los UUID', () => {
    expect(workdayNaturalKey({ ...scheduled, tenantId: scheduled.tenantId.toUpperCase() })).toBe(
      workdayNaturalKey(scheduled),
    );
  });

  it('rechaza entradas mal formadas', () => {
    expect(() => workdayNaturalKey({ ...scheduled, operationalDate: '09/11/2026' })).toThrow(
      RangeError,
    );
    expect(() => workdayNaturalKey({ ...scheduled, shiftInstance: -1 })).toThrow(RangeError);
    expect(() => workdayNaturalKey({ ...scheduled, tenantId: 'x' })).toThrow(RangeError);
  });
});
