/**
 * Unit conversions. See docs/architecture.md "Coordinate systems and units".
 * Internal layout space is always PDF points (pt); DOM space is CSS px.
 */

export const PX_TO_PT = 72 / 96;
export const PT_TO_PX = 96 / 72;
export const MM_TO_PT = 72 / 25.4;
export const PT_TO_MM = 25.4 / 72;

export function pxToPt(px: number): number {
  return px * PX_TO_PT;
}

export function ptToPx(pt: number): number {
  return pt * PT_TO_PX;
}

export function mmToPt(mm: number): number {
  return mm * MM_TO_PT;
}

export function ptToMm(pt: number): number {
  return pt * PT_TO_MM;
}

export interface PageDimensionsPt {
  widthPt: number;
  heightPt: number;
}

/** Standard page sizes in points, portrait orientation. */
export const STANDARD_PAGE_SIZES_PT: Record<string, PageDimensionsPt> = {
  A4: { widthPt: mmToPt(210), heightPt: mmToPt(297) },
  A3: { widthPt: mmToPt(297), heightPt: mmToPt(420) },
  Letter: { widthPt: 612, heightPt: 792 },
  Legal: { widthPt: 612, heightPt: 1008 },
};
