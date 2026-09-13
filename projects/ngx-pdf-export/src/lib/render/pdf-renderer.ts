import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb, clip, closePath, endPath, lineTo, moveTo, popGraphicsState, pushGraphicsState } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { BlockNode, BorderEdge, GroupNode, ImageNode, Rect, RgbaColor, SvgDrawCommand, SvgNode, TextRunNode } from '../model/nodes';
import { Page, PagePrimitive } from '../pagination/paginate';
import { FontRegistry } from '../fonts/font-registry';
import { FontResolver } from './fonts';
import { PdfExportWarning } from '../dom/inspect';
import { svgPathAnchor } from './svg-path-anchor';

export interface RenderGeometry {
  widthPt: number;
  heightPt: number;
  marginTopPt: number;
  marginLeftPt: number;
}

export interface RenderOptions {
  geometry: RenderGeometry;
  debug: boolean;
  onWarning: (w: PdfExportWarning) => void;
}

export interface HeaderFooterConfig {
  headerPrimitivesPerPage?: PagePrimitive[][];
  footerPrimitivesPerPage?: PagePrimitive[][];
  headerGeometry?: RenderGeometry;
  footerGeometry?: RenderGeometry;
}

export async function renderPdf(pages: Page[], fontRegistry: FontRegistry, options: RenderOptions, headerFooter?: HeaderFooterConfig): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const fontResolver = new FontResolver(pdfDoc, fontRegistry, (message) => options.onWarning({ message, elementDescription: '(font resolution)' }));
  const imageCache = new Map<string, PDFImage>();
  const warnedGlyphs = new Set<string>();

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const pdfPage = pdfDoc.addPage([options.geometry.widthPt, options.geometry.heightPt]);
    for (const primitive of page.primitives) {
      await drawPrimitive(pdfDoc, pdfPage, primitive, options, fontResolver, imageCache, warnedGlyphs);
    }
    const headerPrimitives = headerFooter?.headerPrimitivesPerPage?.[i];
    if (headerPrimitives?.length && headerFooter?.headerGeometry) {
      const headerOptions: RenderOptions = { ...options, geometry: headerFooter.headerGeometry };
      for (const primitive of headerPrimitives) {
        await drawPrimitive(pdfDoc, pdfPage, primitive, headerOptions, fontResolver, imageCache, warnedGlyphs);
      }
    }
    const footerPrimitives = headerFooter?.footerPrimitivesPerPage?.[i];
    if (footerPrimitives?.length && headerFooter?.footerGeometry) {
      const footerOptions: RenderOptions = { ...options, geometry: headerFooter.footerGeometry };
      for (const primitive of footerPrimitives) {
        await drawPrimitive(pdfDoc, pdfPage, primitive, footerOptions, fontResolver, imageCache, warnedGlyphs);
      }
    }
    if (options.debug) {
      pdfPage.drawRectangle({
        x: 0,
        y: 0,
        width: options.geometry.widthPt,
        height: options.geometry.heightPt,
        borderColor: rgb(1, 0, 0),
        borderWidth: 1,
        borderDashArray: [4, 4],
      });
    }
  }

  return pdfDoc.save();
}

function rgbFrom(c: RgbaColor) {
  return rgb(c.r / 255, c.g / 255, c.b / 255);
}

function toPdfSpace(rect: Rect, geometry: RenderGeometry): { x: number; topY: number; bottomY: number; width: number; height: number } {
  const x = geometry.marginLeftPt + rect.x;
  const topY = geometry.marginTopPt + rect.y;
  const bottomYPdf = geometry.heightPt - (topY + rect.height);
  const topYPdf = geometry.heightPt - topY;
  return { x, topY: topYPdf, bottomY: bottomYPdf, width: rect.width, height: rect.height };
}

