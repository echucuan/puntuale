import { z } from 'zod';

/** Token de inyección de la configuración validada. */
export const APP_CONFIG = Symbol('APP_CONFIG');

const positiveInt = (fallback: number) => z.coerce.number().int().min(1).default(fallback);
const nonNegativeInt = (fallback: number) => z.coerce.number().int().min(0).default(fallback);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().min(0).max(65_535).default(3000),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  AUTH_SECRET: z.string().min(32),
  MFA_ENCRYPTION_KEY: z.string().min(32),
  CORS_ORIGINS: z.string().min(1),
  SESSION_ABSOLUTE_TTL_SECONDS: positiveInt(43_200),
  SESSION_IDLE_TTL_SECONDS: positiveInt(1_800),
  LOGIN_MAX_FAILURES_ACCOUNT: positiveInt(5),
  LOGIN_MAX_FAILURES_IP: positiveInt(20),
  LOGIN_FAILURE_WINDOW_SECONDS: positiveInt(900),
  LOGIN_DELAY_BASE_MS: nonNegativeInt(1_000),
  LOGIN_DELAY_MAX_MS: nonNegativeInt(30_000),
  RATE_LIMIT_API_IP_PER_MINUTE: positiveInt(120),
  RATE_LIMIT_API_SESSION_PER_MINUTE: positiveInt(300),
  MFA_MAX_ATTEMPTS: positiveInt(5),
  // Los intentos se purgan después de un día: la ventana no puede ser mayor.
  MFA_ATTEMPT_WINDOW_SECONDS: z.coerce.number().int().min(1).max(86_400).default(900),
  MFA_ENROLLMENT_TTL_SECONDS: positiveInt(900),
});

export interface SecurityConfig {
  /** Secreto de los HMAC de CSRF y de las llaves de límites de tasa. */
  authSecret: string;
  corsOrigins: readonly string[];
  session: { absoluteTtlSeconds: number; idleTtlSeconds: number };
  login: {
    maxFailuresPerAccount: number;
    maxFailuresPerIp: number;
    windowSeconds: number;
    delayBaseMs: number;
    delayMaxMs: number;
  };
  api: { perIpPerMinute: number; perSessionPerMinute: number };
  mfa: {
    /** Llave maestra del cifrado de secretos TOTP y de las huellas de recuperación. */
    encryptionKey: string;
    maxAttempts: number;
    windowSeconds: number;
    enrollmentTtlSeconds: number;
  };
}

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  security: SecurityConfig;
}

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1']);

/**
 * Normaliza la lista de orígenes y aplica la regla por entorno: producción exige `https` y rechaza
 * `localhost`; fuera de producción solo se admite `localhost` (ADR 0014). Devuelve null si no cumple.
 */
function parseCorsOrigins(raw: string, nodeEnv: AppConfig['nodeEnv']): string[] | null {
  const origins: string[] = [];
  for (const entry of raw.split(',')) {
    let url: URL;
    try {
      url = new URL(entry.trim());
    } catch {
      return null;
    }
    if (url.origin === 'null' || url.origin !== entry.trim()) return null;
    const isLocal = LOCAL_HOSTNAMES.has(url.hostname);
    if (nodeEnv === 'production' ? url.protocol !== 'https:' || isLocal : !isLocal) return null;
    origins.push(url.origin);
  }
  return origins;
}

/**
 * Valida las variables de entorno al arrancar. Si algo falta o es inválido, la API no arranca.
 * El mensaje de error nunca incluye los valores (pueden contener contraseñas).
 */
export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Configuración inválida en: ${fields}. Revisa .env.example.`);
  }
  const data = parsed.data;
  if (data.NODE_ENV === 'production' && data.AUTH_SECRET.includes('dev_only')) {
    throw new Error('Configuración inválida en: AUTH_SECRET. Revisa .env.example.');
  }
  if (
    data.NODE_ENV === 'production' &&
    (data.MFA_ENCRYPTION_KEY.includes('dev_only') || data.MFA_ENCRYPTION_KEY === data.AUTH_SECRET)
  ) {
    throw new Error('Configuración inválida en: MFA_ENCRYPTION_KEY. Revisa .env.example.');
  }
  const corsOrigins = parseCorsOrigins(data.CORS_ORIGINS, data.NODE_ENV);
  if (!corsOrigins) {
    throw new Error('Configuración inválida en: CORS_ORIGINS. Revisa .env.example.');
  }
  return {
    nodeEnv: data.NODE_ENV,
    port: data.PORT,
    databaseUrl: data.DATABASE_URL,
    security: {
      authSecret: data.AUTH_SECRET,
      corsOrigins,
      session: {
        absoluteTtlSeconds: data.SESSION_ABSOLUTE_TTL_SECONDS,
        idleTtlSeconds: data.SESSION_IDLE_TTL_SECONDS,
      },
      login: {
        maxFailuresPerAccount: data.LOGIN_MAX_FAILURES_ACCOUNT,
        maxFailuresPerIp: data.LOGIN_MAX_FAILURES_IP,
        windowSeconds: data.LOGIN_FAILURE_WINDOW_SECONDS,
        delayBaseMs: data.LOGIN_DELAY_BASE_MS,
        delayMaxMs: data.LOGIN_DELAY_MAX_MS,
      },
      api: {
        perIpPerMinute: data.RATE_LIMIT_API_IP_PER_MINUTE,
        perSessionPerMinute: data.RATE_LIMIT_API_SESSION_PER_MINUTE,
      },
      mfa: {
        encryptionKey: data.MFA_ENCRYPTION_KEY,
        maxAttempts: data.MFA_MAX_ATTEMPTS,
        windowSeconds: data.MFA_ATTEMPT_WINDOW_SECONDS,
        enrollmentTtlSeconds: data.MFA_ENROLLMENT_TTL_SECONDS,
      },
    },
  };
}
