/**
 * Rasterizes a single DOM element in isolation, for content this library
 * cannot translate into native PDF operators (see docs/css-support.md).
 * This is deliberately scoped to one element at a time -- never the whole
 * captured page -- via the SVG <foreignObject> technique: clone the
 * element, inline every computed style onto the clone (foreignObject
 * content does not inherit the host document's stylesheets), serialize to
 * an SVG data URL, and draw it into an offscreen canvas.
 */
export interface RasterizeResult {
  dataUrl: string;
  /** Total captured size in px, including `padPx` on every side. */
  width: number;
  height: number;
}

/**
 * `padPx` reserves extra canvas space around the element's own border box
 * for effects that visually bleed outside it (box-shadow, outline) --
 * without this, capturing exactly the element's own rect would clip a
 * shadow's blur/spread at the box edge. Callers should grow the node's
 * placement rect by the same amount on every side and shift it up/left by
 * `padPx` so the padded raster lands in the right place. See
 * docs/css-support.md.
 */
export async function rasterizeElement(el: HTMLElement, widthPx: number, heightPx: number, scale: number, padPx = 0): Promise<RasterizeResult> {
  if (widthPx <= 0 || heightPx <= 0) {
    throw new Error('ngx-pdf-export: cannot rasterize an element with zero width/height.');
  }

  const totalWidthPx = widthPx + padPx * 2;
  const totalHeightPx = heightPx + padPx * 2;

  const clone = el.cloneNode(true) as HTMLElement;
  inlineComputedStylesRecursive(el, clone);
  copyCanvasBitmaps(el, clone);
  resolveImageSources(clone);
  clone.style.margin = '0';
  clone.style.transform = 'none';
  clone.style.position = 'static';

  const svgNS = 'http://www.w3.org/2000/svg';
  const xhtmlNS = 'http://www.w3.org/1999/xhtml';

  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('xmlns', svgNS);
  svg.setAttribute('width', String(totalWidthPx));
  svg.setAttribute('height', String(totalHeightPx));
  svg.setAttribute('viewBox', `0 0 ${totalWidthPx} ${totalHeightPx}`);

  const foreignObject = document.createElementNS(svgNS, 'foreignObject');
  foreignObject.setAttribute('width', '100%');
  foreignObject.setAttribute('height', '100%');

  const wrapper = document.createElementNS(xhtmlNS, 'div') as unknown as HTMLDivElement;
  wrapper.setAttribute('xmlns', xhtmlNS);
  wrapper.style.width = `${widthPx}px`;
  wrapper.style.height = `${heightPx}px`;
  wrapper.style.padding = `${padPx}px`;
  wrapper.style.boxSizing = 'content-box';
  wrapper.appendChild(clone);
  foreignObject.appendChild(wrapper);
  svg.appendChild(foreignObject);

  const svgString = new XMLSerializer().serializeToString(svg);
  const svgDataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);

  const img = await loadImage(svgDataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(totalWidthPx * scale);
  canvas.height = Math.ceil(totalHeightPx * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('ngx-pdf-export: 2D canvas context unavailable.');
  }
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, totalWidthPx, totalHeightPx);
  const dataUrl = canvas.toDataURL('image/png');
  canvas.width = 0;
  canvas.height = 0;
  return { dataUrl, width: totalWidthPx, height: totalHeightPx };
}

function inlineComputedStylesRecursive(source: Element, target: Element): void {
  const computed = getComputedStyle(source);
  const styleText: string[] = [];
  for (let i = 0; i < computed.length; i++) {
    const prop = computed.item(i);
    styleText.push(`${prop}:${computed.getPropertyValue(prop)}`);
  }
  (target as HTMLElement).setAttribute('style', styleText.join(';'));

  const sourceChildren = Array.from(source.children);
  const targetChildren = Array.from(target.children);
  for (let i = 0; i < sourceChildren.length; i++) {
    if (targetChildren[i]) {
      inlineComputedStylesRecursive(sourceChildren[i], targetChildren[i]);
    }
  }
}

function copyCanvasBitmaps(source: Element, target: Element): void {
  const sourceCanvases = Array.from(source.querySelectorAll('canvas'));
  const targetCanvases = Array.from(target.querySelectorAll('canvas'));
  for (let i = 0; i < sourceCanvases.length; i++) {
    const src = sourceCanvases[i];
    const dst = targetCanvases[i];
    if (!dst) continue;
    dst.width = src.width;
    dst.height = src.height;
    const ctx = dst.getContext('2d');
    try {
      ctx?.drawImage(src, 0, 0);
    } catch {
      // Cross-origin-tainted canvas: leave blank rather than throw.
    }
  }
}

function resolveImageSources(target: Element): void {
  target.querySelectorAll('img').forEach((img) => {
    const resolved = img.src; // IDL property is already absolute-resolved.
    img.setAttribute('src', resolved);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('ngx-pdf-export: failed to rasterize fallback element.'));
    img.src = src;
  });
}
