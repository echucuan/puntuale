import type { INestApplication } from '@nestjs/common';
import {
  ApiErrorSchema,
  HealthResponseSchema,
  TenantContextResponseSchema,
} from '@puntuale/contracts';
import { startTestDatabase, type TestDatabase } from '@puntuale/db/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/create-app';
import { TEST_SESSION_HEADER } from '../../src/modules/tenancy/infrastructure/test-session.resolver';
import { seedTenant, type SeededTenant } from '../support/seed';

let db: TestDatabase;
let app: INestApplication;
let a: SeededTenant;
let b: SeededTenant;

beforeAll(async () => {
  db = await startTestDatabase();
  a = await seedTenant(db.adminPool, 'A');
  b = await seedTenant(db.adminPool, 'B');
  app = await createApp({ nodeEnv: 'test', port: 0, databaseUrl: db.appUrl });
  await app.init();
});

afterAll(async () => {
  await app?.close();
  await db?.stop();
});

const server = () => app.getHttpServer();

describe('GET /health', () => {
  it('responde 200 con la base arriba, sin sesión y fuera del prefijo /api', async () => {
    const response = await request(server()).get('/health').expect(200);
    expect(HealthResponseSchema.parse(response.body)).toEqual({ status: 'ok', database: 'up' });
    await request(server()).get('/api/health').expect(404);
  });
});

describe('GET /api/t/:tenantId/context (TenantGuard)', () => {
  it('sin sesión responde 401 con el formato ApiError', async () => {
    const response = await request(server()).get(`/api/t/${a.tenantId}/context`).expect(401);
    expect(ApiErrorSchema.parse(response.body).error.code).toBe('unauthenticated');
  });

  it('con sesión y membresía devuelve el contexto validado', async () => {
    const response = await request(server())
      .get(`/api/t/${a.tenantId}/context`)
      .set(TEST_SESSION_HEADER, a.userId)
      .expect(200);
    expect(TenantContextResponseSchema.parse(response.body)).toEqual({
      tenantId: a.tenantId,
      userId: a.userId,
      membershipId: a.membershipId,
    });
  });

  it('un usuario de la empresa A que pide la empresa B recibe 404 (la URL no concede acceso)', async () => {
    const response = await request(server())
      .get(`/api/t/${b.tenantId}/context`)
      .set(TEST_SESSION_HEADER, a.userId)
      .expect(404);
    expect(ApiErrorSchema.parse(response.body).error.code).toBe('not_found');
  });

  it('una empresa inexistente y un identificador inválido también responden 404', async () => {
    await request(server())
      .get('/api/t/0190f5e2-0000-7000-8000-00000000dead/context')
      .set(TEST_SESSION_HEADER, a.userId)
      .expect(404);
    await request(server())
      .get("/api/t/not-a-uuid';--/context")
      .set(TEST_SESSION_HEADER, a.userId)
      .expect(404);
  });

  it('una membresía revocada responde 404', async () => {
    const c = await seedTenant(db.adminPool, 'C');
    await db.adminPool.query(`UPDATE user_tenant SET status = 'revoked' WHERE id = $1`, [
      c.membershipId,
    ]);
    await request(server())
      .get(`/api/t/${c.tenantId}/context`)
      .set(TEST_SESSION_HEADER, c.userId)
      .expect(404);
  });
});
