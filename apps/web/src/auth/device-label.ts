const BROWSERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bEdg(e|A|iOS)?\//, 'Edge'],
  [/\bOPR\//, 'Opera'],
  [/\bFirefox\/|\bFxiOS\//, 'Firefox'],
  [/\bChrome\/|\bCriOS\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
];

const SYSTEMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bWindows\b/, 'Windows'],
  [/\bAndroid\b/, 'Android'],
  [/\biPhone\b|\biPad\b/, 'iOS'],
  [/\bMac OS X\b/, 'macOS'],
  [/\bLinux\b/, 'Linux'],
];

function match(table: ReadonlyArray<readonly [RegExp, string]>, value: string): string | null {
  return table.find(([pattern]) => pattern.test(value))?.[1] ?? null;
}

/** Nombre orientativo del dispositivo. El agente de usuario completo queda en los detalles. */
export function deviceLabel(userAgent: string | null): string {
  if (!userAgent) return 'Navegador desconocido';
  const browser = match(BROWSERS, userAgent);
  const system = match(SYSTEMS, userAgent);
  if (browser && system) return `${browser} en ${system}`;
  return browser ?? system ?? 'Navegador desconocido';
}
