import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRadar, type RadarSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = dirname(fileURLToPath(import.meta.url));
const botDir = process.env.MAKEFUN_BOT_DIR || here;
const inputDir = process.env.MAKEFUN_INPUT_DIR || '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 && typeof process.argv[index + 1] === 'string' ? process.argv[index + 1]! : null;
}

function cleanOutput(directory: string): void {
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
}

function copyRequiredDirectory(name: string): void {
  const source = join(botDir, name);
  if (!existsSync(source)) throw new Error(`Missing required ${name}/ directory in the submitted repository.`);
  cpSync(source, join(outputDir, name), { recursive: true, force: true, dereference: false });
}

function safeForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function run(): void {
  const suppliedInput = argument('--input');
  const snapshotPath = suppliedInput ? resolve(suppliedInput) : join(inputDir, 'snapshot.json');
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as RadarSnapshot;
  const radar = buildRadar(snapshot);

  if (radar.rows.length < 100) {
    throw new Error(`The snapshot produced ${radar.rows.length} candidate rows; this radar requires at least 100 valid protocols.`);
  }
  if (radar.diagnostics.watchlist_covered !== radar.diagnostics.watchlist_count) {
    throw new Error(`Watchlist coverage is incomplete: ${radar.diagnostics.watchlist_covered}/${radar.diagnostics.watchlist_count}.`);
  }

  cleanOutput(outputDir);
  copyRequiredDirectory('dashboard');
  copyRequiredDirectory('screenshots');

  const board = {
    schema: 'signal-atlas/board/v1',
    as_of: radar.diagnostics.as_of,
    title: 'Signal Atlas — peer-derived token launch radar',
    methodology: radar.diagnostics.methodology,
    diagnostics: radar.diagnostics,
    rows: radar.rows
  };
  writeFileSync(join(outputDir, 'board.json'), `${JSON.stringify(board, null, 2)}\n`, 'utf8');

  const pageData = {
    schema: 'signal-atlas/page-data/v1',
    title: board.title,
    as_of: board.as_of,
    methodology: board.methodology,
    diagnostics: board.diagnostics,
    rows: board.rows
  };
  writeFileSync(join(outputDir, 'dashboard', 'radar-data.js'), `window.RADAR_DATA=${safeForScript(pageData)};\n`, 'utf8');

  const dossier = buildDossier(outputDir, { text_max_bytes: 65_536 });
  writeFileSync(join(outputDir, 'dossier.json'), dossier);
}

run();
