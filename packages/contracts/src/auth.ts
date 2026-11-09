import { z } from 'zod';

/**
 * Credenciales de `POST /api/auth/login`. El correo se normaliza (sin espacios y en minúsculas).
 * La contraseña tiene un máximo para limitar el trabajo de Argon2id.
 */
export const LoginRequestSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  password: z.string().min(1).max(1024),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/** Identidad de la persona de la sesión. Solo se entrega a la propia persona. */
export const AuthUserSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  displayName: z.string(),
});
export type AuthUser = z.infer<typeof AuthUserSchema>;

/** Datos públicos de una sesión. Nunca incluye el token ni su hash. */
export const AuthSessionSchema = z.object({
  id: z.uuid(),
  createdAt: z.string(),
  lastActivityAt: z.string(),
  idleExpiresAt: z.string(),
  expiresAt: z.string(),
});
export type AuthSession = z.infer<typeof AuthSessionSchema>;

/** Respuesta de `GET /api/auth/csrf`. */
export const CsrfResponseSchema = z.object({ csrfToken: z.string() });
export type CsrfResponse = z.infer<typeof CsrfResponseSchema>;

/** Respuesta de `POST /api/auth/login` y de `GET /api/auth/session`. */
export const CurrentSessionResponseSchema = z.object({
  user: AuthUserSchema,
  session: AuthSessionSchema.extend({ mfaVerified: z.boolean() }),
  csrfToken: z.string(),
});
export type CurrentSessionResponse = z.infer<typeof CurrentSessionResponseSchema>;

/** Una sesión activa de la persona, con su origen y si es la de esta petición. */
export const ActiveSessionSchema = AuthSessionSchema.extend({
  current: z.boolean(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
});
export type ActiveSession = z.infer<typeof ActiveSessionSchema>;

/** Respuesta de `GET /api/auth/sessions`. */
export const ActiveSessionsResponseSchema = z.object({
  sessions: z.array(ActiveSessionSchema),
});
export type ActiveSessionsResponse = z.infer<typeof ActiveSessionsResponseSchema>;
