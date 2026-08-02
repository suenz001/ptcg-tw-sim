/**
 * v6.103 守衛：「這個招式只可在後攻玩家的最初回合使用」型招式（吼叫尾ex｜絕叫、甜甜螢｜慢芬香）
 *
 * ⭐ 修的是**死招**：原本 engine 判 `state.isFirstTurn && isSecondPlayer`，這個組合**永遠不成立** ——
 *   `isFirstTurn` 的語意是「**先攻方**的第 1 個回合」，而 END_TURN finalize 無條件寫
 *   `isFirstTurn: false`；等輪到後攻方時它早就是 false。
 *   結果這兩張 H 標卡的招式在真實對局中 UI 反白 ＋ 引擎攔截，**完全打不出來**。
 *   正解：`state.turn === 1 && isSecondPlayer`（turn 只在後攻方結束回合時 +1）。
 *
 * ⚠⚠ 為什麼既有的 `test-first-turn-attacks.mjs` 沒抓到：它的「後攻最初回合可用」案例是
 *   **手工塞** `{ isFirstTurn: true, activePlayerIndex: 1 }` 的合成盤面 —— 真實 END_TURN
 *   根本產生不出這種盤面 ⇒ 假綠。
 *   **本檔一律走真實 `applyAction(END_TURN)` 之後的盤面**，這是本守衛存在的意義。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x2-s.js'), E = join(ROOT, '.x2-e.ts'), O = join(ROOT, '.x2-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { applyAction, getAvailableAttacks } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({
  entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error',
});
const mod = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}

let pass = 0, fail = 0;
const ok = (n, f) => { try { f(); console.log('  ✓', n); pass++; } catch (e) { console.log('  ✗', n, '→', e.message); fail++; } };

/** 依卡面文字找卡：只認 static/cards 台灣官方中文原文，不寫死 id。 */
function findByAttackText(attackName) {
  for (const [id, c] of pool) {
    for (const a of c.attacks ?? []) {
      if (a.name === attackName && (a.effect ?? '').includes('這個招式只可在後攻玩家的最初回合使用')) {
        return { id, card: c, atkIndex: c.attacks.findIndex((x) => x.name === attackName) };
      }
    }
  }
  return null;
}
const anyBasicEnergyId = (() => {
  for (const [id, c] of pool) if (c.supertype === 'Energy' && c.subtype === 'Basic') return id;
  return null;
})();
const filler = (() => {
  const out = [];
  for (const [id, c] of pool) {
    if (c.supertype === 'Pokemon' && c.stage === 'Basic' && !(c.attacks ?? []).some((a) => (a.effect ?? '').includes('後攻玩家的最初回合'))) out.push(id);
    if (out.length >= 3) break;
  }
  return out;
})();
assert.ok(anyBasicEnergyId && filler.length >= 3, '卡池取樣失敗（守衛不做軟跳過）');

let seq = 0;
const inst = (cardId, energy = 0) => ({
  iid: 'i' + (++seq), cardId: String(cardId), damage: 0,
  energyAttached: Array.from({ length: energy }, () => ({ iid: 'e' + (++seq), cardId: String(anyBasicEnergyId) })),
});
const prizes = () => Array.from({ length: 6 }, () => inst(filler[2]));

/** 建局：P0 先攻、P1 後攻，後攻方戰鬥位放帶目標招式的卡（附 3 能量足以支付）。 */
function makeState(cardId) {
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0,
    turn: 1, isFirstTurn: true, log: [], pendingSelection: null, setupDone: [true, true],
    players: [
      { name: 'P1', active: inst(filler[0]), bench: [inst(filler[1])], hand: [], deck: [inst(filler[1]), inst(filler[1])], discard: [], prizes: prizes() },
      { name: 'P2', active: inst(cardId, 3), bench: [inst(filler[1])], hand: [], deck: [inst(filler[1]), inst(filler[1])], discard: [], prizes: prizes() },
    ],
  };
}
const endTurn = (st, idx) => ({ ...mod.applyAction(st, { type: 'END_TURN', actorIdx: idx }, pool), turnPhase: 'main' });

