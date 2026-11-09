import { describe, expect, it } from 'vitest';
import { colors, cssVariables, fontFamily } from './tokens';

function luminance(hex: string): number {
  const channel = (start: number) => {
    const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

describe('tokens de marca', () => {
  it('todos los colores son hexadecimales de 6 dígitos en minúsculas', () => {
    for (const value of Object.values(colors)) expect(value).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('conserva los colores del kit de identidad y de la landing', () => {
    expect(colors).toMatchObject({
      navy: '#0f2c52',
      blue: '#1769aa',
      pale: '#eaf3fb',
      gray: '#f3f5f7',
      ink: '#202124',
      muted: '#53657a',
      line: '#dce5ee',
      white: '#ffffff',
    });
  });

  it('genera variables CSS con prefijo --pt- y nombres en kebab-case', () => {
    const css = cssVariables();
    expect(css).toContain('--pt-navy: #0f2c52;');
    expect(css).toContain('--pt-danger-bg: #fbeeec;');
    expect(css).toContain('--pt-radius-sm: 4px;');
    expect(css).toContain(`--pt-font: ${fontFamily};`);
  });

  it('no depende de fuentes externas', () => {
    expect(cssVariables()).not.toMatch(/url\(|googleapis/);
  });

  it.each([
    ['ink', 'white'],
    ['ink', 'gray'],
    ['ink', 'pale'],
    ['muted', 'white'],
    ['muted', 'gray'],
    ['muted', 'pale'],
    ['navy', 'pale'],
    ['blue', 'white'],
    ['blue', 'gray'],
    ['white', 'blue'],
    ['white', 'navy'],
    ['success', 'successBg'],
    ['warning', 'warningBg'],
    ['danger', 'dangerBg'],
  ] as const)('el texto %s sobre %s cumple AA (4.5:1)', (text, background) => {
    expect(contrast(colors[text], colors[background])).toBeGreaterThanOrEqual(4.5);
  });

  it('el borde de los controles se distingue del fondo (3:1)', () => {
    expect(contrast(colors.control, colors.white)).toBeGreaterThanOrEqual(3);
  });
});
