import { describe, expect, it } from 'vitest';
import { planFlagChanges, type ReviewFlagRef } from './review-flags';

const flag = (workdayKey: string, code: string, rulesVersion = 'r1'): ReviewFlagRef => ({
  workdayKey,
  code,
  rulesVersion,
});

describe('planFlagChanges: una recomputación no duplica alertas (ajuste 2.4)', () => {
  it('la primera vez crea las alertas calculadas', () => {
    const plan = planFlagChanges([], [flag('w1', 'CLOCK_SKEW'), flag('w1', 'MISSING_OUT')]);
    expect(plan.toCreate).toHaveLength(2);
    expect(plan.toResolve).toHaveLength(0);
  });

  it('repetir el cálculo con la misma entrada no crea nada', () => {
    const computed = [flag('w1', 'CLOCK_SKEW'), flag('w1', 'MISSING_OUT')];
    const first = planFlagChanges([], computed);
    const second = planFlagChanges(first.toCreate, computed);
    expect(second.toCreate).toEqual([]);
    expect(second.toResolve).toEqual([]);
    expect(second.unchanged).toHaveLength(2);
  });

  it('colapsa duplicados dentro del mismo cálculo', () => {
    const plan = planFlagChanges([], [flag('w1', 'CLOCK_SKEW'), flag('w1', 'CLOCK_SKEW')]);
    expect(plan.toCreate).toHaveLength(1);
  });

  it('cierra una alerta que ya no aplica después de un evento tardío', () => {
    // La salida tardía completa el par: MISSING_OUT deja de calcularse.
    const plan = planFlagChanges(
      [flag('w1', 'MISSING_OUT'), flag('w1', 'CLOCK_SKEW')],
      [flag('w1', 'CLOCK_SKEW')],
    );
    expect(plan.toResolve).toEqual([flag('w1', 'MISSING_OUT')]);
    expect(plan.toCreate).toEqual([]);
  });

  it('no toca las alertas de jornadas que no se recalcularon', () => {
    const plan = planFlagChanges([flag('w2', 'MISSING_IN')], [flag('w1', 'CLOCK_SKEW')]);
    expect(plan.toResolve).toEqual([]);
  });

  it('una versión de reglas distinta es una alerta distinta', () => {
    const plan = planFlagChanges([flag('w1', 'LATE', 'r1')], [flag('w1', 'LATE', 'r2')]);
    expect(plan.toCreate).toEqual([flag('w1', 'LATE', 'r2')]);
    expect(plan.toResolve).toEqual([flag('w1', 'LATE', 'r1')]);
  });
});
