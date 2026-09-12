import { describe, expect, it } from 'vitest';
import { mmToPt, pxToPt, ptToMm, ptToPx, STANDARD_PAGE_SIZES_PT } from './units';

describe('unit conversions', () => {
  it('converts CSS px to PDF pt using the 96dpi/72dpi ratio', () => {
    expect(pxToPt(96)).toBeCloseTo(72, 6);
    expect(pxToPt(16)).toBeCloseTo(12, 6);
  });

  it('round-trips px -> pt -> px', () => {
    expect(ptToPx(pxToPt(123.45))).toBeCloseTo(123.45, 6);
  });

  it('converts mm to pt using 25.4mm = 72pt = 1 inch', () => {
    expect(mmToPt(25.4)).toBeCloseTo(72, 6);
  });

  it('round-trips mm -> pt -> mm', () => {
    expect(ptToMm(mmToPt(210))).toBeCloseTo(210, 6);
  });

  it('matches the well-known A4 point dimensions', () => {
    expect(STANDARD_PAGE_SIZES_PT['A4'].widthPt).toBeCloseTo(595.28, 1);
    expect(STANDARD_PAGE_SIZES_PT['A4'].heightPt).toBeCloseTo(841.89, 1);
  });

  it('matches the well-known Letter point dimensions', () => {
    expect(STANDARD_PAGE_SIZES_PT['Letter'].widthPt).toBe(612);
    expect(STANDARD_PAGE_SIZES_PT['Letter'].heightPt).toBe(792);
  });
});
