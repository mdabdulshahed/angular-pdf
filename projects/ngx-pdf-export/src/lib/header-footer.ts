import { LayoutNode, TextRunNode } from './model/nodes';
import { inspectElement } from './dom/inspect';
import { resolveAssets } from './dom/assets';
import { PdfPageContext, PdfExportWarning } from './types';

/**
 * Builds the layout nodes for one page's header or footer callback result.
 * A returned string becomes a single default-styled text run; a returned
 * HTMLElement is run through the same DOM-inspection path as the body
 * (briefly attached off-screen so getBoundingClientRect/getComputedStyle
 * are meaningful), per docs/pagination.md "Headers / footers".
 */
export async function buildHeaderFooterNodes(
  result: string | HTMLElement,
  boxWidthPt: number,
  boxHeightPt: number,
  scale: number,
  onWarning: (w: PdfExportWarning) => void,
): Promise<LayoutNode[]> {
  if (typeof result === 'string') {
    if (!result.trim()) return [];
    const sizePt = 10;
    const node: TextRunNode = {
      id: 'header-footer-text',
      type: 'text',
      rect: { x: 0, y: 0, width: boxWidthPt, height: boxHeightPt },
      visible: true,
      break: { breakInside: 'avoid', breakBefore: 'auto', breakAfter: 'auto' },
      text: result,
      font: { family: 'Helvetica', weight: 400, style: 'normal', sizePt },
      color: { r: 80, g: 80, b: 80, a: 1 },
      letterSpacingPt: 0,
      align: 'left',
      decoration: { underline: false, lineThrough: false },
      baselineOffsetPt: boxHeightPt / 2 + sizePt * 0.35,
    };
    return [node];
  }

  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.top = '0';
  host.style.left = '-99999px';
  host.style.width = `${boxWidthPt / 0.75}px`;
  host.appendChild(result);
  document.body.appendChild(host);

  try {
    const { document: doc, assetTasks, warnings } = inspectElement(result, { keepTogetherSelectors: [] });
    warnings.forEach(onWarning);
    await resolveAssets(assetTasks, scale, onWarning);
    return doc.children;
  } finally {
    document.body.removeChild(host);
  }
}

export function pageContext(pageNumber: number, pageCount: number): PdfPageContext {
  return { pageNumber, pageCount };
}
