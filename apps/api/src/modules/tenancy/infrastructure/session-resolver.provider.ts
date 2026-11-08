import type { Provider } from '@nestjs/common';
import { SESSION_RESOLVER } from '../domain/session';
import { NoSessionResolver } from './no-session.resolver';

/**
 * Resolvedor de sesión del módulo productivo: **siempre** `NoSessionResolver` (toda ruta de empresa
 * responde 401 hasta 1.0-b). No depende de ninguna variable de entorno ni hay atajo de desarrollo.
 *
 * El adaptador de pruebas no existe en `src/`: vive en la carpeta de soporte de pruebas y solo se registra con una
 * composición explícita de pruebas que sobrescribe este proveedor (ADR 0007).
 */
export const sessionResolverProvider: Provider = {
  provide: SESSION_RESOLVER,
  useClass: NoSessionResolver,
};
