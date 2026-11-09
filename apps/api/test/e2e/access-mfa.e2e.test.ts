import { type INestApplication, Logger } from '@nestjs/common';
import {
  AccessMembersResponseSchema,
  CsrfResponseSchema,
  CurrentSessionResponseSchema,
  MfaConfirmResponseSchema,
  MfaEnrollmentResponseSchema,
  MfaStatusResponseSchema,
  MyTenantsResponseSchema,
  type RoleCode,
  TenantMeResponseSchema,
} from '@puntuale/contracts';
import { startTestDatabase, type TestDatabase } from '@puntuale/db/testing';
import { Secret, TOTP } from 'otpauth';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/create-app';
import { AccessService } from '../../src/modules/tenancy/application/access.service';
import { seedAccount, type SeededAccount } from '../support/auth';
import { testConfig, TEST_ORIGIN } from '../support/config';

type Agent = ReturnType<typeof request.agent>;

let db: TestDatabase;
let app: INestApplication;

beforeAll(async () => {
  db = await startTestDatabase();
  app = await createApp(testConfig(db.appUrl));
  await app.listen(0);
});

afterAll(async () => {
  await app?.close();
  await db?.stop();
});

beforeEach(async () => {
  await db.adminPool.query('DELETE FROM login_failure_account');
  await db.adminPool.query('DELETE FROM login_failure_ip');
  await db.adminPool.query('DELETE FROM rate_limit_bucket');
});

interface Actor {
  account: SeededAccount;
  agent: Agent;
  csrf: string;
  sessionId: string;
  membershipId: string;
  tenantId: string;
}

let tenantCounter = 0;

async function createTenant(): Promise<string> {
  tenantCounter += 1;
  const { rows } = await db.adminPool.query<{ id: string }>(
    `INSERT INTO tenant (legal_name, timezone) VALUES ($1, 'America/Mexico_City') RETURNING id`,
    [`Empresa Ficticia ${tenantCounter}`],
  );
  return rows[0]!.id;
}

async function login(account: SeededAccount) {
  const agent = request.agent(app.getHttpServer());
  const csrf = await agent.get('/api/auth/csrf').expect(200);
  const response = await agent
    .post('/api/auth/login')
    .set('Origin', TEST_ORIGIN)
    .set('X-CSRF-Token', CsrfResponseSchema.parse(csrf.body).csrfToken)
    .send({ email: account.email, password: account.password })
    .expect(200);
  const body = CurrentSessionResponseSchema.parse(response.body);
  return { agent, csrf: body.csrfToken, sessionId: body.session.id };
}

async function addMembership(
  tenantId: string,
  userId: string,
  roles: readonly RoleCode[],
): Promise<string> {
  const { rows } = await db.adminPool.query<{ id: string }>(
    `INSERT INTO user_tenant (tenant_id, user_id) VALUES ($1, $2) RETURNING id`,
    [tenantId, userId],
  );
  const membershipId = rows[0]!.id;
  for (const role of roles) {
    await db.adminPool.query(
      `INSERT INTO membership_role (tenant_id, membership_id, role_code) VALUES ($1, $2, $3)`,
      [tenantId, membershipId, role],
    );
  }
  return membershipId;
}

async function member(tenantId: string, roles: readonly RoleCode[]): Promise<Actor> {
  const account = await seedAccount(db.adminPool);
  const membershipId = await addMembership(tenantId, account.userId, roles);
  return { account, membershipId, tenantId, ...(await login(account)) };
}

function send(actor: Actor, method: 'post' | 'put' | 'delete', path: string, body?: object) {
  const pending = actor.agent[method](path)
    .set('Origin', TEST_ORIGIN)
    .set('X-CSRF-Token', actor.csrf);
  return body ? pending.send(body) : pending;
}

const codeAt = (secret: string, offsetSteps = 0) =>
  new TOTP({ secret: Secret.fromBase32(secret) }).generate({
    timestamp: Date.now() + offsetSteps * 30_000,
  });

/** Un código que no coincide con ningún paso de la ventana. */
function wrongCode(secret: string): string {
  const valid = new Set([-1, 0, 1].map((offset) => codeAt(secret, offset)));
  return ['000000', '111111', '222222', '333333'].find((code) => !valid.has(code))!;
}

/** Olvida el último paso aceptado, para pruebas que no tratan sobre la reutilización. */
const forgetLastStep = (userId: string) =>
  db.adminPool.query('UPDATE user_mfa SET last_accepted_step = NULL WHERE user_id = $1', [userId]);

async function startEnrollment(actor: Actor) {
  const response = await send(actor, 'post', '/api/auth/mfa/enrollment', {
    password: actor.account.password,
  }).expect(200);
  return MfaEnrollmentResponseSchema.parse(response.body).secret;
}

async function enroll(actor: Actor) {
  const secret = await startEnrollment(actor);
  const response = await send(actor, 'post', '/api/auth/mfa/enrollment/confirm', {
    code: codeAt(secret),
  }).expect(200);
  return { secret, recoveryCodes: MfaConfirmResponseSchema.parse(response.body).recoveryCodes };
}

const membersOf = (actor: Actor) => actor.agent.get(`/api/t/${actor.tenantId}/access/members`);
const rolePath = (actor: Actor, membershipId: string, role: string) =>
  `/api/t/${actor.tenantId}/access/members/${membershipId}/roles/${role}`;
