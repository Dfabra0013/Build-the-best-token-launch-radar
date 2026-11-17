import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildDossier } from '../vendor/makefun-board.ts';

const out = resolve(process.argv[2] || process.env.MAKEFUN_OUTPUT_DIR || 'out');
const fail = (message) => { throw new Error(`Validation failed: ${message}`); };
const file = (path) => { if (!existsSync(path) || !lstatSync(path).isFile()) fail(`missing regular file ${path}`); return readFileSync(path); };
const walk = (directory, prefix = '') => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
  const full = join(directory, entry.name);
  if (entry.isDirectory()) return walk(full, relative);
  if (!entry.isFile()) fail(`dashboard item is not a regular file: ${relative}`);
  return [{ relative, full, bytes: lstatSync(full).size }];
});

function imageDimensions(bytes) {
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (png) return { type: 'png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8)) fail('screenshot is not PNG or JPEG');
  let at = 2;
  while (at < bytes.length) {
    if (bytes[at] !== 0xff) { at++; continue; }
    while (bytes[at] === 0xff) at++;
    const marker = bytes[at++];
    if ([0xd8, 0xd9].includes(marker)) continue;
    const length = bytes.readUInt16BE(at);
    if (length < 2 || at + length > bytes.length) fail('malformed JPEG');
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      return { type: 'jpeg', height: bytes.readUInt16BE(at + 3), width: bytes.readUInt16BE(at + 5) };
    }
    at += length;
  }
  fail('JPEG dimensions were not found');
}

const board = JSON.parse(file(join(out, 'board.json')).toString('utf8'));
const rows = Array.isArray(board.rows) ? board.rows : fail('board.json rows is not an array');
if (rows.length < 100 || rows.length > 4000) fail(`board has ${rows.length} rows, expected 100–4000`);
const seen = new Set();
let previous = Infinity;
for (const [index, row] of rows.entries()) {
  if (!row.slug || /\s/.test(row.slug) || seen.has(row.slug)) fail(`invalid or duplicate slug at row ${index + 1}`);
  seen.add(row.slug);
  if (row.rank !== index + 1) fail(`rank ${row.rank} is not ${index + 1}`);
  if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0 || row.implied_value_usd > 100_000_000_000_000) fail(`bad implied value for ${row.slug}`);
  if (row.implied_value_usd > previous) fail(`values rise after ${row.slug}`);
  previous = row.implied_value_usd;
  if (!Array.isArray(row.farm_steps) || row.farm_steps.length < 3 || row.farm_steps.length > 12 || row.farm_steps.some((step) => typeof step !== 'string' || step.trim().length < 20 || step.trim().length > 600)) fail(`invalid farm plan for ${row.slug}`);
}
if (new Set(rows.map((row) => row.implied_value_usd)).size < 2) fail('all implied values are identical');
const expectedWatchlist = board.diagnostics?.watchlist_count;
const covered = rows.filter((row) => row.watchlist).length;
if (Number.isInteger(expectedWatchlist) && covered !== expectedWatchlist) fail(`watchlist coverage ${covered}/${expectedWatchlist}`);

const dashboard = join(out, 'dashboard');
if (!existsSync(dashboard)) fail('dashboard directory is missing');
const dashFiles = walk(dashboard);
const dashBytes = dashFiles.reduce((sum, item) => sum + item.bytes, 0);
if (!dashFiles.some((item) => item.relative === 'index.html') || !dashFiles.some((item) => item.relative.endsWith('.css')) || !dashFiles.some((item) => item.relative.endsWith('.js'))) fail('dashboard needs index.html, CSS, and JS');
if (dashFiles.length > 400 || dashBytes > 4 * 1024 * 1024) fail(`dashboard cap exceeded: ${dashFiles.length} files / ${dashBytes} bytes`);
for (const item of dashFiles) {
  if (/https?:\/\//i.test(readFileSync(item.full, 'utf8'))) fail(`network address found in dashboard/${item.relative}`);
}

const screenshots = join(out, 'screenshots');
const names = readdirSync(screenshots).filter((name) => !name.startsWith('.')).sort();
if (names.length < 3 || names.length > 4) fail(`expected 3–4 screenshots, found ${names.length}`);
const shots = names.map((name) => {
  const bytes = file(join(screenshots, name));
  if (bytes.length > 512 * 1024) fail(`${name} exceeds 512 KiB`);
  const dimensions = imageDimensions(bytes);
  const shortSide = Math.min(dimensions.width, dimensions.height);
  const longSide = Math.max(dimensions.width, dimensions.height);
  if (shortSide < 800 || longSide > 1440) fail(`${name} dimensions ${dimensions.width}×${dimensions.height} violate limits`);
  return { name, bytes: bytes.length, dimensions: `${dimensions.width}×${dimensions.height}` };
});

const recordedDossier = file(join(out, 'dossier.json'));
const rebuiltDossier = Buffer.from(buildDossier(out, { text_max_bytes: 65_536 }));
if (!recordedDossier.equals(rebuiltDossier)) fail('dossier.json does not equal buildDossier output');
const dossier = JSON.parse(recordedDossier.toString('utf8'));
if (dossier.schema !== 'makefun/dossier/v1' || dossier.images?.length !== names.length) fail('dossier schema or image list mismatch');

console.log(JSON.stringify({
  valid: true,
  out,
  rows: rows.length,
  watchlist: `${covered}/${expectedWatchlist ?? 'unknown'}`,
  dashboard: { files: dashFiles.length, bytes: dashBytes },
  screenshots: shots,
  dossier: { bytes: recordedDossier.length, sha256: createHash('sha256').update(recordedDossier).digest('hex').slice(0, 16) }
}, null, 2));
