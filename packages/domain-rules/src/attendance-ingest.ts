import type { AttendanceEventEvidence, IngestOutcome } from '@puntuale/contracts';
import { canonicalHash } from './canonical-json';

/**
 * Hash de idempotencia (`payload_hash`) de una marcación (ADR 0011).
 * Se calcula **solo sobre la evidencia**. Los campos de transporte (`deviceSentAt`,
 * `ingestMode`) cambian legítimamente entre reintentos, y si se incluyeran
 * producirían falsos conflictos.
 */
export function computeEvidenceHash(evidence: AttendanceEventEvidence): string {
  const {
    clientEventId,
    employeeId,
    eventType,
    declaredLocalTime,
    declaredUtcOffsetMinutes,
    declaredTimezone,
    deviceId,
    metadata,
  } = evidence;
  return canonicalHash({
    clientEventId: clientEventId.toLowerCase(),
    employeeId: employeeId.toLowerCase(),
    eventType,
    declaredLocalTime: normalizeLocalTime(declaredLocalTime),
    declaredUtcOffsetMinutes,
    declaredTimezone,
    deviceId,
    metadata,
  });
}

/**
 * Clasifica un envío frente a lo que ya existe con el mismo `client_event_id`:
 * - no existe → `created`;
 * - existe con el mismo hash → `duplicate` (reintento; se devuelve el original);
 * - existe con otro hash → `conflict` (el contenido cambió; no se sobrescribe).
 */
export function classifyIngest(existingHash: string | null, incomingHash: string): IngestOutcome {
  if (existingHash === null) return 'created';
  return existingHash === incomingHash ? 'duplicate' : 'conflict';
}

/** Normaliza la hora local a milisegundos fijos (`.SSS`) para que `08:00:00` y `08:00:00.000` hagan el mismo hash. */
export function normalizeLocalTime(localTime: string): string {
  const [base, fraction = ''] = localTime.split('.');
  return `${base}.${fraction.padEnd(3, '0')}`;
}

/**
 * Hora UTC derivada de la hora local y el desfase declarados.
 * Es el mismo cálculo que el CHECK `attendance_event_utc_consistency` de la base de datos.
 * **No es una hora confiable**: proviene de un reloj no validado (ADR 0010).
 */
export function deriveOccurredAtUtc(declaredLocalTime: string, utcOffsetMinutes: number): Date {
  const asIfUtc = Date.parse(`${normalizeLocalTime(declaredLocalTime)}Z`);
  if (Number.isNaN(asIfUtc)) throw new RangeError('Hora local inválida');
  return new Date(asIfUtc - utcOffsetMinutes * 60_000);
}

/** Desfase del reloj del dispositivo: `received_at − device_sent_at`, en segundos enteros. */
export function computeClockOffsetSeconds(receivedAt: Date, deviceSentAt: Date): number {
  return Math.round((receivedAt.getTime() - deviceSentAt.getTime()) / 1000);
}

export interface ClockSkewRules {
  /** Desfase absoluto máximo tolerado entre el reloj del dispositivo y el servidor. Por defecto: 300 s. */
  clockSkewThresholdSeconds: number;
  /** Cuánto puede adelantarse una marcación respecto a la hora del servidor. Por defecto: 120 s. */
  futureToleranceSeconds: number;
}

export const DEFAULT_CLOCK_SKEW_RULES: ClockSkewRules = {
  clockSkewThresholdSeconds: 300,
  futureToleranceSeconds: 120,
};

export type ClockSkewReason = 'DEVICE_CLOCK_OFFSET' | 'FUTURE_EVENT';

export interface ClockSkewAssessment {
  /** Si es `true`, se genera la alerta `CLOCK_SKEW` y la jornada pasa a revisión. **Nunca rechaza el evento.** */
  flagged: boolean;
  reasons: ClockSkewReason[];
}

/** Detecta un desfase de reloj sospechoso (ADR 0011). Solo marca para revisión; nunca rechaza. */
export function detectClockSkew(
  input: { clockOffsetSeconds: number; occurredAtUtc: Date; receivedAt: Date },
  rules: ClockSkewRules = DEFAULT_CLOCK_SKEW_RULES,
): ClockSkewAssessment {
  const reasons: ClockSkewReason[] = [];
  if (Math.abs(input.clockOffsetSeconds) > rules.clockSkewThresholdSeconds) {
    reasons.push('DEVICE_CLOCK_OFFSET');
  }
  const aheadSeconds = (input.occurredAtUtc.getTime() - input.receivedAt.getTime()) / 1000;
  if (aheadSeconds > rules.futureToleranceSeconds) {
    reasons.push('FUTURE_EVENT');
  }
  return { flagged: reasons.length > 0, reasons };
}
