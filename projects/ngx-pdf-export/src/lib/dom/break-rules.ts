import { DEFAULT_BREAK_RULES, NodeBreakRules } from '../model/nodes';

/**
 * Resolves break-inside/before/after from computed style, plus an optional
 * caller-supplied `keepTogether` selector list matched against the live
 * element (checked by the caller via `element.matches(selector)`).
 * See docs/pagination.md "keepTogether / break controls".
 */
export function readBreakRules(style: CSSStyleDeclaration, forceKeepTogether: boolean): NodeBreakRules {
  const breakInside = normalizeAvoid(style.breakInside) || normalizeAvoid((style as any).pageBreakInside);
  const breakBefore = normalizePage(style.breakBefore) || normalizePage((style as any).pageBreakBefore);
  const breakAfter = normalizePage(style.breakAfter) || normalizePage((style as any).pageBreakAfter);

  return {
    breakInside: forceKeepTogether || breakInside === 'avoid' ? 'avoid' : 'auto',
    breakBefore: breakBefore === 'page' ? 'page' : 'auto',
    breakAfter: breakAfter === 'page' ? 'page' : 'auto',
  };
}

function normalizeAvoid(value: string | undefined): 'avoid' | undefined {
  return value === 'avoid' ? 'avoid' : undefined;
}

function normalizePage(value: string | undefined): 'page' | undefined {
  return value === 'page' || value === 'always' || value === 'left' || value === 'right' ? 'page' : undefined;
}

export { DEFAULT_BREAK_RULES };
