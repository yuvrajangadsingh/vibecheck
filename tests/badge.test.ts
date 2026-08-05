import { describe, it, expect } from 'vitest';
import { renderBadge, badgeFor, GRADE_COLOR } from '../src/badge.js';
import { computeScore } from '../src/score.js';

describe('badge', () => {
  it('is valid standalone SVG with no external references', () => {
    const svg = renderBadge(68, 'D');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.trim().endsWith('</svg>')).toBe(true);
    // A badge that fetches from shields.io would leak every CI run of every
    // user to a third party, and break when that service does.
    expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
  });

  it('colours by grade', () => {
    expect(renderBadge(95, 'A')).toContain(GRADE_COLOR.A);
    expect(renderBadge(30, 'F')).toContain(GRADE_COLOR.F);
    expect(renderBadge(95, 'A')).not.toContain(GRADE_COLOR.F);
  });

  it('falls back to grey for an unknown grade rather than throwing', () => {
    expect(renderBadge(50, 'Z')).toContain('#9f9f9f');
  });

  it('shows the score and grade', () => {
    const svg = renderBadge(68, 'D');
    expect(svg).toContain('68 (D)');
  });

  it('widens for longer text instead of clipping it', () => {
    const short = renderBadge(7, 'F');
    const long = renderBadge(100, 'A');
    const w = (s: string) => Number(/width="(\d+)"/.exec(s)![1]);
    expect(w(long)).toBeGreaterThan(w(short));
  });

  it('escapes a custom label so it cannot break the SVG', () => {
    const svg = renderBadge(50, 'C', { label: 'a<b>&"c' });
    expect(svg).toContain('a&lt;b&gt;&amp;&quot;c');
    expect(svg).not.toContain('<b>');
  });

  it('carries an accessible label', () => {
    const svg = renderBadge(68, 'D');
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="slop score: 68 (D)"');
    expect(svg).toContain('<title>slop score: 68 (D)</title>');
  });

  it('accepts a colour override', () => {
    expect(renderBadge(68, 'D', { color: '#123456' })).toContain('#123456');
  });

  it('badgeFor takes a score result end to end', () => {
    const r = computeScore([], 10_000);
    const svg = badgeFor(r);
    expect(svg).toContain('100 (A)');
    expect(svg).toContain(GRADE_COLOR.A);
  });
});
