/**
 * Splits a Text node into per-visual-line runs using only the standard
 * Range API. See docs/layout-engine.md "Text runs via Range".
 *
 * Range.getClientRects() on a range spanning multiple wrapped lines
 * returns one DOMRect per line, in visual order -- the browser has
 * already done line-breaking for us. To recover which substring belongs
 * to which line (needed so the extracted PDF text matches the visible
 * text per line), we binary-search line-count transitions: the number of
 * rects returned by range(0, k) is monotonically non-decreasing in k, so
 * the offset where it first increases from n to n+1 is exactly the start
 * of line n+1. This needs only Range.getClientRects, so it works
 * identically in every browser (no caretRangeFromPoint/caretPositionFromPoint
 * feature-detection needed).
 */
export interface RawTextRun {
  text: string;
  rect: DOMRect;
}

export function extractTextRuns(textNode: Text): RawTextRun[] {
  const data = textNode.data;
  if (!data || !/\S/.test(data)) {
    return [];
  }

  const range = document.createRange();
  range.selectNodeContents(textNode);
  const lineRects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);

  if (lineRects.length <= 1) {
    const rect = lineRects[0] ?? textNode.parentElement?.getBoundingClientRect();
    return rect ? [{ text: data, rect }] : [];
  }

  const boundaries: number[] = [0];
  for (let lineIndex = 0; lineIndex < lineRects.length - 1; lineIndex++) {
    const target = lineIndex + 2;
    const prev = boundaries[boundaries.length - 1];
    const k = findLineBoundary(range, textNode, data.length, target, prev);
    boundaries.push(Math.max(prev, k - 1));
  }
  boundaries.push(data.length);

  const runs: RawTextRun[] = [];
  for (let i = 0; i < lineRects.length; i++) {
    const start = boundaries[i];
    const end = boundaries[i + 1];
    const text = data.slice(start, end);
    if (text.trim().length === 0 && text.length === 0) {
      continue;
    }
    runs.push({ text, rect: lineRects[i] });
  }
  return runs;
}

function countLinesForPrefix(range: Range, node: Text, k: number): number {
  range.setStart(node, 0);
  range.setEnd(node, k);
  return range.getClientRects().length;
}

/** Minimal k in (prev, maxLen] such that the prefix [0, k) spans >= target lines. */
function findLineBoundary(range: Range, node: Text, maxLen: number, target: number, prev: number): number {
  let low = prev + 1;
  let high = maxLen;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (countLinesForPrefix(range, node, mid) >= target) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }
  return low;
}
