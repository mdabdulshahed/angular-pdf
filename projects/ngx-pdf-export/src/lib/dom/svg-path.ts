/**
 * Rewrites the numeric coordinates in an SVG path `d` string by a scale
 * factor, so a path authored in the SVG's own viewBox units can be
 * embedded directly in PDF point space without a separate transform.
 *
 * This is a generic tokenizer for well-formed path data (commands
 * separated from numbers, numbers separated by whitespace/commas). It
 * does not handle the rare "arc flags packed with no separator" shorthand
 * (e.g. `A5 5 0 01 1 10 10`) some minifiers produce -- documented in
 * docs/css-support.md.
 */
const COMMAND_RE = /[MLHVCSQTAZmlhvcsqtaz]/;
const NUMBER_RE = /[-+]?(?:\d+\.\d+|\.\d+|\d+)(?:[eE][-+]?\d+)?/g;

// Number of coordinate values per command letter, and which of those are
// x-like vs y-like (for independent sx/sy scaling). 'f' = flag (unscaled).
const PARAM_ROLES: Record<string, Array<'x' | 'y' | 'f'>> = {
  M: ['x', 'y'],
  L: ['x', 'y'],
  T: ['x', 'y'],
  H: ['x'],
  V: ['y'],
  C: ['x', 'y', 'x', 'y', 'x', 'y'],
  S: ['x', 'y', 'x', 'y'],
  Q: ['x', 'y', 'x', 'y'],
  A: ['x', 'y', 'f', 'f', 'f', 'x', 'y'],
  Z: [],
};

export function scalePathData(d: string, sx: number, sy: number): string {
  let out = '';
  let i = 0;
  let currentRoles: Array<'x' | 'y' | 'f'> = [];
  let roleIndex = 0;

  while (i < d.length) {
    const ch = d[i];
    if (COMMAND_RE.test(ch)) {
      out += ch;
      currentRoles = PARAM_ROLES[ch.toUpperCase()] ?? [];
      roleIndex = 0;
      i++;
      continue;
    }
    if (/\s|,/.test(ch)) {
      out += ch;
      i++;
      continue;
    }
    NUMBER_RE.lastIndex = i;
    const match = NUMBER_RE.exec(d);
    if (!match || match.index !== i) {
      // Unrecognized character; copy through unchanged rather than throw.
      out += ch;
      i++;
      continue;
    }
    const raw = match[0];
    const value = Number(raw);
    const role = currentRoles.length ? currentRoles[roleIndex % currentRoles.length] : 'x';
    roleIndex++;
    const scaled = role === 'y' ? value * sy : role === 'x' ? value * sx : value;
    out += formatNumber(scaled);
    i += raw.length;
  }
  return out;
}

function formatNumber(n: number): string {
  const rounded = Math.round(n * 1000) / 1000;
  return String(rounded);
}
