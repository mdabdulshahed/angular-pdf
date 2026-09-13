import { describe, expect, it } from 'vitest';
import { FontRegistry } from './font-registry';

function bytes(tag: string): ArrayBuffer {
  return new TextEncoder().encode(tag).buffer;
}

describe('FontRegistry', () => {
  it('resolves the nearest registered weight for an exact family/style match', async () => {
    const registry = new FontRegistry();
    await registry.register({ family: 'Inter', src: bytes('regular'), weight: 400 });
    await registry.register({ family: 'Inter', src: bytes('bold'), weight: 700 });

    const resolved = registry.resolve('Inter', 600, 'normal');
    expect(resolved?.weight).toBe(700); // nearer to 600 than 400
  });

  it('is case-insensitive on family name', async () => {
    const registry = new FontRegistry();
    await registry.register({ family: 'Noto Sans', src: bytes('a'), weight: 400 });
    expect(registry.resolve('noto sans', 400, 'normal')).toBeDefined();
    expect(registry.hasAnyFontFor('NOTO SANS')).toBe(true);
  });

  it('prefers a style match over a closer weight in the wrong style', async () => {
    const registry = new FontRegistry();
    await registry.register({ family: 'Inter', src: bytes('regular'), weight: 400, style: 'normal' });
    await registry.register({ family: 'Inter', src: bytes('italic'), weight: 400, style: 'italic' });

    const resolved = registry.resolve('Inter', 400, 'italic');
    expect(resolved?.style).toBe('italic');
  });

  it('returns undefined for an unregistered family', () => {
    const registry = new FontRegistry();
    expect(registry.resolve('Nonexistent', 400, 'normal')).toBeUndefined();
    expect(registry.hasAnyFontFor('Nonexistent')).toBe(false);
  });

  // Regression coverage for the multi-font fallback chain (see
  // render/fonts.ts `fallbackCandidatesFor`): every registered font, from
  // every family, must be enumerable regardless of which family a given
  // text run's *primary* font resolution asked for -- a font registered
  // for one purpose (e.g. an emoji font) should be available to cover
  // another font's missing glyphs.
  it('getAllSources lists every registered font across all families, in registration order', async () => {
    const registry = new FontRegistry();
    await registry.register({ family: 'Inter', src: bytes('a'), weight: 400 });
    await registry.register({ family: 'Noto Emoji', src: bytes('b'), weight: 400 });
    await registry.register({ family: 'Inter', src: bytes('c'), weight: 700 });

    const all = registry.getAllSources();
    expect(all.map((s) => s.family)).toEqual(['Inter', 'Noto Emoji', 'Inter']);
  });
});
