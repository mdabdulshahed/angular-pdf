import {
  BlockNode,
  DocumentNode,
  GroupNode,
  ImageNode,
  LayoutNode,
  Rect,
  NodeBreakRules,
  ResolvedFont,
  SvgNode,
  TableCellNode,
  TableNode,
  TableRowNode,
  TextRunNode,
} from '../model/nodes';
import { pxToPt } from '../model/units';
import { readBoxPaint } from './box-model';
import { readBreakRules } from './break-rules';
import { parseComputedColor } from './color';
import { extractTextRuns } from './text-runs';
import { checkUnsupported } from './unsupported-features';
import { parseSvg } from './svg-parser';

export interface PdfExportWarning {
  message: string;
  elementDescription: string;
}

export type AssetTask =
  | { kind: 'img'; node: ImageNode; element: HTMLImageElement }
  | { kind: 'canvas'; node: ImageNode; element: HTMLCanvasElement }
  | { kind: 'fallback'; node: ImageNode; element: HTMLElement; captureWidthPx: number; captureHeightPx: number };

export interface InspectResult {
  document: DocumentNode;
  assetTasks: AssetTask[];
  warnings: PdfExportWarning[];
}

export interface InspectOptions {
  keepTogetherSelectors: string[];
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export function inspectElement(root: HTMLElement, options: InspectOptions): InspectResult {
  const rootRect = root.getBoundingClientRect();
  const assetTasks: AssetTask[] = [];
  const warnings: PdfExportWarning[] = [];

  const children = walkChildren(root, rootRect, options, assetTasks, warnings);

  return {
    document: {
      flowWidthPt: pxToPt(rootRect.width),
      flowHeightPt: pxToPt(rootRect.height),
      children,
    },
    assetTasks,
    warnings,
  };
}

function relativeRect(elRect: DOMRect, rootRect: DOMRect): Rect {
  return {
    x: pxToPt(elRect.left - rootRect.left),
    y: pxToPt(elRect.top - rootRect.top),
    width: pxToPt(elRect.width),
    height: pxToPt(elRect.height),
  };
}

function walkChildren(
  parent: Element,
  rootRect: DOMRect,
  options: InspectOptions,
  assetTasks: AssetTask[],
  warnings: PdfExportWarning[],
): LayoutNode[] {
  const out: LayoutNode[] = [];
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      out.push(...buildTextNodes(child as Text, parent, rootRect));
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const node = visitElement(child as HTMLElement, rootRect, options, assetTasks, warnings);
      if (node) {
        out.push(node);
      }
    }
  }
  return out;
}

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT']);

function visitElement(
  el: HTMLElement,
  rootRect: DOMRect,
  options: InspectOptions,
  assetTasks: AssetTask[],
  warnings: PdfExportWarning[],
): LayoutNode | null {
  if (SKIP_TAGS.has(el.tagName)) {
    return null;
  }
  const style = getComputedStyle(el);
  if (style.display === 'none') {
    return null;
  }

  const elRect = el.getBoundingClientRect();
  if (elRect.width <= 0 || elRect.height <= 0) {
    return null;
  }
  const rect = relativeRect(elRect, rootRect);
  const visible = style.visibility !== 'hidden' && parseFloat(style.opacity || '1') > 0;
  const forceKeepTogether = options.keepTogetherSelectors.some((sel) => {
    try {
      return el.matches(sel);
    } catch {
      return false;
    }
  });
  const breakRules = readBreakRules(style, forceKeepTogether);

  const tag = el.tagName.toLowerCase();

  if (tag === 'img') {
    return buildImageNode(el as HTMLImageElement, rect, visible, breakRules, assetTasks);
  }
  if (tag === 'canvas') {
    return buildCanvasNode(el as HTMLCanvasElement, rect, visible, breakRules, assetTasks);
  }
  if (tag === 'svg') {
    return buildSvgNode(el as unknown as SVGSVGElement, rect, visible, breakRules, assetTasks, warnings);
  }
  if (tag === 'table') {
    return buildTableNode(el as HTMLTableElement, rootRect, rect, visible, breakRules, options, assetTasks, warnings);
  }

  const unsupported = checkUnsupported(style);
  if (unsupported.unsupported) {
    warnings.push({ message: unsupported.reason!, elementDescription: describeElement(el) });
    return buildFallbackImageNode(el, rect, visible, breakRules, unsupported.reason!, assetTasks, elRect);
  }

  const paint = readBoxPaint(style);
  const children = walkChildren(el, rootRect, options, assetTasks, warnings);
  if (children.length === 0 && !paint.backgroundColor && !paint.borders) {
    return null;
  }

  const clips = style.overflow !== 'visible' && (style.overflowX !== 'visible' || style.overflowY !== 'visible');
  if (clips) {
    const group: GroupNode = {
      id: nextId('group'),
      type: 'group',
      rect,
      visible,
      break: breakRules,
      paint,
      children,
      clip: true,
    };
    return group;
  }

  const node: BlockNode = {
    id: nextId('block'),
    type: 'block',
    rect,
    visible,
    break: breakRules,
    paint,
    children,
  };
  return node;
}

