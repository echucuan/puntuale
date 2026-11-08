import { describe, expect, it } from 'vitest';
import { assertValidAuditAction } from './audit-entry';

describe('assertValidAuditAction', () => {
  it('acepta <modulo>.<entidad>.<verbo>', () => {
    expect(() => assertValidAuditAction('time_tracking.attendance_event.recorded')).not.toThrow();
  });

  it.each(['recorded', 'time_tracking.recorded', 'Time.Event.Recorded', 'a.b.c.d', 'a.b.'])(
    'rechaza %s',
    (action) => {
      expect(() => assertValidAuditAction(action)).toThrow(RangeError);
    },
  );
});