async function drawPrimitive(
  pdfDoc: PDFDocument,
  pdfPage: PDFPage,
  primitive: PagePrimitive,
  options: RenderOptions,
  fontResolver: FontResolver,
  imageCache: Map<string, PDFImage>,
  warnedGlyphs: Set<string>,
): Promise<void> {
  const clipRect = primitive.clip ? toPdfSpace(primitive.clip, options.geometry) : undefined;

  if (clipRect) {
    pushClip(pdfPage, clipRect);
  }

  try {
    switch (primitive.kind) {
      case 'block':
        drawBox(pdfPage, primitive.node, primitive.rect, options);
        if (options.debug && primitive.node.fallback) {
          drawDebugOutline(pdfPage, primitive.rect, options.geometry);
        }
        break;
      case 'text':
        await drawText(pdfPage, primitive.node, primitive.rect, options, fontResolver, warnedGlyphs);
        break;
      case 'image':
        await drawImage(pdfDoc, pdfPage, primitive.node, primitive.rect, options, imageCache);
        if (options.debug && primitive.node.isFallbackRaster) {
          drawDebugOutline(pdfPage, primitive.rect, options.geometry);
        }
        break;
      case 'svg':
        drawSvg(pdfPage, primitive.node, primitive.rect, options.geometry);
        break;
    }
  } finally {
    if (clipRect) {
      popClip(pdfPage);
    }
  }
}

function pushClip(page: PDFPage, r: { x: number; bottomY: number; width: number; height: number }): void {
  page.pushOperators(
    pushGraphicsState(),
    moveTo(r.x, r.bottomY),
    lineTo(r.x + r.width, r.bottomY),
    lineTo(r.x + r.width, r.bottomY + r.height),
    lineTo(r.x, r.bottomY + r.height),
    closePath(),
    clip(),
    endPath(),
  );
}

function popClip(page: PDFPage): void {
  page.pushOperators(popGraphicsState());
}

function drawDebugOutline(page: PDFPage, rect: Rect, geometry: RenderGeometry): void {
  const p = toPdfSpace(rect, geometry);
  page.drawRectangle({ x: p.x, y: p.bottomY, width: p.width, height: p.height, borderColor: rgb(1, 0, 0), borderWidth: 1, borderDashArray: [2, 2] });
}

// ---- box (background/border/border-radius) ----

function drawBox(page: PDFPage, node: BlockNode | GroupNode, rect: Rect, options: RenderOptions): void {
  const p = toPdfSpace(rect, options.geometry);
  const paint = node.paint;
  const radius = paint.borderRadius;
  const hasRadius = !!radius && (radius.topLeft || radius.topRight || radius.bottomRight || radius.bottomLeft);

  if (hasRadius) {
    const d = roundedRectPath(p.width, p.height, radius!);
    const drawOpts: Parameters<PDFPage['drawSvgPath']>[1] = { x: p.x, y: p.topY };
    if (paint.backgroundColor && paint.backgroundColor.a > 0) {
      drawOpts.color = rgbFrom(paint.backgroundColor);
      drawOpts.opacity = paint.backgroundColor.a * paint.opacity;
    }
    const edge = firstPaintedEdge(paint.borders);
    if (edge) {
      drawOpts.borderColor = rgbFrom(edge.color);
      drawOpts.borderWidth = edge.widthPt;
      drawOpts.borderOpacity = edge.color.a * paint.opacity;
      applyDash(drawOpts, edge);
    }
    if (drawOpts.color || drawOpts.borderColor) {
      page.drawSvgPath(d, drawOpts);
    }
    return;
  }

  if (paint.backgroundColor && paint.backgroundColor.a > 0) {
    page.drawRectangle({ x: p.x, y: p.bottomY, width: p.width, height: p.height, color: rgbFrom(paint.backgroundColor), opacity: paint.backgroundColor.a * paint.opacity });
  }

  if (paint.borders) {
    drawEdgeLine(page, paint.borders.top, p.x, p.topY, p.x + p.width, p.topY, paint.opacity);
    drawEdgeLine(page, paint.borders.bottom, p.x, p.bottomY, p.x + p.width, p.bottomY, paint.opacity);
    drawEdgeLine(page, paint.borders.left, p.x, p.bottomY, p.x, p.topY, paint.opacity);
    drawEdgeLine(page, paint.borders.right, p.x + p.width, p.bottomY, p.x + p.width, p.topY, paint.opacity);
  }
}

function firstPaintedEdge(borders: BlockNode['paint']['borders']): BorderEdge | undefined {
  if (!borders) return undefined;
  return [borders.top, borders.right, borders.bottom, borders.left].find((e) => e.style !== 'none' && e.widthPt > 0);
}

