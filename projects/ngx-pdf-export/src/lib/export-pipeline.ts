import { inspectElement } from './dom/inspect';
import { resolveAssets } from './dom/assets';
import { fitDocumentToWidth } from './layout/scale-tree';
import { paginate, flattenLayoutNodes } from './pagination/paginate';
import { resolvePageGeometry } from './pagination/page-geometry';
import { renderPdf, RenderGeometry } from './render/pdf-renderer';
import { buildHeaderFooterNodes, pageContext } from './header-footer';
import { FontRegistry } from './fonts/font-registry';
import { PdfExportOptions, PdfExportWarning } from './types';

export async function runExport(root: HTMLElement, options: PdfExportOptions, fontRegistry: FontRegistry): Promise<Blob> {
  validateTarget(root);

  const warnings: PdfExportWarning[] = [];
  const onWarning = (w: PdfExportWarning) => {
    warnings.push(w);
    options.onWarning?.(w);
    // eslint-disable-next-line no-console
    console.warn(`[ngx-pdf-export] ${w.message} (${w.elementDescription})`);
  };

  const scale = options.scale ?? 2;
  const headerHeightPt = options.header ? options.headerHeight ?? 24 : 0;
  const footerHeightPt = options.footer ? options.footerHeight ?? 24 : 0;

  const geometry = resolvePageGeometry(options.format, options.orientation, options.margin, headerHeightPt, footerHeightPt);

  const { document: doc, assetTasks, warnings: inspectWarnings } = inspectElement(root, {
    keepTogetherSelectors: options.keepTogether ?? [],
  });
  inspectWarnings.forEach(onWarning);

  const fitScale = fitDocumentToWidth(doc, geometry.contentWidthPt);
  if (fitScale < 1) {
    onWarning({ message: `Content is wider than the page (by ${Math.round((1 / fitScale - 1) * 100)}%) and was scaled down to fit.`, elementDescription: `<${root.tagName.toLowerCase()}>` });
  }

  await resolveAssets(assetTasks, scale, onWarning);

  if (options.repeatTableHeaders === false) {
    disableTableHeaderRepeat(doc.children as any);
  }

  const paginated = paginate(doc, { contentHeightPt: geometry.contentHeightPt });
  const pageCount = paginated.pages.length || 1;

  const bodyGeometry: RenderGeometry = {
    widthPt: geometry.widthPt,
    heightPt: geometry.heightPt,
    marginTopPt: geometry.margin.top + headerHeightPt,
    marginLeftPt: geometry.margin.left,
  };

  let headerFooter: Parameters<typeof renderPdf>[3];
  if (options.header || options.footer) {
    const headerGeometry: RenderGeometry = { widthPt: geometry.widthPt, heightPt: geometry.heightPt, marginTopPt: geometry.margin.top, marginLeftPt: geometry.margin.left };
    const footerGeometry: RenderGeometry = { widthPt: geometry.widthPt, heightPt: geometry.heightPt, marginTopPt: geometry.heightPt - geometry.margin.bottom - footerHeightPt, marginLeftPt: geometry.margin.left };

    const headerPrimitivesPerPage = options.header
      ? await Promise.all(
          Array.from({ length: pageCount }, (_, i) => i).map(async (i) => {
            const result = options.header!(pageContext(i + 1, pageCount));
            const nodes = await buildHeaderFooterNodes(result, geometry.contentWidthPt, headerHeightPt, scale, onWarning);
            return flattenLayoutNodes(nodes);
          }),
        )
      : undefined;

    const footerPrimitivesPerPage = options.footer
      ? await Promise.all(
          Array.from({ length: pageCount }, (_, i) => i).map(async (i) => {
            const result = options.footer!(pageContext(i + 1, pageCount));
            const nodes = await buildHeaderFooterNodes(result, geometry.contentWidthPt, footerHeightPt, scale, onWarning);
            return flattenLayoutNodes(nodes);
          }),
        )
      : undefined;

    headerFooter = { headerPrimitivesPerPage, footerPrimitivesPerPage, headerGeometry, footerGeometry };
  }

  const bytes = await renderPdf(
    paginated.pages,
    fontRegistry,
    { geometry: bodyGeometry, debug: !!options.debug, onWarning },
    headerFooter,
  );

  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}

function validateTarget(root: HTMLElement | null | undefined): asserts root is HTMLElement {
  if (!root) {
    throw new Error('ngx-pdf-export: export target not found.');
  }
  if (!root.isConnected) {
    throw new Error('ngx-pdf-export: export target is not attached to the document. The element must be rendered (not display:none, not in a detached view) at export time.');
  }
  const rect = root.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    throw new Error('ngx-pdf-export: export target has zero width or height.');
  }
}

function disableTableHeaderRepeat(nodes: import('./model/nodes').LayoutNode[]): void {
  for (const node of nodes) {
    if (node.type === 'table') {
      node.repeatHeader = false;
    } else if (node.type === 'block' || node.type === 'group') {
      disableTableHeaderRepeat(node.children);
    }
  }
}
