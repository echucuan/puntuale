import type { Provider } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../../config/app-config';
import { SESSION_RESOLVER, type SessionResolver } from '../domain/session';
import { NoSessionResolver } from './no-session.resolver';
import { TestSessionResolver } from './test-session.resolver';

/** Elige el resolvedor de sesión: el de pruebas solo con `NODE_ENV=test`; en cualquier otro caso, ninguno. */
export function createSessionResolver(config: AppConfig): SessionResolver {
  return config.nodeEnv === 'test'
    ? new TestSessionResolver(config.nodeEnv)
    : new NoSessionResolver();
}

export const sessionResolverProvider: Provider = {
  provide: SESSION_RESOLVER,
  inject: [APP_CONFIG],
  useFactory: createSessionResolver,
};
