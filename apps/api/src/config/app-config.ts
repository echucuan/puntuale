import { z } from 'zod';

/** Token de inyección de la configuración validada. */
export const APP_CONFIG = Symbol('APP_CONFIG');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().min(0).max(65_535).default(3000),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
});

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
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
  return {
    nodeEnv: parsed.data.NODE_ENV,
    port: parsed.data.PORT,
    databaseUrl: parsed.data.DATABASE_URL,
  };
}
