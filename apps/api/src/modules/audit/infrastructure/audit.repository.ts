import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { projectAuditData } from '../domain/audit-data-policy';
import { assertValidAuditAction, type AuditEntry, type RecordedAudit } from '../domain/audit-entry';

/**
 * Escribe la auditoría con **el mismo cliente** (y por lo tanto la misma transacción) que el cambio.
 * Si la transacción se revierte, la auditoría también (ADR 0005). Solo inserta: la tabla no admite
 * `UPDATE` ni `DELETE`.
 *
 * `before` y `after` se proyectan a la lista permitida de su tipo de entidad
 * (`audit-data-policy.ts`): nunca se guardan secretos ni campos no listados.
 */
@Injectable()
export class AuditRepository {
  async record(client: PoolClient, entry: AuditEntry): Promise<RecordedAudit> {
    assertValidAuditAction(entry.action);
    const before = projectAuditData(entry.entityType, entry.before);
    const after = projectAuditData(entry.entityType, entry.after);
    const { rows } = await client.query<{ id: string; publicId: string; recordedAt: Date }>(
      `INSERT INTO audit_event (
         tenant_id, actor_type, actor_user_id, channel, action, entity_type, entity_id,
         before_data, after_data, reason, request_ip, user_agent, request_id, subject_occurred_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING id::text AS id, public_id AS "publicId", recorded_at AS "recordedAt"`,
      [
        entry.tenantId,
        entry.actorType,
        entry.actorUserId,
        entry.channel,
        entry.action,
        entry.entityType,
        entry.entityId,
        toJson(before),
        toJson(after),
        entry.reason,
        entry.request.ip,
        entry.request.userAgent,
        entry.request.requestId,
        entry.subjectOccurredAt,
      ],
    );
    const recorded = rows[0];
    if (!recorded) throw new Error('La auditoría no devolvió el registro insertado.');
    return recorded;
  }
}

function toJson(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}
