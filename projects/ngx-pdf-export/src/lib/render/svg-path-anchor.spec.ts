import { describe, expect, it } from 'vitest';
import { svgPathAnchor } from './svg-path-anchor';

describe('svgPathAnchor', () => {
  it('is a no-op for a viewBox with a zero origin', () => {
    expect(svgPathAnchor(100, 200, 0, 0)).toEqual({ x: 100, y: 200 });
  });

  it('shifts the anchor to compensate for a negative viewBox y-origin, as used by Material-style icons (viewBox="0 -960 960 960")', () => {
    // A 14x14pt icon (sx = sy = 14/960) with vbY = -960:
    // offsetYPt = vbY * sy = -960 * (14/960) = -14.
    const sx = 14 / 960;
    const offsetYPt = -960 * sx;
    const anchor = svgPathAnchor(50, 700, 0, offsetYPt);
    // Before this fix, y was left as originTopY (700) unconditionally,
    // which rendered the icon 14pt above where it belongs.
    expect(anchor.y).toBeCloseTo(700 - 14, 6);
    expect(anchor.x).toBe(50);
  });

  it('shifts x for a non-zero viewBox x-origin', () => {
    expect(svgPathAnchor(50, 700, 5, 0)).toEqual({ x: 45, y: 700 });
  });
});
