import { z } from 'zod';

/** Respuesta de `GET /health`. */
export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  database: z.enum(['up', 'down']),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/** Respuesta de `GET /api/t/:tenantId/context`: el contexto de tenant que validó el `TenantGuard`. */
export const TenantContextResponseSchema = z.object({
  tenantId: z.uuid(),
  userId: z.uuid(),
  membershipId: z.uuid(),
});
export type TenantContextResponse = z.infer<typeof TenantContextResponseSchema>;

/** Códigos de error estables de la API. */
export const API_ERROR_CODES = [
  'unauthenticated',
  'not_found',
  'validation_failed',
  'conflict',
  'internal_error',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** Forma única de los errores de la API. `message` está en español y es para personas. */
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.enum(API_ERROR_CODES),
    message: z.string(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
