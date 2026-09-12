# API design

## Principle

"Give me an Angular DOM element and I will turn it into a proper PDF" — the
developer's existing template is the source of truth. There is no
second, PDF-specific document-definition syntax to learn or keep in sync.

## PDF backend: pdf-lib, not jsPDF

Evaluated against the criteria in the brief:

| | pdf-lib | jsPDF |
|---|---|---|
| Text placement | Low-level `drawText(text, {x, y, size, font})` per call — exactly the primitive our own line-by-line layout needs | Higher-level, cursor/flow oriented; fighting its own text-flow to place pre-positioned lines adds friction |
| Custom font embedding | First-class, via `@pdf-lib/fontkit`: `embedFont(bytes)` handles parsing, subsetting, and CMap/ToUnicode generation for real Unicode support | Supported via a base64-conversion plugin (`jspdf-customfonts`), historically less robust for large/CJK fonts and subsetting |
| Vector paths | `page.drawSvgPath()` plus line/rect/bezier primitives — direct mapping from our parsed SVG commands | SVG support is a separate, less maintained plugin |
| Images | PNG/JPEG embed with byte-level control | Supported, similar |
| Page/content control | Direct access to page content streams; can append to an existing page (needed for header/footer composed after body pagination) | Possible but less direct |
| Editing existing PDFs | Can load and modify (not needed for v1, but keeps the door open for "append to existing PDF" later) | Not a design goal of jsPDF |
| Bundle size | ~"pdf-lib` + `@pdf-lib/fontkit` ≈ 300KB min (before gzip); no native deps | jsPDF core is smaller, but grows fast once SVG/font/Unicode plugins are added |
| License | MIT | MIT |
| Browser support | Pure JS/TS, works in-browser and in Node | Same |

**Decision: pdf-lib + `@pdf-lib/fontkit`.** The deciding factors are (1) we
are handing it fully-resolved positions and text runs from our own
pagination engine rather than wanting a document-flow API, so pdf-lib's
lower-level primitives are a better fit than fighting jsPDF's own flow
model, and (2) `@pdf-lib/fontkit`'s subsetting + Unicode CMap generation is
the most direct path to the hard "₹ / Arabic / Urdu / accents must work"
requirement (§9 of the brief).

This choice is fully hidden behind the internal `PdfRenderer` interface
(`render/pdf-renderer.ts`):

```ts
interface PdfRenderer {
  createDocument(): void;
  addPage(widthPt: number, heightPt: number): PageHandle;
  drawText(page: PageHandle, run: PositionedTextRun): void;
  drawRect(page: PageHandle, rect: PositionedRect): void;
  drawImage(page: PageHandle, image: PositionedImage): Promise<void>;
  drawPath(page: PageHandle, path: PositionedPath): void;
  save(): Promise<Uint8Array>;
}
```

Nothing outside `render/` imports `pdf-lib` directly — replacing the backend
later means writing a new class against this interface.

## Public surface

Deliberately small — five exports:

```ts
export class PdfExportService {
  export(target: PdfExportTarget, options?: PdfExportOptions): Promise<void>;
  toBlob(target: PdfExportTarget, options?: PdfExportOptions): Promise<Blob>;
  download(target: PdfExportTarget, filename?: string, options?: PdfExportOptions): Promise<void>;
  registerFont(font: PdfFontSource): Promise<void>;
}

export class PdfExportDirective { /* selector: [pdfExport] */ }

export interface PdfExportOptions { /* below */ }
export interface PdfFontSource { family: string; src: string | ArrayBuffer; weight?: number; style?: 'normal' | 'italic'; }
export type PdfExportTarget = string | HTMLElement | ElementRef<HTMLElement>;
```

`export()` and `download()` both accept either `(target, options)` **or** a
single options object with `element` inside it, per the brief's examples:

```ts
pdf.export('#dashboard', { filename: 'dashboard.pdf', format: 'A4' });
pdf.export(elementRef.nativeElement);
pdf.export({ element: '#dashboard', filename: 'dashboard.pdf', format: 'A4', margin: 20 });
```

resolved by a single overload-normalizing helper (`normalizeArgs.ts`) at the
top of the service, so every downstream call sees one canonical
`{ target, options }` shape.