function applyDash(drawOpts: any, edge: BorderEdge): void {
  if (edge.style === 'dashed') {
    drawOpts.borderDashArray = [edge.widthPt * 2.5, edge.widthPt * 2];
  } else if (edge.style === 'dotted') {
    drawOpts.borderDashArray = [edge.widthPt * 0.6, edge.widthPt * 1.4];
  }
}

function drawEdgeLine(page: PDFPage, edge: BorderEdge, x1: number, y1: number, x2: number, y2: number, groupOpacity: number): void {
  if (edge.style === 'none' || edge.widthPt <= 0) return;
  const dashArray = edge.style === 'dashed' ? [edge.widthPt * 2.5, edge.widthPt * 2] : edge.style === 'dotted' ? [edge.widthPt * 0.6, edge.widthPt * 1.4] : undefined;
  page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: edge.widthPt, color: rgbFrom(edge.color), opacity: edge.color.a * groupOpacity, dashArray });
}

function roundedRectPath(w: number, h: number, r: { topLeft: number; topRight: number; bottomRight: number; bottomLeft: number }): string {
  const tl = Math.min(r.topLeft, w / 2, h / 2);
  const tr = Math.min(r.topRight, w / 2, h / 2);
  const br = Math.min(r.bottomRight, w / 2, h / 2);
  const bl = Math.min(r.bottomLeft, w / 2, h / 2);
  return [
    `M ${tl} 0`,
    `L ${w - tr} 0`,
    `Q ${w} 0 ${w} ${tr}`,
    `L ${w} ${h - br}`,
    `Q ${w} ${h} ${w - br} ${h}`,
    `L ${bl} ${h}`,
    `Q 0 ${h} 0 ${h - bl}`,
    `L 0 ${tl}`,
    `Q 0 0 ${tl} 0`,
    'Z',
  ].join(' ');
}

// ---- text ----

async function drawText(page: PDFPage, node: TextRunNode, rect: Rect, options: RenderOptions, fontResolver: FontResolver, warnedGlyphs: Set<string>): Promise<void> {
  const font = await fontResolver.resolve(node.font);
  const p = toPdfSpace(rect, options.geometry);
  const size = node.font.sizePt;
  const baselineY = options.geometry.heightPt - (options.geometry.marginTopPt + rect.y + node.baselineOffsetPt);
  const color = rgbFrom(node.color);
  const opacity = node.color.a;
  const onWarning = (msg: string) => options.onWarning({ message: msg, elementDescription: node.text.slice(0, 40) });

  let textWidth: number;
  let plan: GlyphPlan | null = null;

  if (node.letterSpacingPt === 0 && canEncodeAll(font, node.text)) {
    // Fast path: the primary font covers the whole run and there's no
    // letter-spacing to hand-position, so draw it as one Tj like any
    // ordinary run -- most text never needs the per-character fallback
    // machinery below.
    textWidth = safeWidth(font, node.text, size);
  } else {
    // Either letter-spacing needs per-character positioning anyway, or the
    // primary font is missing at least one glyph -- in the latter case,
    // check every *other* registered font before giving up on a
    // character, the same way a browser's own font-stack fallback would.
    // See render/fonts.ts `fallbackCandidatesFor`.
    const fallbacks = await fontResolver.fallbackCandidatesFor(font);
    plan = buildGlyphPlan(node.text, font, fallbacks, size, node.letterSpacingPt);
    textWidth = plan.totalWidth;
  }

  let x = p.x;
  if (node.align === 'center') x = p.x + Math.max(0, (rect.width - textWidth) / 2);
  else if (node.align === 'right') x = p.x + Math.max(0, rect.width - textWidth);

  if (plan) {
    drawGlyphPlan(page, plan, x, baselineY, size, color, opacity, node.letterSpacingPt, warnedGlyphs, onWarning);
  } else {
    page.drawText(node.text, { x, y: baselineY, size, font, color, opacity });
  }

  if (node.decoration.underline) {
    page.drawLine({ start: { x, y: baselineY - size * 0.08 }, end: { x: x + textWidth, y: baselineY - size * 0.08 }, thickness: Math.max(0.5, size * 0.05), color, opacity });
  }
  if (node.decoration.lineThrough) {
    page.drawLine({ start: { x, y: baselineY + size * 0.3 }, end: { x: x + textWidth, y: baselineY + size * 0.3 }, thickness: Math.max(0.5, size * 0.05), color, opacity });
  }
}

