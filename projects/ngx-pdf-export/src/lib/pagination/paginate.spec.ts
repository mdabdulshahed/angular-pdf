import { describe, expect, it } from 'vitest';
import { paginate } from './paginate';
import { BlockNode, DEFAULT_BREAK_RULES, DocumentNode, TableNode, TableRowNode, TextRunNode } from '../model/nodes';

const CH = 200; // content height per "page" for these tests

function textNode(id: string, y: number, height: number, text = id): TextRunNode {
  return {
    id,
    type: 'text',
    rect: { x: 0, y, width: 100, height },
    visible: true,
    break: { ...DEFAULT_BREAK_RULES },
    text,
    font: { family: 'Helvetica', weight: 400, style: 'normal', sizePt: height * 0.8 },
    color: { r: 0, g: 0, b: 0, a: 1 },
    letterSpacingPt: 0,
    align: 'left',
    decoration: { underline: false, lineThrough: false },
    baselineOffsetPt: height * 0.8,
  };
}

function block(id: string, y: number, height: number, children: TextRunNode[] = [], breakOverrides: Partial<TextRunNode['break']> = {}): BlockNode {
  return {
    id,
    type: 'block',
    rect: { x: 0, y, width: 100, height },
    visible: true,
    break: { ...DEFAULT_BREAK_RULES, ...breakOverrides },
    paint: { opacity: 1 },
    children,
  };
}

function blockWithBackground(id: string, y: number, height: number, children: TextRunNode[] = []): BlockNode {
  return {
    ...block(id, y, height, children),
    paint: { opacity: 1, backgroundColor: { r: 240, g: 240, b: 240, a: 1 } },
  };
}

function doc(children: DocumentNode['children']): DocumentNode {
  return { flowWidthPt: 100, flowHeightPt: 10000, children };
}

describe('paginate: text lines are never split mid-line', () => {
  it('moves a line that straddles a page boundary whole onto the next page', () => {
    // A 20pt-tall line starting at y=190 would span [190,210), straddling the 200 boundary.
    const line = textNode('straddler', 190, 20);
    const result = paginate(doc([line]), { contentHeightPt: CH });

    expect(result.pages).toHaveLength(2);
    expect(result.pages[0].primitives).toHaveLength(0);
    expect(result.pages[1].primitives).toHaveLength(1);
    expect(result.pages[1].primitives[0].rect.y).toBe(0);
  });

  it('keeps a line that fits entirely within a page on that page', () => {
    const line = textNode('fits', 50, 20);
    const result = paginate(doc([line]), { contentHeightPt: CH });
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].primitives[0].rect.y).toBe(50);
  });
});

describe('paginate: break-before / break-after', () => {
  it('forces a fresh page for break-before: page, but not for the very first element', () => {
    const first = textNode('first', 10, 10, 'first');
    const result = paginate(doc([{ ...first, break: { ...first.break, breakBefore: 'page' } }]), { contentHeightPt: CH });
    expect(result.pages).toHaveLength(1);
  });

  it('forces a fresh page for break-before: page when content already exists on the current page', () => {
    const a = textNode('a', 10, 10);
    const b = textNode('b', 30, 10);
    (b as TextRunNode).break = { ...b.break, breakBefore: 'page' };
    const result = paginate(doc([a, b]), { contentHeightPt: CH });
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0].primitives).toHaveLength(1);
    expect(result.pages[1].primitives).toHaveLength(1);
  });
});

describe('paginate: keepTogether (break-inside: avoid)', () => {
  it('pushes a container that would straddle a boundary whole onto the next page', () => {
    // Container spans [180, 230) -- straddles 200 -- and is marked keepTogether.
    const child = textNode('child', 190, 20);
    const container = block('card', 180, 50, [child], { breakInside: 'avoid' });
    const result = paginate(doc([container]), { contentHeightPt: CH });

    expect(result.pages).toHaveLength(2);
    expect(result.pages[0].primitives).toHaveLength(0);
    // The container's background/border + its child text should both land on page 2.
    expect(result.pages[1].primitives.length).toBeGreaterThan(0);
  });

  it('does not move a keepTogether container that already fits on the current page', () => {
    const child = textNode('child', 15, 20);
    const container = block('card', 10, 30, [child], { breakInside: 'avoid' });
    const result = paginate(doc([container]), { contentHeightPt: CH });
    expect(result.pages).toHaveLength(1);
  });

  it('falls back to normal splitting when a keepTogether container is taller than a page', () => {
    const child1 = textNode('c1', 10, 10);
    const child2 = textNode('c2', CH + 10, 10); // forces the container past one page
    const container = block('tall', 0, CH + 30, [child1, child2], { breakInside: 'avoid' });
    const result = paginate(doc([container]), { contentHeightPt: CH });
    expect(result.pages.length).toBeGreaterThan(1);
  });
});

