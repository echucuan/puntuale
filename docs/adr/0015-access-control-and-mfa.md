# ADR 0015 · Catálogo cerrado de roles y MFA TOTP obligatorio para funciones administrativas

- **Fecha:** 2026-11-08
- **Estado:** Aceptado. Implementado en 1.0-b.2.

## Contexto

Con sesiones reales (ADR 0014), `TenantGuard` responde si una persona pertenece a una empresa, pero no qué puede hacer en ella. El piloto necesita un administrador que gestione accesos y un segundo factor para ese tipo de cuenta. Los módulos de asistencia, incidencias y cierres todavía no existen, y tampoco las entidades de centro de trabajo o área.

## Problema

¿Cómo se autoriza cada operación por empresa, sin conceder permisos de funciones inexistentes ni alcances que no se pueden evaluar? ¿Cómo se exige el segundo factor sin que una contraseña baste para administrar?

## Alternativas consideradas

1. **Roles por empresa (diseño planificado en `planned-design-v1.md` §11):** permitiría personalizar, pero los roles personalizados están fuera de alcance y multiplican los casos que hay que probar.
2. **Catálogo global y cerrado:** una sola matriz probada, igual para todas las empresas. Elegida.
3. **Alcance de centro o área tratado como toda la empresa:** daría funcionalidad al supervisor, pero ampliaría su acceso en silencio. Rechazada.
4. **MFA por empresa:** una persona tendría varios secretos para una sola identidad. Rechazada: el MFA es global por persona, como la credencial.
5. **Verificar MFA solo en el login:** obligaría a pedir el código a colaboradores que no lo necesitan. Rechazada: se registra por sesión y se exige en los permisos que provienen de roles con MFA.

## Decisión

**Catálogo.** Las tablas globales `role`, `permission` y `role_permission` son de solo lectura para `puntuale_app`. Los roles son `company_owner`, `hr_admin`, `auditor`, `supervisor` y `employee`. Solo `access.read`, `access.manage` y `access.manage_admins` tienen estado `active`; los permisos de módulos futuros quedan `reserved` y la consulta de permisos nunca los devuelve.

**Alcance.** `membership_role.scope_type` solo admite `tenant`. El supervisor no tiene permisos activos porque `work_site` y `area` no existen; la `ScopePolicy` del ADR 0003 queda pendiente de esas entidades.

**Autorización.** `PermissionGuard` va después de `TenantGuard`, evalúa los roles vigentes en cada petición y deniega si la ruta no declara `@RequirePermission`. Sin membresía activa, 404; sin permiso, 403 `permission_denied`; si falta MFA, 403 `mfa_required` o `mfa_enrollment_required`.

**Cambios de acceso.** Se aplican en una transacción con bloqueo por empresa, que relee la membresía y los permisos de quien actúa. Nadie cambia su propio acceso (`self_modification`). Afectar un rol administrativo, o a quien lo tiene, exige `access.manage_admins`. Debe quedar un `company_owner` con acceso efectivo: membresía activa, rol vigente y credencial activa (`last_admin`). La función `access_effective_owner_memberships()` hace esa comprobación, para que `puntuale_app` no lea las credenciales. Un retiro marca `revoked_at`: no existe `DELETE`. Solo un cambio real se audita, en la misma transacción.

**MFA.**

- TOTP SHA-1, seis dígitos, periodo de 30 s y tolerancia de un paso, con la librería `otpauth`.
- El secreto se cifra con AES-256-GCM. La llave se deriva con HKDF de `MFA_ENCRYPTION_KEY`, y el identificador de la persona se autentica como dato adicional.
- `last_accepted_step` solo avanza, bajo un bloqueo por persona: un código aceptado no se vuelve a aceptar, ni uno de un paso anterior.
- Hay 10 códigos de recuperación, se muestran una sola vez, se guardan como HMAC y se consumen con un `UPDATE` atómico.
- Verificación, recuperación y reautenticación comparten un límite por persona (5 en 15 minutos, configurable), que se reserva antes de comprobar el factor.
- `auth_session.mfa_verified_at` marca la sesión. Una sesión nueva o rotada empieza sin verificar.
- Reemplazar o desactivar exige contraseña y factor actual. Al reemplazar, las demás sesiones pierden la verificación; al desactivar, todas.

Los eventos MFA van a `security_event`, global como la identidad. Los cambios de membresía, roles y selección de empresa van a `audit_event`, por empresa. Ninguno guarda códigos ni secretos.

## Consecuencias

- Agregar un permiso real es una migración que lo cambia a `active` y el código que lo usa.
- Cambiar o perder `MFA_ENCRYPTION_KEY` invalida los secretos y los códigos de recuperación inscritos: su rotación requiere un procedimiento que todavía no existe.
- La primera inscripción solo exige contraseña: quien la conozca antes que su titular podría inscribirse. Se acepta para el piloto en localhost.
- Perder el teléfono y los códigos de recuperación deja la cuenta sin MFA recuperable por la aplicación; no hay flujo de soporte.
- La primera cuenta `company_owner` de una empresa solo se crea con la semilla: la alta de empresas y las invitaciones no existen.
- Cualquier operación futura que deshabilite credenciales debe respetar la misma garantía: tomar el bloqueo de acceso de cada empresa afectada y rechazar el cambio si dejaría a alguna sin propietario con acceso efectivo. Hoy la aplicación no tiene esa operación.
- Pendiente: alcance por centro o área cuando existan esas entidades.

## Limitaciones aceptadas para el piloto local

El arquitecto las aceptó para el piloto en localhost. **No autorizan exposición pública:** deben resolverse antes de publicar el servicio.

- Primera inscripción de MFA con contraseña y confirmación TOTP.
- Alta inicial de empresa mediante la semilla.
- Sin recuperación asistida si se pierden el teléfono y los códigos.
- Rotación de `MFA_ENCRYPTION_KEY` pendiente. La custodia está en [`docs/security/README.md`](../security/README.md).
