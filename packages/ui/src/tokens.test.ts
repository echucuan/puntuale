import { describe, expect, it } from 'vitest';
import { colors, cssVariables, fontFamily } from './tokens';

describe('tokens de marca', () => {
  it('todos los colores son hexadecimales de 6 dígitos en minúsculas', () => {
    for (const value of Object.values(colors)) expect(value).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('conserva los colores principales de la landing', () => {
    expect(colors.navy).toBe('#0f2c52');
    expect(colors.blue).toBe('#1769aa');
  });

  it('genera variables CSS con prefijo --pt-', () => {
    const css = cssVariables();
    expect(css).toContain('--pt-navy: #0f2c52;');
    expect(css).toContain(`--pt-font: ${fontFamily};`);
  });

  it('no depende de fuentes externas', () => {
    expect(cssVariables()).not.toMatch(/url\(|googleapis/);
  });
});
