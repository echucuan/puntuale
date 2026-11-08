import type { ClientBase } from 'pg';
import type { LoginThrottleSnapshot } from '../domain/login-throttle';

/** Serializa los intentos de una misma cuenta durante la transacción. */
export async function lockAccountThrottle(client: ClientBase, accountKey: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [accountKey]);
}

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
    `WITH recent AS (
       SELECT account_key, ip_key,
              extract(epoch FROM clock_timestamp() - occurred_at) AS age
         FROM login_failure
        WHERE occurred_at > clock_timestamp() - make_interval(secs => $3)
          AND (account_key = $1 OR ip_key = $2)
     )
     SELECT count(*) FILTER (WHERE account_key = $1)::int AS account_failures,
            count(*) FILTER (WHERE ip_key = $2)::int AS ip_failures,
            max(age) FILTER (WHERE account_key = $1) AS oldest_account,
            min(age) FILTER (WHERE account_key = $1) AS newest_account,
            max(age) FILTER (WHERE ip_key = $2) AS oldest_ip
       FROM recent`,
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

export async function insertLoginFailure(
  client: ClientBase,
  accountKey: string,
  ipKey: string,
): Promise<void> {
  await client.query('INSERT INTO login_failure (account_key, ip_key) VALUES ($1, $2)', [
    accountKey,
    ipKey,
  ]);
}

export async function clearLoginFailures(client: ClientBase, accountKey: string): Promise<void> {
  await client.query('SELECT auth_clear_login_failures($1)', [accountKey]);
}
