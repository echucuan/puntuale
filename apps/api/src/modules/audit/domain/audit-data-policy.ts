/**
 * Lista permitida de campos que pueden aparecer en `before_data` y `after_data` (ADR 0005).
 *
 * - Solo se guardan los campos listados para cada tipo de entidad; el resto se descarta.
 * - Un tipo de entidad que no esté registrado no se puede auditar con datos.
 * - Nunca se permiten secretos: contraseñas, secretos MFA, tokens, cookies ni credenciales.
 *   La lista se valida al cargar el módulo, así que un campo prohibido no puede agregarse por error.
 */
export const AUDITABLE_FIELDS = {
  attendance_event: [
    'id',
    'tenantId',
    'employeeId',
    'eventType',
    'source',
    'ingestMode',
    'declaredLocalTime',
    'declaredUtcOffsetMinutes',
    'declaredTimezone',
    'occurredAtUtc',
    'deviceSentAt',
    'receivedAt',
    'clockOffsetSeconds',
    'clientEventId',
    'payloadHash',
    'deviceId',
    'supersedesEventId',
    'createdByUserId',
    'metadata',
    // Solo en el rechazo por conflicto: el hash de la evidencia que no se guardó.
    'incomingPayloadHash',
  ],
  employee: ['id', 'tenantId', 'employeeNumber', 'displayName', 'status'],
  user_tenant: ['id', 'tenantId', 'userId', 'employeeId', 'status'],
  membership_role: ['id', 'tenantId', 'membershipId', 'role', 'scopeType'],
} as const satisfies Record<string, readonly string[]>;

export type AuditableEntityType = keyof typeof AUDITABLE_FIELDS;

/** Nombres de campo que nunca se auditan, aunque alguien los agregue a la lista permitida. */
const SENSITIVE_FIELD =
  /pass(word)?|secret|token|cookie|credential|mfa|otp|totp|session|api_?key|private_?key|hash_?password/i;

/** `payloadHash` e `incomingPayloadHash` son huellas de evidencia, no secretos. */
const SENSITIVE_EXCEPTIONS = new Set(['payloadHash', 'incomingPayloadHash']);

export function isSensitiveField(field: string): boolean {
  return !SENSITIVE_EXCEPTIONS.has(field) && SENSITIVE_FIELD.test(field);
}

export function isAuditableEntityType(entityType: string): entityType is AuditableEntityType {
  return Object.hasOwn(AUDITABLE_FIELDS, entityType);
}

/** Verifica la propia lista permitida. Se ejecuta al cargar el módulo y en las pruebas. */
export function assertAuditPolicyIsSafe(policy: Record<string, readonly string[]>): void {
  for (const [entityType, fields] of Object.entries(policy)) {
    for (const field of fields) {
      if (isSensitiveField(field)) {
        throw new Error(`Campo sensible en la lista de auditoría: ${entityType}.${field}`);
      }
    }
  }
}

assertAuditPolicyIsSafe(AUDITABLE_FIELDS);

/**
 * Proyecta `data` a los campos permitidos de `entityType`. `null`/`undefined` devuelven `null`.
 * Lanza un error si el tipo de entidad no está registrado o si `data` no es un objeto.
 */
export function projectAuditData(
  entityType: string,
  data: unknown,
): Record<string, unknown> | null {
  if (data === null || data === undefined) return null;
  if (!isAuditableEntityType(entityType)) {
    throw new RangeError(`Tipo de entidad sin lista de auditoría: ${entityType}`);
  }
  if (typeof data !== 'object' || Array.isArray(data)) {
    throw new TypeError('Los datos de auditoría deben ser un objeto');
  }
  const allowed: readonly string[] = AUDITABLE_FIELDS[entityType];
  const projected: Record<string, unknown> = {};
  for (const field of allowed) {
    if (Object.hasOwn(data, field)) projected[field] = (data as Record<string, unknown>)[field];
  }
  return projected;
}
