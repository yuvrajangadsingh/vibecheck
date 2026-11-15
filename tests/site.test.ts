import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { execFile, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { auditSite, robotsBlocksAll } from '../src/site.js';

const ROOT = resolve(import.meta.dirname, '..');
const CLI = join(ROOT, 'dist', 'cli.js');

type Route = { status?: number; type?: string; headers?: Record<string, string>; body: string };

function serve(routes: Record<string, Route>, fallback: Route): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const r = routes[(req.url ?? '/').split('?')[0]] ?? fallback;
    res.writeHead(r.status ?? 200, { 'content-type': r.type ?? 'text/html', ...r.headers });
    res.end(r.body);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => {
    ok({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/` });
  }));
}

// A Vite starter shipped as is: every path answers with the app shell.
const SLOPPY_INDEX = `<!doctype html><html><head><title>Vite + React + TS</title>
<link rel="stylesheet" href="/assets/index.css">
<link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet">
<script src="https://static.hotjar.com/c/hotjar-1.js"></script>
</head><body><div id="root"></div><script type="module" src="/assets/index-abc.js"></script></body></html>`;

const CLEAN_INDEX = `<!doctype html><html lang="en"><head><title>Acme invoices</title>
<meta name="description" content="Invoices for small shops.">
<meta property="og:image" content="/og.png">
<link rel="canonical" href="/"><link rel="icon" href="/icon.png">
</head><body><h1>Acme invoices</h1><p>Send an invoice in a minute and get paid by UPI or card, with reminders that go out on their own.</p>
<a href="/privacy">Privacy</a><script src="/app.js"></script></body></html>`;

// Has content, so the copy checks run; robots.txt blocks everyone in the second group.
const BLOCKED_INDEX = `<!doctype html><html lang="en"><head><title>Notes</title></head><body>
<p>Write notes fast — sync them — share them &mdash; all from one place, for every team that needs it.</p>
<a href="/terms">Terms</a><footer>Edit with Lovable</footer></body></html>`;

let sloppy: { server: Server; url: string };
let clean: { server: Server; url: string };
let blocked: { server: Server; url: string };
let short: { server: Server; url: string };

beforeAll(async () => {
  if (!existsSync(CLI)) execSync('npm run build', { cwd: ROOT, stdio: 'ignore' });
  sloppy = await serve({
    '/assets/index.css': { type: 'text/css', body: '.bg-gradient-to-r{}.from-purple-500{--tw-gradient-from:#a855f7}' },
    // The map is named only by the comment, so guessing <script>.map would miss it.
    '/assets/index-abc.js': { type: 'text/javascript', body: 'console.log(1)\n//# sourceMappingURL=maps/app.map' },
    '/assets/maps/app.map': { type: 'application/json', body: '{"version":3,"sources":["a.ts"],"mappings":"AAAA"}' },
    '/.env': { type: 'text/plain', body: '# local\nexport API_KEY=xk_test_123\n' },
    '/.git/HEAD': { type: 'text/plain', body: 'ref: refs/heads/main\n' },
  }, { body: SLOPPY_INDEX });
  const securityHeaders = { 'content-security-policy': "default-src 'self'", 'x-content-type-options': 'nosniff' };
  clean = await serve({
    '/': { headers: securityHeaders, body: CLEAN_INDEX },
    '/robots.txt': { type: 'text/plain', body: 'User-agent: *\nDisallow: /admin\n' },
    '/sitemap.xml': { type: 'application/xml', body: '<?xml version="1.0"?><urlset><url><loc>/</loc></url></urlset>' },
    '/app.js': { type: 'text/javascript', headers: { sourcemap: 'http://[' }, body: 'console.log(1)' },
    '/icon.png': { type: 'image/png', body: 'png' },
    '/.env': { status: 503, body: 'busy' },
    '/.git/HEAD': { status: 202, headers: { 'x-amzn-waf-action': 'challenge' }, body: '' },
  }, { status: 404, body: 'not found' });
  blocked = await serve({
    '/': { headers: securityHeaders, body: BLOCKED_INDEX },
    '/robots.txt': { type: 'text/plain', body: 'User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nDisallow: /\n' },
  }, { status: 404, body: 'not found' });
  // A rendered page that is just short, behind a login: neither JS-only nor a soft 404.
  short = await serve({
    '/': { body: '<html lang="en"><body><p>Coming soon.</p><script type="module" src="https://www.googletagmanager.com/gtag/js"></script>'
      + '<script type="application/ld+json">{"url":"https://www.hotjar.com/"}</script><a href="https://fonts.googleapis.com/">fonts</a></body></html>' },
    '/login': { body: '<html><body><form>Log in</form></body></html>' },
  }, { status: 302, headers: { location: '/login' }, body: '' });
});

afterAll(() => {
  for (const s of [sloppy, clean, blocked, short]) s?.server.close();
});

const ids = async (url: string) => (await auditSite(url)).findings.map((f) => f.id).sort();

describe('vibecheck site', () => {
  it('flags a starter app shipped as is', async () => {
    expect(await ids(sloppy.url)).toEqual([
      'exposed-env', 'exposed-git', 'exposed-source-map', 'google-fonts', 'js-only-page', 'missing-canonical',
      'missing-csp', 'missing-description', 'missing-lang', 'missing-nosniff', 'missing-og-image', 'no-favicon',
      'no-https', 'no-robots', 'no-sitemap', 'purple-gradient', 'session-replay', 'soft-404', 'template-title',
    ]);
  });

  it('names the map the script points at', async () => {
    const report = await auditSite(sloppy.url);
    expect(report.findings.find((f) => f.id === 'exposed-source-map')?.message).toBe('source maps are public: /assets/maps/app.map');
  });

  it('finds nothing but plain http on a finished page, and lists the probes that did not answer', async () => {
    const report = await auditSite(clean.url);
    expect(report.findings.map((f) => f.id)).toEqual(['no-https']);
    expect(report.notChecked.sort()).toEqual([`${clean.url}.env (503)`, `${clean.url}.git/HEAD (202)`]);
  });

  it('reads the copy and robots.txt groups', async () => {
    const report = await auditSite(blocked.url);
    expect(report.findings.map((f) => f.id)).toEqual(expect.arrayContaining(['robots-blocks-all', 'em-dashes', 'builder-badge', 'no-privacy-link']));
    expect(report.findings.find((f) => f.id === 'em-dashes')?.message).toBe('3 em dashes in the page copy');
  });

  it('does not call a short page JS-only, a login redirect a soft 404, or a mention a loaded script', async () => {
    const found = await ids(short.url);
    for (const id of ['js-only-page', 'soft-404', 'session-replay', 'google-fonts']) expect(found).not.toContain(id);
  });

  it('blocks all only when no crawler group lets anything through', () => {
    expect(robotsBlocksAll('User-agent: *\nDisallow: /\n')).toBe(true);
    expect(robotsBlocksAll('User-agent: Googlebot\nDisallow:\n\nUser-agent: *\nDisallow: /\n')).toBe(false);
    expect(robotsBlocksAll('User-agent: *\nDisallow: /\nAllow: /blog\n')).toBe(false);
    expect(robotsBlocksAll('User-agent: *\nDisallow: /admin\n')).toBe(false);
    expect(robotsBlocksAll('User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nDisallow: /\n\nUser-agent: Googlebot\nDisallow: /admin\n')).toBe(true);
  });

  it('exits 1 on an exposed file, 0 without, 2 when the site is down', async () => {
    const run = (args: string[]) => promisify(execFile)('node', [CLI, ...args]).then(
      (r) => ({ code: 0, stdout: r.stdout }),
      (e: { code: number; stdout: string }) => ({ code: e.code, stdout: e.stdout }),
    );
    const bad = await run(['site', sloppy.url, '--json']);
    expect(bad.code).toBe(1);
    expect(JSON.parse(bad.stdout).findings[0].id).toBe('exposed-env');
    expect((await run(['site', clean.url])).code).toBe(0);
    expect((await run(['site', 'http://127.0.0.1:1/'])).code).toBe(2);
  });
});
