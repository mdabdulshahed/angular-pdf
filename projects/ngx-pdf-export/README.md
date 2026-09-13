# ngx-pdf-export

A DOM-aware, client-side Angular library that exports a rendered
Angular/HTML element into a real PDF — with actual selectable, searchable,
copy-pasteable PDF text — entirely in the browser. No backend, no API
calls, and no `html2canvas`-style screenshot-to-image pipeline.

```bash
npm install ngx-pdf-export
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

It reads the browser's own already-computed layout
(`getBoundingClientRect`, `getComputedStyle`, and per-line text boxes via
`Range.getClientRects`) and replays it as real PDF drawing/text operators,
instead of rasterizing the page. Only the rare element using a CSS feature
this library doesn't translate (gradients, box-shadow, CSS filters) is
rasterized — and only that one element, never the whole page.

## Also available

- `PdfExportDirective` (`[pdfExport]`) for template-driven export.
- `toBlob()` / `download()` / `export()` on `PdfExportService`.
- `registerFont()` for custom TTF/OTF fonts — see "Fonts" below; this
  matters for *any* app that cares about the PDF looking like the screen,
  not just non-Latin text.
- Multi-page pagination with `keepTogether`, `break-before`/`break-after`,
  and repeated table headers.
- Headers/footers with page numbers (`Page X of Y`).
- A `debug: true` mode that outlines page boundaries and rasterized
  fallback elements directly on the output PDF.

## Fonts

By default, text is drawn with Helvetica/Times/Courier (the PDF
"Standard-14" fonts) — every PDF reader already has them, so they never
need to be embedded. But they are **not** your app's actual font, and their
character widths don't match it either — so unregistered text can both
look different and end up positioned slightly differently than the same
line on screen (a heading's right edge landing closer to or further from
whatever sits next to it, for example).

To make the PDF match the screen, register your app's actual font file(s),
using the same `font-family` name your CSS uses:

```ts
await pdf.registerFont({ family: 'Inter Tight', src: '/fonts/InterTight-Regular.ttf', weight: 400 });
await pdf.registerFont({ family: 'Inter Tight', src: '/fonts/InterTight-Bold.ttf', weight: 700 });
```

Use a **static** font file (a single weight/style, e.g. `Inter-Regular.ttf`),
not a variable font (e.g. `Inter[wght].ttf`) — `@pdf-lib/fontkit` does not
subset variable fonts correctly. If you only have a variable font, instance
a static weight first: `fonttools varLib.instancer -o Inter-Regular.ttf
"Inter[wght].ttf" wght=400`.

If a `font-family` your content uses is never registered, the library
substitutes the nearest Standard-14 font and logs a warning naming exactly
which family was substituted, so this is never a silent surprise.

### Unicode, emoji, and multi-script text

The Standard-14 fonts only cover Latin-1-ish text. For ₹, Arabic,
Devanagari, CJK, emoji, or most accented characters, register a
Unicode-capable font:

```ts
await pdf.registerFont({ family: 'Noto Sans', src: '/fonts/NotoSans-Regular.ttf', weight: 400 });
```

Every registered font also covers every *other* registered font's missing
glyphs — register an emoji font once, anywhere, under any family name, and
it covers emoji throughout the whole document, even inside text styled
with a completely different `font-family`. This mirrors how a browser's
own CSS font stack silently falls back to a system emoji font per
character; `registerFont()` doesn't take a stack, so instead every
registered font is available as a fallback for every other one.

## Documentation

Full architecture docs, CSS support matrix, pagination algorithm, and API
design are in the [repository's `docs/` folder](https://github.com/mdabdulshahed/angular-pdf/tree/main/docs).

## License

MIT
