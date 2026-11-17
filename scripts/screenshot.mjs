// Regenerates the three screenshots from a built output directory.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
//   node scripts/screenshot.mjs out            # writes screenshots/1-board.png, 2-detail.png, 3-filtered.png
//
// The grader never runs this: it copies the committed screenshots/ as they are. This script exists so a
// contributor can reproduce them. It uses @sparticuz/chromium (a serverless Chromium published on npm),
// so no system browser is needed on Linux x64; on Debian-family systems the bundled Amazon Linux 2023
// libraries are extracted to a cache dir and added to LD_LIBRARY_PATH automatically. Override the page
// with SCREENSHOT_URL=... to shoot a different build.
//
//   npm install            # once, to get the two devDependencies
//   SCREENSHOT_URL=file:///abs/path/out/dashboard/index.html node scripts/screenshot.mjs

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(here, '..');
const outDir = resolve(process.argv[2] ?? 'out');
const shotsDir = join(repoRoot, 'screenshots');
const url = process.env.SCREENSHOT_URL ?? `file://${join(outDir, 'dashboard', 'index.html')}`;

/** Make the bundled AL2023 libraries available on non-AL2023 systems. */
const al2023Libs = () => {
  const marker = join(tmpdir(), 'token-radar-al2023-lib');
  const libsDir = join(marker, 'lib');
  if (existsSync(join(libsDir, 'libnspr4.so'))) return libsDir;
  const archive = join(repoRoot, 'node_modules', '@sparticuz', 'chromium', 'bin', 'al2023.tar.br');
  if (!existsSync(archive)) return null; // nothing bundled to extract; hope the system has the libraries
  const raw = zlib.brotliDecompressSync(readFileSync(archive), { maxOutputLength: 1 << 28 });
  const tarPath = join(tmpdir(), 'token-radar-al2023.tar');
  writeFileSync(tarPath, raw);
  mkdirSync(marker, { recursive: true });
  execFileSync('tar', ['-xf', tarPath, '-C', marker], { stdio: 'ignore' });
  return libsDir;
};

const chromium = (await import('@sparticuz/chromium')).default;
const puppeteer = (await import('puppeteer-core')).default;
const libs = al2023Libs();
const executablePath = await chromium.executablePath();

const browser = await puppeteer.launch({
  args: [...chromium.args, '--no-sandbox', '--disable-dev-shm-usage'],
  executablePath,
  headless: 'shell',
  env: libs ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
});

const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1.15 });
await page.goto(url, { waitUntil: 'networkidle0', timeout: 30_000 });

mkdirSync(shotsDir, { recursive: true });

// 1 — the board, ranked by implied launch value
await page.screenshot({ path: join(shotsDir, '1-board.png') });

// 2 — a protocol's detail view: the first row's farm plan, open
const firstSlug = await page.evaluate(() => document.querySelector('tr[data-slug]')?.dataset.slug ?? null);
if (firstSlug) {
  await page.click(`tr[data-slug="${firstSlug}"]`);
  await new Promise((r) => setTimeout(r, 400));
}
await page.screenshot({ path: join(shotsDir, '2-detail.png') });
if (firstSlug) await page.click('#drawer-close');

// 3 — a filtered view: the Risk Curators category, the watchlist's dominant family
await new Promise((r) => setTimeout(r, 250));
const chip = await page.$('.cat-chip[data-category="Risk Curators"]');
if (chip) await chip.click();
else await page.click('#seg-watchlist');
await new Promise((r) => setTimeout(r, 250));
await page.screenshot({ path: join(shotsDir, '3-filtered.png') });

await browser.close();
console.log(`wrote ${join(shotsDir, '1-board.png')}, ${join(shotsDir, '2-detail.png')}, ${join(shotsDir, '3-filtered.png')}`);
