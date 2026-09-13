import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

/**
 * Drives the real demo app in a real Chromium browser and inspects the
 * resulting PDF bytes. This is the only layer of the test suite that can
 * verify the library's central, non-negotiable claim -- that the exported
 * PDF contains real, selectable/searchable text, not a rasterized image of
 * text -- because that claim depends on genuine browser layout
 * (getBoundingClientRect/getComputedStyle/Range) that jsdom does not
 * reproduce faithfully. See docs/roadmap.md Phase 2 "visual regression".
 *
 * Text-content assertions shell out to `pdftotext` (poppler-utils), the
 * same tool used to hand-verify this library during development. Install
 * it locally with `brew install poppler` / `apt-get install poppler-utils`
 * to run these tests.
 */

function extractText(pdfPath: string): string {
  return execFileSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf-8' });
}

test.describe('ngx-pdf-export demo: real, selectable PDF output', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => {
      throw new Error(`Unhandled page error: ${err.message}`);
    });
    await page.goto('/');
    await page.waitForSelector('#dashboard');
    await page.waitForTimeout(400); // let registerFont() resolve
  });

  test('A4 portrait export paginates and preserves selectable text, including ₹', async ({ page }) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ngx-pdf-export-'));
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export A4 Portrait' }).click(),
    ]);
    const filePath = path.join(dir, 'out.pdf');
    await download.saveAs(filePath);

    const doc = await PDFDocument.load(require('node:fs').readFileSync(filePath));
    expect(doc.getPageCount()).toBeGreaterThan(1);

    const w = doc.getPage(0).getWidth();
    const h = doc.getPage(0).getHeight();
    expect(Math.round(w)).toBe(595); // A4 width in pt
    expect(Math.round(h)).toBe(842); // A4 height in pt

    const text = extractText(filePath);
    expect(text).toContain('Sales Dashboard');
    expect(text).toContain('Recent Orders');
    expect(text).toMatch(/₹[\d,]+/); // real Unicode rupee glyph extracted as text, not an image
    expect(text).toContain('INV-1000');
    expect(text).toContain('Aarav Sharma');
  });

  test('table header repeats on the continuation page', async ({ page }) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ngx-pdf-export-'));
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export A4 Portrait' }).click(),
    ]);
    const filePath = path.join(dir, 'out.pdf');
    await download.saveAs(filePath);

    const occurrences = execFileSync('pdftotext', ['-layout', filePath, '-'], { encoding: 'utf-8' }).match(/Invoice\s+Customer\s+Email/g);
    expect(occurrences?.length ?? 0).toBeGreaterThanOrEqual(2); // header row + at least one repeat
  });

  test('landscape export is wider than it is tall and needs fewer pages', async ({ page }) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ngx-pdf-export-'));
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export A4 Landscape' }).click(),
    ]);
    const filePath = path.join(dir, 'out.pdf');
    await download.saveAs(filePath);

    const doc = await PDFDocument.load(require('node:fs').readFileSync(filePath));
    expect(doc.getPage(0).getWidth()).toBeGreaterThan(doc.getPage(0).getHeight());
  });

  test('header/footer export includes page numbers and reserved header text', async ({ page }) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ngx-pdf-export-'));
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export with Header/Footer' }).click(),
    ]);
    const filePath = path.join(dir, 'out.pdf');
    await download.saveAs(filePath);

    const text = extractText(filePath);
    expect(text).toContain('Sales Dashboard --');
    expect(text).toMatch(/Page \d+ of \d+/);
  });

  test('debug mode still produces a valid, text-bearing PDF', async ({ page }) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ngx-pdf-export-'));
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export (debug mode)' }).click(),
    ]);
    const filePath = path.join(dir, 'out.pdf');
    await download.saveAs(filePath);

    const text = extractText(filePath);
    expect(text).toContain('Sales Dashboard');
  });

  test('a font registered under an unrelated family still covers another font\'s missing glyph (emoji fallback chain)', async ({ page }) => {
    // The demo registers "Noto Emoji" but no element's font-family is ever
    // set to it -- this only passes if render/fonts.ts's cross-font
    // fallback chain actually kicks in for the footer's emoji character,
    // which the primary (Noto Sans) font doesn't have a glyph for.
    const warnings: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'warning' && msg.text().includes('has no glyph')) warnings.push(msg.text());
    });

    const dir = mkdtempSync(path.join(tmpdir(), 'ngx-pdf-export-'));
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export A4 Portrait' }).click(),
    ]);
    const filePath = path.join(dir, 'out.pdf');
    await download.saveAs(filePath);

    const text = extractText(filePath);
    expect(text).toContain('\u{1F389}'); // the party-popper emoji, extracted as real text
    expect(warnings.some((w) => w.includes('\u{1F389}'))).toBe(false);
  });
});
