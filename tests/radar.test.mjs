import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { buildRadar } from '../lib/model.ts';

function fixture() {
  const categories = ['Dexes', 'Lending', 'Yield', 'Derivatives', 'Services'];
  const chains = ['Ethereum', 'Arbitrum', 'Base', 'Solana'];
  const protocols = Array.from({ length: 170 }, (_, index) => {
    const tokened = index < 65;
    const tvl = 6_000_000 + ((index * 5_731_991) % 900_000_000);
    return {
      slug: `fixture-${String(index + 1).padStart(3, '0')}`,
      name: `Fixture Protocol ${index + 1}`,
      category: categories[index % categories.length],
      chains: [chains[index % chains.length], ...(index % 4 === 0 ? [chains[(index + 1) % chains.length]] : [])],
      tvl_usd: tvl,
      change_7d: (index * 11) % 90 - 35,
      mcap_usd: tokened ? Math.round(tvl * (0.7 + (index % 11) * 0.45)) : null,
      listed_at: `202${index % 6}-0${(index % 8) + 1}-15`,
      gecko_id: tokened ? `fixture-token-${index}` : null,
      symbol: tokened ? `F${index}` : null
    };
  });
  return {
    as_of: '2026-11-14T10:00:00.000Z',
    floor_usd: 50_000_000,
    protocols,
    watchlist: protocols.slice(65, 105).map((protocol) => protocol.slug)
  };
}

test('the valuation model emits a ranked, fully covered board with concrete plans', () => {
  const result = buildRadar(fixture());
  assert.ok(result.rows.length >= 100);
  assert.equal(result.diagnostics.watchlist_covered, 40);
  assert.equal(new Set(result.rows.map((row) => row.slug)).size, result.rows.length);
  assert.ok(result.rows.every((row, index) => row.rank === index + 1));
  assert.ok(result.rows.every((row, index) => index === 0 || row.implied_value_usd <= result.rows[index - 1].implied_value_usd));
  assert.ok(result.rows.some((row) => row.confidence === 'high'));
  assert.ok(result.rows.every((row) => row.farm_steps.length >= 3 && row.farm_steps.every((step) => step.length >= 20 && step.length <= 600)));
  assert.ok(result.rows.every((row) => row.token_record === 'not-recorded'));
});

test('main.ts writes deterministic, dossier-matching grade artifacts', () => {
  const root = resolve(new URL('..', import.meta.url).pathname);
  const temp = mkdtempSync(join(tmpdir(), 'signal-atlas-test-'));
  const input = join(temp, 'snapshot.json');
  const outputA = join(temp, 'out-a');
  const outputB = join(temp, 'out-b');
  writeFileSync(input, JSON.stringify(fixture()));
  try {
    for (const output of [outputA, outputB]) {
      const run = spawnSync(process.execPath, ['main.ts', '--input', input], { cwd: root, env: { ...process.env, MAKEFUN_OUTPUT_DIR: output }, encoding: 'utf8' });
      assert.equal(run.status, 0, `${run.stderr}\n${run.stdout}`);
    }
    for (const relative of ['board.json', 'dashboard/radar-data.js', 'dossier.json']) {
      assert.deepEqual(readFileSync(join(outputA, relative)), readFileSync(join(outputB, relative)), `${relative} changed between identical runs`);
    }
    const board = JSON.parse(readFileSync(join(outputA, 'board.json'), 'utf8'));
    const dossier = JSON.parse(readFileSync(join(outputA, 'dossier.json'), 'utf8'));
    assert.ok(board.rows.length >= 100);
    assert.equal(dossier.schema, 'makefun/dossier/v1');
    assert.equal(dossier.images.length, 3);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