function buildTextNodes(textNode: Text, parentEl: Element, rootRect: DOMRect): TextRunNode[] {
  const raw = extractTextRuns(textNode);
  if (raw.length === 0) {
    return [];
  }
  const style = getComputedStyle(parentEl);
  const font = readFont(style);
  const color = parseComputedColor(style.color) ?? { r: 0, g: 0, b: 0, a: 1 };
  const letterSpacingPt = style.letterSpacing === 'normal' ? 0 : pxToPt(parseFloat(style.letterSpacing || '0') || 0);
  const align = normalizeAlign(style.textAlign, style.direction);
  const decorationLine = (style as any).textDecorationLine || style.textDecoration || '';
  const decoration = {
    underline: decorationLine.includes('underline'),
    lineThrough: decorationLine.includes('line-through'),
  };

  return raw.map((run) => {
    const rect = relativeRect(run.rect, rootRect);
    return {
      id: nextId('text'),
      type: 'text',
      rect,
      visible: style.visibility !== 'hidden',
      break: { breakInside: 'avoid', breakBefore: 'auto', breakAfter: 'auto' },
      text: run.text,
      font,
      color,
      letterSpacingPt,
      align,
      decoration,
      baselineOffsetPt: rect.height * 0.8,
    } as TextRunNode;
  });
}