describe('paginate: paint order', () => {
  it('draws a non-atomic container background before its own text children, never on top of them', () => {
    // Regression test: a container's background primitive must be pushed
    // *before* its children's primitives in the page's primitive list, so
    // it paints behind them -- otherwise an opaque background fill drawn
    // after its own text/icon children completely hides them. This is
    // easy to get backwards because the background's true extent can only
    // be known once children are placed for multi-page containers, which
    // tempts placing it last; see docs/pagination.md.
    const child1 = textNode('label', 10, 10, 'Total Revenue');
    const child2 = textNode('value', 25, 14, '₹1,39,388');
    const card = blockWithBackground('card', 0, 50, [child1, child2]);
    const result = paginate(doc([card]), { contentHeightPt: CH });

    const primitives = result.pages[0].primitives;
    const bgIndex = primitives.findIndex((p) => p.kind === 'block' && p.node.id === 'card');
    const labelIndex = primitives.findIndex((p) => p.kind === 'text' && (p.node as TextRunNode).text === 'Total Revenue');
    const valueIndex = primitives.findIndex((p) => p.kind === 'text' && (p.node as TextRunNode).text === '₹1,39,388');

    expect(bgIndex).toBeGreaterThanOrEqual(0);
    expect(labelIndex).toBeGreaterThan(bgIndex);
    expect(valueIndex).toBeGreaterThan(bgIndex);
  });

  it('draws a keepTogether container background before its children too', () => {
    const child = textNode('label', 10, 10, 'Explore the Docs');
    const pill = blockWithBackground('pill', 0, 27, [child]);
    pill.break = { ...pill.break, breakInside: 'avoid' };
    const result = paginate(doc([pill]), { contentHeightPt: CH });

    const primitives = result.pages[0].primitives;
    const bgIndex = primitives.findIndex((p) => p.kind === 'block' && p.node.id === 'pill');
    const textIndex = primitives.findIndex((p) => p.kind === 'text');

    expect(bgIndex).toBeLessThan(textIndex);
  });
});

describe('paginate: tables', () => {
  function tableWithRows(rowCount: number, rowHeight: number): TableNode {
    const headerCell = { id: 'h-cell', rect: { x: 0, y: 0, width: 100, height: rowHeight }, isHeader: true, paint: { opacity: 1 }, content: [textNode('h-text', 0, rowHeight, 'Header')] };
    const headerRow: TableRowNode = { id: 'header', rect: { x: 0, y: 0, width: 100, height: rowHeight }, isHeader: true, cells: [headerCell] };

    const bodyRows: TableRowNode[] = Array.from({ length: rowCount }, (_, i) => {
      const y = (i + 1) * rowHeight;
      const cell = { id: `cell-${i}`, rect: { x: 0, y, width: 100, height: rowHeight }, isHeader: false, paint: { opacity: 1 }, content: [textNode(`row-${i}-text`, y, rowHeight, `Row ${i}`)] };
      return { id: `row-${i}`, rect: { x: 0, y, width: 100, height: rowHeight }, isHeader: false, cells: [cell] };
    });

    return {
      id: 'table',
      type: 'table',
      rect: { x: 0, y: 0, width: 100, height: (rowCount + 1) * rowHeight },
      visible: true,
      break: { ...DEFAULT_BREAK_RULES },
      columns: [{ x: 0, width: 100 }],
      rows: [headerRow, ...bodyRows],
      headerRowCount: 1,
      repeatHeader: true,
    };
  }

  it('never splits a row across pages', () => {
    // Row height 30, content height 200 -> a row starting at y=190 would straddle.
    const table = tableWithRows(10, 30);
    const result = paginate(doc([table]), { contentHeightPt: CH });
    for (const page of result.pages) {
      for (const prim of page.primitives) {
        expect(prim.rect.y).toBeGreaterThanOrEqual(0);
        expect(prim.rect.y + prim.rect.height).toBeLessThanOrEqual(CH + 0.5);
      }
    }
  });

  it('repeats the header row on every continuation page', () => {
    const table = tableWithRows(20, 30); // tall enough to span several pages
    const result = paginate(doc([table]), { contentHeightPt: CH });
    expect(result.pages.length).toBeGreaterThan(1);

    for (const page of result.pages) {
      const headerText = page.primitives.find((p) => p.kind === 'text' && (p.node as TextRunNode).text === 'Header');
      expect(headerText).toBeDefined();
    }
  });
});
