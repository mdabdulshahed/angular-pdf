# CSS support

Reminder: because the layout stage reads the browser's *computed* geometry
rather than reimplementing layout (`architecture.md`), a property being
"supported" here means one of two different things depending on the
property:

- **Layout properties** (`display`, `flex-*`, `justify-content`,
  `align-items`, `gap`, `width/height`, `position`, `top/right/bottom/left`,
  most `transform`s) are supported *as a side effect* of reading
  `getBoundingClientRect()` — the browser already applied them, we just read
  where things ended up. These "just work" for single-page content; the
  caveat is multi-page reflow (see `layout-engine.md` §"Flex/grid").
- **Paint properties** (`color`, `background-color`, `border`, fonts, text
  properties) are supported because we explicitly translate them into PDF
  drawing/text operators. These need to be implemented one by one, and this
  is the list that actually grows over time.

## Supported in v1 (Phase 1/2 of `roadmap.md`)

| Category | Properties |
|---|---|
| Layout | `display: block/inline/inline-block/flex`, `flex-direction`, `justify-content`, `align-items`, `gap`, `width/height`, `min/max-width/height`, `margin`, `padding`, `position: static/relative/absolute` (fixed via `getBoundingClientRect`), `top/right/bottom/left` (as an outcome of the above), `overflow: visible/hidden` (hidden clips paint to the element's rect) |
| Border/background | `border` (all sides, width/style/color, `solid`/`dashed`/`dotted`), `border-radius` (per-corner), `background-color`, `background-image: url(...)` with `no-repeat`/`cover`/`contain` (a plain raster background image; not a gradient) |
| Color | `color`, `opacity` (applied per-node as PDF fill/stroke alpha), any valid CSS color syntax `getComputedStyle` can return — legacy `rgb()`/`rgba()`/hex/named colors via a fast regex path, and CSS Color 4 forms (`color-mix()`, `oklch()`, `oklab()`, `lab()`, `lch()`, the `color(<space> ...)` function) via a canvas-based fallback resolver (`dom/color.ts`) |
| Text | `font-family`, `font-size`, `font-weight`, `font-style`, `line-height`, `letter-spacing`, `text-align: left/right/center/justify`, `white-space: normal/nowrap/pre`, word wrapping (read from the browser's own line boxes), `text-decoration: underline/line-through` |
| Media | `<img>` (PNG/JPEG/data URL/same-origin), `<svg>` limited to `rect/circle/ellipse/line/polyline/polygon/path/g`, `<canvas>` (rasterized — see below), `<table>`/`<thead>`/`<tbody>`/`<tr>`/`<th>`/`<td>` |
| Pagination | `break-before`/`break-after`/`break-inside` (and legacy `page-break-*`), plus the library's own `keepTogether` option |

**Why the color resolver matters in practice:** `getComputedStyle()` does
not normalize every color to `rgb()`/`rgba()` the way it always used to.
Any color computed from a CSS Color 4 function — most commonly
`color-mix()`, which many current design systems (including Angular's own
starter template) use for tinted/muted palette colors — is returned
verbatim in its own serialization, e.g. `color-mix(in srgb, blue 50%,
transparent)` computes to `color(srgb 0 0 1 / 0.5)`, not to an `rgba()`
string. A parser that only handles `rgb()`/`rgba()` silently treats every
such color as unparseable — dropping backgrounds and SVG fills entirely,
and falling back text to black — with no error, because "color not found"
looks identical to "element has no background." `dom/color.ts` handles this
by resolving anything the fast path doesn't recognize through a 1x1 canvas
(`fillStyle` + `getImageData`), which is correct for *any* syntactically
valid CSS color regardless of color space, since that's exactly what the
canvas rasterizer already has to do internally.

`<canvas>` is intentionally always rasterized — its content is already a
bitmap the canvas API produced; there is no vector source to recover in the
general case. This is not a violation of "no screenshot pipeline": it's a
single flagged element, not the whole export, and it's explicitly called
out as acceptable in the product brief (§12).

## Explicitly unsupported in v1 — rasterized as a fallback

Any element whose computed style uses one of these triggers **that one
element** (not the page) being rasterized via the `foreignObject` fallback
(`architecture.md` §"Hybrid rendering"), with a `console.warn` (and, in
`debug: true` mode, a dashed outline on the output PDF):

- Gradients (`linear-gradient`, `radial-gradient`, `conic-gradient`) as a
  `background-image`
- `box-shadow`, `filter`, `backdrop-filter`
- `transform` beyond a pure `translate()` (rotation/scale/skew/3D/matrix)
- CSS Grid (`display: grid`) — grid *children* still get correct rects
  individually (we read them like any other box), but the grid container
  itself is not specially interpreted; nested grids inside an unsupported
  ancestor are rasterized with it
- `::before`/`::before`-generated content, `::marker`
- CSS custom scrollbars, `mix-blend-mode`, `clip-path` beyond simple insets
- Web fonts loaded via `@font-face` that the app already applies on screen
  render with the correct glyphs *in the browser*, but that were not also
  explicitly `registerFont()`-ed with the library (see `fonts` in
  `api-design.md`) — the PDF falls back to the nearest Standard-14 font,
  which will look visually different from the on-screen render. This is
  not auto-rasterized (it would defeat selectable text for the most common
  real-world case — a custom brand font), it's a text-fidelity warning
  instead.

## Explicitly out of scope for v1 (see `roadmap.md` Phase 3)

CSS Grid track-level fidelity, gradients/shadows as *native* PDF vector
paint (they're only ever rasterized in v1, never translated to PDF's own
shading/pattern operators), `<svg>` `<text>`/`<use>`/`<clipPath>`/filters,
RTL/bidi *shaping* (Arabic/Urdu glyph joining — see `fonts.md` below),
multi-column layout, CSS animations/transitions (export always captures the
resting state), print-specific `@page` at-rules.

## Unicode and non-Latin scripts

The PDF Standard-14 fonts (Helvetica, Times, Courier, and their bold/italic
variants) — used automatically when no matching custom font has been
registered — only support the WinAnsi encoding (roughly Latin-1). They
**cannot** render `₹`, Devanagari, Arabic, Urdu, CJK, or most accented
characters outside Western European languages. This is a hard PDF
Standard-14 limitation, not a bug in this library.

For any non-Latin-1 content, register a Unicode-capable TTF/OTF font (e.g.
Noto Sans for broad Latin/₹/Cyrillic coverage, Noto Sans Arabic for
Arabic/Urdu) via `pdf.registerFont(...)` — see `api-design.md`. Once
registered and embedded (with subsetting, via `@pdf-lib/fontkit`), any
Unicode codepoint present in that font's glyph table renders correctly and
remains selectable/searchable text.

One further honest limitation: registering an Arabic/Urdu font makes the
*glyphs* available, but v1 does not perform Arabic contextual shaping
(initial/medial/final letterforms) or bidi run reordering — text is placed
glyph-by-glyph in logical order. Right-to-left *scripts* will therefore
render with visually disconnected letterforms in v1. This is called out
explicitly in `roadmap.md` as a Phase 3 item (it requires a shaping engine
such as HarfBuzz compiled to WASM) rather than silently shipped as "Arabic
support."
