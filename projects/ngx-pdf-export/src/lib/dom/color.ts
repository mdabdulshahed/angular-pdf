import { RgbaColor } from '../model/nodes';

const RGBA_RE = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i;

let probeCtx: CanvasRenderingContext2D | null | undefined;

function getProbeCtx(): CanvasRenderingContext2D | null {
  if (probeCtx === undefined) {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    probeCtx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | null;
  }
  return probeCtx;
}

/**
 * Resolves any valid CSS color string to concrete RGBA components.
 *
 * getComputedStyle() normalizes plain colors to rgb()/rgba(), which the
 * fast regex path below handles directly. But it does NOT downgrade
 * CSS Color 4 results -- color-mix(), oklch(), lab(), lch(), and the
 * color(<colorspace> ...) function are all returned as-is (e.g.
 * `color-mix(in srgb, blue 50%, transparent)` serializes to
 * `color(srgb 0 0 1 / 0.5)`, not `rgba(...)`), which a naive rgb()-only
 * parser silently fails to match. Since these are increasingly common in
 * modern component libraries (including Angular's own current starter
 * template), we fall back to asking the browser itself to resolve them:
 * assigning the string to a 1x1 canvas's `fillStyle` and reading the
 * rasterized pixel back is correct for *any* syntactically valid CSS
 * color, because that's exactly what the canvas rasterizer has to do
 * internally regardless of the input color space. See docs/css-support.md.
 */
export function parseComputedColor(value: string | null | undefined): RgbaColor | undefined {
  if (!value) {
    return undefined;
  }
  if (value === 'transparent') {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  const trimmed = value.trim();
  const match = RGBA_RE.exec(trimmed);
  if (match) {
    return {
      r: clamp255(Number(match[1])),
      g: clamp255(Number(match[2])),
      b: clamp255(Number(match[3])),
      a: match[4] !== undefined ? clamp01(Number(match[4])) : 1,
    };
  }
  return resolveViaCanvas(trimmed);
}

const SENTINEL = '#010203';

function resolveViaCanvas(value: string): RgbaColor | undefined {
  const ctx = getProbeCtx();
  if (!ctx) {
    return undefined;
  }
  ctx.fillStyle = SENTINEL;
  ctx.fillStyle = value; // per spec, an invalid value is silently ignored (fillStyle keeps its prior value)
  if (ctx.fillStyle === SENTINEL) {
    return undefined; // assignment was rejected -- not a color this browser understands either
  }
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  return { r, g, b, a: a / 255 };
}

export function isTransparent(color: RgbaColor | undefined): boolean {
  return !color || color.a <= 0;
}

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
