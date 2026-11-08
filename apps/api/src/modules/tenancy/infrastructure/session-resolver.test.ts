import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app.module';
import type { AppConfig } from '../../../config/app-config';
import { SESSION_RESOLVER, type SessionResolver } from '../domain/session';
import { NoSessionResolver } from './no-session.resolver';

const SRC_DIR = fileURLToPath(new URL('../../../', import.meta.url));
const USER = '0190f5e2-0000-7000-8000-0000000000bb';

function config(nodeEnv: AppConfig['nodeEnv']): AppConfig {
  // La URL no se usa: el Pool de pg no se conecta hasta la primera consulta.
  return { nodeEnv, port: 0, databaseUrl: 'postgres://u:ficticia@localhost:5432/db' };
}

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function* sourceFiles(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(path);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) yield path;
  }
}

describe('composición productiva: sin adaptador de autenticación de pruebas (ADR 0007)', () => {
  it.each(['development', 'test', 'production'] as const)(
    'con NODE_ENV=%s el módulo registra NoSessionResolver, que nunca da sesión',
    async (nodeEnv) => {
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule.forRoot(config(nodeEnv))],
      }).compile();
      closers.push(() => moduleRef.close());
      const resolver = moduleRef.get<SessionResolver>(SESSION_RESOLVER);
      expect(resolver).toBeInstanceOf(NoSessionResolver);
      await expect(resolver.resolve({ headers: { 'x-test-user-id': USER } })).resolves.toBeNull();
    },
  );

  it('ningún archivo de src/ contiene ni importa el adaptador de pruebas', async () => {
    const offenders: string[] = [];
    for await (const file of sourceFiles(SRC_DIR)) {
      const content = await readFile(file, 'utf8');
      if (/TestSessionResolver|x-test-user-id|test\/support/.test(content)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
