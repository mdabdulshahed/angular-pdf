import { Directive, ElementRef, HostListener, Input } from '@angular/core';
import { PdfExportOptions } from '../types';
import { PdfExportService } from './pdf-export.service';

/**
 * Thin wrapper around PdfExportService for template-driven use:
 *
 * ```html
 * <div id="dashboard" pdfExport pdfFileName="dashboard.pdf" #dash="pdfExport">
 *   ...
 * </div>
 * <button (click)="dash.export()">Export</button>
 * ```
 *
 * By default this does not attach its own click handler -- the host element
 * shown in the brief's example is the content being exported, not
 * necessarily a button. Set `pdfTrigger="click"` to export when the host
 * element itself is clicked.
 */
@Directive({
  selector: '[pdfExport]',
  exportAs: 'pdfExport',
})
export class PdfExportDirective {
  @Input() pdfFileName?: string;
  @Input() pdfOptions?: PdfExportOptions;
  @Input() pdfTrigger: 'click' | 'none' = 'none';

  constructor(private readonly elementRef: ElementRef<HTMLElement>, private readonly pdf: PdfExportService) {}

  @HostListener('click')
  protected onHostClick(): void {
    if (this.pdfTrigger === 'click') {
      void this.export();
    }
  }

  async export(): Promise<void> {
    await this.pdf.download(this.elementRef.nativeElement, this.pdfFileName, this.pdfOptions);
  }
}
