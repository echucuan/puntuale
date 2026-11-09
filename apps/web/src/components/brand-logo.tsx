/**
 * Logo principal original (2172 × 724). Solo va sobre fondos claros: el kit define versiones
 * monocromáticas para fondos oscuros, pero no existen como archivo. La clase `.pt-logo` completa el
 * área de protección del kit.
 */
export function BrandLogo({ className = '' }: { className?: string }) {
  return (
    <span className={`pt-logo ${className}`.trim()}>
      <img src="/brand/logo.png" alt="Puntuale" width={2172} height={724} />
    </span>
  );
}
