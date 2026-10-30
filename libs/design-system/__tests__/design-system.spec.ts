import { describe, expect, it } from 'vitest';

import {
  colors,
  darkTheme,
  fontFamily,
  fontSize,
  lightColors,
  lightTheme,
  radius,
  spacing,
  tokens,
} from '../src/index.js';

describe('design tokens', () => {
  it('exports a complete token set', () => {
    expect(tokens).toBeDefined();
    expect(tokens.colors).toBe(colors);
    expect(tokens.fontFamily).toBe(fontFamily);
    expect(tokens.fontSize).toBe(fontSize);
    expect(tokens.spacing).toBe(spacing);
    expect(tokens.radius).toBe(radius);
  });

  it('defines dark background colors', () => {
    expect(colors.bg.void).toBe('#08080d');
    expect(colors.bg.surface).toBe('#0f0f17');
    expect(colors.bg.elevated).toBe('#171721');
    expect(colors.bg.overlay).toBe('#1f1f2e');
  });

  it('defines primary network teal', () => {
    expect(colors.primary.DEFAULT).toBe('#00d4c8');
    expect(colors.primary.hover).toBe('#00f0e2');
  });

  it('defines accent tattoo amber', () => {
    expect(colors.accent.DEFAULT).toBe('#e6a817');
    expect(colors.accent.hover).toBe('#f0b829');
  });

  it('defines light theme overrides', () => {
    expect(lightColors.bg.void).toBe('#f5f5f8');
    expect(lightColors.bg.surface).toBe('#ffffff');
    // Darkened for WCAG AA on light surfaces (see #1643).
    expect(lightColors.primary.DEFAULT).toBe('#007068');
    expect(lightColors.text.DEFAULT).toBe('#1a1a2e');
  });

  it('defines signal colors', () => {
    expect(colors.error.DEFAULT).toBe('#f04060');
    expect(colors.warning.DEFAULT).toBe('#f0a030');
    expect(colors.success.DEFAULT).toBe('#40c060');
    expect(colors.info.DEFAULT).toBe('#4090f0');
  });

  it('includes both sans and mono font families', () => {
    expect(fontFamily.sans).toContain('Inter');
    expect(fontFamily.mono).toContain('JetBrains Mono');
  });

  it('provides a complete spacing scale', () => {
    expect(spacing[0]).toBe('0');
    expect(spacing[1]).toBe('0.25rem');
    expect(spacing[4]).toBe('1rem');
    expect(spacing[8]).toBe('2rem');
  });
});

describe('themes', () => {
  it('dark theme uses dark mode', () => {
    expect(darkTheme.mode).toBe('dark');
    expect(darkTheme.color.bg.void).toBe('#08080d');
    expect(darkTheme.color.primary.DEFAULT).toBe('#00d4c8');
    expect(darkTheme.color.accent.DEFAULT).toBe('#e6a817');
  });

  it('light theme uses light mode', () => {
    expect(lightTheme.mode).toBe('light');
    expect(lightTheme.color.bg.void).toBe('#f5f5f8');
    expect(lightTheme.color.primary.DEFAULT).toBe('#007068');
  });

  it('themes share non-color tokens', () => {
    expect(darkTheme.font).toStrictEqual(lightTheme.font);
    expect(darkTheme.spacing).toStrictEqual(lightTheme.spacing);
    expect(darkTheme.radius).toStrictEqual(lightTheme.radius);
    expect(darkTheme.shadow).toStrictEqual(lightTheme.shadow);
    expect(darkTheme.transition).toStrictEqual(lightTheme.transition);
    expect(darkTheme.breakpoint).toStrictEqual(lightTheme.breakpoint);
    expect(darkTheme.zIndex).toStrictEqual(lightTheme.zIndex);
  });

  it('themes have different text colors', () => {
    expect(darkTheme.color.text.DEFAULT).not.toBe(
      lightTheme.color.text.DEFAULT,
    );
  });
});

// Guards the *semantic* foreground/background contract (not literal hex values),
// so a future token tweak that breaks a real text/fill pair fails the build. #1643
describe('WCAG AA contrast contracts', () => {
  function hexToRgb(hex: string): [number, number, number] {
    const h = hex.replace('#', '');
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  }
  function relLuminance(hex: string): number {
    const srgb = hexToRgb(hex).map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
  }
  function contrast(a: string, b: string): number {
    const l1 = relLuminance(a);
    const l2 = relLuminance(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }

  const AA = 4.5;
  for (const theme of [darkTheme, lightTheme]) {
    const c = theme.color;
    // Filled buttons render text.inverse over a solid brand/signal fill.
    const filledButtonPairs: Array<[string, string, string]> = [
      [`${theme.mode} primary button`, c.primary.DEFAULT, c.text.inverse],
      [`${theme.mode} accent button`, c.accent.DEFAULT, c.text.inverse],
      [`${theme.mode} danger button`, c.error.DEFAULT, c.text.inverse],
    ];
    for (const [name, bg, fg] of filledButtonPairs) {
      it(`${name}: inverse text on fill meets AA`, () => {
        expect(contrast(bg, fg)).toBeGreaterThanOrEqual(AA);
      });
    }

    // Body/secondary/muted text over the base surfaces.
    const textPairs: Array<[string, string, string]> = [
      [`${theme.mode} body`, c.text.DEFAULT, c.bg.surface],
      [`${theme.mode} secondary`, c.text.secondary, c.bg.surface],
      [`${theme.mode} muted`, c.text.muted, c.bg.surface],
    ];
    for (const [name, fg, bg] of textPairs) {
      it(`${name}: text on surface meets AA`, () => {
        expect(contrast(fg, bg)).toBeGreaterThanOrEqual(AA);
      });
    }
  }
});