```ts
interface PdfExportOptions {
  filename?: string;                 // default 'document.pdf'
  format?: 'A4' | 'A3' | 'Letter' | 'Legal' | { width: number; height: number; unit?: 'pt' | 'mm' | 'px' };
  orientation?: 'portrait' | 'landscape';
  margin?: number | { top: number; right: number; bottom: number; left: number }; // mm, default 10
  usePrintStyles?: boolean;          // default false — see below
  keepTogether?: string[];           // CSS selectors, in addition to break-inside: avoid
  repeatTableHeaders?: boolean;      // default true
  header?: (ctx: PdfPageContext) => string | HTMLElement;
  footer?: (ctx: PdfPageContext) => string | HTMLElement;
  headerHeight?: number;             // pt, default 0 (no header) unless `header` set
  footerHeight?: number;
  scale?: number;                    // fallback-rasterization pixel density, default 2 (matches typical devicePixelRatio)
  debug?: boolean;                   // default false
  onWarning?: (warning: PdfExportWarning) => void;
}
```

`usePrintStyles: true` temporarily toggles a `media="print"` stylesheet
evaluation for the captured subtree (by reading styles as if the `print`
media query matched, using `matchMedia`-aware computed style resolution)
rather than the screen styles — for apps that already maintain print
stylesheets. Default is `false` (reproduce exactly what's on screen), since
most Angular apps exporting a "dashboard to PDF" have no print stylesheet at
all and expect what they see.

## Font registration

```ts
await pdf.registerFont({ family: 'Inter', src: '/fonts/Inter-Regular.ttf', weight: 400 });
await pdf.registerFont({ family: 'Inter', src: '/fonts/Inter-Bold.ttf', weight: 700 });
```

`src` may be a URL (fetched once, cached) or raw bytes (`ArrayBuffer`) for
apps that already have the font bytes in memory. Register a **static**
TTF/OTF file (a single weight/style, e.g. `Inter-Regular.ttf`), not a
variable font (`Inter[wght,wdth].ttf`) -- empirically, `@pdf-lib/fontkit`
subsets/embeds most glyphs from a variable font's default instance
incorrectly (most characters render as missing/wrong outlines even though
the PDF's text layer is still technically correct, since `ToUnicode` CMap
generation and glyph-outline embedding are separate steps and only the
latter is affected). Most font distributions, including Google Fonts,
publish static per-weight files alongside the variable one; use those.
Registration is global to
the service instance — call it once, e.g. in `app.config.ts`/a bootstrap
provider — not per-export. At render time, each `TextRunNode`'s resolved
`font-family`/`font-weight`/`font-style` is matched against the registry by
nearest weight (CSS-style fallback: exact family match, then nearest
registered weight for that family, then Standard-14 by generic family
guess, e.g. serif → Times, monospace → Courier, else → Helvetica).

## Accepted targets

`string` (passed to `document.querySelector`), `HTMLElement`, or Angular's
`ElementRef<HTMLElement>` (unwrapped via `.nativeElement`). A bare
`TemplateRef` is **not** accepted in v1 — it has no rendered DOM to inspect
until it's embedded in a view, which would require the library to create
and destroy an `EmbeddedViewRef` itself (view container, change detection
timing, cleanup) for content the caller never intended to actually display.
An app that wants to export a template it doesn't otherwise render can
already do this itself with `ViewContainerRef.createEmbeddedView()` into an
off-screen host and pass the resulting element — documented in the README
as the recommended pattern, revisited as a convenience wrapper in
`roadmap.md`.

## Directive

```html
<div id="dashboard" pdfExport pdfFileName="dashboard.pdf" [pdfOptions]="{ format: 'A4' }">
  ...
</div>
<button (click)="dashboardExport.export()">Export</button>
```

A thin wrapper: injects `PdfExportService`, exposes `export()` on the
directive instance (grabbable via a template reference variable, e.g.
`#dashboardExport="pdfExport"`) and, by default, does **not** auto-attach a
click handler to its own host — the brief's example shows it on the
content element (`<div ... pdfExport>`), which is frequently not a button.
An opt-in `pdfTrigger="click"` input attaches a host listener for the
common "export the element itself is also the trigger" case.

## Return values / side effects

- `download()` triggers a browser download (via an object URL + synthetic
  `<a>` click) and resolves once the PDF bytes are generated — it does not
  wait for the browser's download UI.
- `toBlob()` returns the `Blob` and does **not** trigger a download, for
  callers who want to upload it, preview it in an `<iframe>`, or attach it
  to an email.
- `export()` is `download()` with a default filename — kept as a separate
  method because it's the name used throughout the brief's examples and
  reads more naturally at call sites than `download()` with no explicit
  filename argument.

## Error handling

`onWarning` and `console.warn` both fire for recoverable issues (unsupported
CSS triggering a fallback rasterization, a CORS-blocked image that had to be
skipped, a Unicode codepoint with no matching glyph in the resolved font).
The returned `Promise` only **rejects** for unrecoverable issues (target not
found, target not attached/rendered, zero-area target). The library never
silently produces an empty or obviously-broken PDF without at least a
`console.warn` explaining why.
