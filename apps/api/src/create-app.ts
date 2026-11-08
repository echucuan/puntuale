import 'reflect-metadata';
import { type INestApplication, RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import type { AppConfig } from './config/app-config';

/** Configuración HTTP común: la aplica la composición productiva y la de pruebas. */
export function configureApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix('api', { exclude: [{ path: 'health', method: RequestMethod.GET }] });
  app.enableShutdownHooks();
  return app;
}

/**
 * Composición **productiva** de la API (la usa `main.ts`). No acepta sustituciones de proveedores:
 * el resolvedor de sesión siempre es `NoSessionResolver`.
 */
export async function createApp(config: AppConfig): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.forRoot(config), {
    logger: config.nodeEnv === 'test' ? ['error'] : ['log', 'warn', 'error'],
  });
  return configureApp(app);
}
