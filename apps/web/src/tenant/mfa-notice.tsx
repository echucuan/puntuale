import type { MfaSituation } from '@puntuale/contracts';
import { MfaVerifyForm } from '../account/mfa-fields';
import type { AuthApi } from '../api/auth';
import { followLink, type Navigate } from '../routing';

/** Indica qué falta para usar los roles con MFA y permite completarlo. */
export function MfaNotice({
  situation,
  api,
  navigate,
  onVerified,
  onSessionEnded,
}: {
  situation: MfaSituation;
  api: AuthApi;
  navigate: Navigate;
  onVerified: () => void | Promise<void>;
  onSessionEnded: (message: string) => void;
}) {
  if (situation === 'enrollment_required') {
    return (
      <div className="pt-card pt-card--attention">
        <h2>Configura la verificación en dos pasos</h2>
        <p className="pt-hint">
          Tu rol la exige. Hasta configurarla no podrás hacer operaciones administrativas.
        </p>
        <a
          className="pt-button pt-button--secondary pt-button--link"
          href="/cuenta"
          onClick={(event) => followLink(event, '/cuenta', navigate)}
        >
          Configurar en Mi cuenta
        </a>
      </div>
    );
  }
  if (situation === 'verify') {
    return (
      <div className="pt-card pt-card--attention">
        <h2>Completa la verificación en dos pasos</h2>
        <p className="pt-hint">
          Tu contraseña fue correcta. Falta el código para usar tus funciones administrativas.
        </p>
        <MfaVerifyForm api={api} onVerified={onVerified} onSessionEnded={onSessionEnded} />
      </div>
    );
  }
  return null;
}
