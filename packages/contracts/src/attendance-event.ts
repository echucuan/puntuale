import { z } from 'zod';
import {
  ATTENDANCE_EVENT_SOURCES,
  ATTENDANCE_EVENT_TYPES,
  INGEST_MODES,
  INGEST_OUTCOMES,
} from './enums';
import {
  IanaTimezoneSchema,
  InstantSchema,
  LocalDateTimeSchema,
  UtcOffsetMinutesSchema,
} from './time';

/**
 * Metadatos controlados de una marcación: claves acotadas y valores escalares.
 * No admite objetos anidados ni datos arbitrarios del cliente.
 */
export const AttendanceEventMetadataSchema = z
  .record(
    z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
    z.union([z.string().max(200), z.number().finite(), z.boolean()]),
  )
  .refine((value) => Object.keys(value).length <= 20, { message: 'Máximo 20 metadatos' });

/**
 * **Evidencia** de una marcación: lo que el dispositivo declara que ocurrió.
 * El hash de idempotencia (`payload_hash`) se calcula **solo** sobre estos campos.
 * Si incluyera campos de transporte, un reintento legítimo daría un falso conflicto (ADR 0011).
 */
export const AttendanceEventEvidenceSchema = z.object({
  /** UUID generado en el dispositivo. Es la llave de idempotencia. */
  clientEventId: z.uuid(),
  employeeId: z.uuid(),
  eventType: z.enum(ATTENDANCE_EVENT_TYPES),
  /** Hora de pared declarada por el dispositivo, sin zona. */
  declaredLocalTime: LocalDateTimeSchema,
  /** Desfase UTC que el dispositivo declaraba en ese momento (resuelve horas ambiguas). */
  declaredUtcOffsetMinutes: UtcOffsetMinutesSchema,
  declaredTimezone: IanaTimezoneSchema,
  deviceId: z.string().min(1).max(128).nullable(),
  metadata: AttendanceEventMetadataSchema,
});
export type AttendanceEventEvidence = z.infer<typeof AttendanceEventEvidenceSchema>;

/**
 * **Transporte**: datos del envío. Pueden cambiar entre reintentos sin cambiar la evidencia.
 */
export const AttendanceEventTransportSchema = z.object({
  /** Hora del reloj del dispositivo al enviar. Sirve para calcular el desfase de reloj. */
  deviceSentAt: InstantSchema,
  ingestMode: z.enum(INGEST_MODES),
});
export type AttendanceEventTransport = z.infer<typeof AttendanceEventTransportSchema>;

/** Contrato completo de entrada de una marcación desde la PWA (en línea o sincronizada). */
export const AttendanceEventInputSchema = AttendanceEventEvidenceSchema.extend(
  AttendanceEventTransportSchema.shape,
);
export type AttendanceEventInput = z.infer<typeof AttendanceEventInputSchema>;

/** Marcación persistida, tal como la devuelve la API. Las horas son instantes ISO en UTC. */
export const AttendanceEventRecordSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  employeeId: z.uuid(),
  eventType: z.enum(ATTENDANCE_EVENT_TYPES),
  source: z.enum(ATTENDANCE_EVENT_SOURCES),
  ingestMode: z.enum(INGEST_MODES).nullable(),
  declaredLocalTime: LocalDateTimeSchema.nullable(),
  declaredUtcOffsetMinutes: UtcOffsetMinutesSchema.nullable(),
  declaredTimezone: IanaTimezoneSchema,
  /** Derivada de la hora declarada. Proviene de un reloj no validado: sirve para ordenar, no es confiable (ADR 0010). */
  occurredAtUtc: InstantSchema,
  deviceSentAt: InstantSchema.nullable(),
  /** Hora del servidor. Es la referencia confiable para auditoría. */
  receivedAt: InstantSchema,
  clockOffsetSeconds: z.number().int().nullable(),
  clientEventId: z.uuid().nullable(),
  payloadHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  deviceId: z.string().nullable(),
  supersedesEventId: z.uuid().nullable(),
  createdByUserId: z.uuid().nullable(),
  metadata: AttendanceEventMetadataSchema,
});
export type AttendanceEventRecord = z.infer<typeof AttendanceEventRecordSchema>;

/** Resultado de la ingesta idempotente: `created` (201), `duplicate` (200) o `conflict` (409). */
export const IngestResultSchema = z.object({
  outcome: z.enum(INGEST_OUTCOMES),
  duplicate: z.boolean(),
  event: AttendanceEventRecordSchema,
});
export type IngestResult = z.infer<typeof IngestResultSchema>;
