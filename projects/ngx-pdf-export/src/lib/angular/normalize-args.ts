import { ElementRef } from '@angular/core';
import { PdfExportOptions, PdfExportOptionsWithElement } from '../types';

export type PdfExportTarget = string | HTMLElement | ElementRef<HTMLElement>;

export interface NormalizedArgs {
  element: PdfExportTarget;
  opts: PdfExportOptions;
}

/**
 * Accepts either `(target, options)` or a single `{ element, ...options }`
 * object -- see docs/api-design.md.
 */
export function normalizeArgs(target: PdfExportTarget | PdfExportOptionsWithElement, options?: PdfExportOptions): NormalizedArgs {
  if (isOptionsWithElement(target)) {
    const { element, ...rest } = target;
    return { element, opts: rest };
  }
  return { element: target, opts: options ?? {} };
}

function isOptionsWithElement(value: unknown): value is PdfExportOptionsWithElement {
  return typeof value === 'object' && value !== null && !(value instanceof ElementRef) && !(value instanceof HTMLElement) && 'element' in value;
}

export function resolveElement(target: PdfExportTarget): HTMLElement {
  if (typeof target === 'string') {
    const found = document.querySelector<HTMLElement>(target);
    if (!found) {
      throw new Error(`ngx-pdf-export: no element matches selector "${target}".`);
    }
    return found;
  }
  if (target instanceof ElementRef) {
    return target.nativeElement;
  }
  return target;
}
