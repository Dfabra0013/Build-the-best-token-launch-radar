// Smoke test: build the entry from the synthetic fixture and check the invariants the gate cares about.
//   node scripts/smoke.mjs
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'token-radar-smoke-'));

execFileSync(process.execPath, [join(root, 'main.ts'), '--input', join(root, 'test', 'fixture-snapshot.json'), '--output', out], { stdio: 'inherit' });

const board = JSON.parse(readFileSync(join(out, 'board.json'), 'utf8')).rows;
const snapshot = JSON.parse(readFileSync(join(root, 'test', 'fixture-snapshot.json'), 'utf8'));
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

check(board.length >= snapshot.watchlist.length, 'board covers fewer rows than the watchlist');
for (const slug of snapshot.watchlist) check(board.some((r) => r.slug === slug), `watchlist slug ${slug} missing`);
check(board.every((r, i) => r.rank === i + 1), 'ranks are not 1..n in order');
check(board.every((r, i, a) => i === 0 || a[i - 1].implied_value_usd >= r.implied_value_usd), 'implied value not descending');
check(board.every((r) => Number.isSafeInteger(r.implied_value_usd) && r.implied_value_usd > 0), 'implied value not a positive safe integer');
check(board.every((r) => r.farm_steps.length >= 3 && r.farm_steps.length <= 12), 'farm step count out of range');
check(board.every((r) => r.farm_steps.every((s) => s.length >= 20 && s.length <= 600)), 'a farm step is outside 20..600 characters');
check(!board.some((r) => r.slug === 'fixture-wrapped'), 'wrapped product leaked into the board');
check(!board.some((r) => r.slug === 'fixture-v2'), 'versioned pool leaked into the board');
check(!board.some((r) => r.category === 'Canonical Bridge'), 'canonical bridge leaked into the board');
check(!board.some((r) => r.category === 'CEX'), 'CEX leaked into the board');
for (const file of ['board.json', 'data.js', 'dossier.json', 'dashboard/index.html', 'dashboard/app.css', 'dashboard/app.js']) {
  check(existsSync(join(out, file)), `${file} was not written`);
}
const dossier = JSON.parse(readFileSync(join(out, 'dossier.json'), 'utf8'));
check(dossier.schema === 'makefun/dossier/v1', 'dossier schema mismatch');
check(Array.isArray(dossier.images) && dossier.images.length >= 3, 'dossier holds fewer than 3 images');

if (failures.length) {
  console.error(`smoke: FAILED\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
console.log(`smoke: ok — ${board.length} rows, dossier ${dossier.images.length} images, invariants hold`);