interface GlyphPlanEntry {
  ch: string;
  font: PDFFont | null; // null = no font (primary or fallback) could encode it
  width: number;
}

interface GlyphPlan {
  entries: GlyphPlanEntry[];
  totalWidth: number;
}

function buildGlyphPlan(text: string, primary: PDFFont, fallbacks: PDFFont[], size: number, letterSpacingPt: number): GlyphPlan {
  const chars = Array.from(text);
  const entries: GlyphPlanEntry[] = chars.map((ch) => {
    if (canEncodeAll(primary, ch)) {
      return { ch, font: primary, width: safeWidth(primary, ch, size) };
    }
    const fallback = fallbacks.find((f) => canEncodeAll(f, ch));
    if (fallback) {
      return { ch, font: fallback, width: safeWidth(fallback, ch, size) };
    }
    return { ch, font: null, width: size * 0.5 };
  });
  const totalWidth = entries.reduce((sum, e) => sum + e.width, 0) + letterSpacingPt * Math.max(0, entries.length - 1);
  return { entries, totalWidth };
}

function drawGlyphPlan(
  page: PDFPage,
  plan: GlyphPlan,
  x0: number,
  y: number,
  size: number,
  color: ReturnType<typeof rgb>,
  opacity: number,
  letterSpacingPt: number,
  warnedGlyphs: Set<string>,
  onWarning: (message: string) => void,
): void {
  let x = x0;
  for (const entry of plan.entries) {
    if (entry.font) {
      page.drawText(entry.ch, { x, y, size, font: entry.font, color, opacity });
    } else if (!warnedGlyphs.has(entry.ch)) {
      warnedGlyphs.add(entry.ch);
      onWarning(`Character "${entry.ch}" has no glyph in the resolved font or any registered fallback font and was skipped. Register a font with coverage for this character via registerFont().`);
    }
    x += entry.width + letterSpacingPt;
  }
}

function safeWidth(font: PDFFont, text: string, size: number): number {
  try {
    return font.widthOfTextAtSize(text, size);
  } catch {
    return size * 0.5 * Array.from(text).length;
  }
}

const characterSetCache = new WeakMap<PDFFont, Set<number>>();

function characterSetOf(font: PDFFont): Set<number> {
  let set = characterSetCache.get(font);
  if (!set) {
    set = new Set(font.getCharacterSet());
    characterSetCache.set(font, set);
  }
  return set;
}

/**
 * Whether every character in `text` has a real glyph in `font` -- not
 * "does drawing/measuring it throw." For pdf-lib's Standard-14 fonts,
 * `widthOfTextAtSize` does throw on an out-of-WinAnsi character, but for a
 * *custom embedded* font (any `registerFont()`-ed TTF/OTF), it does not:
 * TrueType/OpenType cmap lookups for a missing codepoint silently resolve
 * to glyph 0 (.notdef, the "tofu box") and pdf-lib happily measures/draws
 * that -- so a try/catch around widthOfTextAtSize only ever catches the
 * Standard-14 case, silently missing every custom-font gap and defeating
 * the whole point of the fallback-font search below. `getCharacterSet()`
 * reports the font's real codepoint coverage regardless of font kind.
 */
function canEncodeAll(font: PDFFont, text: string): boolean {
  const set = characterSetOf(font);
  for (const ch of text) {
    if (!set.has(ch.codePointAt(0)!)) return false;
  }
  return true;
}

// ---- images ----

async function drawImage(pdfDoc: PDFDocument, page: PDFPage, node: ImageNode, rect: Rect, options: RenderOptions, cache: Map<string, PDFImage>): Promise<void> {
  if (!node.source.value) return;

  let embedded = cache.get(node.source.value);
  if (!embedded) {
    const decoded = decodeDataUrl(node.source.value);
    if (!decoded) return;
    embedded = decoded.isPng ? await pdfDoc.embedPng(decoded.bytes) : await pdfDoc.embedJpg(decoded.bytes);
    cache.set(node.source.value, embedded);
  }

  const box = toPdfSpace(rect, options.geometry);
  const natW = node.naturalWidth || embedded.width;
  const natH = node.naturalHeight || embedded.height;

  let drawW = box.width;
  let drawH = box.height;
  let drawX = box.x;
  let drawTopY = options.geometry.marginTopPt + rect.y;

  if ((node.fit === 'contain' || node.fit === 'cover') && natW > 0 && natH > 0) {
    const scale = node.fit === 'contain' ? Math.min(box.width / natW, box.height / natH) : Math.max(box.width / natW, box.height / natH);
    drawW = natW * scale;
    drawH = natH * scale;
    drawX = box.x + (box.width - drawW) / 2;
    drawTopY = options.geometry.marginTopPt + rect.y + (box.height - drawH) / 2;
  } else if (node.fit === 'none' && natW > 0 && natH > 0) {
    drawW = natW;
    drawH = natH;
  }

  const drawBottomYPdf = options.geometry.heightPt - (drawTopY + drawH);
  const needsClip = drawW > box.width + 0.5 || drawH > box.height + 0.5;

  if (needsClip) {
    pushClip(page, box);
  }
  page.drawImage(embedded, { x: drawX, y: drawBottomYPdf, width: drawW, height: drawH });
  if (needsClip) {
    popClip(page);
  }
}

