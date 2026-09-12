import { describe, expect, it } from 'vitest';
import { scalePathData } from './svg-path';

describe('scalePathData', () => {
  it('scales x and y coordinates independently for M/L, preserving original spacing', () => {
    const out = scalePathData('M10 20 L30 40', 2, 3);
    expect(out).toBe('M20 60 L60 120');
  });

  it('scales H by sx only and V by sy only', () => {
    const out = scalePathData('M0 0 H10 V20', 2, 5);
    expect(out).toBe('M0 0 H20 V100');
  });

  it('scales cubic curve control and end points', () => {
    const out = scalePathData('C1 2 3 4 5 6', 10, 10);
    expect(out).toBe('C10 20 30 40 50 60');
  });

  it('scales arc radii and endpoint but leaves flags alone', () => {
    const out = scalePathData('A5 5 0 0 1 10 10', 2, 2);
    expect(out).toBe('A10 10 0 0 1 20 20');
  });

  it('leaves the Z command untouched', () => {
    expect(scalePathData('M0 0 L10 10 Z', 1, 1)).toBe('M0 0 L10 10 Z');
  });

  it('is a no-op at scale 1', () => {
    expect(scalePathData('M5 5 L15 15', 1, 1)).toBe('M5 5 L15 15');
  });

  it('handles comma-separated coordinates', () => {
    expect(scalePathData('M10,20 L30,40', 2, 2)).toBe('M20,40 L60,80');
  });

  it('handles negative and decimal numbers', () => {
    expect(scalePathData('M-1.5 2.25', 4, 4)).toBe('M-6 9');
  });
});
