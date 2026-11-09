import type { ClientBase } from 'pg';
import type { LoginThrottleSnapshot } from '../domain/login-throttle';

/**
 * Serializa, hasta el fin de la transacción, los intentos que comparten alguna llave. Toma los
 * bloqueos en orden ascendente del identificador numérico: al ser un orden total, dos
 * transacciones no pueden esperarse mutuamente, sea cual sea el orden de `keys`.
 */
export async function lockThrottleKeys(client: ClientBase, keys: readonly string[]): Promise<void> {
  await client.query(
    `SELECT pg_advisory_xact_lock(lock_id)
       FROM (SELECT DISTINCT hashtextextended(key, 0) AS lock_id
               FROM unnest($1::text[]) AS key
              ORDER BY lock_id
             OFFSET 0) AS ordered`,
    [keys],
  );
}

/** Lee los fallos vigentes. Debe ejecutarse después de `lockThrottleKeys`, en otra sentencia. */
export async function readThrottleSnapshot(
  client: ClientBase,
  accountKey: string,
  ipKey: string,
  windowSeconds: number,
): Promise<LoginThrottleSnapshot> {
  const { rows } = await client.query<{
    account_failures: number;
    ip_failures: number;
    oldest_account: string | null;
    newest_account: string | null;
    oldest_ip: string | null;
  }>(
    `SELECT account.failures AS account_failures,
            account.oldest AS oldest_account,
            account.newest AS newest_account,
            ip.failures AS ip_failures,
            ip.oldest AS oldest_ip
       FROM (SELECT count(*)::int AS failures,
                    max(extract(epoch FROM clock_timestamp() - occurred_at)) AS oldest,
                    min(extract(epoch FROM clock_timestamp() - occurred_at)) AS newest
               FROM login_failure_account
              WHERE account_key = $1
                AND occurred_at > clock_timestamp() - make_interval(secs => $3)) AS account,
            (SELECT count(*)::int AS failures,
                    max(extract(epoch FROM clock_timestamp() - occurred_at)) AS oldest
               FROM login_failure_ip
              WHERE ip_key = $2
                AND occurred_at > clock_timestamp() - make_interval(secs => $3)) AS ip`,
    [accountKey, ipKey, windowSeconds],
  );
  const row = rows[0]!;
  const toNumber = (value: string | null) => (value === null ? null : Number(value));
  return {
    accountFailures: row.account_failures,
    ipFailures: row.ip_failures,
    oldestAccountAgeSeconds: toNumber(row.oldest_account),
    newestAccountAgeSeconds: toNumber(row.newest_account),
    oldestIpAgeSeconds: toNumber(row.oldest_ip),
  };
}

/** Registra el intento en ambos límites y devuelve el id de su fila de IP. */
export async function insertLoginAttempt(
  client: ClientBase,
  accountKey: string,
  ipKey: string,
): Promise<string> {
  await client.query('INSERT INTO login_failure_account (account_key) VALUES ($1)', [accountKey]);
  const { rows } = await client.query<{ id: string }>(
    'INSERT INTO login_failure_ip (ip_key) VALUES ($1) RETURNING id',
    [ipKey],
  );
  return rows[0]!.id;
}

/** Reinicia los fallos de la cuenta. No toca el historial de IP. */
export async function clearLoginFailures(client: ClientBase, accountKey: string): Promise<void> {
  await client.query('SELECT auth_clear_login_failures($1)', [accountKey]);
}

/** Retira de la IP solo el intento indicado: los demás fallos siguen contando. */
export async function releaseIpAttempt(
  client: ClientBase,
  attemptId: string,
  ipKey: string,
): Promise<void> {
  await client.query('SELECT auth_release_login_ip_attempt($1, $2)', [attemptId, ipKey]);
}
