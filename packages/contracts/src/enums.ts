/**
 * Enumeraciones compartidas. Cada una se define como un arreglo `as const`
 * (fuente única de verdad) más su tipo unión derivado (ADR 0009).
 * Los valores coinciden exactamente con los CHECK de la base de datos.
 */

/** Estado de asistencia de una jornada (ADR 0012). Exactamente cuatro valores. */
export const ATTENDANCE_STATUSES = ['pending', 'incomplete', 'needs_review', 'complete'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/** Etiquetas de interfaz en español para cada estado de asistencia. */
export const ATTENDANCE_STATUS_LABELS_ES: Record<AttendanceStatus, string> = {
  pending: 'Pendiente',
  incomplete: 'Incompleta',
  needs_review: 'Por revisar',
  complete: 'Completa',
};

/** Tipo de marcación. */
export const ATTENDANCE_EVENT_TYPES = ['in', 'out'] as const;
export type AttendanceEventType = (typeof ATTENDANCE_EVENT_TYPES)[number];

/** Origen de la marcación: dispositivo (PWA) o corrección (ADR 0004). */
export const ATTENDANCE_EVENT_SOURCES = ['pwa', 'correction'] as const;
export type AttendanceEventSource = (typeof ATTENDANCE_EVENT_SOURCES)[number];

/** Cómo llegó el evento al servidor (ADR 0011). */
export const INGEST_MODES = ['online', 'offline_sync'] as const;
export type IngestMode = (typeof INGEST_MODES)[number];

/** Resultado determinista de la ingesta idempotente (ADR 0011). */
export const INGEST_OUTCOMES = ['created', 'duplicate', 'conflict'] as const;
export type IngestOutcome = (typeof INGEST_OUTCOMES)[number];

/** Estado de sincronización en la cola del cliente (implementación de la cola: 1.0-d). */
export const CLIENT_SYNC_STATUSES = ['queued', 'sending', 'synced', 'conflict', 'failed'] as const;
export type ClientSyncStatus = (typeof CLIENT_SYNC_STATUSES)[number];

export const TENANT_STATUSES = ['active', 'inactive'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const EMPLOYEE_STATUSES = ['active', 'terminated'] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

export const MEMBERSHIP_STATUSES = ['active', 'revoked'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

/** Canal por el que se originó una acción auditada (ADR 0005). */
export const AUDIT_CHANNELS = ['online', 'offline_sync', 'job', 'system'] as const;
export type AuditChannel = (typeof AUDIT_CHANNELS)[number];

export const AUDIT_ACTOR_TYPES = ['user', 'system', 'job'] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];