const statusPath = (actor: Actor, membershipId: string) =>
  `/api/t/${actor.tenantId}/access/members/${membershipId}/status`;

async function verifiedOwner(tenantId: string) {
  const actor = await member(tenantId, ['company_owner']);
  return { actor, ...(await enroll(actor)) };
}

async function verifiedHr(tenantId: string) {
  const actor = await member(tenantId, ['hr_admin']);
  await enroll(actor);
  return actor;
}

const auditOf = async (tenantId: string, action: string) => {
  const { rows } = await db.adminPool.query<{ after_data: unknown; before_data: unknown }>(
    `SELECT before_data, after_data FROM audit_event WHERE tenant_id = $1 AND action = $2`,
    [tenantId, action],
  );
  return rows;
};

const eventTypes = async (userId: string) => {
  const { rows } = await db.adminPool.query<{ event_type: string }>(
    `SELECT event_type FROM security_event WHERE user_id = $1 ORDER BY id`,
    [userId],
  );
  return rows.map((row) => row.event_type);
};

describe('empresas de la persona', () => {
  it('sin sesión responde 401', async () => {
    await request(app.getHttpServer()).get('/api/me/tenants').expect(401);
  });

  it('solo lista las empresas con membresía activa, con sus roles', async () => {
    const a = await createTenant();
    const b = await createTenant();
    const c = await createTenant();
    const actor = await member(a, ['employee']);
    await addMembership(b, actor.account.userId, ['company_owner']);
    const inactive = await addMembership(c, actor.account.userId, ['employee']);
    await db.adminPool.query(`UPDATE user_tenant SET status = 'revoked' WHERE id = $1`, [inactive]);

    const response = await actor.agent.get('/api/me/tenants').expect(200);
    const { tenants } = MyTenantsResponseSchema.parse(response.body);
    expect(tenants.map((tenant) => tenant.tenantId).sort()).toEqual([a, b].sort());
    expect(tenants.find((tenant) => tenant.tenantId === b)).toMatchObject({
      roles: ['company_owner'],
      requiresMfa: true,
    });
    expect(tenants.find((tenant) => tenant.tenantId === a)?.requiresMfa).toBe(false);
  });

  it('la selección exige membresía y se audita', async () => {
    const a = await createTenant();
    const b = await createTenant();
    const actor = await member(a, ['employee']);
    await send(actor, 'post', `/api/t/${a}/selection`).expect(204);
    await send(actor, 'post', `/api/t/${b}/selection`).expect(404);
    expect(await auditOf(a, 'tenancy.tenant.switched')).toHaveLength(1);
    expect(await auditOf(b, 'tenancy.tenant.switched')).toHaveLength(0);
  });
});

describe('identidad propia', () => {
  it('un colaborador ve su identidad, sus roles y ningún permiso reservado', async () => {
    const tenantId = await createTenant();
    const actor = await member(tenantId, ['supervisor']);
    const response = await actor.agent.get(`/api/t/${tenantId}/me`).expect(200);
    const me = TenantMeResponseSchema.parse(response.body);
    expect(me.user.email).toBe(actor.account.email);
    expect(me.roles).toEqual(['supervisor']);
    expect(me.permissions).toEqual([]);
    expect(me.mfa).toBe('not_required');
    expect(JSON.stringify(response.body)).not.toMatch(/attendance|incident|period/);
  });

  it('un colaborador no puede consultar la vista de accesos', async () => {
    const actor = await member(await createTenant(), ['employee']);
    const response = await membersOf(actor).expect(403);
    expect(response.body.error.code).toBe('permission_denied');
  });
});

describe('aislamiento entre empresas', () => {
  it('el administrador solo lista su empresa y no alcanza membresías de otra', async () => {
    const a = await createTenant();
    const b = await createTenant();
    const { actor } = await verifiedOwner(a);
    const colleague = await member(a, ['employee']);
    const outsider = await member(b, ['employee']);

    const response = await membersOf(actor).expect(200);
    const { members } = AccessMembersResponseSchema.parse(response.body);
    expect(members.map((item) => item.membershipId).sort()).toEqual(
      [actor.membershipId, colleague.membershipId].sort(),
    );
    expect(JSON.stringify(response.body)).not.toContain(outsider.account.email);

    await actor.agent.get(`/api/t/${b}/access/members`).expect(404);
    await send(actor, 'put', rolePath(actor, outsider.membershipId, 'auditor')).expect(404);
    await send(actor, 'put', statusPath(actor, outsider.membershipId), {
      status: 'revoked',
    }).expect(404);
    await send(actor, 'put', `/api/t/${b}/access/members/${outsider.membershipId}/status`, {
      status: 'revoked',
    }).expect(404);
    const { rows } = await db.adminPool.query(`SELECT status FROM user_tenant WHERE id = $1`, [
      outsider.membershipId,
    ]);
    expect(rows).toEqual([{ status: 'active' }]);
  });
});

