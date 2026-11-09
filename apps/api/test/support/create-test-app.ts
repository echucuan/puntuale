import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import type { AppConfig } from '../../src/config/app-config';
import { configureApp } from '../../src/create-app';
import { SESSION_RESOLVER } from '../../src/modules/tenancy/domain/session';
import { TestSessionResolver } from './test-session.resolver';

/**
 * Composición **explícita de pruebas**: el mismo `AppModule` productivo, con el resolvedor de
 * sesión sustituido por `TestSessionResolver`. Es el único lugar que lo registra.
 */
export async function createTestApp(config: AppConfig): Promise<INestApplication> {
  const resolver = new TestSessionResolver({ env: process.env, databaseUrl: config.databaseUrl });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(config)] })
    .overrideProvider(SESSION_RESOLVER)
    .useValue(resolver)
    .compile();
  const app = moduleRef.createNestApplication({ logger: ['error'] });
  return configureApp(app, config);
}
