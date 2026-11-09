import {
  type AccessMembersResponse,
  AccessMembersResponseSchema,
  type ActiveSession,
  ActiveSessionsResponseSchema,
  ApiErrorSchema,
  CsrfResponseSchema,
  type CurrentSessionResponse,
  CurrentSessionResponseSchema,
  type LoginRequest,
  type MfaConfirmRequest,
  type MfaConfirmResponse,
  MfaConfirmResponseSchema,
  type MfaDisableRequest,
  type MfaEnrollmentRequest,
  type MfaEnrollmentResponse,
  MfaEnrollmentResponseSchema,
  type MfaFactor,
  type MfaStatusResponse,
  MfaStatusResponseSchema,
  type MyTenant,
  MyTenantsResponseSchema,
  type RoleCode,
  type TenantMeResponse,
  TenantMeResponseSchema,
} from '@puntuale/contracts';

export interface AuthFailure {
  code: string;
  retryAfterSeconds: number | null;
}

interface ResponseSchema<T> {
  safeParse(body: unknown): { success: true; data: T } | { success: false };
}

export type AuthResult<T> = { ok: true; value: T } | { ok: false; failure: AuthFailure };

const UNREACHABLE: AuthResult<never> = {
  ok: false,
  failure: { code: 'unreachable', retryAfterSeconds: null },
};

function outOfContract(): AuthResult<never> {
  return { ok: false, failure: { code: 'unexpected', retryAfterSeconds: null } };
}

async function toFailure(response: Response): Promise<AuthResult<never>> {
  const body: unknown = await response.json().catch(() => null);
  const parsed = ApiErrorSchema.safeParse(body);
  const retryAfter = Number(response.headers.get('Retry-After'));
  return {
    ok: false,
    failure: {
      code: parsed.success ? parsed.data.error.code : 'unexpected',
      retryAfterSeconds: retryAfter > 0 ? retryAfter : null,
    },
  };
}

