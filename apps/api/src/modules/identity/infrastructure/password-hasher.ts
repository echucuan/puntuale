import { randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

// Argon2id es el algoritmo por defecto de la librería. Parámetros del ADR 0014.
const OPTIONS = { memoryCost: 65_536, timeCost: 3, parallelism: 1 } as const;

/** Verifica contraseñas con Argon2id. Nunca registra ni devuelve la contraseña. */
export class PasswordHasher {
  private dummyHash: Promise<string> | null = null;

  hash(password: string): Promise<string> {
    return hash(password, OPTIONS);
  }

  /**
   * Compara contra `passwordHash`, o contra un hash ficticio si la cuenta no existe, para que ambos
   * casos tarden lo mismo. Sin cuenta, el resultado siempre es `false`.
   */
  async verify(passwordHash: string | null, password: string): Promise<boolean> {
    this.dummyHash ??= this.hash(randomBytes(32).toString('base64url'));
    const matches = await verify(passwordHash ?? (await this.dummyHash), password);
    return passwordHash !== null && matches;
  }
}