function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; isPng: boolean } | null {
  const match = /^data:image\/(png|jpe?g);base64,(.*)$/i.exec(dataUrl);
  if (!match) return null;
  const isPng = match[1].toLowerCase() === 'png';
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, isPng };
}

// ---- svg ----

function drawSvg(page: PDFPage, node: SvgNode, rect: Rect, geometry: RenderGeometry): void {
  const p = toPdfSpace(rect, geometry);
  for (const cmd of node.commands) {
    drawSvgCommand(page, cmd, p.x, p.topY);
  }
}

function drawSvgCommand(page: PDFPage, cmd: SvgDrawCommand, originX: number, originTopY: number): void {
  const paint = cmd.paint;
  const drawOpts: any = {};
  if (paint.fill) {
    drawOpts.color = rgbFrom(paint.fill);
    drawOpts.opacity = paint.fill.a * paint.opacity;
  }
  if (paint.stroke && paint.strokeWidthPt > 0) {
    drawOpts.borderColor = rgbFrom(paint.stroke);
    drawOpts.borderWidth = paint.strokeWidthPt;
    drawOpts.borderOpacity = paint.stroke.a * paint.opacity;
  }
  if (!drawOpts.color && !drawOpts.borderColor) return;

  switch (cmd.op) {
    case 'rect': {
      const hasRadius = cmd.rx > 0 || cmd.ry > 0;
      if (hasRadius) {
        const d = roundedRectPath(cmd.width, cmd.height, { topLeft: cmd.rx, topRight: cmd.rx, bottomRight: cmd.rx, bottomLeft: cmd.rx });
        page.drawSvgPath(d, { ...drawOpts, x: originX + cmd.x, y: originTopY - cmd.y });
      } else {
        page.drawRectangle({ x: originX + cmd.x, y: originTopY - cmd.y - cmd.height, width: cmd.width, height: cmd.height, color: drawOpts.color, opacity: drawOpts.opacity, borderColor: drawOpts.borderColor, borderWidth: drawOpts.borderWidth, borderOpacity: drawOpts.borderOpacity });
      }
      break;
    }
    case 'ellipse':
      page.drawEllipse({ x: originX + cmd.cx, y: originTopY - cmd.cy, xScale: cmd.rx, yScale: cmd.ry, color: drawOpts.color, opacity: drawOpts.opacity, borderColor: drawOpts.borderColor, borderWidth: drawOpts.borderWidth, borderOpacity: drawOpts.borderOpacity });
      break;
    case 'line':
      if (drawOpts.borderColor) {
        page.drawLine({ start: { x: originX + cmd.x1, y: originTopY - cmd.y1 }, end: { x: originX + cmd.x2, y: originTopY - cmd.y2 }, thickness: drawOpts.borderWidth, color: drawOpts.borderColor, opacity: drawOpts.borderOpacity });
      }
      break;
    case 'path': {
      // See dom/svg-parser.ts and render/svg-path-anchor.ts: a non-zero
      // viewBox origin is applied here, as a shift of the anchor point,
      // rather than baked into cmd.d -- safe regardless of whether the
      // path mixes absolute/relative commands.
      const anchor = svgPathAnchor(originX, originTopY, cmd.originOffsetXPt, cmd.originOffsetYPt);
      page.drawSvgPath(cmd.d, { ...drawOpts, x: anchor.x, y: anchor.y });
      break;
    }
  }
}
