# Architecture

## Goal

Turn a rendered Angular/HTML DOM subtree into a **real PDF** — one where text is
drawn with PDF text-showing operators (`Tj`/`TJ`), not baked into a bitmap. The
package must run entirely in the browser: no server, no headless Chrome, no
canvas-screenshot-to-image pipeline.

## The key architectural decision: don't reimplement CSS layout

A naive reading of "DOM → layout tree → layout engine → pagination → PDF"
suggests writing a from-scratch block/inline/flex/grid layout algorithm, the
way a browser engine does. That is a multi-year undertaking (line breaking,
BFC/IFC rules, flex sizing algorithm, grid track sizing, `text-align`,
bidi, ...) and it would necessarily lag behind what the browser already does
correctly.

**We don't do that.** The browser has already laid out the element perfectly
— that's *why* it's on screen. So instead of recomputing layout, we treat the
browser's own layout as ground truth and read it back:

- `element.getBoundingClientRect()` gives the exact box (position + size) the
  browser computed for every element, regardless of whether it got there via
  block flow, flex, grid, absolute positioning, or transforms.
- `Range.getClientRects()`, applied to each text node, gives the exact
  per-*line* bounding boxes the browser produced after line-breaking,
  hyphenation-free wrapping, `text-align`, `letter-spacing`, bidi, etc. One
  rect per wrapped line, in document order.
- `getComputedStyle()` gives the resolved values for every CSS property we
  care about, with `var()` custom properties already resolved (the browser
  does that for us for free).

So the pipeline is really:

```
Live DOM (already laid out by the browser)
  │  read-only inspection: getBoundingClientRect + getComputedStyle + Range.getClientRects
  ▼
DomSnapshot (position/size/style facts per node, still framework-independent)
  │  dom-inspector: classify nodes, detect unsupported features, resolve box model
  ▼
LayoutTree (Document → Block/Text/Image/Svg/Table/Group nodes, in PDF points,
            single tall "flow" page, y-down from the top of the captured root)
  │  pagination engine: slice the flow into discrete Pages without cutting a
  │  text line or a table row, honoring keepTogether / break-before / break-after
  ▼
PaginatedDocument (Document → Page[] → positioned primitives, page-local coords)
  │  PdfRenderer backend (pdf-lib): flip Y to PDF's bottom-left origin,
  │  embed fonts/images, emit real text/vector operators
  ▼
PDF Blob (download / return)
```

This means our "layout engine" is not a layout algorithm — it's a
**geometry-extraction and pagination-reflow** engine. That is a realistic
scope for a browser-based library, and it gets flexbox, CSS Grid,
`position: absolute`, and most `transform`s "for free" for single-page
content, because we never try to recompute *how* the box got where it is —
we just read where it is.

The trade-off, stated honestly: this only works for content the browser has
actually rendered (the element must be attached to the document and not
`display: none`), and multi-page reflow of flex/grid layouts is
**approximate** — we slice the already-computed flow by Y-coordinate rather
than re-running the flex/grid algorithm once per page. A single-column
report/dashboard/invoice (the target use case) reflows cleanly; a complex
multi-column flex layout that is *supposed* to reshuffle its items when
content moves to a new page will not do so. This is documented in
`css-support.md` and revisited in `roadmap.md`.

## Why text stays selectable

Because we never rasterize text. Each wrapped line, as reported by
`Range.getClientRects()`, becomes one PDF text-showing operation at the
line's exact x/y position, using the resolved font, size, weight, style,
color and letter-spacing from `getComputedStyle()`. The browser already did
the line-breaking; we just replay its answer as vector text instead of
pixels. Non-text content (backgrounds, borders, images, simple SVG) is drawn
as real PDF graphics operators. Only content the renderer cannot faithfully
reproduce (see `css-support.md`) is rasterized, and only that one element —
never the whole page.

## Module boundaries

```
projects/ngx-pdf-export/src/lib/
  dom/            DOM inspection: DomSnapshot construction, Range-based line
                  extraction, unsupported-feature detection, hidden-element
                  handling, canvas/image/SVG capture.
  model/          Framework-independent node types (DocumentNode, BlockNode,
                  TextRunNode, ImageNode, SvgNode, TableNode, GroupNode, ...)
                  and the shared unit types (Pt, Rect, BoxModel, Color).
  layout/         DomSnapshot -> LayoutTree. Unit conversion (px -> pt), box
                  model resolution, fallback-node substitution.
  pagination/     LayoutTree -> PaginatedDocument. Page-size/margin math,
                  flow slicing, keepTogether, break-before/after, table row
                  splitting + header repeat.
  fonts/          FontRegistry: registerFont(), family/weight/style
                  resolution, Standard-14 fallback, embedding via fontkit.
  render/         PdfRenderer interface + the pdf-lib backend implementation.
                  This is the only module allowed to import `pdf-lib`.
  fallback/       Isolated per-element rasterization (foreignObject -> canvas
                  -> PNG) used only for nodes the layout stage flags as
                  unsupported.
  angular/        PdfExportService, PdfExportDirective, DI tokens/config.
  public-api.ts   Small, curated surface re-exported from the package root.
```

`render/` is intentionally the only module that touches the PDF backend
library. Everything upstream of it (`dom`, `model`, `layout`, `pagination`)
has no knowledge of pdf-lib and operates on plain, serializable data
structures. Swapping the PDF backend later (see `api-design.md`) means
rewriting `render/` against the same `PdfRenderer` interface — nothing else
changes.

## Coordinate systems and units

Three coordinate systems are in play; each stage owns exactly one:

