import { MarginSpec, PageFormat } from '../types';
import { mmToPt, pxToPt, STANDARD_PAGE_SIZES_PT } from '../model/units';

export interface ResolvedPageGeometry {
  widthPt: number;
  heightPt: number;
  margin: MarginSpec; // pt
  contentWidthPt: number;
  contentHeightPt: number;
}

export function resolvePageGeometry(
  format: PageFormat | undefined,
  orientation: 'portrait' | 'landscape' | undefined,
  margin: number | Partial<MarginSpec> | undefined,
  extraTopPt: number,
  extraBottomPt: number,
): ResolvedPageGeometry {
  let widthPt: number;
  let heightPt: number;

  if (!format || format === 'A4') {
    ({ widthPt, heightPt } = STANDARD_PAGE_SIZES_PT['A4']);
  } else if (typeof format === 'string') {
    const preset = STANDARD_PAGE_SIZES_PT[format];
    if (!preset) throw new Error(`ngx-pdf-export: unknown page format "${format}".`);
    ({ widthPt, heightPt } = preset);
  } else {
    const unit = format.unit ?? 'mm';
    const convert = unit === 'pt' ? (n: number) => n : unit === 'px' ? pxToPt : mmToPt;
    widthPt = convert(format.width);
    heightPt = convert(format.height);
  }

  if (orientation === 'landscape' && widthPt < heightPt) {
    [widthPt, heightPt] = [heightPt, widthPt];
  } else if (orientation === 'portrait' && widthPt > heightPt) {
    [widthPt, heightPt] = [heightPt, widthPt];
  }

  const resolvedMargin = resolveMargin(margin);

  const contentWidthPt = widthPt - resolvedMargin.left - resolvedMargin.right;
  const contentHeightPt = heightPt - resolvedMargin.top - resolvedMargin.bottom - extraTopPt - extraBottomPt;

  if (contentWidthPt <= 0 || contentHeightPt <= 0) {
    throw new Error('ngx-pdf-export: margins (and header/footer height) leave no room for content on the page.');
  }

  return { widthPt, heightPt, margin: resolvedMargin, contentWidthPt, contentHeightPt };
}

function resolveMargin(margin: number | Partial<MarginSpec> | undefined): MarginSpec {
  if (margin === undefined) {
    const mm10 = mmToPt(10);
    return { top: mm10, right: mm10, bottom: mm10, left: mm10 };
  }
  if (typeof margin === 'number') {
    const pt = mmToPt(margin);
    return { top: pt, right: pt, bottom: pt, left: pt };
  }
  const mm10 = mmToPt(10);
  return {
    top: margin.top !== undefined ? mmToPt(margin.top) : mm10,
    right: margin.right !== undefined ? mmToPt(margin.right) : mm10,
    bottom: margin.bottom !== undefined ? mmToPt(margin.bottom) : mm10,
    left: margin.left !== undefined ? mmToPt(margin.left) : mm10,
  };
}
