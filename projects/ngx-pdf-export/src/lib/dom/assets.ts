import { AssetTask } from './inspect';
import { rasterizeElement } from '../fallback/rasterize';
import { pxToPt } from '../model/units';

/** Extra capture margin (CSS px) around a rasterized fallback element, for box-shadow/outline bleed. See docs/css-support.md. */
const FALLBACK_CAPTURE_PAD_PX = 24;

export interface AssetWarning {
  message: string;
  elementDescription: string;
}

/**
 * Resolves every deferred asset (images, canvases, fallback rasterizations)
 * to a data URL, mutating each task's node in place. Runs after layout so
 * we only pay encode/fetch cost for assets that actually made it into the
 * export. See docs/architecture.md "Performance" and docs/layout-engine.md
 * §5.
 */
export async function resolveAssets(tasks: AssetTask[], scale: number, onWarning: (w: AssetWarning) => void): Promise<void> {
  await Promise.all(
    tasks.map(async (task) => {
      try {
        if (task.kind === 'img') {
          task.node.source = { kind: 'data-url', value: await imageToDataUrl(task.element) };
        } else if (task.kind === 'canvas') {
          task.node.source = { kind: 'data-url', value: task.element.toDataURL('image/png') };
        } else {
          const padPx = task.needsBleedPadding ? FALLBACK_CAPTURE_PAD_PX : 0;
          const result = await rasterizeElement(task.element, task.captureWidthPx, task.captureHeightPx, scale, padPx);
          task.node.source = { kind: 'data-url', value: result.dataUrl };
          const padPt = pxToPt(padPx);
          task.node.rect = {
            x: task.node.rect.x - padPt,
            y: task.node.rect.y - padPt,
            width: task.node.rect.width + padPt * 2,
            height: task.node.rect.height + padPt * 2,
          };
          task.node.naturalWidth = result.width;
          task.node.naturalHeight = result.height;
        }
      } catch (err) {
        task.node.visible = false;
        onWarning({
          message: task.kind === 'img' ? `Image could not be embedded (${(err as Error).message}). This is often a CORS restriction -- the image's server must send Access-Control-Allow-Origin, and the <img> needs crossorigin="anonymous".` : `Failed to render element: ${(err as Error).message}`,
          elementDescription: describeElement(task.element),
        });
      }
    }),
  );
}

async function imageToDataUrl(img: HTMLImageElement): Promise<string> {
  const src = img.currentSrc || img.src;
  if (src.startsWith('data:')) {
    return src;
  }
  const response = await fetch(src, { mode: 'cors' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const blob = await response.blob();
  return await blobToDataUrl(blob);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('failed to read image blob'));
    reader.readAsDataURL(blob);
  });
}

function describeElement(el: HTMLElement): string {
  const id = el.id ? `#${el.id}` : '';
  return `<${el.tagName.toLowerCase()}${id}>`;
}
