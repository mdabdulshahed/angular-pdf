/*
 * Public API surface of ngx-pdf-export.
 * Keep this small and curated -- see docs/api-design.md "Public surface".
 */

export { PdfExportService } from './lib/angular/pdf-export.service';
export type { PdfExportTarget } from './lib/angular/normalize-args';
export { PdfExportDirective } from './lib/angular/pdf-export.directive';

export type { PdfFontSource } from './lib/fonts/font-registry';

export type {
  PdfExportOptions,
  PdfExportOptionsWithElement,
  PdfExportWarning,
  PdfPageContext,
  PageFormat,
  MarginSpec,
} from './lib/types';
