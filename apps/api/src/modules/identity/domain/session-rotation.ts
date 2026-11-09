/**
 * Tiempo durante el cual una sesión recién rotada todavía se considera un intento perdedor. Pasado
 * este plazo, una cookie vieja (por ejemplo, de una respuesta perdida) ya no impide iniciar sesión.
 */
export const ROTATION_CONFLICT_WINDOW_SECONDS = 30;

/** Estado, ya bloqueado, de la sesión que traía la petición de login. */
export interface PresentedSession {
  id: string;
  userId: string;
  active: boolean;
  recentlyRotated: boolean;
}

export type RotationDecision =
  | { kind: 'independent' }
  | { kind: 'rotate'; sessionId: string }
  | { kind: 'conflict'; sessionId: string };

/**
 * Contrato de rotación (ADR 0014): una sesión se consume una sola vez y solo la rota su dueña.
 * Sin sesión propia que rotar, el login es independiente y no toca ninguna otra sesión.
 */
export function decideRotation(
  presented: PresentedSession | null,
  accountUserId: string,
): RotationDecision {
  if (!presented || presented.userId !== accountUserId) return { kind: 'independent' };
  if (presented.active) return { kind: 'rotate', sessionId: presented.id };
  if (presented.recentlyRotated) return { kind: 'conflict', sessionId: presented.id };
  return { kind: 'independent' };
}
