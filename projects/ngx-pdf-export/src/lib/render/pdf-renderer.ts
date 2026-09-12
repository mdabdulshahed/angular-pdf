import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb, clip, closePath, endPath, lineTo, moveTo, popGraphicsState, pushGraphicsState } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { BlockNode, BorderEdge, GroupNode, ImageNode, Rect, RgbaColor, SvgDrawCommand, SvgNode, TextRunNode } from '../model/nodes';
import { Page, PagePrimitive } from '../pagination/paginate';
import { FontRegistry } from '../fonts/font-registry';
import { FontResolver } from './fonts';
import { PdfExportWarning } from '../dom/inspect';

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
  const fontResolver = new FontResolver(pdfDoc, fontRegistry);
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

  const textWidth = measureText(font, node.text, size, node.letterSpacingPt);
  let x = p.x;
  if (node.align === 'center') x = p.x + Math.max(0, (rect.width - textWidth) / 2);
  else if (node.align === 'right') x = p.x + Math.max(0, rect.width - textWidth);

  drawGlyphsSafely(page, font, node.text, x, baselineY, size, color, opacity, node.letterSpacingPt, warnedGlyphs, (msg) => options.onWarning({ message: msg, elementDescription: node.text.slice(0, 40) }));

  if (node.decoration.underline) {
    page.drawLine({ start: { x, y: baselineY - size * 0.08 }, end: { x: x + textWidth, y: baselineY - size * 0.08 }, thickness: Math.max(0.5, size * 0.05), color, opacity });
  }
  if (node.decoration.lineThrough) {
    page.drawLine({ start: { x, y: baselineY + size * 0.3 }, end: { x: x + textWidth, y: baselineY + size * 0.3 }, thickness: Math.max(0.5, size * 0.05), color, opacity });
  }
}

function measureText(font: PDFFont, text: string, size: number, letterSpacingPt: number): number {
  let w = 0;
  for (const ch of text) w += safeWidth(font, ch, size);
  return w + letterSpacingPt * Math.max(0, [...text].length - 1);
}

function safeWidth(font: PDFFont, ch: string, size: number): number {
  try {
    return font.widthOfTextAtSize(ch, size);
  } catch {
    return size * 0.5;
  }
}

function drawGlyphsSafely(
  page: PDFPage,
  font: PDFFont,
  text: string,
  x0: number,
  y: number,
  size: number,
  color: ReturnType<typeof rgb>,
  opacity: number,
  letterSpacingPt: number,
  warnedGlyphs: Set<string>,
  onWarning: (message: string) => void,
): void {
  if (letterSpacingPt === 0 && canEncodeAll(font, text)) {
    page.drawText(text, { x: x0, y, size, font, color, opacity });
    return;
  }
  let x = x0;
  for (const ch of text) {
    if (canEncodeAll(font, ch)) {
      page.drawText(ch, { x, y, size, font, color, opacity });
    } else if (!warnedGlyphs.has(ch)) {
      warnedGlyphs.add(ch);
      onWarning(`Character "${ch}" has no glyph in the resolved font and was skipped. Register a Unicode-capable font via registerFont() for this text.`);
    }
    x += safeWidth(font, ch, size) + letterSpacingPt;
  }
}

function canEncodeAll(font: PDFFont, text: string): boolean {
  try {
    font.widthOfTextAtSize(text, 10);
    return true;
  } catch {
    return false;
  }
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
    case 'path':
      page.drawSvgPath(cmd.d, { ...drawOpts, x: originX, y: originTopY });
      break;
  }
}
