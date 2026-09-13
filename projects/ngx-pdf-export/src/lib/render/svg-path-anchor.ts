/**
 * Computes the PDF-space anchor point pdf-lib's drawSvgPath should be
 * placed at for a path command carrying a viewBox-origin offset.
 *
 * Derivation: `dom/svg-parser.ts` scales a path's coordinates by (sx, sy)
 * but deliberately leaves the viewBox's own origin (vbX, vbY) unsubtracted
 * in the path data itself (see the comment there for why -- rewriting
 * relative-command deltas would be wrong). The still-needed shift of
 * (-vbX*sx, -vbY*sy) is applied here instead, as a rigid translation of
 * the whole already-scaled path, via drawSvgPath's own (x, y) anchor:
 *
 *   PDF_x(point) = anchorX + localX          (x: no flip)
 *   PDF_y(point) = anchorY - localY          (y: pdf-lib flips paths to
 *                                              match top-left SVG authoring
 *                                              -- see docs/architecture.md)
 *
 * We want PDF_x = originX + (localX - offsetXPt) and
 *         PDF_y = originTopY - (localY - offsetYPt),
 * which, matching coefficients of localX/localY, gives:
 *
 *   anchorX = originX - offsetXPt
 *   anchorY = originTopY + offsetYPt
 */
export function svgPathAnchor(originX: number, originTopY: number, offsetXPt: number, offsetYPt: number): { x: number; y: number } {
  return { x: originX - offsetXPt, y: originTopY + offsetYPt };
}
