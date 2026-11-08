/**
 * Identidad estable de una jornada (ajuste 2.2 del arquitecto).
 *
 * La llave natural **no recibe eventos**: depende solo del contexto de programación
 * (tenant, empleado, fecha operativa, asignación, versión del horario e instancia de turno).
 * Por eso una marcación tardía o fuera de orden nunca cambia la identidad de una jornada
 * ni crea otra: recalcular hace un upsert sobre la misma llave.
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface WorkdayKeyBase {
  tenantId: string;
  employeeId: string;
  /** Fecha local en que **inicia** el turno (ADR 0010), con el formato AAAA-MM-DD. */
  operationalDate: string;
}

export interface ScheduledWorkdayKeyInput extends WorkdayKeyBase {
  kind: 'scheduled';
  assignmentId: string;
  scheduleVersionId: string;
  /** Índice del turno dentro de la **definición del horario** de ese día (0, 1, …), no del orden de los eventos. */
  shiftInstance: number;
}

/** Como máximo una jornada no programada por empleado y fecha operativa. */
export interface UnscheduledWorkdayKeyInput extends WorkdayKeyBase {
  kind: 'unscheduled';
}

export type WorkdayKeyInput = ScheduledWorkdayKeyInput | UnscheduledWorkdayKeyInput;

export function workdayNaturalKey(input: WorkdayKeyInput): string {
  assertUuid(input.tenantId, 'tenantId');
  assertUuid(input.employeeId, 'employeeId');
  if (!DATE_PATTERN.test(input.operationalDate)) {
    throw new RangeError('operationalDate debe tener el formato AAAA-MM-DD');
  }
  const base = [input.tenantId, input.employeeId, input.operationalDate].map((v) =>
    v.toLowerCase(),
  );
  if (input.kind === 'unscheduled') {
    return ['unscheduled', ...base].join(':');
  }
  assertUuid(input.assignmentId, 'assignmentId');
  assertUuid(input.scheduleVersionId, 'scheduleVersionId');
  if (!Number.isInteger(input.shiftInstance) || input.shiftInstance < 0) {
    throw new RangeError('shiftInstance debe ser un entero mayor o igual a 0');
  }
  return [
    'scheduled',
    ...base,
    input.assignmentId.toLowerCase(),
    input.scheduleVersionId.toLowerCase(),
    String(input.shiftInstance),
  ].join(':');
}

function assertUuid(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) throw new RangeError(`${field} debe ser un UUID`);
}