function readFont(style: CSSStyleDeclaration): ResolvedFont {
  const weight = parseInt(style.fontWeight || '400', 10) || (style.fontWeight === 'bold' ? 700 : 400);
  const fontStyle = style.fontStyle === 'italic' || style.fontStyle === 'oblique' ? 'italic' : 'normal';
  return {
    family: (style.fontFamily || 'sans-serif').split(',')[0].trim().replace(/^["']|["']$/g, ''),
    weight,
    style: fontStyle,
    sizePt: pxToPt(parseFloat(style.fontSize || '16')),
  };
}

function normalizeAlign(textAlign: string, direction: string): 'left' | 'right' | 'center' | 'justify' {
  const isRtl = direction === 'rtl';
  switch (textAlign) {
    case 'center':
      return 'center';
    case 'right':
      return 'right';
    case 'left':
      return 'left';
    case 'justify':
      return 'justify';
    case 'start':
      return isRtl ? 'right' : 'left';
    case 'end':
      return isRtl ? 'left' : 'right';
    default:
      return 'left';
  }
}

function buildImageNode(
  img: HTMLImageElement,
  rect: Rect,
  visible: boolean,
  breakRules: NodeBreakRules,
  assetTasks: AssetTask[],
): ImageNode {
  const style = getComputedStyle(img);
  const node: ImageNode = {
    id: nextId('img'),
    type: 'image',
    rect,
    visible,
    break: breakRules,
    source: { kind: 'url', value: '' },
    fit: (style.objectFit as ImageNode['fit']) || 'fill',
    naturalWidth: img.naturalWidth || img.width,
    naturalHeight: img.naturalHeight || img.height,
    isFallbackRaster: false,
  };
  assetTasks.push({ kind: 'img', node, element: img });
  return node;
}

function buildCanvasNode(
  canvas: HTMLCanvasElement,
  rect: Rect,
  visible: boolean,
  breakRules: NodeBreakRules,
  assetTasks: AssetTask[],
): ImageNode {
  const node: ImageNode = {
    id: nextId('canvas'),
    type: 'image',
    rect,
    visible,
    break: breakRules,
    source: { kind: 'canvas', value: '' },
    fit: 'fill',
    naturalWidth: canvas.width,
    naturalHeight: canvas.height,
    isFallbackRaster: false,
  };
  assetTasks.push({ kind: 'canvas', node, element: canvas });
  return node;
}

function buildSvgNode(
  svg: SVGSVGElement,
  rect: Rect,
  visible: boolean,
  breakRules: NodeBreakRules,
  assetTasks: AssetTask[],
  warnings: PdfExportWarning[],
): SvgNode | ImageNode {
  try {
    const commands = parseSvg(svg, rect.width, rect.height);
    if (commands) {
      return {
        id: nextId('svg'),
        type: 'svg',
        rect,
        visible,
        break: breakRules,
        commands,
        viewBox: rect,
      };
    }
  } catch {
    // fall through to rasterization
  }
  warnings.push({ message: 'This <svg> uses gradients/filters/text/use and is not supported; rasterized.', elementDescription: describeElement(svg as unknown as HTMLElement) });
  return buildFallbackImageNode(svg as unknown as HTMLElement, rect, visible, breakRules, 'unsupported SVG features', assetTasks, svg.getBoundingClientRect());
}

function buildFallbackImageNode(
  el: HTMLElement,
  rect: Rect,
  visible: boolean,
  breakRules: NodeBreakRules,
  reason: string,
  assetTasks: AssetTask[],
  elRect: DOMRect,
): ImageNode {
  const node: ImageNode = {
    id: nextId('fallback'),
    type: 'image',
    rect,
    visible,
    break: breakRules,
    fallback: { reason },
    source: { kind: 'data-url', value: '' },
    fit: 'fill',
    naturalWidth: rect.width,
    naturalHeight: rect.height,
    isFallbackRaster: true,
  };
  // Captured at the element's true on-screen size (not `rect`, which may
  // later be shrunk by fit-to-width scaling) so the clone -- which still
  // carries its original, unscaled inline styles -- isn't clipped inside
  // its own raster. See docs/architecture.md "Hybrid rendering".
  assetTasks.push({ kind: 'fallback', node, element: el, captureWidthPx: elRect.width, captureHeightPx: elRect.height });
  return node;
}

function buildTableNode(
  table: HTMLTableElement,
  rootRect: DOMRect,
  rect: Rect,
  visible: boolean,
  breakRules: NodeBreakRules,
  options: InspectOptions,
  assetTasks: AssetTask[],
  warnings: PdfExportWarning[],
): TableNode {
  const rowEls = Array.from(table.querySelectorAll('tr'));
  const headerRowEls = new Set(Array.from(table.querySelectorAll('thead tr')));

  const rows: TableRowNode[] = rowEls.map((tr) => {
    const trRect = relativeRect(tr.getBoundingClientRect(), rootRect);
    const cellEls = Array.from(tr.children).filter((c) => c.tagName === 'TD' || c.tagName === 'TH');
    const cells: TableCellNode[] = cellEls.map((cellEl) => {
      const cellRect = relativeRect(cellEl.getBoundingClientRect(), rootRect);
      const cellStyle = getComputedStyle(cellEl);
      const paint = readBoxPaint(cellStyle);
      const content = walkChildren(cellEl, rootRect, options, assetTasks, warnings);
      return {
        id: nextId('cell'),
        rect: cellRect,
        isHeader: cellEl.tagName === 'TH',
        paint,
        content,
      };
    });
    return {
      id: nextId('row'),
      rect: trRect,
      isHeader: headerRowEls.has(tr),
      cells,
    };
  });

  const firstBodyRow = rows.find((r) => !r.isHeader) ?? rows[0];
  const columns = (firstBodyRow?.cells ?? []).map((c) => ({ x: c.rect.x, width: c.rect.width }));

  return {
    id: nextId('table'),
    type: 'table',
    rect,
    visible,
    break: breakRules,
    columns,
    rows,
    headerRowCount: rows.filter((r) => r.isHeader).length,
    repeatHeader: true,
  };
}

function describeElement(el: HTMLElement): string {
  const id = el.id ? `#${el.id}` : '';
  const cls = el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).join('.')}` : '';
  return `<${el.tagName.toLowerCase()}${id}${cls}>`;
}
