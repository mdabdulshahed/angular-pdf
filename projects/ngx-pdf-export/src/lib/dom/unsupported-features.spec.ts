import { describe, expect, it } from 'vitest';
import { checkUnsupported } from './unsupported-features';

function style(overrides: Partial<Record<string, string>>): CSSStyleDeclaration {
  const base: Record<string, string> = {
    backgroundImage: 'none',
    boxShadow: 'none',
    filter: 'none',
    backdropFilter: 'none',
    transform: 'none',
    mixBlendMode: 'normal',
    display: 'block',
  };
  return { ...base, ...overrides } as unknown as CSSStyleDeclaration;
}

describe('checkUnsupported: needsBleedPadding', () => {
  // Regression test: only effects that can visually paint *outside* an
  // element's own border box (box-shadow, filter) should trigger extra
  // fallback-rasterization capture padding. Padding every fallback
  // element regardless shifts elements with no such bleed -- a
  // gradient-filled background/SVG, an unsupported transform,
  // display:grid -- away from sibling content that shares their
  // left/top edge but didn't go through the fallback path (e.g. a
  // gradient-logo <svg> ending up misaligned with a plain-text <h1>
  // right below it). See docs/css-support.md.

  it('needs bleed padding for box-shadow', () => {
    const result = checkUnsupported(style({ boxShadow: '0 6px 16px rgba(0,0,0,0.2)' }));
    expect(result.unsupported).toBe(true);
    expect(result.needsBleedPadding).toBe(true);
  });

  it('needs bleed padding for filter', () => {
    const result = checkUnsupported(style({ filter: 'blur(4px)' }));
    expect(result.unsupported).toBe(true);
    expect(result.needsBleedPadding).toBe(true);
  });

  it('does not need bleed padding for a gradient background', () => {
    const result = checkUnsupported(style({ backgroundImage: 'linear-gradient(red, blue)' }));
    expect(result.unsupported).toBe(true);
    expect(result.needsBleedPadding).toBe(false);
  });

  it('does not need bleed padding for an unsupported transform', () => {
    const result = checkUnsupported(style({ transform: 'matrix(0, 1, -1, 0, 0, 0)' }));
    expect(result.unsupported).toBe(true);
    expect(result.needsBleedPadding).toBe(false);
  });

  it('does not need bleed padding for display: grid', () => {
    const result = checkUnsupported(style({ display: 'grid' }));
    expect(result.unsupported).toBe(true);
    expect(result.needsBleedPadding).toBe(false);
  });

  it('does not need bleed padding for mix-blend-mode', () => {
    const result = checkUnsupported(style({ mixBlendMode: 'multiply' }));
    expect(result.unsupported).toBe(true);
    expect(result.needsBleedPadding).toBe(false);
  });

  it('reports supported (no padding) for ordinary styles', () => {
    const result = checkUnsupported(style({}));
    expect(result.unsupported).toBe(false);
    expect(result.needsBleedPadding).toBe(false);
  });
});
