import { z } from 'zod';
import { MEMBERSHIP_STATUSES } from './enums';

/** Catálogo cerrado de roles (ADR 0015). Coincide con la tabla `role`. */
export const ROLE_CODES = [
  'company_owner',
  'hr_admin',
  'auditor',
  'supervisor',
  'employee',
] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

export const ROLE_LABELS_ES: Record<RoleCode, string> = {
  company_owner: 'Propietario de la empresa',
  hr_admin: 'Administrador de RH',
  auditor: 'Auditor',
  supervisor: 'Supervisor',
  employee: 'Colaborador',
};

/** Permisos con función real en esta versión. Los reservados nunca se conceden ni se exponen. */
export const ACTIVE_PERMISSIONS = ['access.read', 'access.manage', 'access.manage_admins'] as const;
export type ActivePermission = (typeof ACTIVE_PERMISSIONS)[number];

export const PERMISSION_LABELS_ES: Record<ActivePermission, string> = {
  'access.read': 'Consultar los accesos de la empresa',
  'access.manage': 'Gestionar accesos de colaboradores',
  'access.manage_admins': 'Gestionar accesos administrativos',
};

const RoleCodeSchema = z.enum(ROLE_CODES);
const ActivePermissionSchema = z.enum(ACTIVE_PERMISSIONS);
const MembershipStatusSchema = z.enum(MEMBERSHIP_STATUSES);

/** Una empresa a la que pertenece la persona de la sesión. */
export const MyTenantSchema = z.object({
  tenantId: z.uuid(),
  legalName: z.string(),
  membershipId: z.uuid(),
  roles: z.array(RoleCodeSchema),
  requiresMfa: z.boolean(),
});
export type MyTenant = z.infer<typeof MyTenantSchema>;

/** Respuesta de `GET /api/me/tenants`. */
export const MyTenantsResponseSchema = z.object({ tenants: z.array(MyTenantSchema) });
export type MyTenantsResponse = z.infer<typeof MyTenantsResponseSchema>;

/** Situación de MFA para la persona y esta sesión. */
export const MfaSituationSchema = z.enum(['not_required', 'enrollment_required', 'verify', 'ok']);
export type MfaSituation = z.infer<typeof MfaSituationSchema>;

/** Respuesta de `GET /api/t/:tenantId/me`: la identidad y los accesos propios en una empresa. */
export const TenantMeResponseSchema = z.object({
  tenant: z.object({ id: z.uuid(), legalName: z.string(), timezone: z.string() }),
  user: z.object({ id: z.uuid(), displayName: z.string(), email: z.string() }),
  membership: z.object({ id: z.uuid(), status: MembershipStatusSchema }),
  employee: z.object({ employeeNumber: z.string(), displayName: z.string() }).nullable(),
  roles: z.array(RoleCodeSchema),
  permissions: z.array(ActivePermissionSchema),
  mfa: MfaSituationSchema,
});
export type TenantMeResponse = z.infer<typeof TenantMeResponseSchema>;

/** Una membresía en la vista de accesos. Nunca incluye datos de seguridad. */
export const AccessMemberSchema = z.object({
  membershipId: z.uuid(),
  displayName: z.string(),
  email: z.string(),
  status: MembershipStatusSchema,
  employeeNumber: z.string().nullable(),
  roles: z.array(RoleCodeSchema),
  isSelf: z.boolean(),
});
export type AccessMember = z.infer<typeof AccessMemberSchema>;

/** Respuesta de `GET /api/t/:tenantId/access/members`. */
export const AccessMembersResponseSchema = z.object({
  members: z.array(AccessMemberSchema),
  canManage: z.boolean(),
  canManageAdmins: z.boolean(),
  adminRoles: z.array(RoleCodeSchema),
});
export type AccessMembersResponse = z.infer<typeof AccessMembersResponseSchema>;

/** Cuerpo de `PUT /api/t/:tenantId/access/members/:membershipId/status`. */
export const UpdateMembershipStatusRequestSchema = z.strictObject({
  status: MembershipStatusSchema,
});
export type UpdateMembershipStatusRequest = z.infer<typeof UpdateMembershipStatusRequestSchema>;

export { RoleCodeSchema, ActivePermissionSchema };

const TOTP_CODE = z.string().regex(/^\d{6}$/);
/** Se normaliza en la API: acepta minúsculas, espacios y guiones. */
const RECOVERY_CODE = z.string().min(16).max(32);

/** Un segundo factor: código de la aplicación o código de recuperación, nunca ambos. */
export const MfaFactorSchema = z.union([
  z.strictObject({ code: TOTP_CODE }),
  z.strictObject({ recoveryCode: RECOVERY_CODE }),
]);
export type MfaFactor = z.infer<typeof MfaFactorSchema>;

/** Cuerpo de `POST /api/auth/mfa/verify`. */
export const MfaVerifyRequestSchema = MfaFactorSchema;

const PASSWORD = z.string().min(1).max(1024);

function atMostOneFactor(value: { code?: string; recoveryCode?: string }): boolean {
  return value.code === undefined || value.recoveryCode === undefined;
}

/**
 * Cuerpo de `POST /api/auth/mfa/enrollment`. La contraseña siempre es obligatoria; si ya hay MFA
 * activo, la API exige además el factor actual para reemplazarlo.
 */
export const MfaEnrollmentRequestSchema = z
  .strictObject({
    password: PASSWORD,
    code: TOTP_CODE.optional(),
    recoveryCode: RECOVERY_CODE.optional(),
  })
  .refine(atMostOneFactor);
export type MfaEnrollmentRequest = z.infer<typeof MfaEnrollmentRequestSchema>;

/** Cuerpo de `POST /api/auth/mfa/enrollment/confirm`. */
export const MfaConfirmRequestSchema = z.strictObject({ code: TOTP_CODE });
export type MfaConfirmRequest = z.infer<typeof MfaConfirmRequestSchema>;

/** Cuerpo de `POST /api/auth/mfa/disable`: contraseña y factor actual. */
export const MfaDisableRequestSchema = z
  .strictObject({
    password: PASSWORD,
    code: TOTP_CODE.optional(),
    recoveryCode: RECOVERY_CODE.optional(),
  })
  .refine(atMostOneFactor);
export type MfaDisableRequest = z.infer<typeof MfaDisableRequestSchema>;

/** Respuesta de `GET /api/auth/mfa`. Nunca incluye el secreto. */
export const MfaStatusResponseSchema = z.object({
  enrolled: z.boolean(),
  pendingEnrollment: z.boolean(),
  verifiedThisSession: z.boolean(),
  recoveryCodesRemaining: z.number().int().min(0),
});
export type MfaStatusResponse = z.infer<typeof MfaStatusResponseSchema>;

/** Respuesta de `POST /api/auth/mfa/enrollment`. El secreto solo se entrega aquí. */
export const MfaEnrollmentResponseSchema = z.object({
  secret: z.string(),
  otpauthUri: z.string(),
});
export type MfaEnrollmentResponse = z.infer<typeof MfaEnrollmentResponseSchema>;

/** Respuesta de la confirmación. Los códigos solo se muestran esta vez. */
export const MfaConfirmResponseSchema = z.object({ recoveryCodes: z.array(z.string()) });
export type MfaConfirmResponse = z.infer<typeof MfaConfirmResponseSchema>;
