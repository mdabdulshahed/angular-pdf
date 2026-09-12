/** Public option/type surface. See docs/api-design.md. */

export type PageFormat = 'A4' | 'A3' | 'Letter' | 'Legal' | { width: number; height: number; unit?: 'pt' | 'mm' | 'px' };

export interface MarginSpec {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PdfPageContext {
  pageNumber: number;
  pageCount: number;
}

export interface PdfExportWarning {
  message: string;
  elementDescription: string;
}

export interface PdfExportOptions {
  filename?: string;
  format?: PageFormat;
  orientation?: 'portrait' | 'landscape';
  /** mm, applied to all four sides unless given per-side. Default 10mm. */
  margin?: number | Partial<MarginSpec>;
  usePrintStyles?: boolean;
  keepTogether?: string[];
  repeatTableHeaders?: boolean;
  header?: (ctx: PdfPageContext) => string | HTMLElement;
  footer?: (ctx: PdfPageContext) => string | HTMLElement;
  headerHeight?: number;
  footerHeight?: number;
  scale?: number;
  debug?: boolean;
  onWarning?: (warning: PdfExportWarning) => void;
}

export interface PdfExportOptionsWithElement extends PdfExportOptions {
  element: string | HTMLElement;
}
