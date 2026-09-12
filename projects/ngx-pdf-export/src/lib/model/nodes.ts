/**
 * Framework-independent internal document/layout tree.
 * See docs/architecture.md and docs/layout-engine.md.
 *
 * All geometry on these nodes is in *layout space*: PDF points, y-down,
 * origin at the top-left of the captured root element (a single tall
 * "flow" -- pagination has not happened yet at this stage).
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RgbaColor {
  r: number; // 0-255
  g: number; // 0-255
  b: number; // 0-255
  a: number; // 0-1
}

export type BorderStyle = 'solid' | 'dashed' | 'dotted' | 'none';

export interface BorderEdge {
  widthPt: number;
  style: BorderStyle;
  color: RgbaColor;
}

export interface BoxBorders {
  top: BorderEdge;
  right: BorderEdge;
  bottom: BorderEdge;
  left: BorderEdge;
}

export interface BorderRadius {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
}

export interface BoxPaint {
  backgroundColor?: RgbaColor;
  backgroundImage?: { dataUrl: string; fit: 'cover' | 'contain' | 'fill' };
  borders?: BoxBorders;
  borderRadius?: BorderRadius;
  opacity: number; // 0-1, default 1
}

export type BreakRule = 'auto' | 'avoid' | 'page-before' | 'page-after';

export interface NodeBreakRules {
  breakInside: 'auto' | 'avoid';
  breakBefore: 'auto' | 'page';
  breakAfter: 'auto' | 'page';
}

export const DEFAULT_BREAK_RULES: NodeBreakRules = {
  breakInside: 'auto',
  breakBefore: 'auto',
  breakAfter: 'auto',
};

export type LayoutNode =
  | BlockNode
  | TextRunNode
  | ImageNode
  | SvgNode
  | TableNode
  | GroupNode;

export interface BaseNode {
  id: string;
  rect: Rect;
  visible: boolean;
  break: NodeBreakRules;
  /** Present when this node replaced an unsupported subtree. */
  fallback?: { reason: string };
}

export interface BlockNode extends BaseNode {
  type: 'block';
  paint: BoxPaint;
  children: LayoutNode[];
}

export interface GroupNode extends BaseNode {
  type: 'group';
  paint: BoxPaint;
  children: LayoutNode[];
  /** Clip children painting to `rect` -- from overflow: hidden/auto/scroll. */
  clip: boolean;
}

export interface TextRunNode extends BaseNode {
  type: 'text';
  text: string;
  font: ResolvedFont;
  color: RgbaColor;
  letterSpacingPt: number;
  align: 'left' | 'right' | 'center' | 'justify';
  decoration: { underline: boolean; lineThrough: boolean };
  /** Baseline offset from rect.y (top of the line box), in pt. */
  baselineOffsetPt: number;
}

export interface ResolvedFont {
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  sizePt: number;
}

export interface ImageNode extends BaseNode {
  type: 'image';
  source: { kind: 'url' | 'data-url' | 'canvas'; value: string };
  fit: 'cover' | 'contain' | 'fill' | 'none';
  naturalWidth: number;
  naturalHeight: number;
  isFallbackRaster: boolean;
}

export type SvgDrawCommand =
  | { op: 'rect'; x: number; y: number; width: number; height: number; rx: number; ry: number; paint: SvgPaint }
  | { op: 'ellipse'; cx: number; cy: number; rx: number; ry: number; paint: SvgPaint }
  | { op: 'path'; d: string; paint: SvgPaint }
  | { op: 'line'; x1: number; y1: number; x2: number; y2: number; paint: SvgPaint };

export interface SvgPaint {
  fill?: RgbaColor;
  stroke?: RgbaColor;
  strokeWidthPt: number;
  opacity: number;
}

export interface SvgNode extends BaseNode {
  type: 'svg';
  /** Commands in the SVG's own local coordinate space (viewBox units, pt-scaled). */
  commands: SvgDrawCommand[];
  viewBox: Rect;
}

export interface TableCellNode {
  id: string;
  rect: Rect;
  isHeader: boolean;
  paint: BoxPaint;
  content: LayoutNode[];
}

export interface TableRowNode {
  id: string;
  rect: Rect;
  isHeader: boolean;
  cells: TableCellNode[];
}

export interface TableColumn {
  x: number;
  width: number;
}

export interface TableNode extends BaseNode {
  type: 'table';
  columns: TableColumn[];
  rows: TableRowNode[];
  headerRowCount: number;
  repeatHeader: boolean;
}

export interface DocumentNode {
  /** Total height of the captured flow, in pt -- before pagination. */
  flowWidthPt: number;
  flowHeightPt: number;
  children: LayoutNode[];
}

export function isContainer(node: LayoutNode): node is BlockNode | GroupNode {
  return node.type === 'block' || node.type === 'group';
}