describe('membresía desactivada', () => {
  it('pierde el acceso con la sesión abierta y lo recupera al reactivarse', async () => {
    const tenantId = await createTenant();
    const { actor: owner } = await verifiedOwner(tenantId);
    const colleague = await member(tenantId, ['employee']);
    await colleague.agent.get(`/api/t/${tenantId}/me`).expect(200);

    await send(owner, 'put', statusPath(owner, colleague.membershipId), {
      status: 'revoked',
    }).expect(204);
    await colleague.agent.get(`/api/t/${tenantId}/me`).expect(404);
    const tenants = await colleague.agent.get('/api/me/tenants').expect(200);
    expect(MyTenantsResponseSchema.parse(tenants.body).tenants).toEqual([]);
    await colleague.agent.get('/api/auth/session').expect(200);

    const [audit] = await auditOf(tenantId, 'tenancy.membership.deactivated');
    expect(audit).toMatchObject({
      before_data: { status: 'active' },
      after_data: { status: 'revoked' },
    });

    await send(owner, 'put', statusPath(owner, colleague.membershipId), {
      status: 'active',
    }).expect(204);
    await colleague.agent.get(`/api/t/${tenantId}/me`).expect(200);
  });

  it('un administrador desactivado no conserva sus permisos', async () => {
    const tenantId = await createTenant();
    const { actor: owner } = await verifiedOwner(tenantId);
    const hr = await verifiedHr(tenantId);
    await send(owner, 'put', statusPath(owner, hr.membershipId), { status: 'revoked' }).expect(204);
    await membersOf(hr).expect(404);
  });
});

describe('roles y elevación de privilegios', () => {
  it('asigna y retira un rol, audita el cambio real y no repite auditoría', async () => {
    const tenantId = await createTenant();
    const { actor: owner } = await verifiedOwner(tenantId);
    const colleague = await member(tenantId, ['employee']);

    await send(owner, 'put', rolePath(owner, colleague.membershipId, 'auditor')).expect(204);
    await send(owner, 'put', rolePath(owner, colleague.membershipId, 'auditor')).expect(204);
    expect(await auditOf(tenantId, 'tenancy.membership_role.assigned')).toHaveLength(1);

    await send(owner, 'delete', rolePath(owner, colleague.membershipId, 'auditor')).expect(204);
    await send(owner, 'delete', rolePath(owner, colleague.membershipId, 'auditor')).expect(204);
    expect(await auditOf(tenantId, 'tenancy.membership_role.retired')).toHaveLength(1);

    const { rows } = await db.adminPool.query(
      `SELECT revoked_at IS NOT NULL AS retired FROM membership_role
        WHERE membership_id = $1 AND role_code = 'auditor'`,
      [colleague.membershipId],
    );
    expect(rows).toEqual([{ retired: true }]);
  });

  it('nadie cambia su propio acceso', async () => {
    const tenantId = await createTenant();
    const { actor: owner } = await verifiedOwner(tenantId);
    await member(tenantId, ['company_owner']);
    const self = await send(owner, 'put', rolePath(owner, owner.membershipId, 'hr_admin'));
    expect(self.status).toBe(403);
    expect(self.body.error.code).toBe('self_modification');
    const status = await send(owner, 'put', statusPath(owner, owner.membershipId), {
      status: 'revoked',
    });
    expect(status.body.error.code).toBe('self_modification');
  });

  it('un colaborador no puede asignarse un rol administrativo', async () => {
    const actor = await member(await createTenant(), ['employee']);
    const response = await send(actor, 'put', rolePath(actor, actor.membershipId, 'company_owner'));
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('permission_denied');
  });

  it('RH no asigna roles administrativos ni afecta a administradores', async () => {
    const tenantId = await createTenant();
    const { actor: owner } = await verifiedOwner(tenantId);
    const hr = await verifiedHr(tenantId);
    const colleague = await member(tenantId, ['employee']);

    await send(hr, 'put', rolePath(hr, colleague.membershipId, 'auditor')).expect(204);
    for (const role of ['company_owner', 'hr_admin']) {
      const denied = await send(hr, 'put', rolePath(hr, colleague.membershipId, role));
      expect(denied.status).toBe(403);
      expect(denied.body.error.code).toBe('permission_denied');
    }
    await send(hr, 'put', statusPath(hr, owner.membershipId), { status: 'revoked' }).expect(403);
    await send(hr, 'delete', rolePath(hr, owner.membershipId, 'company_owner')).expect(403);
  });

  it('retirar un rol quita el permiso en la siguiente petición', async () => {
    const tenantId = await createTenant();
    const { actor: owner } = await verifiedOwner(tenantId);
    const hr = await verifiedHr(tenantId);
    await membersOf(hr).expect(200);
    await send(owner, 'delete', rolePath(owner, hr.membershipId, 'hr_admin')).expect(204);
    await membersOf(hr).expect(403);
  });

  it('rechaza un rol fuera del catálogo y no asigna a una membresía inactiva', async () => {
    const tenantId = await createTenant();
    const { actor: owner } = await verifiedOwner(tenantId);
    const colleague = await member(tenantId, ['employee']);
    await send(owner, 'put', rolePath(owner, colleague.membershipId, 'superadmin')).expect(404);
    await send(owner, 'put', statusPath(owner, colleague.membershipId), {
      status: 'revoked',
    }).expect(204);
    await send(owner, 'put', rolePath(owner, colleague.membershipId, 'auditor')).expect(409);
  });
});

