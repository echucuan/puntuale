import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { type INestApplication, RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import type { AppConfig } from './config/app-config';

export type RequestWithId = Request & { requestId?: string };

/**
 * Configuración HTTP común: la aplica la composición productiva y la de pruebas.
 * Helmet y CORS van primero para cubrir también las respuestas de error (ADR 0014).
 */
export function configureApp(app: INestApplication, config: AppConfig): INestApplication {
  app.use(
    helmet({
      // La API solo devuelve JSON: no carga recursos ni se muestra en marcos.
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
      xFrameOptions: { action: 'deny' },
      strictTransportSecurity:
        config.nodeEnv === 'production' ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    }),
  );
  app.enableCors({
    // Lista explícita: nunca `*`. Un origen desconocido no recibe encabezados CORS.
    origin: [...config.security.corsOrigins],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
    maxAge: 600,
  });
  app.use((request: RequestWithId, response: Response, next: NextFunction) => {
    // Se genera siempre: un identificador enviado por el cliente no es confiable.
    request.requestId = randomUUID();
    response.setHeader('X-Request-Id', request.requestId);
    next();
  });
  app.setGlobalPrefix('api', { exclude: [{ path: 'health', method: RequestMethod.GET }] });
  app.enableShutdownHooks();
  return app;
}

/**
 * Composición **productiva** de la API (la usa `main.ts`). No acepta sustituciones de proveedores:
 * la sesión siempre se resuelve con la cookie real.
 */
export async function createApp(config: AppConfig): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.forRoot(config), {
    logger: config.nodeEnv === 'test' ? ['error'] : ['log', 'warn', 'error'],
  });
  return configureApp(app, config);
}
