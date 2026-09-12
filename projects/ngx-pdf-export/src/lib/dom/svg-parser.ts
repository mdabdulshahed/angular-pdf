import { RgbaColor, SvgDrawCommand, SvgPaint } from '../model/nodes';
import { pxToPt } from '../model/units';
import { parseComputedColor } from './color';
import { scalePathData } from './svg-path';

const SUPPORTED_TAGS = new Set(['rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'g', 'svg']);

/**
 * Parses a supported subset of SVG into scale-normalized draw commands.
 * Returns null if the subtree uses a feature we don't translate (gradient
 * fill, <text>, <use>, <clipPath>, filters, patterns, images) -- the
 * caller falls back to rasterizing the whole <svg> as one element. See
 * docs/css-support.md.
 */
export function parseSvg(svg: SVGSVGElement, renderedWidthPt: number, renderedHeightPt: number): SvgDrawCommand[] | null {
  const viewBox = svg.viewBox?.baseVal;
  const vbWidth = viewBox && viewBox.width > 0 ? viewBox.width : svg.width.baseVal.value || renderedWidthPt;
  const vbHeight = viewBox && viewBox.height > 0 ? viewBox.height : svg.height.baseVal.value || renderedHeightPt;
  const vbX = viewBox?.x ?? 0;
  const vbY = viewBox?.y ?? 0;

  const sx = vbWidth > 0 ? renderedWidthPt / vbWidth : 1;
  const sy = vbHeight > 0 ? renderedHeightPt / vbHeight : 1;

  const commands: SvgDrawCommand[] = [];
  const ok = walk(svg, sx, sy, vbX, vbY, commands);
  return ok ? commands : null;
}

function walk(el: Element, sx: number, sy: number, vbX: number, vbY: number, out: SvgDrawCommand[]): boolean {
  for (const child of Array.from(el.children)) {
    const tag = child.tagName.toLowerCase();
    if (!SUPPORTED_TAGS.has(tag)) {
      return false;
    }
    if (tag === 'g' || tag === 'svg') {
      if (!walk(child, sx, sy, vbX, vbY, out)) {
        return false;
      }
      continue;
    }

    const style = getComputedStyle(child);
    if (hasGradientOrPattern(style.fill) || hasGradientOrPattern(style.stroke)) {
      return false;
    }

    const paint = readSvgPaint(style);

    switch (tag) {
      case 'rect': {
        const r = child as SVGRectElement;
        out.push({
          op: 'rect',
          x: (num(r, 'x') - vbX) * sx,
          y: (num(r, 'y') - vbY) * sy,
          width: num(r, 'width') * sx,
          height: num(r, 'height') * sy,
          rx: num(r, 'rx') * sx,
          ry: num(r, 'ry') * sy,
          paint,
        });
        break;
      }
      case 'circle': {
        const c = child as SVGCircleElement;
        const rr = num(c, 'r');
        out.push({
          op: 'ellipse',
          cx: (num(c, 'cx') - vbX) * sx,
          cy: (num(c, 'cy') - vbY) * sy,
          rx: rr * sx,
          ry: rr * sy,
          paint,
        });
        break;
      }
      case 'ellipse': {
        const e = child as SVGEllipseElement;
        out.push({
          op: 'ellipse',
          cx: (num(e, 'cx') - vbX) * sx,
          cy: (num(e, 'cy') - vbY) * sy,
          rx: num(e, 'rx') * sx,
          ry: num(e, 'ry') * sy,
          paint,
        });
        break;
      }
      case 'line': {
        const l = child as SVGLineElement;
        out.push({
          op: 'line',
          x1: (num(l, 'x1') - vbX) * sx,
          y1: (num(l, 'y1') - vbY) * sy,
          x2: (num(l, 'x2') - vbX) * sx,
          y2: (num(l, 'y2') - vbY) * sy,
          paint,
        });
        break;
      }
      case 'polyline':
      case 'polygon': {
        const points = (child.getAttribute('points') || '').trim();
        if (!points) break;
        const d = pointsToPathData(points, tag === 'polygon');
        out.push({ op: 'path', d: scalePathData(offsetPathOrigin(d, vbX, vbY), sx, sy), paint });
        break;
      }
      case 'path': {
        const d = child.getAttribute('d') || '';
        if (!d) break;
        out.push({ op: 'path', d: scalePathData(d, sx, sy), paint });
        break;
      }
    }
  }
  return true;
}

function hasGradientOrPattern(paintRef: string): boolean {
  return paintRef.startsWith('url(');
}

function readSvgPaint(style: CSSStyleDeclaration): SvgPaint {
  const fillOpacity = parseFloat(style.fillOpacity || '1');
  const strokeOpacity = parseFloat(style.strokeOpacity || '1');
  const opacity = parseFloat(style.opacity || '1');

  const fillColor = style.fill && style.fill !== 'none' ? withAlpha(parseComputedColor(style.fill), fillOpacity) : undefined;
  const strokeColor = style.stroke && style.stroke !== 'none' ? withAlpha(parseComputedColor(style.stroke), strokeOpacity) : undefined;

  return {
    fill: fillColor,
    stroke: strokeColor,
    strokeWidthPt: pxToPt(parseFloat(style.strokeWidth || '0')),
    opacity: Number.isFinite(opacity) ? opacity : 1,
  };
}

function withAlpha(color: RgbaColor | undefined, alphaMultiplier: number): RgbaColor | undefined {
  if (!color) return undefined;
  return { ...color, a: color.a * (Number.isFinite(alphaMultiplier) ? alphaMultiplier : 1) };
}

function num(el: Element, attr: string): number {
  const v = (el as any)[attr]?.baseVal?.value;
  if (typeof v === 'number') return v;
  return parseFloat(el.getAttribute(attr) || '0') || 0;
}

function pointsToPathData(points: string, close: boolean): string {
  const coords = points.split(/[\s,]+/).filter(Boolean).map(Number);
  let d = '';
  for (let i = 0; i < coords.length - 1; i += 2) {
    d += (i === 0 ? 'M' : 'L') + coords[i] + ' ' + coords[i + 1] + ' ';
  }
  return close ? d + 'Z' : d;
}

function offsetPathOrigin(d: string, vbX: number, vbY: number): string {
  if (!vbX && !vbY) return d;
  // Points already carry absolute coordinates; shift by viewBox origin using the same scaler with a translate pass.
  return d.replace(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g, (_m, x, y) => `${Number(x) - vbX} ${Number(y) - vbY}`);
}
