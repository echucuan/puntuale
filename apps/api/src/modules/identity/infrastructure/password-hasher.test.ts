import { describe, expect, it } from 'vitest';
import { PasswordHasher } from './password-hasher';

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher();

  it('usa Argon2id con 64 MiB, 3 iteraciones y paralelismo 1 (ADR 0014)', async () => {
    expect(await hasher.hash('contrasena-ficticia')).toMatch(
      /^\$argon2id\$v=19\$m=65536,t=3,p=1\$/,
    );
  });

  it('acepta la contraseña correcta y rechaza una incorrecta', async () => {
    const stored = await hasher.hash('contrasena-ficticia');
    await expect(hasher.verify(stored, 'contrasena-ficticia')).resolves.toBe(true);
    await expect(hasher.verify(stored, 'otra')).resolves.toBe(false);
  });

  it('sin cuenta siempre responde false', async () => {
    await expect(hasher.verify(null, 'contrasena-ficticia')).resolves.toBe(false);
  });
});
