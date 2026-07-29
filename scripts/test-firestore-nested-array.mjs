#!/usr/bin/env node
/**
 * 守衛：GameState 序列化後**不得含巢狀陣列**（array 的元素又是 array）。
 *
 * 為什麼要有這一網（v6.056 事故）：
 *   Firestore **不支援巢狀陣列**（map 裡包 array 可以，array 裡包 array 不行）。
 *   v5.911「輪番狂攻」新增的 `ancientAttackedIidsThisTurn/LastSelfTurn` 宣告成
 *   `[string[], string[]]` → 每一次 `startGame` / `pushGameState` 寫入都被 Firestore
 *   整包拒收（`Function Transaction.update() called with invalid data.
 *   Nested arrays are not supported`）→ **休閒線上從此完全建不起對局**，
 *   而且錯誤只進 console，畫面永遠停在「⏳ 雙方已準備，遊戲即將開始⋯」。
 *   同型前例：`mulliganRevealedHands`（v2.84 / v3.741）當年就是為了這條規則
 *   改成 `{ p1, p2 }` —— 但沒有留下守衛，於是同一個坑又被踩了一次。
 *
 * ⭐per-player 欄位一律用 `{ p1, p2 }`，不要用 `T[][]`。
 *
 * Run: node scripts/test-firestore-nested-array.mjs
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x-fna-s.js'), E = join(ROOT, '.x-fna-e.ts'), O = join(ROOT, '.x-fna-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { createGame, applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction } = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}

/** 完全比照 Firestore 的規則：array 的元素不可以是 array。 */
function findNestedArrays(o) {
  const hits = [];
  const walk = (v, path, inArray) => {
    if (Array.isArray(v)) {
      if (inArray) hits.push(path);
      v.forEach((x, i) => walk(x, `${path}[${i}]`, true));
      return;
    }
    if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k], `${path}.${k}`, false);
  };
  walk(o, 'gameState', false);
  return [...new Set(hits.map((h) => h.replace(/\[\d+\]/g, '[]')))];
}

const ENERGY = '14128', BASIC = '19174', BURST = '13974';
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

const decks = {
  '一般牌組': [{ cardId: BASIC, count: 8 }, { cardId: ENERGY, count: 52 }],
  '含閃焰王牌': [{ cardId: BURST, count: 4 }, { cardId: BASIC, count: 4 }, { cardId: ENERGY, count: 52 }],
};

for (const [name, entries] of Object.entries(decks)) {
  T(`⭐⭐開局盤面可寫入 Firestore（無巢狀陣列）— ${name}`, () => {
    for (let i = 0; i < 25; i++) {
      const g = createGame({ name: 'P1', entries }, { name: 'P2', entries }, pool,
        { firstChoicePreferences: ['random', 'random'] });
      const hits = findNestedArrays(JSON.parse(JSON.stringify(g)));
      assert.deepEqual(hits, [],
        `Firestore 會整包拒收這份盤面（Nested arrays are not supported）→ 線上建不起局。位置：${hits.join('、')}`);
    }
  });
}

T('⭐⭐對局進行中的盤面也不得出現巢狀陣列（推送給對手時同樣會被拒收）', () => {
  const entries = decks['一般牌組'];
  let g = createGame({ name: 'P1', entries }, { name: 'P2', entries }, pool,
    { firstChoicePreferences: ['random', 'random'] });
  // 走完 setup → playing，再打幾個回合，讓回合制欄位都被寫過一輪
  const place = (idx) => {
    const p = g.players[idx];
    const basic = p.hand.find((c) => (pool.get(c.cardId)?.subtype ?? '') === 'Basic');
    if (basic) g = applyAction(g, { type: 'PLACE_ACTIVE', iid: basic.iid, senderIdx: idx }, pool);
    g = applyAction(g, { type: 'FINISH_SETUP', senderIdx: idx }, pool);
  };
  place(0); place(1);
  for (let i = 0; i < 6; i++) {
    const hits = findNestedArrays(JSON.parse(JSON.stringify(g)));
    assert.deepEqual(hits, [], `第 ${i} 步出現巢狀陣列：${hits.join('、')}`);
    g = applyAction(g, { type: 'END_TURN' }, pool);
  }
});

T('⭐GameState 的型別宣告不得有 per-player 巢狀陣列（新欄位一律 { p1, p2 }）', () => {
  const src = readFileSync(join(ROOT, 'src/lib/game/types.ts'), 'utf8');
  const bad = [];
  for (const line of src.split('\n')) {
    const s = line.trim();
    if (s.startsWith('//') || s.startsWith('*') || s.startsWith('/*')) continue;
    // ⚠先去空白再比對：`[^\]]*` 會被 `string[]` 自己的 `]` 提前截斷，抓不到
    //   `[string[], string[]]` 這種 tuple-of-array（第一版就是這樣假綠的）。
    const t = s.replace(/\s/g, '');
    if (/:\[.*\[\].*\];/.test(t) || /:\w+\[\]\[\];/.test(t)) bad.push(s);
  }
  assert.deepEqual(bad, [],
    'Firestore 不支援巢狀陣列 → 這種欄位會讓整份盤面寫不進房間。改用 { p1, p2 }：\n  ' + bad.join('\n  '));
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
