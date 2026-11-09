import type { ReactNode } from 'react';

export type MessageKind = 'error' | 'wait' | 'info' | 'success';

const LABELS: Record<MessageKind, string> = {
  error: 'Error',
  wait: 'Espera',
  info: 'Aviso',
  success: 'Listo',
};

const ICON_PATHS: Record<MessageKind, string> = {
  error: 'M12 7v6m0 3.5v.5M12 3l9.5 17h-19z',
  wait: 'M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  info: 'M12 11v6m0-9.5V8m9 4a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  success: 'M8 12.5l3 3 5-6m5 2.5a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
};

export function Icon({ path }: { path: string }) {
  return (
    <svg className="pt-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={path} />
    </svg>
  );
}

interface MessageProps {
  kind: MessageKind;
  children: ReactNode;
  id?: string;
}

/** Mensaje de estado. Comunica con icono y texto, no solo con color. */
export function Message({ kind, children, id }: MessageProps) {
  const urgent = kind === 'error' || kind === 'wait';
  return (
    <div id={id} className={`pt-message pt-message--${kind}`} role={urgent ? 'alert' : 'status'}>
      <Icon path={ICON_PATHS[kind]} />
      <p>
        <strong>{LABELS[kind]}:</strong> {children}
      </p>
    </div>
  );
}
