import { RgbaColor } from '../model/nodes';

const RGBA_RE = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i;

/**
 * Parses a getComputedStyle() color string. getComputedStyle always
 * normalizes to rgb()/rgba() form in every browser we target, so we don't
 * need to handle hex/hsl/named colors here.
 */
export function parseComputedColor(value: string | null | undefined): RgbaColor | undefined {
  if (!value) {
    return undefined;
  }
  if (value === 'transparent') {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  const match = RGBA_RE.exec(value.trim());
  if (!match) {
    return undefined;
  }
  return {
    r: clamp255(Number(match[1])),
    g: clamp255(Number(match[2])),
    b: clamp255(Number(match[3])),
    a: match[4] !== undefined ? clamp01(Number(match[4])) : 1,
  };
}

export function isTransparent(color: RgbaColor | undefined): boolean {
  return !color || color.a <= 0;
}

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
