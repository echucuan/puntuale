import type { AttendanceStatus } from '@puntuale/contracts';

/** Condiciones que determinan el estado de asistencia de una jornada. */
export interface AttendanceStatusInput {
  /** Hay al menos una alerta, corrección o aclaración abierta que requiere atención. */
  hasOpenReviewItems: boolean;
  /** La ventana del turno sigue abierta: aún pueden llegar marcaciones. */
  windowOpen: boolean;
  /** Hay segmentos sin par (entrada sin salida o salida sin entrada). */
  hasUnpairedSegments: boolean;
}

/**
 * Precedencia única de los estados de asistencia (ADR 0012):
 * 1. `needs_review`: hay algo abierto que requiere atención; tiene prioridad para no ocultar incidencias.
 * 2. `pending`: la ventana sigue abierta.
 * 3. `incomplete`: la ventana cerró y faltan pares.
 * 4. `complete`: pares válidos y nada abierto.
 *
 * Una ausencia justificada **no** es un estado: es una incidencia resuelta (`resolved_justified`).
 */
export function resolveAttendanceStatus(input: AttendanceStatusInput): AttendanceStatus {
  if (input.hasOpenReviewItems) return 'needs_review';
  if (input.windowOpen) return 'pending';
  if (input.hasUnpairedSegments) return 'incomplete';
  return 'complete';
}
