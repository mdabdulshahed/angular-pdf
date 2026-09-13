import { PDFDocument, PDFFont, StandardFonts } from 'pdf-lib';
import { ResolvedFont } from '../model/nodes';
import { FontRegistry, RegisteredFontSource } from '../fonts/font-registry';

/**
 * Resolves a text run's CSS-derived font to an embedded PDFFont, preferring
 * a developer-registered custom font (full Unicode support, subset-embedded
 * via fontkit) and falling back to the nearest Standard-14 font (WinAnsi
 * only -- see docs/css-support.md "Unicode and non-Latin scripts").
 *
 * Also builds a fallback chain across *every* registered font: a real
 * browser rendering `font-family: "Inter Tight", ..., "Apple Color Emoji"`
 * silently pulls the emoji glyph from the last font in that stack when
 * "Inter Tight" doesn't have it. We don't replicate the CSS font stack
 * (registerFont() doesn't ask for one), but we get the same practical
 * result for the common case -- register any font, for any purpose, and
 * it also becomes available to cover *other* fonts' missing glyphs -- via
 * `fallbackCandidatesFor`, used by render/pdf-renderer.ts's per-character
 * draw loop when the primary font can't encode a character.
 */
export class FontResolver {
  private cache = new Map<string, PDFFont>();
  private embeddedBySource = new Map<RegisteredFontSource, PDFFont>();

  constructor(private pdfDoc: PDFDocument, private registry: FontRegistry, private onWarning?: (message: string) => void) {}

  async resolve(font: ResolvedFont): Promise<PDFFont> {
    const key = `${font.family}|${font.weight}|${font.style}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const custom = this.registry.resolve(font.family, font.weight, font.style);
    let embedded: PDFFont;
    if (custom) {
      embedded = await this.embedRegistered(custom);
    } else {
      const standard = pickStandardFont(font);
      embedded = await this.pdfDoc.embedFont(standard);
      // Standard-14 metrics (fixed since ~1985 PostScript Helvetica/Times/
      // Courier) essentially never match the actual character widths of
      // whatever the browser rendered "font-family" with -- the gap
      // compounds with font-size and any letter-spacing, and can visibly
      // shift where a line of text ends relative to unrelated sibling
      // content. This is the single most common cause of "why doesn't my
      // PDF layout match the screenshot" reports; see docs/css-support.md.
      // Skipped when the CSS family already names a Standard-14 base font
      // (e.g. `font-family: Arial`/`Helvetica`) -- there the substitution
      // is the intended, reasonable choice, not a mismatch to flag.
      if (!isStandardFontFamilyName(font.family)) {
        this.onWarning?.(
          `font-family "${font.family}" is not registered; substituting ${standard} (Standard-14). Character widths will differ from the on-screen font, which can visibly shift text/line positions. Register the actual font via registerFont() for pixel-accurate output.`,
        );
      }
    }
    this.cache.set(key, embedded);
    return embedded;
  }

  /** Every other registered font, embedded, in registration order -- for the primary-font-can't-encode-this-character fallback path. */
  async fallbackCandidatesFor(primary: PDFFont): Promise<PDFFont[]> {
    const out: PDFFont[] = [];
    for (const source of this.registry.getAllSources()) {
      const embedded = await this.embedRegistered(source);
      if (embedded !== primary && !out.includes(embedded)) {
        out.push(embedded);
      }
    }
    return out;
  }

  private async embedRegistered(source: RegisteredFontSource): Promise<PDFFont> {
    const cached = this.embeddedBySource.get(source);
    if (cached) return cached;
    const embedded = await this.pdfDoc.embedFont(source.bytes, { subset: true });
    this.embeddedBySource.set(source, embedded);
    return embedded;
  }
}

const STANDARD_FONT_FAMILY_NAMES = /^(helvetica|arial|times( new roman)?|courier( new)?|monospace|sans-serif|serif)$/i;

function isStandardFontFamilyName(family: string): boolean {
  return STANDARD_FONT_FAMILY_NAMES.test(family.trim());
}

function pickStandardFont(font: ResolvedFont): StandardFonts {
  const family = font.family.toLowerCase();
  const bold = font.weight >= 600;
  const italic = font.style === 'italic';

  if (/mono|courier|consolas|menlo/.test(family)) {
    if (bold && italic) return StandardFonts.CourierBoldOblique;
    if (bold) return StandardFonts.CourierBold;
    if (italic) return StandardFonts.CourierOblique;
    return StandardFonts.Courier;
  }
  if (/times|serif|georgia|garamond/.test(family)) {
    if (bold && italic) return StandardFonts.TimesRomanBoldItalic;
    if (bold) return StandardFonts.TimesRomanBold;
    if (italic) return StandardFonts.TimesRomanItalic;
    return StandardFonts.TimesRoman;
  }
  if (bold && italic) return StandardFonts.HelveticaBoldOblique;
  if (bold) return StandardFonts.HelveticaBold;
  if (italic) return StandardFonts.HelveticaOblique;
  return StandardFonts.Helvetica;
}
