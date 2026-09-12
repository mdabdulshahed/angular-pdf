export interface PdfFontSource {
  family: string;
  src: string | ArrayBuffer;
  weight?: number;
  style?: 'normal' | 'italic';
}

export interface RegisteredFontSource {
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  bytes: ArrayBuffer;
}

/**
 * Holds developer-registered custom fonts (see docs/api-design.md "Font
 * registration"). Resolution is family match -> nearest registered weight
 * for that family+style, falling back to the opposite style if no exact
 * style match exists. Standard-14 fallback happens in render/fonts.ts,
 * outside this class, since it needs a live PDFDocument to embed against.
 */
export class FontRegistry {
  private sources: RegisteredFontSource[] = [];

  async register(font: PdfFontSource): Promise<void> {
    const bytes = typeof font.src === 'string' ? await fetchBytes(font.src) : font.src;
    this.sources.push({
      family: font.family,
      weight: font.weight ?? 400,
      style: font.style ?? 'normal',
      bytes,
    });
  }

  resolve(family: string, weight: number, style: 'normal' | 'italic'): RegisteredFontSource | undefined {
    const candidates = this.sources.filter((s) => s.family.toLowerCase() === family.toLowerCase());
    if (candidates.length === 0) {
      return undefined;
    }
    const styleMatches = candidates.filter((c) => c.style === style);
    const pool = styleMatches.length > 0 ? styleMatches : candidates;
    return pool.reduce((best, c) => (Math.abs(c.weight - weight) < Math.abs(best.weight - weight) ? c : best));
  }

  hasAnyFontFor(family: string): boolean {
    return this.sources.some((s) => s.family.toLowerCase() === family.toLowerCase());
  }
}

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`ngx-pdf-export: failed to fetch font "${url}" (HTTP ${response.status}).`);
  }
  return response.arrayBuffer();
}
