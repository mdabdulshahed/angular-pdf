import { BlockNode, DocumentNode, GroupNode, ImageNode, LayoutNode, Rect, SvgNode, TableNode, TableRowNode, TextRunNode } from '../model/nodes';

/**
 * See docs/pagination.md. Implementation strategy: walk the tree in visual
 * (document) order while maintaining one monotonically-increasing scalar
 * `shift` -- the total extra vertical space injected so far by page
 * breaks. Every node's page-slotted position is `node.rect.y + shift`;
 * pushing a node to a later page is just increasing `shift` by however
 * much is needed to move it past the current page boundary. Because the
 * shift is global and applied to everything from that point in document
 * order onward, later siblings/containers automatically account for it --
 * there is no separate "cursor" data structure to keep in sync.
 */
export interface PageContentBox {
  contentHeightPt: number;
}

export type PagePrimitive =
  | { kind: 'block'; rect: Rect; node: BlockNode | GroupNode; clip?: Rect }
  | { kind: 'text'; rect: Rect; node: TextRunNode; clip?: Rect }
  | { kind: 'image'; rect: Rect; node: ImageNode; clip?: Rect }
  | { kind: 'svg'; rect: Rect; node: SvgNode; clip?: Rect };

export interface Page {
  primitives: PagePrimitive[];
}

export interface PaginatedDocument {
  pages: Page[];
}

interface State {
  shift: number;
  hasPlaced: boolean;
  lastPageTouched: number;
}

const EPS = 0.01;

