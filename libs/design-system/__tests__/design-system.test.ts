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
    expect(lightColors.primary.DEFAULT).toBe('#009990');
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
    expect(lightTheme.color.primary.DEFAULT).toBe('#009990');
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
