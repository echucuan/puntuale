/** Sesión válida de la petición, con la identidad de su dueña. */
export interface ActiveSessionRecord {
  id: string;
  userId: string;
  email: string;
  displayName: string;
  createdAt: Date;
  lastActivityAt: Date;
  idleExpiresAt: Date;
  expiresAt: Date;
  /** Momento en que esta sesión completó MFA. Null si todavía no. */
  mfaVerifiedAt: Date | null;
}

/** Datos de la petición que se registran. No incluye cuerpo, cookies ni encabezados de autenticación. */
export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}
