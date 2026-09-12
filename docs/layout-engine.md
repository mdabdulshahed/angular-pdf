# Layout engine

See `architecture.md` first for *why* this stage reads geometry from the
browser instead of recomputing it. This doc covers *how*, and the concrete
node model.

## Pipeline within this stage

```
Element (root)
  → dom/inspect.ts: walk(root) → DomSnapshot tree
  → layout/build-tree.ts: DomSnapshot → LayoutTree (Document/Block/Text/...)
```

### 1. Walking the DOM (`dom/inspect.ts`)

Depth-first walk of `root` and its element/text children. For every element:

- Skip it (and its subtree) if `display: none`, or if it's a
  `<script>`/`<style>`/`<template>`/comment node.
- Skip it (contribute nothing, but *do* walk children) if `visibility:
  hidden` or `opacity: 0` still needs its box measured for sibling
  positioning — in practice we still record the node but mark
  `visible: false` so the renderer omits paint operators for it.
- Compute `rect = el.getBoundingClientRect()`, then subtract the captured
  root's own top-left so every rect is root-relative, in CSS px.
- Read `getComputedStyle(el)` once and extract only the properties listed in
  `css-support.md`, into a plain `ResolvedStyle` object (already-resolved
  values — no `var()`, no `calc()` left over, courtesy of the browser).
- Classify the element (`classify.ts`): `table`/`thead`/`tbody`/`tr`/`th`/
  `td`, `img`, `svg`, `canvas`, or generic `block`/`inline` based on
  computed `display`.
- Run `unsupported-features.ts` against the resolved style: if it uses
  `background-image` with a `gradient()`, `box-shadow`, `filter`,
  `backdrop-filter`, a `transform` beyond `translate()`, `mask`, or CSS
  Grid template values, mark the node `fallback: { reason }` and **do not
  recurse into its children** — its subtree will be rasterized as one unit
  by the fallback stage instead.

### 2. Text runs via `Range`

For each text node inside an inline-formatting context, instead of trying to
re-wrap the string ourselves:

```ts
const range = document.createRange();
range.selectNodeContents(textNode);
const rects = Array.from(range.getClientRects());
```

Each `DOMRect` in `rects` is one already-wrapped visual line, in the exact
position and size the browser rendered it, in visual (painted) order. We
pair each rect with the substring it covers using only `Range.getClientRects`
itself, rather than a second, less portable API: the number of rects
returned by `range(0, k).getClientRects()` is monotonically non-decreasing
in `k`, so the character offset where that count first increases from `n`
to `n + 1` is exactly the start of line `n + 1`. Binary-searching each of
these transitions (`dom/text-runs.ts`) recovers every line's exact
substring using nothing but the standard `Range` API — no
`caretRangeFromPoint`/`caretPositionFromPoint` feature-detection needed,
and no platform-specific fallback. Each resulting
`{ text, rect }` pair becomes one `TextRunNode` — this is also the unit the
pagination engine slices on (a `TextRunNode` is never split across pages;
see `pagination.md`).

Font metrics for the run (family, size, weight, style, color, letter
spacing, decoration) are read from `getComputedStyle()` on the text node's
parent element, not re-derived — we trust the browser's cascade resolution
completely.

### 3. Box model resolution

For every element node, `layout/box-model.ts` reads the four computed box
edges directly (`getComputedStyle` already resolves shorthand/percentage/
`auto` margins and padding into pixel values for a laid-out element):

```
margin-{top,right,bottom,left}
border-{top,right,bottom,left}-width/style/color
padding-{top,right,bottom,left}
border-{top-left,top-right,bottom-right,bottom-left}-radius
background-color, background-image (solid image / no-repeat cover subset)
```

The element's `getBoundingClientRect()` is the **border box** (matches
`box-sizing: border-box`, the default we assume for computed rects — since
we read the rect directly rather than summing width+padding+border
ourselves, `box-sizing: content-box` "just works" too, with no special
casing needed).

### 4. Tables

`<table>` gets a dedicated `TableNode` rather than being treated as a plain
block, because pagination needs row-level semantics (never split a row,
optionally repeat the header). Construction:

- `TableNode.columns[]`: derived from the rendered column boundaries — the
  x-position/width of each cell in the first body row (browsers already
  computed final column widths via table layout; we just read them).
- `TableNode.rows[]`: one `TableRowNode` per `<tr>`, each holding its
  `<th>`/`<td>` cells as regular `BlockNode`s (with their own text runs,
  background, borders) plus the row's rect.
- `TableNode.headerRowCount`: number of `<thead><tr>` rows, used by the
  pagination engine to know how many rows to re-emit at the top of a
  continuation page.

### 5. Images / SVG / canvas

- `<img>` → `ImageNode` holding the *original* `src` (or, if it's a
  same-origin/data URL, the decoded bytes fetched during rendering — not
  during layout, to keep this stage synchronous). Aspect ratio and
  `object-fit` (`cover`/`contain`/`fill`/`none`) are read from computed
  style and resolved into a source-crop + placement rect at render time.
- `<svg>` → `SvgNode` holding the serialized `outerHTML` of the SVG (parsed
  into vector draw commands later, in `render/svg-to-pdf.ts`) *if* every
  child element is in the supported shape set (`rect`, `circle`, `ellipse`,
  `line`, `polyline`, `polygon`, `path` with `M/L/H/V/C/S/Q/T/A/Z`, `g` for
  grouping/opacity). Otherwise it's marked `fallback` and rasterized as a
  unit (gradients, `<text>`, `<use>`, `<clipPath>`, filters are common
  reasons).
- `<canvas>` → always `ImageNode`, populated from `canvas.toDataURL()` at
  render time (not layout time, so we only pay the encode cost for canvases
  that actually end up in the export).

## Flex/grid: read, don't recompute

We never run a flex-sizing or grid-track-sizing algorithm. A flex container's
children already have final `getBoundingClientRect()`s reflecting
`flex-direction`, `justify-content`, `align-items`, `gap`, and `flex-grow/
shrink/basis` — we read those rects like any other block's. This is what
makes flex/grid "supported" without us writing a flex/grid engine. The
honest limitation (stated in `architecture.md` and `css-support.md`): if a
flex row has to move to a new page mid-way, we do **not** re-run the flex
algorithm for the remaining items on the new page — they keep the relative
offsets they had in the single-page flow, just translated by the page break.
For the target use case (dashboards, invoices, reports laid out as stacked
sections) this is very rarely visible; it matters most for flex rows that
are themselves taller than one page, which is an unusual layout to print
regardless.

## Output: the `LayoutTree`

The result of this stage is a plain, serializable tree (see
`model/nodes.ts`) rooted at a single `DocumentNode`, in **layout space**
(pt, y-down, root-relative — see `architecture.md`). It has no page
boundaries yet; that's the pagination engine's job (`pagination.md`). Every
node carries a stable-ish `id` (used only for debug-mode overlays and error
messages, not for identity comparisons).
