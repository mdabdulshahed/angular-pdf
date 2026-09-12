# ngx-pdf-export

A DOM-aware, client-side Angular library that exports a rendered
Angular/HTML element into a real PDF — with actual selectable, searchable,
copy-pasteable PDF text — entirely in the browser. No backend, no API
calls, and no `html2canvas`-style screenshot-to-image pipeline anywhere in
the path.

```html
<div id="dashboard">
  <h1>Sales Dashboard</h1>
  <p>Total Revenue: ₹12,50,000</p>
</div>
```

```ts
import { PdfExportService } from 'ngx-pdf-export';

constructor(private pdf: PdfExportService) {}

async exportDashboard() {
  await this.pdf.download('#dashboard', 'dashboard.pdf', {
    format: 'A4',
    orientation: 'landscape',
  });
}
```

The text in the resulting PDF is real PDF text — select it, search it
(Cmd/Ctrl+F), copy/paste it, and it stays crisp at any zoom level, because
it was never a picture in the first place.

## Why this is architecturally different from "html2canvas → PNG → PDF"

That common approach rasterizes the whole page into a bitmap, so the "PDF"
is really a picture of your page glued into a PDF wrapper: no selectable
text, blurry at high zoom, huge file sizes, and no real pagination (just a
picture sliced at arbitrary heights).

This library instead reads the browser's own already-computed layout
(`getBoundingClientRect`, `getComputedStyle`, and per-line text boxes via
`Range.getClientRects`) and replays it as real PDF drawing/text operators.
Only the rare element using a CSS feature this library doesn't translate
(gradients, box-shadow, CSS filters) is rasterized — and only that one
element, never the whole page. The full reasoning is in
**[docs/architecture.md](docs/architecture.md)**.

## Documentation

| Doc | Covers |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Why this architecture, coordinate systems, px↔pt conversion, module boundaries, hybrid rendering/fallback strategy |
| [docs/layout-engine.md](docs/layout-engine.md) | How DOM geometry is read, text-line extraction via `Range`, box model, tables, SVG/canvas |
| [docs/pagination.md](docs/pagination.md) | Page slicing algorithm, `keepTogether`, break-before/after, table header repeat, fit-to-width, headers/footers |
| [docs/css-support.md](docs/css-support.md) | Exactly which CSS is supported, what falls back to rasterization, Unicode/font limitations |
| [docs/api-design.md](docs/api-design.md) | Public API, why pdf-lib was chosen over jsPDF, font registration |
| [docs/roadmap.md](docs/roadmap.md) | Phase 1 (this repo) vs. Phase 2/3 scope |

## Repository layout

```
projects/ngx-pdf-export/   the library (publishable npm package)
  src/lib/dom/              DOM inspection (geometry, text runs, SVG parsing, break rules)
  src/lib/model/             framework-independent node types + unit conversions
  src/lib/layout/            fit-to-width scaling
  src/lib/pagination/        page slicing, page geometry
  src/lib/fonts/             custom font registration
  src/lib/render/            the only module that imports pdf-lib
  src/lib/fallback/          isolated per-element rasterization for unsupported CSS
  src/lib/angular/           PdfExportService, PdfExportDirective
projects/demo/              a realistic Angular dashboard exercising every feature above
docs/                        architecture documentation (read this before the code)
e2e/                          Playwright tests that drive the real demo app and inspect real PDF bytes
```

## Getting started

Requires Node 22.22+ / 24.15+ (Angular 22's own requirement; `.nvmrc` pins
a working version).

```bash
npm install
npm run build        # builds the library to dist/ngx-pdf-export
npm start             # serves the demo app at http://localhost:4200
npm test              # unit tests (pure logic: pagination, units, SVG path scaling)
npm run test:e2e      # Playwright: drives the demo in real Chromium, inspects real PDF bytes
```

`npm run test:e2e` shells out to `pdftotext` (poppler-utils) to verify the
exported PDFs' text is genuinely extractable — install it with
`brew install poppler` or `apt-get install poppler-utils` if it's missing.

## Demo app

`projects/demo` is a realistic sales dashboard: KPI cards (including one
with `box-shadow`, deliberately, to exercise the fallback-rasterization
path), an inline SVG bar chart, a 42-row table that spans multiple pages
with a repeating header, and Indian Rupee (₹) amounts throughout — proving
the Unicode font-registration path actually works, not just the ASCII
happy path. It has buttons to export A4 portrait, A4 landscape, with a
header/footer showing "Page X of Y", and in `debug: true` mode (which
outlines page boundaries and rasterized-fallback elements directly on the
output PDF).

## Current scope

This is a Phase 1 MVP per [docs/roadmap.md](docs/roadmap.md): block/flex
layout, real selectable text with line-accurate wrapping, tables with
repeated headers, images, vector SVG (with rasterized fallback for
gradients/filters/`<text>`), pagination with `keepTogether` and
break-before/after, custom font registration, and a debug mode. CSS Grid,
native PDF gradients/shadows, and Arabic/Urdu glyph shaping are explicitly
out of scope for now — see [docs/css-support.md](docs/css-support.md) for
the exact, honest boundary between what's supported and what's
rasterized.