export function paginate(doc: DocumentNode, contentBox: PageContentBox): PaginatedDocument {
  const CH = contentBox.contentHeightPt;
  const pages: Page[] = [];
  const state: State = { shift: 0, hasPlaced: false, lastPageTouched: -1 };

  const ensurePage = (idx: number): Page => {
    while (pages.length <= idx) pages.push({ primitives: [] });
    return pages[idx];
  };

  const clipForPage = (clip: Rect | undefined, page: number): Rect | undefined => (clip ? { ...clip, y: clip.y - page * CH } : undefined);

  /** Places an atomic node (never split): moves it whole to the next page if it straddles a boundary or has a forced break-before. */
  function pushAtomic(rect: Rect, breakBefore: 'auto' | 'page'): { page: number; localY: number } {
    let adjustedY = rect.y + state.shift;
    let page = Math.floor(adjustedY / CH);

    if (breakBefore === 'page' && state.hasPlaced && page === state.lastPageTouched) {
      state.shift += (state.lastPageTouched + 1) * CH - adjustedY;
      adjustedY = rect.y + state.shift;
      page = Math.floor(adjustedY / CH);
    }

    const endPage = Math.floor((adjustedY + rect.height - EPS) / CH);
    if (endPage !== page) {
      state.shift += (page + 1) * CH - adjustedY;
      adjustedY = rect.y + state.shift;
      page = Math.floor(adjustedY / CH);
    }

    state.hasPlaced = true;
    state.lastPageTouched = page;
    ensurePage(page);
    return { page, localY: adjustedY - page * CH };
  }

  function forceBreakAfter(bottomAdjusted: number): void {
    const bottomPage = Math.floor((bottomAdjusted - EPS) / CH);
    state.shift += (bottomPage + 1) * CH - bottomAdjusted;
    state.lastPageTouched = bottomPage + 1;
  }

  function placeContainerBackground(node: BlockNode | GroupNode, adjustedTop: number, adjustedBottom: number, clip: Rect | undefined): void {
    const hasPaint = !!(node.paint.backgroundColor || node.paint.borders || node.paint.backgroundImage);
    if (!hasPaint) return;
    const firstPage = Math.max(0, Math.floor(adjustedTop / CH));
    const lastPage = Math.floor((adjustedBottom - EPS) / CH);
    for (let p = firstPage; p <= lastPage; p++) {
      const pageTop = p * CH;
      const pageBottom = pageTop + CH;
      const vTop = Math.max(adjustedTop, pageTop);
      const vBottom = Math.min(adjustedBottom, pageBottom);
      if (vBottom <= vTop) continue;
      const rect: Rect = { x: node.rect.x, y: vTop - pageTop, width: node.rect.width, height: vBottom - vTop };
      ensurePage(p).primitives.push({ kind: 'block', rect, node, clip: clipForPage(clip, p) });
    }
  }

  function placeMedia(node: ImageNode | SvgNode, clip: Rect | undefined): void {
    if (node.rect.height <= CH) {
      const { page, localY } = pushAtomic(node.rect, node.break.breakBefore);
      ensurePage(page).primitives.push({ kind: node.type, rect: { ...node.rect, y: localY }, node, clip: clipForPage(clip, page) } as PagePrimitive);
      if (node.break.breakAfter === 'page') forceBreakAfter(page * CH + localY + node.rect.height);
      return;
    }
    // Oversized media: clip a slice onto every page it intersects (docs/pagination.md step 3).
    const adjustedTop = node.rect.y + state.shift;
    const adjustedBottom = adjustedTop + node.rect.height;
    state.hasPlaced = true;
    const firstPage = Math.max(0, Math.floor(adjustedTop / CH));
    const lastPage = Math.floor((adjustedBottom - EPS) / CH);
    for (let p = firstPage; p <= lastPage; p++) {
      const pageTop = p * CH;
      const pageBottom = pageTop + CH;
      const vTop = Math.max(adjustedTop, pageTop);
      const vBottom = Math.min(adjustedBottom, pageBottom);
      if (vBottom <= vTop) continue;
      const rect: Rect = { x: node.rect.x, y: vTop - pageTop, width: node.rect.width, height: vBottom - vTop };
      ensurePage(p).primitives.push({ kind: node.type, rect, node, clip: clipForPage(clip, p) } as PagePrimitive);
    }
    state.lastPageTouched = lastPage;
  }

  function placeNode(node: LayoutNode, clip: Rect | undefined): void {
    if (!node.visible) return;

    if (node.type === 'text') {
      const { page, localY } = pushAtomic(node.rect, node.break.breakBefore);
      ensurePage(page).primitives.push({ kind: 'text', rect: { ...node.rect, y: localY }, node, clip: clipForPage(clip, page) });
      if (node.break.breakAfter === 'page') forceBreakAfter(page * CH + localY + node.rect.height);
      return;
    }

    if (node.type === 'image' || node.type === 'svg') {
      placeMedia(node, clip);
      return;
    }

    if (node.type === 'table') {
      placeTable(node, clip);
      return;
    }

    // block | group
    const keepTogether = node.break.breakInside === 'avoid';
    const fitsOnePage = node.rect.height <= CH;

    if (keepTogether && fitsOnePage) {
      const { page, localY } = pushAtomic(node.rect, node.break.breakBefore);
      const adjustedTop = page * CH + localY;
      const adjustedBottom = adjustedTop + node.rect.height;
      placeContainerBackground(node, adjustedTop, adjustedBottom, clip);
      const childClip = node.type === 'group' && node.clip ? { x: node.rect.x, y: adjustedTop, width: node.rect.width, height: node.rect.height } : clip;
      for (const child of node.children) placeNode(child, childClip);
      if (node.break.breakAfter === 'page') forceBreakAfter(adjustedBottom);
      return;
    }

    // A keepTogether node taller than a full page can't actually be kept together;
    // it falls through to normal per-child splitting below.
    if (node.break.breakBefore === 'page') {
      const adjustedY = node.rect.y + state.shift;
      const page = Math.floor(adjustedY / CH);
      if (state.hasPlaced && page === state.lastPageTouched) {
        state.shift += (state.lastPageTouched + 1) * CH - adjustedY;
      }
    }

    const shiftAtStart = state.shift;
    const adjustedTop = node.rect.y + shiftAtStart;
    const childClip = node.type === 'group' && node.clip ? { x: node.rect.x, y: adjustedTop, width: node.rect.width, height: node.rect.height } : clip;
    for (const child of node.children) placeNode(child, childClip);
    const shiftAtEnd = state.shift;
    const adjustedBottom = node.rect.y + node.rect.height + shiftAtEnd;
    placeContainerBackground(node, adjustedTop, adjustedBottom, clip);
    state.hasPlaced = true;

    if (node.break.breakAfter === 'page') {
      forceBreakAfter(adjustedBottom);
    } else {
      state.lastPageTouched = Math.max(state.lastPageTouched, Math.floor((adjustedBottom - EPS) / CH));
    }
  }

  function emitFixed(node: LayoutNode, page: number, dy: number, clip: Rect | undefined): void {
    const rect = { ...node.rect, y: node.rect.y + dy };
    if (node.type === 'text' || node.type === 'image' || node.type === 'svg') {
      ensurePage(page).primitives.push({ kind: node.type, rect, node, clip: clipForPage(clip, page) } as PagePrimitive);
    } else if (node.type === 'block' || node.type === 'group') {
      if (node.paint.backgroundColor || node.paint.borders || node.paint.backgroundImage) {
        ensurePage(page).primitives.push({ kind: 'block', rect, node, clip: clipForPage(clip, page) });
      }
      for (const child of node.children) emitFixed(child, page, dy, clip);
    }
  }

  function placeRowVisual(row: TableRowNode, page: number, localY: number, clip: Rect | undefined): void {
    ensurePage(page);
    const dy = localY - row.rect.y;
    for (const cell of row.cells) {
      if (cell.paint.backgroundColor || cell.paint.borders) {
        const rect: Rect = { x: cell.rect.x, y: localY, width: cell.rect.width, height: row.rect.height };
        const fakeCellBlock: BlockNode = { id: cell.id, type: 'block', rect, visible: true, break: { breakInside: 'avoid', breakBefore: 'auto', breakAfter: 'auto' }, paint: cell.paint, children: [] };
        ensurePage(page).primitives.push({ kind: 'block', rect, node: fakeCellBlock, clip: clipForPage(clip, page) });
      }
      for (const child of cell.content) emitFixed(child, page, dy, clip);
    }
  }

  function placeTable(table: TableNode, clip: Rect | undefined): void {
    const headerRows = table.rows.filter((r) => r.isHeader);
    const bodyRows = table.rows.filter((r) => !r.isHeader);
    let previousBodyPage = -1;

    for (const hRow of headerRows) {
      const { page, localY } = pushAtomic(hRow.rect, 'auto');
      placeRowVisual(hRow, page, localY, clip);
      previousBodyPage = page;
    }

    for (const row of bodyRows) {
      const { page, localY } = pushAtomic(row.rect, 'auto');
      let finalLocalY = localY;

      if (table.repeatHeader && headerRows.length > 0 && page !== previousBodyPage) {
        let offset = 0;
        for (const hRow of headerRows) {
          placeRowVisual(hRow, page, offset, clip);
          offset += hRow.rect.height;
        }
        if (localY < offset) {
          state.shift += offset - localY;
          finalLocalY = offset;
          state.lastPageTouched = page;
        }
      }

      placeRowVisual(row, page, finalLocalY, clip);
      previousBodyPage = page;
    }
  }

  for (const child of doc.children) placeNode(child, undefined);
  return { pages };
}

/**
 * Flattens a small, self-contained node list (header/footer content) into
 * primitives with no page-break logic -- used for content that is assumed
 * to fit within its own reserved header/footer box. See docs/pagination.md
 * "Headers / footers".
 */
export function flattenLayoutNodes(nodes: LayoutNode[]): PagePrimitive[] {
  const out: PagePrimitive[] = [];
  const visit = (node: LayoutNode): void => {
    if (!node.visible) return;
    if (node.type === 'text' || node.type === 'image' || node.type === 'svg') {
      out.push({ kind: node.type, rect: node.rect, node } as PagePrimitive);
    } else if (node.type === 'table') {
      for (const row of node.rows) {
        for (const cell of row.cells) {
          cell.content.forEach(visit);
        }
      }
    } else {
      if (node.paint.backgroundColor || node.paint.borders || node.paint.backgroundImage) {
        out.push({ kind: 'block', rect: node.rect, node });
      }
      for (const child of node.children) visit(child);
    }
  };
  for (const node of nodes) visit(node);
  return out;
}
