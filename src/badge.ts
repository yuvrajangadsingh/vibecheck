import type { ScoreResult } from './score.js';

/**
 * Shields-style SVG badge for a slop score.
 *
 * Self-contained on purpose: fetching from shields.io would leak every CI run
 * of every user to a third party, and a badge that 404s when someone else's
 * service is down is worse than no badge.
 */

/** Grade colours follow shields' conventions so the badge reads correctly next to others. */
const GRADE_COLOR: Record<string, string> = {
  A: '#4c1',      // brightgreen
  B: '#97ca00',   // green
  C: '#dfb317',   // yellow
  D: '#fe7d37',   // orange
  F: '#e05d44',   // red
};

/**
 * Approximate rendered width of DejaVu Sans 11px, which is what shields uses
 * and what most Linux renderers fall back to. Per-character widths matter:
 * measuring "A" and "l" the same makes short labels visibly off-centre.
 */
const CHAR_WIDTH: Record<string, number> = {
  ' ': 3.6, i: 2.8, j: 2.8, l: 2.8, I: 3.2, '.': 3.2, ',': 3.2, "'": 2.4,
  f: 4.0, t: 4.0, r: 4.4, '/': 4.0, '(': 4.0, ')': 4.0,
};
const DEFAULT_CHAR_WIDTH = 6.6;

function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += CHAR_WIDTH[ch] ?? DEFAULT_CHAR_WIDTH;
  return Math.round(w);
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export type BadgeOptions = {
  label?: string;
  /** Override the colour; otherwise derived from the grade. */
  color?: string;
};

/**
 * @param score  0-100
 * @param grade  A-F, decides the colour
 */
export function renderBadge(score: number, grade: string, opts: BadgeOptions = {}): string {
  const label = opts.label ?? 'slop score';
  const value = `${score} (${grade})`;
  const color = opts.color ?? GRADE_COLOR[grade] ?? '#9f9f9f';

  const PAD = 10;
  const labelW = textWidth(label) + PAD * 2;
  const valueW = textWidth(value) + PAD * 2;
  const total = labelW + valueW;
  const H = 20;

  // x positions are in tenths, matching shields' textLength trick, which keeps
  // the text from reflowing when a renderer substitutes a different font.
  const labelX = (labelW / 2) * 10;
  const valueX = (labelW + valueW / 2) * 10;
  const labelTextLen = (labelW - PAD * 2) * 10;
  const valueTextLen = (valueW - PAD * 2) * 10;
  const a11y = `${label}: ${value}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${total}" height="${H}" role="img" aria-label="${esc(a11y)}">
  <title>${esc(a11y)}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="${total}" height="${H}" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelW}" height="${H}" fill="#555"/>
    <rect x="${labelW}" width="${valueW}" height="${H}" fill="${esc(color)}"/>
    <rect width="${total}" height="${H}" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="110" text-rendering="geometricPrecision">
    <text aria-hidden="true" x="${labelX}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${labelTextLen}">${esc(label)}</text>
    <text x="${labelX}" y="140" transform="scale(.1)" textLength="${labelTextLen}">${esc(label)}</text>
    <text aria-hidden="true" x="${valueX}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${valueTextLen}">${esc(value)}</text>
    <text x="${valueX}" y="140" transform="scale(.1)" textLength="${valueTextLen}">${esc(value)}</text>
  </g>
</svg>
`;
}

export function badgeFor(result: ScoreResult, opts?: BadgeOptions): string {
  return renderBadge(result.score, result.grade, opts);
}

export { GRADE_COLOR };
