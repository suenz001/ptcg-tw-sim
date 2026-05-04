#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const coinAnimationPath = join(REPO_ROOT, 'src/lib/game/coinAnimation.ts');
const tmp = mkdtempSync(join(tmpdir(), 'ptcg-coin-animation-'));
const entry = join(tmp, 'entry.ts');
const out = join(tmp, 'bundle.mjs');

writeFileSync(entry, `
  export { parseCoinFlipAnimationEvents } from ${JSON.stringify(coinAnimationPath)};
`);

try {
  await esbuild.build({
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    logLevel: 'silent',
  });

  const { parseCoinFlipAnimationEvents } = await import(pathToFileURL(out));

  const logs = [
    '機關槍合擊：第 1 次擲硬幣 — 正面',
    '機關槍合擊：第 2 次擲硬幣 — 正面',
    '機關槍合擊：第 3 次擲硬幣 — 反面（停止）',
    '機關槍合擊：2 次正面 → 基礎 200 + 2×50 = 300 傷害',
  ];
  const events = logs.flatMap(parseCoinFlipAnimationEvents);
  assert.deepEqual(events.map(e => e.result), ['heads', 'heads', 'tails'],
    '機關槍合擊動畫順序必須是先正面數次，最後反面停止，且傷害總結不能多觸發正面動畫');

  assert.deepEqual(
    parseCoinFlipAnimationEvents('連斬：擲 2 次硬幣正面 1 次').map(e => e.result),
    ['heads'],
    '舊式包含「擲硬幣/硬幣」的擲幣總結仍應保留一次 fallback 動畫'
  );

  assert.deepEqual(
    parseCoinFlipAnimationEvents('機關槍合擊：0 次正面 → 基礎 200 + 0×50 = 200 傷害'),
    [],
    '不含擲硬幣的傷害總結不可被「正面」字樣誤判成硬幣動畫'
  );

  console.log('✅ coin animation parser regression passed');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
