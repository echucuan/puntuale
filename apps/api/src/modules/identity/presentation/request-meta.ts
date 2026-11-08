import { isIP } from 'node:net';
import type { Request } from 'express';
import type { RequestWithId } from '../../../create-app';
import type { RequestMeta } from '../domain/active-session';

const MAX_USER_AGENT = 512;

/** Datos de origen de la petición. La IP es la de la conexión (`trust proxy` sigue sin activar). */
export function requestMeta(request: Request): RequestMeta {
  const ip = request.ip && isIP(request.ip) ? request.ip : null;
  const userAgent = request.headers['user-agent']?.slice(0, MAX_USER_AGENT) ?? null;
  return { ip, userAgent, requestId: (request as RequestWithId).requestId ?? null };
}
