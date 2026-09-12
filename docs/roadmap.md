# Roadmap

## Phase 1 — MVP (this repo, implemented now)

- Angular integration: `PdfExportService`, `PdfExportDirective`, standalone
  Angular 22 library, selector/`HTMLElement`/`ElementRef` input.
- DOM inspection via `getBoundingClientRect`/`getComputedStyle`/`Range`
  (`architecture.md`, `layout-engine.md`).
- Block box model: margin/padding/border/border-radius/background-color.
- Real selectable text: per-line PDF text objects via `Range.getClientRects`,
  `text-align`, `white-space`, `letter-spacing`, `line-height`.
- Basic flex support (read-back, per `layout-engine.md`).
- Images (PNG/JPEG/data URL), basic SVG → vector PDF paths.
- A4/A3/Letter/Legal + custom size, portrait/landscape, margins.
- Automatic pagination: no mid-line/mid-row cuts, `keepTogether`,
  `break-before`/`break-after`.
- Tables with repeated headers across pages.
- Header/footer with page numbers.
- Font registry + custom TTF/OTF registration, Standard-14 fallback.
- Fallback rasterization for unsupported CSS, scoped to one element.
- `debug` mode (console warnings + on-PDF outlines).

## Phase 2 — near-term hardening

- `<canvas>` capture edge cases: canvases using `preserveDrawingBuffer:
  false` WebGL contexts need a capture hook *before* the next frame clears
  the buffer; document a `captureCanvas` override for apps using charting
  libraries that manage their own WebGL context.
- `object-fit: cover/contain` for background images, not just `<img>`.
- Multi-column `keepTogether` groups (e.g. keep a KPI row of 4 cards
  together as one unit even though each card individually would fit split).
- Better CORS diagnostics: a pre-flight `HEAD` check with an actionable
  warning message pointing at `crossorigin="anonymous"` + the image host's
  `Access-Control-Allow-Origin` requirement, instead of a generic failure.
- Visual regression test suite (rendered PDF pages rasterized to PNG via
  `pdf.js` and compared against golden images) layered on top of the
  Phase 1 text-extraction tests.
- Offscreen rendering of currently-hidden/off-viewport elements (the clone-
  into-sandbox approach rejected for v1 in `architecture.md`, revisited
  once the canvas/font-copying issues have a clean answer — likely a hidden
  same-origin `<iframe>` with the app's own stylesheets re-linked, rather
  than a raw clone).

## Phase 3 — broader fidelity

- CSS Grid template-level fidelity for multi-page reflow (today, grid
  children's rects are read as-is; a grid that must reflow across a page
  break doesn't re-run track sizing).
- Native PDF gradients/shadows: translate `linear-gradient`/`box-shadow`
  into PDF shading patterns instead of always rasterizing.
- `<svg>` `<text>`, `<use>`, `<clipPath>`, filters, patterns.
- `transform`: rotation/scale/skew/matrix (today: `translate()` only, via
  `getBoundingClientRect`; anything else triggers the fallback rasterizer).
- Bidi + Arabic/Urdu contextual shaping via a WASM text-shaping engine
  (HarfBuzz), so RTL scripts render with correct joined letterforms rather
  than isolated glyphs in logical order (see `css-support.md`'s Unicode
  section for the current limitation).
- `TemplateRef` convenience wrapper (create/destroy an off-screen embedded
  view internally) instead of requiring callers to do it themselves.
- Web Worker offload for the pagination + PDF-byte-generation stages, once
  a clean way to transfer the `LayoutTree` (already a plain serializable
  structure — the blocker is `pdf-lib`'s and the DOM read stage's reliance
  on browser-global objects, not the data) is worked out; likely means
  running DOM inspection + `LayoutTree` build on the main thread (fast,
  synchronous) and only pagination + `pdf-lib` encoding in the worker.
- `@font-face` auto-detection: read fonts the app has already loaded via
  the CSS Font Loading API (`document.fonts`) and auto-fetch/embed their
  source bytes when same-origin, instead of requiring explicit
  `registerFont()` calls for custom brand fonts.
