/**
 * Detects computed-style usage this library cannot faithfully translate
 * into PDF operators. See docs/css-support.md.
 */
export interface UnsupportedCheck {
  unsupported: boolean;
  reason?: string;
}

const GRADIENT_RE = /(linear|radial|conic)-gradient\(/i;

export function checkUnsupported(style: CSSStyleDeclaration): UnsupportedCheck {
  const backgroundImage = style.backgroundImage;
  if (backgroundImage && backgroundImage !== 'none' && GRADIENT_RE.test(backgroundImage)) {
    return { unsupported: true, reason: `background: ${backgroundImage} is a gradient and is not supported; rasterized.` };
  }

  const boxShadow = style.boxShadow;
  if (boxShadow && boxShadow !== 'none') {
    return { unsupported: true, reason: `box-shadow: ${boxShadow} is not supported; rasterized.` };
  }

  const filter = style.filter;
  if (filter && filter !== 'none') {
    return { unsupported: true, reason: `filter: ${filter} is not supported; rasterized.` };
  }

  const backdropFilter = (style as any).backdropFilter as string | undefined;
  if (backdropFilter && backdropFilter !== 'none') {
    return { unsupported: true, reason: `backdrop-filter is not supported; rasterized.` };
  }

  const transform = style.transform;
  if (transform && transform !== 'none' && !isTranslateOnly(transform)) {
    return { unsupported: true, reason: `transform: ${transform} is not supported (only translate() is); rasterized.` };
  }

  const mixBlendMode = style.mixBlendMode;
  if (mixBlendMode && mixBlendMode !== 'normal') {
    return { unsupported: true, reason: `mix-blend-mode: ${mixBlendMode} is not supported; rasterized.` };
  }

  if (style.display === 'grid' || style.display === 'inline-grid') {
    return { unsupported: true, reason: 'display: grid is not specially interpreted and is rasterized as a unit.' };
  }

  return { unsupported: false };
}

function isTranslateOnly(transform: string): boolean {
  // matrix(1, 0, 0, 1, tx, ty) is what getComputedStyle reports for a pure translate().
  const m = /^matrix\(\s*1,\s*0,\s*0,\s*1,\s*[-\d.]+,\s*[-\d.]+\s*\)$/i;
  return m.test(transform.trim());
}