for (const attackName of ['絕叫', '慢芬香']) {
  const found = findByAttackText(attackName);
  ok(`卡面查證：「${attackName}」確實寫「這個招式只可在後攻玩家的最初回合使用」`, () => {
    assert.ok(found, `static/cards 找不到符合卡面的「${attackName}」`);
  });
  if (!found) continue;
  const { id, card, atkIndex } = found;

  ok(`${card.name}｜${attackName}：⭐走真實 END_TURN 後，後攻方最初回合**可用**（HEAD 死招）`, () => {
    const s0 = makeState(id);
    const s1 = endTurn(s0, 0);                       // 先攻方結束第 1 回合
    // 這一步是整個 bug 的核心：真實流程走完 isFirstTurn 已是 false
    assert.strictEqual(s1.isFirstTurn, false, 'END_TURN 後 isFirstTurn 應為 false（此即舊判準必然失效的原因）');
    assert.strictEqual(s1.turn, 1, 'turn 只在後攻方結束回合才 +1');
    assert.strictEqual(s1.activePlayerIndex, 1, '應輪到後攻方');
    assert.ok(mod.getAvailableAttacks(s1, pool).includes(atkIndex), 'UI 端應該可用（不得反白）');
    const s2 = mod.applyAction(s1, { type: 'ATTACK', attackIndex: atkIndex, actorIdx: 1 }, pool);
    const msgs = s2.log.map((l) => (typeof l === 'string' ? l : l.message ?? ''));
    assert.ok(msgs.some((m) => m.includes(`使出「${attackName}」`)), '引擎端應該真的發動：\n' + msgs.slice(-4).join('\n'));
    assert.ok(!msgs.some((m) => m.includes('只能在後攻方最初回合使用')), '不該被擋');
  });

  ok(`${card.name}｜${attackName}：先攻方最初回合**不可用**（負對照）`, () => {
    const s0 = makeState(id);
    // 把同一張卡放到先攻方戰鬥位
    const s = { ...s0, players: [{ ...s0.players[0], active: inst(id, 3) }, s0.players[1]] };
    // ⚠ 不能斷言整個陣列為空：同一張卡的**其他招式**可能剛好付得出能量。只鎖這一招。
    assert.ok(!mod.getAvailableAttacks(s, pool).includes(atkIndex), '先攻方不該可用');
  });

  ok(`${card.name}｜${attackName}：後攻方第 2 回合**不可用**（負對照，防判準寫成永遠通過）`, () => {
    let s = makeState(id);
    s = endTurn(s, 0);   // 先攻 T1 結束 → 後攻 T1
    s = endTurn(s, 1);   // 後攻 T1 結束 → turn=2、輪先攻
    s = endTurn(s, 0);   // 先攻 T2 結束 → 輪後攻（第 2 個自己的回合）
    assert.strictEqual(s.activePlayerIndex, 1);
    assert.ok(s.turn >= 2, `第 2 輪 turn 應 >= 2，實際 ${s.turn}`);
    assert.ok(!mod.getAvailableAttacks(s, pool).includes(atkIndex), '後攻方第 2 回合不該可用');
    const after = mod.applyAction(s, { type: 'ATTACK', attackIndex: atkIndex, actorIdx: 1 }, pool);
    const msgs = after.log.map((l) => (typeof l === 'string' ? l : l.message ?? ''));
    assert.ok(msgs.some((m) => m.includes('只能在後攻方最初回合使用')), '引擎端也要擋');
  });
}

ok('引擎端與 UI 端用同一個判準（兩處必須同步改，否則會出現亮著卻送不出去）', () => {
  const src = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8');
  const hits = [...src.matchAll(/SECOND_PLAYER_FIRST_TURN_ONLY\.has\([^)]*\)/g)];
  assert.ok(hits.length >= 2, '應有引擎端與 UI 端兩個消費點');
  for (const h of hits) {
    const window = src.slice(h.index, h.index + 400);
    assert.ok(/state\.turn !== 1/.test(window), '消費點應改用 state.turn !== 1：\n' + window.slice(0, 200));
    assert.ok(!/!\s*state\.isFirstTurn/.test(window), '消費點不得再用 !state.isFirstTurn（永遠 true）');
  }
});

console.log(`\n=== v6.103 後攻最初回合限定招式：PASS ${pass} / FAIL ${fail} ===`);
if (fail > 0) process.exit(1);
