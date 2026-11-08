import type { AuditActorType, AuditChannel } from '@puntuale/contracts';

/** Datos de la petición que se registran en la auditoría (ADR 0005). */
export interface RequestMetadata {
  /** En eventos sincronizados sin conexión, es la IP de la sincronización, no la del momento original. */
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

/** Una entrada de auditoría. Se inserta en la misma transacción que el cambio que describe. */
export interface AuditEntry {
  tenantId: string;
  actorType: AuditActorType;
  actorUserId: string | null;
  channel: AuditChannel;
  /** `<modulo>.<entidad>.<verbo-en-pasado>`, por ejemplo `time_tracking.attendance_event.recorded`. */
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  request: RequestMetadata;
  /** Momento declarado del hecho auditado (por ejemplo, la marcación sin conexión). */
  subjectOccurredAt: Date | null;
}

export interface RecordedAudit {
  /** Secuencia global con huecos. No es por tenant ni es el único criterio de orden. */
  id: string;
  publicId: string;
  recordedAt: Date;
}

const ACTION = /^[a-z][a-z_]*\.[a-z][a-z_]*\.[a-z][a-z_]*$/;

/** Valida la forma de la acción antes de llegar al CHECK de la base. */
export function assertValidAuditAction(action: string): void {
  if (!ACTION.test(action)) {
    throw new RangeError(`Acción de auditoría inválida: ${action}`);
  }
}
