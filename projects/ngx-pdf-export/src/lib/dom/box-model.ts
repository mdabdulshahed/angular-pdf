import { BorderEdge, BorderRadius, BorderStyle, BoxBorders, BoxPaint } from '../model/nodes';
import { pxToPt } from '../model/units';
import { isTransparent, parseComputedColor } from './color';

export function readBoxPaint(style: CSSStyleDeclaration): BoxPaint {
  const backgroundColor = parseComputedColor(style.backgroundColor);
  const opacity = clamp01(parseFloat(style.opacity || '1'));

  const paint: BoxPaint = {
    opacity: Number.isFinite(opacity) ? opacity : 1,
  };

  if (backgroundColor && !isTransparent(backgroundColor)) {
    paint.backgroundColor = backgroundColor;
  }

  const borders = readBorders(style);
  if (borders) {
    paint.borders = borders;
  }

  const radius = readBorderRadius(style);
  if (radius) {
    paint.borderRadius = radius;
  }

  return paint;
}

function readBorders(style: CSSStyleDeclaration): BoxBorders | undefined {
  const top = readEdge(style, 'Top');
  const right = readEdge(style, 'Right');
  const bottom = readEdge(style, 'Bottom');
  const left = readEdge(style, 'Left');

  const hasAny = [top, right, bottom, left].some((e) => e.style !== 'none' && e.widthPt > 0);
  if (!hasAny) {
    return undefined;
  }
  return { top, right, bottom, left };
}

function readEdge(style: CSSStyleDeclaration, side: 'Top' | 'Right' | 'Bottom' | 'Left'): BorderEdge {
  const widthPx = parseFloat((style as any)[`border${side}Width`] || '0');
  const borderStyle = normalizeBorderStyle((style as any)[`border${side}Style`]);
  const color = parseComputedColor((style as any)[`border${side}Color`]) ?? { r: 0, g: 0, b: 0, a: 1 };
  return {
    widthPt: borderStyle === 'none' ? 0 : pxToPt(widthPx || 0),
    style: borderStyle,
    color,
  };
}

function normalizeBorderStyle(value: string | undefined): BorderStyle {
  switch (value) {
    case 'dashed':
      return 'dashed';
    case 'dotted':
      return 'dotted';
    case 'solid':
    case 'double':
    case 'groove':
    case 'ridge':
    case 'inset':
    case 'outset':
      return 'solid';
    default:
      return 'none';
  }
}

function readBorderRadius(style: CSSStyleDeclaration): BorderRadius | undefined {
  const topLeft = pxToPt(parseFloat(style.borderTopLeftRadius || '0'));
  const topRight = pxToPt(parseFloat(style.borderTopRightRadius || '0'));
  const bottomRight = pxToPt(parseFloat(style.borderBottomRightRadius || '0'));
  const bottomLeft = pxToPt(parseFloat(style.borderBottomLeftRadius || '0'));
  if (!topLeft && !topRight && !bottomRight && !bottomLeft) {
    return undefined;
  }
  return { topLeft, topRight, bottomRight, bottomLeft };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
