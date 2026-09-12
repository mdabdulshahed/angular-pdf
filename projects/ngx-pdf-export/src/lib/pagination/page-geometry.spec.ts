import { describe, expect, it } from 'vitest';
import { resolvePageGeometry } from './page-geometry';
import { mmToPt } from '../model/units';

describe('resolvePageGeometry', () => {
  it('defaults to A4 portrait with 10mm margins', () => {
    const g = resolvePageGeometry(undefined, undefined, undefined, 0, 0);
    expect(g.widthPt).toBeCloseTo(595.28, 1);
    expect(g.heightPt).toBeCloseTo(841.89, 1);
    expect(g.margin.top).toBeCloseTo(mmToPt(10), 3);
  });

  it('swaps width/height for landscape orientation', () => {
    const g = resolvePageGeometry('A4', 'landscape', 10, 0, 0);
    expect(g.widthPt).toBeGreaterThan(g.heightPt);
  });

  it('keeps portrait dimensions when orientation is portrait', () => {
    const g = resolvePageGeometry('A4', 'portrait', 10, 0, 0);
    expect(g.heightPt).toBeGreaterThan(g.widthPt);
  });

  it('resolves Letter to its known point dimensions', () => {
    const g = resolvePageGeometry('Letter', 'portrait', 0, 0, 0);
    expect(g.widthPt).toBe(612);
    expect(g.heightPt).toBe(792);
  });

  it('accepts a custom size in mm by default', () => {
    const g = resolvePageGeometry({ width: 100, height: 150 }, 'portrait', 0, 0, 0);
    expect(g.widthPt).toBeCloseTo(mmToPt(100), 3);
    expect(g.heightPt).toBeCloseTo(mmToPt(150), 3);
  });

  it('accepts a custom size in pt directly', () => {
    const g = resolvePageGeometry({ width: 300, height: 400, unit: 'pt' }, 'portrait', 0, 0, 0);
    expect(g.widthPt).toBe(300);
    expect(g.heightPt).toBe(400);
  });

  it('applies per-side margins when given an object', () => {
    const g = resolvePageGeometry('A4', 'portrait', { top: 20, bottom: 5, left: 15, right: 15 }, 0, 0);
    expect(g.margin.top).toBeCloseTo(mmToPt(20), 3);
    expect(g.margin.bottom).toBeCloseTo(mmToPt(5), 3);
  });

  it('reserves header/footer height from the content box', () => {
    const withoutHeader = resolvePageGeometry('A4', 'portrait', 10, 0, 0);
    const withHeader = resolvePageGeometry('A4', 'portrait', 10, 24, 18);
    expect(withHeader.contentHeightPt).toBeCloseTo(withoutHeader.contentHeightPt - 42, 3);
  });

  it('throws when margins leave no room for content', () => {
    expect(() => resolvePageGeometry({ width: 20, height: 20, unit: 'pt' }, 'portrait', 20, 0, 0)).toThrow();
  });
});
