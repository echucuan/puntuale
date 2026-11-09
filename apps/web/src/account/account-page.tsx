import type { CurrentSessionResponse } from '@puntuale/contracts';
import { SessionPanel } from '../auth/session-panel';
import { PageFrame, type PageContext } from '../components/page-frame';
import { MfaPanel } from './mfa-panel';

interface AccountPageProps extends PageContext {
  onChanged: (next: CurrentSessionResponse) => void;
}

/** «Mi cuenta»: verificación en dos pasos y sesiones de la persona. */
export function AccountPage({ onChanged, ...context }: AccountPageProps) {
  const { api, current, onEnded } = context;
  return (
    <PageFrame {...context} title="Mi cuenta">
      <MfaPanel api={api} current={current} onChanged={onChanged} onEnded={onEnded} />
      <SessionPanel api={api} current={current} onChanged={onChanged} onEnded={onEnded} />
    </PageFrame>
  );
}
