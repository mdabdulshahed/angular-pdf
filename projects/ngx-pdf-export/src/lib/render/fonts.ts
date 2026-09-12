import { PDFDocument, PDFFont, StandardFonts } from 'pdf-lib';
import { ResolvedFont } from '../model/nodes';
import { FontRegistry } from '../fonts/font-registry';

/**
 * Resolves a text run's CSS-derived font to an embedded PDFFont, preferring
 * a developer-registered custom font (full Unicode support, subset-embedded
 * via fontkit) and falling back to the nearest Standard-14 font (WinAnsi
 * only -- see docs/css-support.md "Unicode and non-Latin scripts").
 */
export class FontResolver {
  private cache = new Map<string, PDFFont>();

  constructor(private pdfDoc: PDFDocument, private registry: FontRegistry) {}

  async resolve(font: ResolvedFont): Promise<PDFFont> {
    const key = `${font.family}|${font.weight}|${font.style}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const custom = this.registry.resolve(font.family, font.weight, font.style);
    let embedded: PDFFont;
    if (custom) {
      embedded = await this.pdfDoc.embedFont(custom.bytes, { subset: true });
    } else {
      embedded = await this.pdfDoc.embedFont(pickStandardFont(font));
    }
    this.cache.set(key, embedded);
    return embedded;
  }
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
