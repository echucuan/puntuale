/**
 * Tokens de marca de Puntuale, tomados de las variables `:root` de la landing (`styles.css`).
 * La landing no se modifica: este archivo copia sus valores para la aplicación (ADR 0008).
 */
export const colors = {
  navy: '#0f2c52',
  blue: '#1769aa',
  pale: '#eaf3fb',
  gray: '#f3f5f7',
  ink: '#202124',
  muted: '#53657a',
  line: '#dce5ee',
  white: '#ffffff',
} as const;

export type ColorToken = keyof typeof colors;

/**
 * Pila tipográfica. La landing usa Montserrat; la aplicación **no** descarga fuentes externas
 * (Google Fonts) y usa Montserrat solo si está instalada localmente.
 */
export const fontFamily = 'Montserrat, Arial, system-ui, sans-serif';

/** Variables CSS listas para inyectar en `:root`. */
export function cssVariables(): string {
  const lines = Object.entries(colors).map(([name, value]) => `  --pt-${name}: ${value};`);
  lines.push(`  --pt-font: ${fontFamily};`);
  return `:root {\n${lines.join('\n')}\n}`;
}
