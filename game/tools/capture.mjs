#!/usr/bin/env node
// Screenshot harness: serves game/ over http, drives headless Chromium (WebGL via
// SwiftShader), captures the DESIGN.md presets, reports console errors + perf stats.
// Usage: node capture.mjs [--presets overview,gameplay,...] [--out DIR] [--perf]
// Env: PW_NODE_MODULES (dir containing playwright-core), CHROME_PATH (chromium binary)
import http from 'node:http';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const gameDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const PRESETS = opt('--presets', 'overview,gameplay,hero,ult,river,base').split(',');
const OUT = path.resolve(opt('--out', path.join(gameDir, 'tools', 'shots')));
const PERF = args.includes('--perf');
mkdirSync(OUT, { recursive: true });

const require_ = createRequire(path.join(process.env.PW_NODE_MODULES ?? path.join(gameDir, 'tools'), 'x.js'));
const { chromium } = require_('playwright-core');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
    let p = path.normalize(path.join(gameDir, decodeURIComponent(url.pathname)));
    if (!p.startsWith(gameDir)) { res.writeHead(403); return res.end(); }
    if (url.pathname === '/') p = path.join(gameDir, 'index.html');
    const body = await readFile(p);
    res.writeHead(200, { 'content-type': MIME[path.extname(p)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
});
const ctx = await browser.newContext({
  viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
});
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 500)); });
page.on('pageerror', e => errors.push(String(e).slice(0, 500)));

const result = { shots: [], errors, perf: null };
try {
  await page.goto(`http://127.0.0.1:${port}/index.html?shot=1&seed=42`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction('window.__WR_READY === true', null, { timeout: 45000 });
  for (const name of PRESETS) {
    await page.evaluate(n => window.__WR_DEBUG.preset(n), name);
    await page.waitForTimeout(300);
    const file = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: file });
    result.shots.push(file);
  }
  if (PERF) {
    result.perf = await page.evaluate(async () => {
      const s = window.__WR_DEBUG.stats?.() ?? {};
      const t0 = performance.now(); let frames = 0;
      await new Promise(res => { const loop = () => { frames++; (performance.now() - t0 < 3000) ? requestAnimationFrame(loop) : res(); }; window.__WR_DEBUG.resume?.(); requestAnimationFrame(loop); });
      return { ...s, fps: Math.round(frames / 3) };
    });
  }
} catch (e) { errors.push('HARNESS: ' + String(e).slice(0, 800)); }
await browser.close(); server.close();
console.log(JSON.stringify(result, null, 2));
process.exit(errors.length ? 1 : 0);