/** Cliente de sesión. La cookie la maneja el navegador; JavaScript nunca ve el token de sesión. */
export function createAuthApi(fetchImpl: typeof fetch = (...args) => fetch(...args)) {
  async function readJson<T>(
    path: string,
    init: RequestInit,
    parse: (body: unknown) => T | null,
  ): Promise<AuthResult<T>> {
    try {
      const response = await fetchImpl(path, init);
      if (!response.ok) return await toFailure(response);
      const value = parse(await response.json().catch(() => null));
      return value === null ? outOfContract() : { ok: true, value };
    } catch {
      return UNREACHABLE;
    }
  }

  function csrfToken(): Promise<AuthResult<string>> {
    return readJson('/api/auth/csrf', {}, (body) => {
      const parsed = CsrfResponseSchema.safeParse(body);
      return parsed.success ? parsed.data.csrfToken : null;
    });
  }

  /** Toda mutación pide primero el token CSRF vigente: cambia al iniciar sesión. */
  async function mutationInit(method: string, body?: unknown): Promise<AuthResult<RequestInit>> {
    const csrf = await csrfToken();
    if (!csrf.ok) return csrf;
    return {
      ok: true,
      value: {
        method,
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf.value },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    };
  }

  async function sendWithoutContent(
    path: string,
    method: string,
    body?: unknown,
  ): Promise<AuthResult<null>> {
    const init = await mutationInit(method, body);
    if (!init.ok) return init;
    try {
      const response = await fetchImpl(path, init.value);
      return response.ok ? { ok: true, value: null } : await toFailure(response);
    } catch {
      return UNREACHABLE;
    }
  }

  function parseCurrent(body: unknown): CurrentSessionResponse | null {
    const parsed = CurrentSessionResponseSchema.safeParse(body);
    return parsed.success ? parsed.data : null;
  }

  function parser<T>(schema: ResponseSchema<T>) {
    return (body: unknown): T | null => {
      const parsed = schema.safeParse(body);
      return parsed.success ? parsed.data : null;
    };
  }

  async function postJson<T>(
    path: string,
    body: unknown,
    schema: ResponseSchema<T>,
  ): Promise<AuthResult<T>> {
    const init = await mutationInit('POST', body);
    if (!init.ok) return init;
    return readJson(path, init.value, parser(schema));
  }

  const tenantBase = (tenantId: string) => `/api/t/${encodeURIComponent(tenantId)}`;
  const memberBase = (tenantId: string, membershipId: string) =>
    `${tenantBase(tenantId)}/access/members/${encodeURIComponent(membershipId)}`;

  return {
    myTenants: async (): Promise<AuthResult<MyTenant[]>> => {
      const result = await readJson('/api/me/tenants', {}, parser(MyTenantsResponseSchema));
      return result.ok ? { ok: true, value: result.value.tenants } : result;
    },

    tenantMe: (tenantId: string): Promise<AuthResult<TenantMeResponse>> =>
      readJson(`${tenantBase(tenantId)}/me`, {}, parser(TenantMeResponseSchema)),

    selectTenant: (tenantId: string) =>
      sendWithoutContent(`${tenantBase(tenantId)}/selection`, 'POST'),

    accessMembers: (tenantId: string): Promise<AuthResult<AccessMembersResponse>> =>
      readJson(`${tenantBase(tenantId)}/access/members`, {}, parser(AccessMembersResponseSchema)),

    assignRole: (tenantId: string, membershipId: string, role: RoleCode) =>
      sendWithoutContent(`${memberBase(tenantId, membershipId)}/roles/${role}`, 'PUT'),

    retireRole: (tenantId: string, membershipId: string, role: RoleCode) =>
      sendWithoutContent(`${memberBase(tenantId, membershipId)}/roles/${role}`, 'DELETE'),

    setMembershipStatus: (tenantId: string, membershipId: string, status: 'active' | 'revoked') =>
      sendWithoutContent(`${memberBase(tenantId, membershipId)}/status`, 'PUT', { status }),

    mfaStatus: (): Promise<AuthResult<MfaStatusResponse>> =>
      readJson('/api/auth/mfa', {}, parser(MfaStatusResponseSchema)),

    startMfaEnrollment: (input: MfaEnrollmentRequest): Promise<AuthResult<MfaEnrollmentResponse>> =>
      postJson('/api/auth/mfa/enrollment', input, MfaEnrollmentResponseSchema),

    confirmMfaEnrollment: (input: MfaConfirmRequest): Promise<AuthResult<MfaConfirmResponse>> =>
      postJson('/api/auth/mfa/enrollment/confirm', input, MfaConfirmResponseSchema),

    verifyMfa: (factor: MfaFactor) => sendWithoutContent('/api/auth/mfa/verify', 'POST', factor),

    disableMfa: (input: MfaDisableRequest) =>
      sendWithoutContent('/api/auth/mfa/disable', 'POST', input),

    currentSession: () => readJson('/api/auth/session', {}, parseCurrent),

    async login(credentials: LoginRequest): Promise<AuthResult<CurrentSessionResponse>> {
      const init = await mutationInit('POST', credentials);
      if (!init.ok) return init;
      return readJson('/api/auth/login', init.value, parseCurrent);
    },

    logout: () => sendWithoutContent('/api/auth/logout', 'POST'),

    revokeSession: (sessionId: string) =>
      sendWithoutContent(`/api/auth/sessions/${encodeURIComponent(sessionId)}`, 'DELETE'),

    listSessions: (): Promise<AuthResult<ActiveSession[]>> =>
      readJson('/api/auth/sessions', {}, (body) => {
        const parsed = ActiveSessionsResponseSchema.safeParse(body);
        return parsed.success ? parsed.data.sessions : null;
      }),
  };
}

export type AuthApi = ReturnType<typeof createAuthApi>;

