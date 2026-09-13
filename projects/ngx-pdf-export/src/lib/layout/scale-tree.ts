import { DocumentNode, LayoutNode, Rect, SvgDrawCommand, TableCellNode, TableRowNode } from '../model/nodes';
import { scalePathData } from '../dom/svg-path';

/**
 * Uniformly shrinks the whole captured flow (never enlarges) so its width
 * fits the page's content width, the same "shrink to fit" behavior a
 * browser's own print dialog applies to an over-wide page. Without this,
 * any dashboard wider than the chosen page format (a very common case --
 * most web layouts are wider than A4) would simply be clipped at the page
 * edge. Every geometric quantity in the tree (rects, font sizes, border
 * widths/radii, SVG coordinates) is scaled together so nothing distorts.
 */
export function fitDocumentToWidth(doc: DocumentNode, contentWidthPt: number): number {
  if (doc.flowWidthPt <= contentWidthPt || doc.flowWidthPt <= 0) {
    return 1;
  }
  const scale = contentWidthPt / doc.flowWidthPt;
  doc.flowWidthPt *= scale;
  doc.flowHeightPt *= scale;
  doc.children.forEach((child) => scaleNode(child, scale));
  return scale;
}

function scaleRect(rect: Rect, scale: number): Rect {
  return { x: rect.x * scale, y: rect.y * scale, width: rect.width * scale, height: rect.height * scale };
}

function scaleNode(node: LayoutNode, scale: number): void {
  node.rect = scaleRect(node.rect, scale);

  switch (node.type) {
    case 'text':
      node.font = { ...node.font, sizePt: node.font.sizePt * scale };
      node.letterSpacingPt *= scale;
      node.baselineOffsetPt *= scale;
      return;
    case 'image':
      node.naturalWidth *= scale;
      node.naturalHeight *= scale;
      return;
    case 'svg':
      node.commands = node.commands.map((cmd) => scaleSvgCommand(cmd, scale));
      node.viewBox = scaleRect(node.viewBox, scale);
      return;
    case 'block':
    case 'group':
      scalePaintBorders(node, scale);
      node.children.forEach((child) => scaleNode(child, scale));
      return;
    case 'table':
      node.columns = node.columns.map((c) => ({ x: c.x * scale, width: c.width * scale }));
      node.rows = node.rows.map((row) => scaleTableRow(row, scale));
      return;
  }
}

function scaleTableRow(row: TableRowNode, scale: number): TableRowNode {
  return {
    ...row,
    rect: scaleRect(row.rect, scale),
    cells: row.cells.map((cell) => scaleTableCell(cell, scale)),
  };
}

function scaleTableCell(cell: TableCellNode, scale: number): TableCellNode {
  scalePaintBorders(cell as unknown as { paint: TableCellNode['paint'] }, scale);
  return {
    ...cell,
    rect: scaleRect(cell.rect, scale),
    content: cell.content.map((child) => {
      scaleNode(child, scale);
      return child;
    }),
  };
}

function scalePaintBorders(node: { paint: { borders?: any; borderRadius?: any } }, scale: number): void {
  const paint = node.paint;
  if (paint.borders) {
    for (const edge of Object.values(paint.borders) as any[]) {
      edge.widthPt *= scale;
    }
  }
  if (paint.borderRadius) {
    for (const key of Object.keys(paint.borderRadius)) {
      paint.borderRadius[key] *= scale;
    }
  }
}

function scaleSvgCommand(cmd: SvgDrawCommand, scale: number): SvgDrawCommand {
  const paint = { ...cmd.paint, strokeWidthPt: cmd.paint.strokeWidthPt * scale };
  switch (cmd.op) {
    case 'rect':
      return { ...cmd, x: cmd.x * scale, y: cmd.y * scale, width: cmd.width * scale, height: cmd.height * scale, rx: cmd.rx * scale, ry: cmd.ry * scale, paint };
    case 'ellipse':
      return { ...cmd, cx: cmd.cx * scale, cy: cmd.cy * scale, rx: cmd.rx * scale, ry: cmd.ry * scale, paint };
    case 'line':
      return { ...cmd, x1: cmd.x1 * scale, y1: cmd.y1 * scale, x2: cmd.x2 * scale, y2: cmd.y2 * scale, paint };
    case 'path':
      return { ...cmd, d: scalePathData(cmd.d, scale, scale), paint, originOffsetXPt: cmd.originOffsetXPt * scale, originOffsetYPt: cmd.originOffsetYPt * scale };
  }
}
