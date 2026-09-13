/**
 * Detects computed-style usage this library cannot faithfully translate
 * into PDF operators. See docs/css-support.md.
 */
export interface UnsupportedCheck {
  unsupported: boolean;
  reason?: string;
  /**
   * Whether the fallback rasterization needs extra capture margin around
   * the element's own border box. Only effects that can visually paint
   * *outside* an element's own box -- box-shadow, filter (blur/drop-shadow)
   * -- need this; padding every fallback element regardless would shift
   * elements with no such bleed (a gradient-filled background/SVG, an
   * unsupported transform, display:grid) away from sibling content that
   * didn't go through the fallback path but shares its left/top edge. See
   * docs/css-support.md.
   */
  needsBleedPadding: boolean;
}

const GRADIENT_RE = /(linear|radial|conic)-gradient\(/i;

export function checkUnsupported(style: CSSStyleDeclaration): UnsupportedCheck {
  const backgroundImage = style.backgroundImage;
  if (backgroundImage && backgroundImage !== 'none' && GRADIENT_RE.test(backgroundImage)) {
    return { unsupported: true, reason: `background: ${backgroundImage} is a gradient and is not supported; rasterized.`, needsBleedPadding: false };
  }

  const boxShadow = style.boxShadow;
  if (boxShadow && boxShadow !== 'none') {
    return { unsupported: true, reason: `box-shadow: ${boxShadow} is not supported; rasterized.`, needsBleedPadding: true };
  }

  const filter = style.filter;
  if (filter && filter !== 'none') {
    return { unsupported: true, reason: `filter: ${filter} is not supported; rasterized.`, needsBleedPadding: true };
  }

  const backdropFilter = (style as any).backdropFilter as string | undefined;
  if (backdropFilter && backdropFilter !== 'none') {
    return { unsupported: true, reason: `backdrop-filter is not supported; rasterized.`, needsBleedPadding: false };
  }

  const transform = style.transform;
  if (transform && transform !== 'none' && !isTranslateOnly(transform)) {
    return { unsupported: true, reason: `transform: ${transform} is not supported (only translate() is); rasterized.`, needsBleedPadding: false };
  }

  const mixBlendMode = style.mixBlendMode;
  if (mixBlendMode && mixBlendMode !== 'normal') {
    return { unsupported: true, reason: `mix-blend-mode: ${mixBlendMode} is not supported; rasterized.`, needsBleedPadding: false };
  }

  if (style.display === 'grid' || style.display === 'inline-grid') {
    return { unsupported: true, reason: 'display: grid is not specially interpreted and is rasterized as a unit.', needsBleedPadding: false };
  }

  return { unsupported: false, needsBleedPadding: false };
}

function isTranslateOnly(transform: string): boolean {
  // matrix(1, 0, 0, 1, tx, ty) is what getComputedStyle reports for a pure translate().
  const m = /^matrix\(\s*1,\s*0,\s*0,\s*1,\s*[-\d.]+,\s*[-\d.]+\s*\)$/i;
  return m.test(transform.trim());
}