/** Mensaje para la persona. Es el mismo si la cuenta no existe o la contraseña es incorrecta. */
export function authFailureMessage(failure: AuthFailure): string {
  switch (failure.code) {
    case 'invalid_credentials':
      return 'Correo o contraseña incorrectos.';
    case 'rate_limited':
      return failure.retryAfterSeconds === null
        ? 'Demasiados intentos. Espera un momento.'
        : `Demasiados intentos. Vuelve a intentar en ${failure.retryAfterSeconds} s.`;
    case 'validation_failed':
      return 'Revisa el correo y la contraseña.';
    case 'forbidden':
      return 'La petición fue rechazada por seguridad. Recarga la página.';
    case 'unauthenticated':
      return 'Tu sesión terminó. Inicia sesión de nuevo.';
    case 'not_found':
      return 'Esa sesión ya no existe.';
    case 'conflict':
      return 'Tu sesión ya se renovó en otra solicitud. Recarga la página.';
    case 'payload_too_large':
      return 'Los datos enviados son demasiado grandes. Revísalos e inténtalo de nuevo.';
    case 'unreachable':
      return 'No se pudo contactar a la API.';
    default:
      return 'Ocurrió un error inesperado.';
  }
}

function waitMessage(failure: AuthFailure): string {
  return failure.retryAfterSeconds === null
    ? 'Demasiados intentos. Espera un momento.'
    : `Demasiados intentos. Vuelve a intentar en ${formatWait(failure.retryAfterSeconds)}.`;
}

/** Mensajes del segundo factor. */
export function mfaFailureMessage(failure: AuthFailure): string {
  switch (failure.code) {
    case 'invalid_mfa_code':
      return 'El código no es válido o ya se usó. Espera el siguiente código e inténtalo de nuevo.';
    case 'invalid_credentials':
      return 'La contraseña no es correcta.';
    case 'validation_failed':
      return 'Revisa los datos: el código de la aplicación tiene seis dígitos.';
    case 'conflict':
      return 'La configuración venció. Empieza de nuevo.';
    case 'mfa_enrollment_required':
      return 'Primero configura la verificación en dos pasos.';
    case 'rate_limited':
      return waitMessage(failure);
    default:
      return authFailureMessage(failure);
  }
}

/** Mensajes de empresas y accesos. */
export function accessFailureMessage(failure: AuthFailure): string {
  switch (failure.code) {
    case 'not_found':
      return 'No tienes acceso a esta empresa o ese registro ya no existe.';
    case 'permission_denied':
      return 'Tu rol no permite esta acción.';
    case 'mfa_required':
      return 'Completa la verificación en dos pasos para continuar.';
    case 'mfa_enrollment_required':
      return 'Configura la verificación en dos pasos en Mi cuenta para continuar.';
    case 'last_admin':
      return 'No se puede: la empresa debe conservar al menos una persona propietaria con acceso activo.';
    case 'self_modification':
      return 'No puedes cambiar tu propio acceso. Pídeselo a otra persona administradora.';
    case 'conflict':
      return 'La membresía está inactiva. Actívala antes de asignarle un rol.';
    case 'rate_limited':
      return waitMessage(failure);
    default:
      return authFailureMessage(failure);
  }
}

/** Respuesta visible de un formulario de acceso. `wait` bloquea el envío durante la espera. */
export type FormFeedback =
  { kind: 'error'; message: string } | { kind: 'wait'; message: string; retryAfterSeconds: number };

export function toFormFeedback(failure: AuthFailure): FormFeedback {
  if (failure.code === 'rate_limited' && failure.retryAfterSeconds !== null) {
    return {
      kind: 'wait',
      message: 'Por seguridad, espera antes de volver a intentarlo.',
      retryAfterSeconds: failure.retryAfterSeconds,
    };
  }
  return { kind: 'error', message: authFailureMessage(failure) };
}

/** Tiempo restante legible: `45 s`, `2 min 5 s`. */
export function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const rest = seconds % 60;
  return rest === 0 ? `${seconds / 60} min` : `${Math.floor(seconds / 60)} min ${rest} s`;
}