1. **DOM space**: CSS pixels, origin top-left of the captured root element,
   y increases downward. This is what `getBoundingClientRect()` gives us
   (after subtracting the root's own rect).
2. **Layout space**: PDF points (`pt`), origin top-left of the *flow*
   (the whole captured content, treated as one arbitrarily tall page), y
   increases downward. Conversion from DOM space is a single scalar
   multiply: `pt = px * 0.75` (see below). This is the space the
   `LayoutTree` and the pagination engine work in — keeping y-down here
   means pagination is just "slice by y range," with no sign flips to
   reason about.
3. **PDF space**: points, origin bottom-left of *each page*, y increases
   upward — mandated by the PDF spec. The flip happens exactly once, in
   `render/`, per primitive: `pdfY = pageHeightPt - (layoutY + boxHeight)`.

### px → pt conversion

CSS defines `1px = 1/96 inch`. PDF points are `1pt = 1/72 inch`. So:

```
1 CSS px = 72/96 pt = 0.75 pt
```

This is a fixed, DPI-independent conversion — we do not rasterize, so there
is no "export resolution" to configure for vector content (text, shapes,
vector SVG). It only becomes relevant for the fallback rasterizer, where a
`scale` option controls the pixel density of the embedded PNG (see
`css-support.md`).

### mm / pt / px conversions (`layout/units.ts`)

```
1 inch = 25.4 mm = 72 pt = 96 px
mmToPt(mm) = mm * 72 / 25.4
ptToMm(pt) = pt * 25.4 / 72
pxToPt(px) = px * 0.75
ptToPx(pt) = pt / 0.75
```

Standard page sizes are stored in pt (the PDF-native unit) and derived from
mm where that's the more recognizable source of truth:

| Format | mm | pt (rounded) |
|---|---|---|
| A4 | 210 × 297 | 595.28 × 841.89 |
| A3 | 297 × 420 | 841.89 × 1190.55 |
| Letter | 215.9 × 279.4 | 612 × 792 |
| Legal | 215.9 × 355.6 | 612 × 1008 |

## Why not clone the DOM into an offscreen sandbox?

An earlier design considered cloning the target subtree into a detached,
off-screen container so inspection could never have *any* visible side
effect and so `usePrintStyles` could toggle a media-query-like class without
touching the live page. We deliberately dropped that for v1:

- `cloneNode()` does not copy `<canvas>` pixel contents, scroll offsets, or
  form control values — the clone would need per-element special-casing
  that duplicates most of what the inspector already has to do on the live
  tree anyway.
- Cross-origin stylesheets, `@font-face` rules and CSS custom properties
  inherited from ancestors outside the captured subtree would all need to
  be re-resolved or copied into the clone.
- The inspector never *mutates* the live DOM — it only calls read-only APIs
  (`getBoundingClientRect`, `getComputedStyle`, `Range.getClientRects`) — so
  there is no visible side effect to guard against in the first place.

The cost is that the target element must be actually attached and rendered
(not `display: none`, not in an inactive tab) at export time. This is
documented as a requirement in `api-design.md` and revisited as a possible
v2 feature (offscreen rendering of currently-hidden content) in
`roadmap.md`.

## Hybrid rendering / fallback strategy

Every node the DOM inspector visits is classified as either **native** (we
know how to express it as real PDF operators: text, rect, border, image,
simple SVG shapes) or **unsupported** (it uses a CSS feature we don't
translate: gradients, box-shadow, CSS filters, non-trivial `transform`s,
CSS Grid subgrid, `<canvas>` content, complex SVG with gradients/masks/
`<text>`/`<use>`).

Unsupported nodes are rasterized **individually**: `fallback/` serializes
just that element (via an SVG `<foreignObject>` wrapping a clone of the
element's `outerHTML` plus its resolved computed styles inlined, drawn to an
off-screen `<canvas>`, read back as a PNG data URL) and the result replaces
that one subtree as a single `ImageNode` positioned at the same rect. Layout
does not recurse into the unsupported subtree any further, and — critically
— siblings and ancestors are completely unaffected: a dashboard with one
CSS-gradient card and nine plain cards produces nine real-text cards and one
rasterized card, not ten images.

`<canvas>` elements are treated as always-rasterized (`canvas.toDataURL()`),
per the spec's own guidance — a canvas's content is graphical output the
canvas API already rasterized; there is no "real" vector form to recover
from a 2D canvas in the general case.

## Debug mode

`export(target, { debug: true })` makes the pagination and layout stages
retain their diagnostics instead of discarding them: every fallback
rasterization emits a `console.warn` naming the element and the reason
(e.g. `background: linear-gradient(...) is not supported and will be
rasterized`), and the renderer additionally draws a dashed red outline
around every rasterized node and every page boundary directly on the output
PDF, so you can see exactly what was approximated without leaving the
browser.

## Performance

- No DOM cloning (see above) means no duplicated subtree.
- Rasterization is opt-in/per-node, not per-export, so the common case (text,
  boxes, borders, simple SVG) never touches `<canvas>` at all.
- `Range` objects are created and discarded per text node during inspection;
  nothing large is retained past the `LayoutTree` build step.
- Font embedding/subsetting is memoized per `(family, weight, style)` for the
  duration of one export, so a table with a thousand cells in the same font
  embeds that font once.
- The DOM inspection and layout stages are synchronous (they're just reading
  already-computed browser state, which is fast); pagination and PDF byte
  generation are `async` and yield between pages via microtasks so a
  many-page export doesn't block the main thread for one long tick. Web
  Workers are not used in v1 because `pdf-lib` document construction and DOM
  reads both require access to browser-only APIs/objects that don't transfer
  cleanly to a worker; this is revisited in `roadmap.md`.
