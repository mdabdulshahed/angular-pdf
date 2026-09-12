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
- `registerFont()` for custom TTF/OTF fonts (required for non-Latin
  Unicode text — see the Unicode note below).
- Multi-page pagination with `keepTogether`, `break-before`/`break-after`,
  and repeated table headers.
- Headers/footers with page numbers (`Page X of Y`).
- A `debug: true` mode that outlines page boundaries and rasterized
  fallback elements directly on the output PDF.

## Unicode note

The default (Standard-14) fonts only support Latin-1-ish text. For ₹,
Arabic, Devanagari, CJK, or most accented characters, register a Unicode
TTF/OTF font first:

```ts
await pdf.registerFont({ family: 'Noto Sans', src: '/fonts/NotoSans-Regular.ttf', weight: 400 });
```

Use a **static** font file (a single weight/style), not a variable font —
`@pdf-lib/fontkit` does not subset variable fonts correctly.

## Documentation

Full architecture docs, CSS support matrix, pagination algorithm, and API
design are in the [repository's `docs/` folder](https://github.com/mdabdulshahed/angular-pdf/tree/main/docs).

## License

MIT
