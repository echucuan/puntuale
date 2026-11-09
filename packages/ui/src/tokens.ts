/**
 * Tokens de marca de Puntuale: kit de identidad y variables `:root` de la landing (`styles.css`).
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
  // Tokens funcionales de la aplicación: no forman parte del kit de identidad.
  control: '#7b8ca0',
  success: '#1e7a46',
  successBg: '#e8f5ee',
  warning: '#7a5000',
  warningBg: '#fdf4e3',
  danger: '#a4372d',
  dangerBg: '#fbeeec',
} as const;

export type ColorToken = keyof typeof colors;

export const radii = {
  sm: '4px',
  md: '8px',
} as const;

/**
 * Montserrat Bold para títulos y Regular para texto, según el kit. Semibold es para controles y
 * etiquetas.
 */
export const fontWeights = {
  regular: '400',
  semibold: '600',
  bold: '700',
} as const;

/**
 * Pila tipográfica. La landing usa Montserrat; la aplicación **no** descarga fuentes externas
 * (Google Fonts) y usa Montserrat solo si está instalada localmente.
 */
export const fontFamily = 'Montserrat, Arial, system-ui, sans-serif';

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** Variables CSS listas para inyectar en `:root`. */
export function cssVariables(): string {
  const lines = [
    ...Object.entries(colors).map(([name, value]) => `  --pt-${kebab(name)}: ${value};`),
    ...Object.entries(radii).map(([name, value]) => `  --pt-radius-${name}: ${value};`),
    ...Object.entries(fontWeights).map(([name, value]) => `  --pt-weight-${name}: ${value};`),
  ];
  lines.push(`  --pt-font: ${fontFamily};`);
  return `:root {\n${lines.join('\n')}\n}`;
}
