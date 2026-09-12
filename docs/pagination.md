# Pagination engine

Input: a `LayoutTree` — one arbitrarily tall "flow" in layout space (pt,
y-down, origin at the top of the captured root). Output: a
`PaginatedDocument` — `Document → Page[]`, each page holding primitives in
**page-local** coordinates (still y-down; the flip to PDF's bottom-left
origin happens later, in `render/`).

## Fit-to-width

Most web layouts are wider than a printed page -- a 900px-wide dashboard is
already close to the full content width of A4 portrait (~571pt ≈ 761px at
96dpi) before accounting for margins, and plenty of dashboards are wider
still. Before pagination runs, `layout/scale-tree.ts` compares the captured
flow's width (`doc.flowWidthPt`) to the page's content width and, if the
flow is wider, uniformly scales every geometric quantity in the tree
(rects, font sizes, border widths/radii, SVG coordinates) down by
`contentWidthPt / flowWidthPt` -- the same "shrink to fit" a browser's own
print dialog applies. It never *enlarges* narrow content. This runs once,
before pagination, so it also reduces the page count for wide content
instead of just avoiding horizontal clipping. A `console.warn` (and
`onWarning`) fires when this happens, naming the scale-down percentage, so
it's never a silent surprise.

## Page geometry

```ts
interface PageSpec {
  format: 'A4' | 'A3' | 'Letter' | 'Legal' | { widthPt: number; heightPt: number };
  orientation: 'portrait' | 'landscape';
  margin: number | { top: number; right: number; bottom: number; left: number }; // pt
}
```

`contentHeightPt = pageHeightPt - margin.top - margin.bottom` (and
analogously for width, used for wrapping decisions already baked into the
DOM's own layout — we don't re-wrap, but content wider than
`contentWidthPt` is flagged in debug mode as "will be clipped/overflow").
Orientation swaps width/height before margins are applied.

## The core algorithm: slice by Y, never mid-line, never mid-row

1. Compute `pageCount = ceil(flowHeightPt / contentHeightPt)` as a starting
   point (a first candidate set of page boundaries at
   `k * contentHeightPt`).
2. Walk the `LayoutTree` in document order, maintaining a "cursor" — the
   current page index and its Y-range `[pageTop, pageTop + contentHeightPt)`
   in flow coordinates.
3. For each **atomic** node (a `TextRunNode` — one already-wrapped line; a
   leaf `ImageNode`/`SvgNode`; a `TableRowNode` — one table row):
   - If the node's rect fits entirely within the current page's Y-range,
     place it there, at `localY = flowY - pageTop`.
   - If it doesn't fit and the current page still has room *above* the
     node (i.e., the node merely straddles the boundary), **advance to the
     next page** and re-test — the node is placed whole on the new page,
     which becomes the new cursor. This is what guarantees a text line or a
     table row is never cut in half: atomic nodes are moved as a unit, not
     clipped.
   - If the node is taller than one full page's content height on its own
     (a single line can't be, by definition, but a huge image or an
     oversized table row can), it is clipped to the page — split into a
     visible top portion on the current page and, if still taller than a
     full page, additional full-page slices, with the final remainder on
     the next page. This is the one place "split rather than overflow" (
     spec §7) means an actual pixel-level clip rather than a semantic
     split, because an image has no internal structure to split along.
4. **Non-atomic container nodes** (`BlockNode`, `GroupNode`, the table's own
   wrapping box) are not moved as a unit — their children are placed
   independently per the rules above. The container's own paint (background
   color, border, border-radius) is drawn on **every page it visually
   intersects**, clipped to that page's portion of the container's rect.
   Border-radius is only applied to a page-edge if that edge is the
   container's true top or bottom edge on that page (an edge created purely
   by a page break is drawn square) — documented as a minor visual
   approximation for containers that happen to break exactly at a rounded
   corner, which is rare in practice (containers this large relative to a
   page are usually marked `keepTogether` anyway).

## `keepTogether` / break controls

Resolved during the `LayoutTree` build (`layout/break-rules.ts`), from,
in priority order:
1. An explicit per-call override: `export(el, { keepTogether: ['.card', 'tr'] })`
   (CSS selectors, matched against the *original* DOM before layout).
2. Computed style: `break-inside: avoid` / legacy `page-break-inside: avoid`.
3. `break-before: page` / `page-break-before: always` → forces the node's
   page cursor to advance to a fresh page before placing it.
4. `break-after: page` / `page-break-after: always` → forces a fresh page
   immediately after the node.

A node marked "keep together" whose rect is **taller than one page** cannot
actually be kept together; we emit a debug-mode warning and fall back to the
normal split behavior for its children rather than silently ignoring the
request.

Table rows get `keepTogether` semantics by default (a `TableRowNode` is
always atomic, per the algorithm above) — no CSS needed, because splitting a
row mid-cell is essentially always wrong for tabular data.

## Table header repeat

When a `TableNode`'s rows span more than one page, the pagination engine
re-emits its `headerRowCount` header rows (cloned, re-measured only for
their new page-local Y position — same rects/text/styling) at
`localY = margin.top` on every continuation page before resuming body rows,
and shifts the following body rows down by the repeated header's height.
This is on by default (`repeatHeader: true` in the table's resolved break
rules) and can be disabled per export.

## Headers / footers

Page headers/footers are **not** part of the captured element's flow at
all — they're composed independently per page, after the body content has
been paginated, so their presence doesn't perturb the body's own page
count calculation beyond reserving vertical space for them up front:

```ts
export(el, {
  header: (ctx: { pageNumber: number; pageCount: number }) => string | HTMLElement,
  footer: (ctx: { pageNumber: number; pageCount: number }) => string | HTMLElement,
  headerHeight: 24, // pt, reserved from contentHeightPt before slicing
  footerHeight: 24,
});
```

`pageCount` is only known once slicing is complete, so header/footer
callbacks run in a second pass, after pagination, immediately before
rendering — this is also why "Page X of Y" is possible at all (a
single-pass renderer couldn't know Y while drawing page 1). Header/footer
content reuses the same DOM-inspection → `LayoutTree` path as the body (a
detached, off-screen-rendered fragment per callback result), just anchored
to each page's top/bottom margin instead of being paginated itself.

## Why margins are reserved before slicing, not after

`contentHeightPt` already excludes `margin.top/bottom` (and, when set,
`headerHeight`/`footerHeight`) before step 1 above runs, so slice boundaries
land on genuine content limits — we never compute a boundary and then
discover it doesn't leave room for the footer.
