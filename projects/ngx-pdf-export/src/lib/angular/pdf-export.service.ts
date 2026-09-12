import { Injectable } from '@angular/core';
import { runExport } from '../export-pipeline';
import { FontRegistry, PdfFontSource } from '../fonts/font-registry';
import { PdfExportOptions, PdfExportOptionsWithElement } from '../types';
import { normalizeArgs, PdfExportTarget, resolveElement } from './normalize-args';

export type { PdfExportTarget } from './normalize-args';

/**
 * The library's public entry point. See docs/api-design.md "Public surface".
 * `export`/`download`/`toBlob` all accept either `(target, options)` or a
 * single `{ element, ...options }` object.
 */
@Injectable({ providedIn: 'root' })
export class PdfExportService {
  private readonly fontRegistry = new FontRegistry();

  /** Registers a custom TTF/OTF font for embedding -- see docs/api-design.md "Font registration". */
  async registerFont(font: PdfFontSource): Promise<void> {
    await this.fontRegistry.register(font);
  }

  /** Builds the PDF and returns it as a Blob, without triggering a download. */
  async toBlob(target: PdfExportTarget | PdfExportOptionsWithElement, options?: PdfExportOptions): Promise<Blob> {
    const { element, opts } = normalizeArgs(target, options);
    const root = resolveElement(element);
    return runExport(root, opts, this.fontRegistry);
  }

  /** Builds the PDF and triggers a browser download. Alias for `download()` with the brief's example call shape. */
  async export(target: PdfExportTarget | PdfExportOptionsWithElement, options?: PdfExportOptions): Promise<void> {
    const { element, opts } = normalizeArgs(target, options);
    const blob = await this.toBlob(element, opts);
    triggerDownload(blob, opts.filename ?? 'document.pdf');
  }

  /** Builds the PDF and triggers a browser download with an explicit filename. */
  async download(target: PdfExportTarget | PdfExportOptionsWithElement, filename?: string, options?: PdfExportOptions): Promise<void> {
    const { element, opts } = normalizeArgs(target, options);
    const finalFilename = filename ?? opts.filename ?? 'document.pdf';
    const blob = await this.toBlob(element, opts);
    triggerDownload(blob, finalFilename);
  }
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