describe('último administrador', () => {
  it('el último propietario activo no se retira ni se desactiva', async () => {
    const tenantId = await createTenant();
    const { actor: owner } = await verifiedOwner(tenantId);
    const retire = await send(
      owner,
      'delete',
      rolePath(owner, owner.membershipId, 'company_owner'),
    );
    expect(retire.status).toBe(409);
    expect(retire.body.error.code).toBe('last_admin');
    const deactivate = await send(owner, 'put', statusPath(owner, owner.membershipId), {
      status: 'revoked',
    });
    expect(deactivate.status).toBe(409);
    expect(deactivate.body.error.code).toBe('last_admin');
  });

  it('un propietario inactivo no cuenta como propietario restante', async () => {
    const tenantId = await createTenant();
    const { actor: first } = await verifiedOwner(tenantId);
    const { actor: second } = await verifiedOwner(tenantId);
    await send(first, 'put', statusPath(first, second.membershipId), {
      status: 'revoked',
    }).expect(204);
    const response = await send(
      first,
      'delete',
      rolePath(first, first.membershipId, 'company_owner'),
    );
    expect(response.body.error.code).toBe('last_admin');
  });

  it('dos propietarios que se retiran a la vez dejan al menos uno activo', async () => {
    const tenantId = await createTenant();
    const { actor: first } = await verifiedOwner(tenantId);
    const { actor: second } = await verifiedOwner(tenantId);
    const results = await Promise.all([
      send(first, 'delete', rolePath(first, second.membershipId, 'company_owner')),
      send(second, 'delete', rolePath(second, first.membershipId, 'company_owner')),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([204, 403]);
    const { rows } = await db.adminPool.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM membership_role
        WHERE tenant_id = $1 AND role_code = 'company_owner' AND revoked_at IS NULL`,
      [tenantId],
    );
    expect(rows[0]!.total).toBe(1);
  });
});

describe('MFA obligatorio para roles administrativos', () => {
  it('la contraseña sola no da acceso administrativo', async () => {
    const tenantId = await createTenant();
    const actor = await member(tenantId, ['company_owner']);
    const colleague = await member(tenantId, ['employee']);

    const notEnrolled = await membersOf(actor).expect(403);
    expect(notEnrolled.body.error.code).toBe('mfa_enrollment_required');
    const blocked = await send(actor, 'put', rolePath(actor, colleague.membershipId, 'auditor'));
    expect(blocked.body.error.code).toBe('mfa_enrollment_required');
    const me = await actor.agent.get(`/api/t/${tenantId}/me`).expect(200);
    expect(TenantMeResponseSchema.parse(me.body)).toMatchObject({
      permissions: [],
      mfa: 'enrollment_required',
    });

    const { secret } = await enroll(actor);
    await membersOf(actor).expect(200);

    const relogged = { ...actor, ...(await login(actor.account)) };
    const pending = await membersOf(relogged).expect(403);
    expect(pending.body.error.code).toBe('mfa_required');

    await forgetLastStep(actor.account.userId);
    await send(relogged, 'post', '/api/auth/mfa/verify', { code: codeAt(secret) }).expect(204);
    await membersOf(relogged).expect(200);
    const after = await relogged.agent.get(`/api/t/${tenantId}/me`).expect(200);
    expect(TenantMeResponseSchema.parse(after.body)).toMatchObject({
      permissions: ['access.manage', 'access.manage_admins', 'access.read'],
      mfa: 'ok',
    });
  });

  it('una inscripción sin confirmar no activa MFA ni da acceso', async () => {
    const tenantId = await createTenant();
    const actor = await member(tenantId, ['company_owner']);
    const secret = await startEnrollment(actor);
    const status = await actor.agent.get('/api/auth/mfa').expect(200);
    expect(MfaStatusResponseSchema.parse(status.body)).toMatchObject({
      enrolled: false,
      pendingEnrollment: true,
      verifiedThisSession: false,
    });
    const wrong = await send(actor, 'post', '/api/auth/mfa/enrollment/confirm', {
      code: wrongCode(secret),
    }).expect(403);
    expect(wrong.body.error.code).toBe('invalid_mfa_code');
    await membersOf(actor).expect(403);
  });

  it('el secreto pendiente vencido no se puede confirmar', async () => {
    const actor = await member(await createTenant(), ['company_owner']);
    const secret = await startEnrollment(actor);
    await db.adminPool.query(
      `UPDATE user_mfa SET pending_created_at = now() - interval '1 hour' WHERE user_id = $1`,
      [actor.account.userId],
    );
    await send(actor, 'post', '/api/auth/mfa/enrollment/confirm', { code: codeAt(secret) }).expect(
      409,
    );
  });

  it('la verificación de una sesión no pasa a otra, y el rol sin MFA no la exige', async () => {
    const tenantId = await createTenant();
    const { actor } = await verifiedOwner(tenantId);
    const other = { ...actor, ...(await login(actor.account)) };
    await membersOf(actor).expect(200);
    await membersOf(other).expect(403);
  });
});

describe('códigos TOTP', () => {
  it('no acepta el mismo código dos veces', async () => {
    const { actor, secret } = await verifiedOwner(await createTenant());
    const relogged = { ...actor, ...(await login(actor.account)) };
    await forgetLastStep(actor.account.userId);
    const code = codeAt(secret);
    await send(relogged, 'post', '/api/auth/mfa/verify', { code }).expect(204);

    const replay = { ...actor, ...(await login(actor.account)) };
    const response = await send(replay, 'post', '/api/auth/mfa/verify', { code }).expect(403);
    expect(response.body.error.code).toBe('invalid_mfa_code');
    await membersOf(replay).expect(403);
  });

  it('el código de confirmación tampoco se puede reutilizar', async () => {
    const actor = await member(await createTenant(), ['company_owner']);
    const secret = await startEnrollment(actor);
    const code = codeAt(secret);
    await send(actor, 'post', '/api/auth/mfa/enrollment/confirm', { code }).expect(200);
    const relogged = { ...actor, ...(await login(actor.account)) };
    await send(relogged, 'post', '/api/auth/mfa/verify', { code }).expect(403);
  });

  it('un paso anterior al último aceptado no sirve aunque esté en la ventana', async () => {
    const { actor, secret } = await verifiedOwner(await createTenant());
    await db.adminPool.query('UPDATE user_mfa SET last_accepted_step = $2 WHERE user_id = $1', [
      actor.account.userId,
      Math.floor(Date.now() / 30_000),
    ]);
    const relogged = { ...actor, ...(await login(actor.account)) };
    await send(relogged, 'post', '/api/auth/mfa/verify', { code: codeAt(secret, -1) }).expect(403);
  });

  it('dos verificaciones simultáneas del mismo código: solo una se acepta', async () => {
    const { actor, secret } = await verifiedOwner(await createTenant());
    await forgetLastStep(actor.account.userId);
    const first = { ...actor, ...(await login(actor.account)) };
    const second = { ...actor, ...(await login(actor.account)) };
    const code = codeAt(secret);
    const results = await Promise.all([
      send(first, 'post', '/api/auth/mfa/verify', { code }),
      send(second, 'post', '/api/auth/mfa/verify', { code }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([204, 403]);
  });

  it('limita los intentos fallidos con 429 y Retry-After', async () => {
    const { actor, secret } = await verifiedOwner(await createTenant());
    const relogged = { ...actor, ...(await login(actor.account)) };
    const code = wrongCode(secret);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await send(relogged, 'post', '/api/auth/mfa/verify', { code }).expect(403);
    }
    await forgetLastStep(actor.account.userId);
    const limited = await send(relogged, 'post', '/api/auth/mfa/verify', {
      code: codeAt(secret),
    }).expect(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    await membersOf(relogged).expect(403);
    expect(await eventTypes(actor.account.userId)).toContain('mfa_failed');
  });

  it('el límite también cubre la recuperación y la reautenticación', async () => {
    const { actor, secret, recoveryCodes } = await verifiedOwner(await createTenant());
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await send(actor, 'post', '/api/auth/mfa/verify', {
        recoveryCode: 'AAAA-BBBB-CCCC-DDDD',
      }).expect(403);
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await send(actor, 'post', '/api/auth/mfa/disable', {
        password: 'incorrecta',
        code: wrongCode(secret),
      }).expect(403);
    }
    await send(actor, 'post', '/api/auth/mfa/verify', {
      recoveryCode: recoveryCodes[0]!,
    }).expect(429);
  });
});

describe('códigos de recuperación', () => {
  it('se entregan 10, se guardan como huellas y cada uno sirve una sola vez', async () => {
    const { actor, recoveryCodes } = await verifiedOwner(await createTenant());
    expect(new Set(recoveryCodes).size).toBe(10);

    const { rows } = await db.adminPool.query<{ code_hash: string }>(
      'SELECT code_hash FROM mfa_recovery_code WHERE user_id = $1',
      [actor.account.userId],
    );
    expect(rows).toHaveLength(10);
    for (const code of recoveryCodes) {
      expect(rows.some((row) => row.code_hash.includes(code.replaceAll('-', '')))).toBe(false);
    }

    const recoveryCode = recoveryCodes[0]!;
    const relogged = { ...actor, ...(await login(actor.account)) };
    await send(relogged, 'post', '/api/auth/mfa/verify', { recoveryCode }).expect(204);
    await membersOf(relogged).expect(200);

    const again = { ...actor, ...(await login(actor.account)) };
    const reused = await send(again, 'post', '/api/auth/mfa/verify', { recoveryCode }).expect(403);
    expect(reused.body.error.code).toBe('invalid_mfa_code');
    await membersOf(again).expect(403);

    const status = await again.agent.get('/api/auth/mfa').expect(200);
    expect(MfaStatusResponseSchema.parse(status.body).recoveryCodesRemaining).toBe(9);
    expect(await eventTypes(actor.account.userId)).toContain('mfa_recovery_used');
  });

  it('acepta el código sin guiones y en minúsculas', async () => {
    const { actor, recoveryCodes } = await verifiedOwner(await createTenant());
    const relogged = { ...actor, ...(await login(actor.account)) };
    await send(relogged, 'post', '/api/auth/mfa/verify', {
      recoveryCode: recoveryCodes[1]!.replaceAll('-', '').toLowerCase(),
    }).expect(204);
  });

  it('el código de otra persona no sirve', async () => {
    const tenantId = await createTenant();
    const { actor: first } = await verifiedOwner(tenantId);
    const { recoveryCodes } = await verifiedOwner(tenantId);
    await send(first, 'post', '/api/auth/mfa/verify', { recoveryCode: recoveryCodes[0]! }).expect(
      403,
    );
  });

  it('dos usos simultáneos del mismo código: solo uno se acepta', async () => {
    const { actor, recoveryCodes } = await verifiedOwner(await createTenant());
    const first = { ...actor, ...(await login(actor.account)) };
    const second = { ...actor, ...(await login(actor.account)) };
    const results = await Promise.all(
      [first, second].map((item) =>
        send(item, 'post', '/api/auth/mfa/verify', { recoveryCode: recoveryCodes[2]! }),
      ),
    );
    expect(results.map((result) => result.status).sort()).toEqual([204, 403]);
  });
});

describe('reemplazar y desactivar MFA', () => {
  it('reemplazar exige contraseña y factor; el secreto anterior sigue hasta confirmar', async () => {
    const tenantId = await createTenant();
    const { actor, secret, recoveryCodes } = await verifiedOwner(tenantId);
    const other = { ...actor, ...(await login(actor.account)) };

    await send(actor, 'post', '/api/auth/mfa/enrollment', {
      password: 'incorrecta',
      recoveryCode: recoveryCodes[0]!,
    }).expect(403);
    await send(actor, 'post', '/api/auth/mfa/enrollment', {
      password: actor.account.password,
    }).expect(403);

    await forgetLastStep(actor.account.userId);
    const started = await send(actor, 'post', '/api/auth/mfa/enrollment', {
      password: actor.account.password,
      code: codeAt(secret),
    }).expect(200);
    const replacement = MfaEnrollmentResponseSchema.parse(started.body).secret;
    expect(replacement).not.toBe(secret);

    await forgetLastStep(actor.account.userId);
    await send(other, 'post', '/api/auth/mfa/verify', { code: codeAt(secret) }).expect(204);
    await membersOf(other).expect(200);

    const confirmed = await send(actor, 'post', '/api/auth/mfa/enrollment/confirm', {
      code: codeAt(replacement),
    }).expect(200);
    await membersOf(actor).expect(200);
    await membersOf(other).expect(403);
    expect(await eventTypes(actor.account.userId)).toContain('mfa_replaced');

    const newCodes = MfaConfirmResponseSchema.parse(confirmed.body).recoveryCodes;
    await send(other, 'post', '/api/auth/mfa/verify', { recoveryCode: recoveryCodes[1]! }).expect(
      403,
    );
    await send(other, 'post', '/api/auth/mfa/verify', { recoveryCode: newCodes[0]! }).expect(204);
  });

  it('desactivar exige reautenticación y deja las sesiones sin verificación', async () => {
    const tenantId = await createTenant();
    const { actor, secret } = await verifiedOwner(tenantId);

    await send(actor, 'post', '/api/auth/mfa/disable', {
      password: actor.account.password,
    }).expect(403);
    await forgetLastStep(actor.account.userId);
    const badPassword = await send(actor, 'post', '/api/auth/mfa/disable', {
      password: 'incorrecta',
      code: codeAt(secret),
    }).expect(403);
    expect(badPassword.body.error.code).toBe('invalid_credentials');
    await membersOf(actor).expect(200);

    await forgetLastStep(actor.account.userId);
    await send(actor, 'post', '/api/auth/mfa/disable', {
      password: actor.account.password,
      code: codeAt(secret),
    }).expect(204);
    const denied = await membersOf(actor).expect(403);
    expect(denied.body.error.code).toBe('mfa_enrollment_required');
    expect(await eventTypes(actor.account.userId)).toContain('mfa_disabled');
  });

  it('una sesión rotada empieza sin verificación', async () => {
    const { actor } = await verifiedOwner(await createTenant());
    const csrf = await actor.agent.get('/api/auth/csrf').expect(200);
    const rotated = await actor.agent
      .post('/api/auth/login')
      .set('Origin', TEST_ORIGIN)
      .set('X-CSRF-Token', CsrfResponseSchema.parse(csrf.body).csrfToken)
      .send({ email: actor.account.email, password: actor.account.password })
      .expect(200);
    expect(CurrentSessionResponseSchema.parse(rotated.body).session.mfaVerified).toBe(false);
    await membersOf(actor).expect(403);
  });
});

describe('ausencia de secretos', () => {
  it('no aparecen en respuestas posteriores, base de datos, eventos, auditoría ni registros', async () => {
    const written: string[] = [];
    const capture = (...args: unknown[]) => {
      written.push(args.map(String).join(' '));
      return true;
    };
    const spies = [
      vi.spyOn(process.stdout, 'write').mockImplementation(capture),
      vi.spyOn(process.stderr, 'write').mockImplementation(capture),
      vi.spyOn(console, 'log').mockImplementation(capture),
      vi.spyOn(console, 'error').mockImplementation(capture),
      vi.spyOn(Logger.prototype, 'log').mockImplementation(capture),
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(capture),
      vi.spyOn(Logger.prototype, 'error').mockImplementation(capture),
    ];

    let sensitive: string[];
    let bodies: string;
    let actor: Actor;
    try {
      const tenantId = await createTenant();
      const owner = await verifiedOwner(tenantId);
      actor = owner.actor;
      await forgetLastStep(actor.account.userId);
      const code = codeAt(owner.secret);
      await send(actor, 'post', '/api/auth/mfa/verify', { code }).expect(204);
      await send(actor, 'post', '/api/auth/mfa/verify', { code: wrongCode(owner.secret) }).expect(
        403,
      );
      const responses = await Promise.all([
        actor.agent.get('/api/auth/mfa'),
        actor.agent.get('/api/auth/session'),
        actor.agent.get('/api/me/tenants'),
        actor.agent.get(`/api/t/${tenantId}/me`),
        membersOf(actor),
      ]);
      bodies = responses.map((response) => JSON.stringify(response.body)).join('\n');
      sensitive = [owner.secret, code, actor.account.password, ...owner.recoveryCodes];
    } finally {
      for (const spy of spies) spy.mockRestore();
    }

    const { rows: stored } = await db.adminPool.query<{ dump: string }>(
      `SELECT concat_ws(' ',
         (SELECT string_agg(to_jsonb(m)::text, ' ') FROM user_mfa m WHERE user_id = $1),
         (SELECT string_agg(to_jsonb(r)::text, ' ') FROM mfa_recovery_code r WHERE user_id = $1),
         (SELECT string_agg(to_jsonb(e)::text, ' ') FROM security_event e WHERE user_id = $1),
         (SELECT string_agg(to_jsonb(a)::text, ' ') FROM audit_event a WHERE actor_user_id = $1)
       ) AS dump`,
      [actor.account.userId],
    );
    const logs = written.join('\n');
    for (const value of sensitive) {
      expect(stored[0]!.dump).not.toContain(value);
      expect(logs).not.toContain(value);
      expect(bodies).not.toContain(value);
    }
    expect(bodies).not.toMatch(/ciphertext|code_hash|last_accepted_step/i);
  });

  it('las respuestas con el secreto o los códigos no se almacenan en caché', async () => {
    const actor = await member(await createTenant(), ['company_owner']);
    const started = await send(actor, 'post', '/api/auth/mfa/enrollment', {
      password: actor.account.password,
    }).expect(200);
    expect(started.headers['cache-control']).toBe('no-store');
    const secret = MfaEnrollmentResponseSchema.parse(started.body).secret;
    const confirmed = await send(actor, 'post', '/api/auth/mfa/enrollment/confirm', {
      code: codeAt(secret),
    }).expect(200);
    expect(confirmed.headers['cache-control']).toBe('no-store');
  });

  it('el secreto cifrado de una persona no sirve si se copia a otra', async () => {
    const tenantId = await createTenant();
    const { actor: first, secret } = await verifiedOwner(tenantId);
    const { actor: second } = await verifiedOwner(tenantId);
    await db.adminPool.query(
      `UPDATE user_mfa SET
         secret_ciphertext = (SELECT secret_ciphertext FROM user_mfa WHERE user_id = $1),
         last_accepted_step = NULL
       WHERE user_id = $2`,
      [first.account.userId, second.account.userId],
    );
    const response = await send(second, 'post', '/api/auth/mfa/verify', { code: codeAt(secret) });
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('ciphertext');
  });
});

describe('propietario con acceso efectivo', () => {
  const META = { ip: null, userAgent: null, requestId: null };
  const RETIRED = 'tenancy.membership_role.retired';
  const DEACTIVATED = 'tenancy.membership.deactivated';

  const disableCredential = (userId: string) =>
    db.adminPool.query(`UPDATE app_user_credential SET status = 'disabled' WHERE user_id = $1`, [
      userId,
    ]);

  const effectiveOwners = async (tenantId: string) => {
    const { rows } = await db.adminPool.query<{ membership_id: string }>(
      `SELECT ut.id AS membership_id
         FROM user_tenant ut
         JOIN membership_role mr ON mr.tenant_id = ut.tenant_id AND mr.membership_id = ut.id
         JOIN app_user_credential c ON c.user_id = ut.user_id
        WHERE ut.tenant_id = $1 AND ut.status = 'active' AND mr.role_code = 'company_owner'
          AND mr.revoked_at IS NULL AND c.status = 'active'`,
      [tenantId],
    );
    return rows.map((row) => row.membership_id);
  };

  /** Un propietario cuya credencial se deshabilitó después de pasar los guards de la petición. */
  const asDisabledOwner = (actor: Actor) => {
    const service = app.get(AccessService, { strict: false });
    const context = {
      tenantId: actor.tenantId,
      userId: actor.account.userId,
      membershipId: actor.membershipId,
    };
    return {
      retire: (membershipId: string) =>
        service.change(
          context,
          membershipId,
          { kind: 'retire_role', role: 'company_owner' },
          'verified',
          META,
        ),
      deactivate: (membershipId: string) =>
        service.change(
          context,
          membershipId,
          { kind: 'set_status', status: 'revoked' },
          'verified',
          META,
        ),
    };
  };

  it('el propietario deshabilitado no cuenta: el único habilitado no se retira a sí mismo', async () => {
    const tenantId = await createTenant();
    const { actor: enabled } = await verifiedOwner(tenantId);
    const disabled = await member(tenantId, ['company_owner']);
    await disableCredential(disabled.account.userId);

    const retire = await send(
      enabled,
      'delete',
      rolePath(enabled, enabled.membershipId, 'company_owner'),
    );
    expect(retire.status).toBe(409);
    expect(retire.body.error.code).toBe('last_admin');
    const deactivate = await send(enabled, 'put', statusPath(enabled, enabled.membershipId), {
      status: 'revoked',
    });
    expect(deactivate.status).toBe(409);
    expect(deactivate.body.error.code).toBe('last_admin');

    expect(await effectiveOwners(tenantId)).toEqual([enabled.membershipId]);
    expect(await auditOf(tenantId, RETIRED)).toEqual([]);
    expect(await auditOf(tenantId, DEACTIVATED)).toEqual([]);
  });

  it('una credencial deshabilitada durante la petición no permite retirar al único habilitado', async () => {
    const tenantId = await createTenant();
    const { actor: enabled } = await verifiedOwner(tenantId);
    const disabled = await member(tenantId, ['company_owner']);
    await disableCredential(disabled.account.userId);

    await expect(asDisabledOwner(disabled).retire(enabled.membershipId)).rejects.toMatchObject({
      code: 'last_admin',
    });
    await expect(asDisabledOwner(disabled).deactivate(enabled.membershipId)).rejects.toMatchObject({
      code: 'last_admin',
    });

    expect(await effectiveOwners(tenantId)).toEqual([enabled.membershipId]);
    const { rows } = await db.adminPool.query(
      `SELECT ut.status, mr.revoked_at
         FROM user_tenant ut
         JOIN membership_role mr ON mr.tenant_id = ut.tenant_id AND mr.membership_id = ut.id
        WHERE ut.id = $1`,
      [enabled.membershipId],
    );
    expect(rows).toEqual([{ status: 'active', revoked_at: null }]);
    expect(await auditOf(tenantId, RETIRED)).toEqual([]);
    expect(await auditOf(tenantId, DEACTIVATED)).toEqual([]);
  });

  it('el propietario habilitado sí puede retirar y desactivar al deshabilitado', async () => {
    const tenantId = await createTenant();
    const { actor: enabled } = await verifiedOwner(tenantId);
    const first = await member(tenantId, ['company_owner']);
    const second = await member(tenantId, ['company_owner']);
    await disableCredential(first.account.userId);
    await disableCredential(second.account.userId);

    await send(enabled, 'delete', rolePath(enabled, first.membershipId, 'company_owner')).expect(
      204,
    );
    await send(enabled, 'put', statusPath(enabled, second.membershipId), {
      status: 'revoked',
    }).expect(204);
    expect(await effectiveOwners(tenantId)).toEqual([enabled.membershipId]);
  });

  it('una credencial deshabilitada termina la sesión del propietario', async () => {
    const tenantId = await createTenant();
    const { actor } = await verifiedOwner(tenantId);
    await disableCredential(actor.account.userId);
    await membersOf(actor).expect(401);
  });

  it('dos retiros simultáneos, con un tercero deshabilitado, dejan uno con acceso efectivo', async () => {
    const tenantId = await createTenant();
    const { actor: first } = await verifiedOwner(tenantId);
    const { actor: second } = await verifiedOwner(tenantId);
    const disabled = await member(tenantId, ['company_owner']);
    await disableCredential(disabled.account.userId);

    const results = await Promise.all([
      send(first, 'delete', rolePath(first, second.membershipId, 'company_owner')),
      send(second, 'delete', rolePath(second, first.membershipId, 'company_owner')),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([204, 403]);
    expect(await effectiveOwners(tenantId)).toHaveLength(1);
    expect(await auditOf(tenantId, RETIRED)).toHaveLength(1);
  });

  it('un retiro y una desactivación simultáneos conservan uno con acceso efectivo', async () => {
    const tenantId = await createTenant();
    const { actor: first } = await verifiedOwner(tenantId);
    const { actor: second } = await verifiedOwner(tenantId);
    const disabled = await member(tenantId, ['company_owner']);
    await disableCredential(disabled.account.userId);

    await Promise.allSettled([
      send(first, 'put', statusPath(first, second.membershipId), { status: 'revoked' }),
      asDisabledOwner(disabled).retire(first.membershipId),
    ]);
    expect(await effectiveOwners(tenantId)).toHaveLength(1);
  });
});

describe('reactivación', () => {
  it('conserva los roles y reactivar a un administrador exige access.manage_admins', async () => {
    const tenantId = await createTenant();
    const { actor: owner } = await verifiedOwner(tenantId);
    const hr = await verifiedHr(tenantId);
    const admin = await member(tenantId, ['hr_admin', 'auditor']);

    await send(owner, 'put', statusPath(owner, admin.membershipId), { status: 'revoked' }).expect(
      204,
    );
    const denied = await send(hr, 'put', statusPath(hr, admin.membershipId), { status: 'active' });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('permission_denied');

    await send(owner, 'put', statusPath(owner, admin.membershipId), { status: 'active' }).expect(
      204,
    );
    const response = await membersOf(owner).expect(200);
    const { members } = AccessMembersResponseSchema.parse(response.body);
    expect(members.find((item) => item.membershipId === admin.membershipId)).toMatchObject({
      status: 'active',
      roles: ['auditor', 'hr_admin'],
    });
  });
});
