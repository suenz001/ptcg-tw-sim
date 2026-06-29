/**
 * KO 結算黃金基準網（Phase 1 安全網）— v5.769+
 * 目的：在「KO 順序全域重構」（招式效果先於昏厥結算）之前，先把現行 KO 結算的核心輸出
 *   （獎賞數、戰鬥位移除、送新 active、終局）以黃金值釘住。之後抽 resolveKnockouts / 改順序時
 *   重跑本網確認零回歸（除了刻意要改的「效果先於昏厥」類，那些另有專屬測試）。
 * 設計：把對手預設成接近致命傷（damage=HP-10），用乾淨攻擊方 小獅獅｜撞擊（[無] 10、無效果）
 *   一招 KO，避免被招式 cost/效果干擾，純測 KO block 輸出。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.kog-s.js'), E = join(ROOT, '.kog-e.ts'), O = join(ROOT, '.kog-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { createGame, applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { applyAction } = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const LION = '18508';     // 小獅獅 撞擊 [無] 10（乾淨，無效果）
const WILLDUN = '14086';  // 願增猿 110HP（一般基礎，1 獎賞）
const LAPRAS = '14085';   // 拉普拉斯ex（2 獎賞）
const GENGAR = '16916';   // 超級耿鬼ex（影藏）
const SNEASEL = '14421';  // 狃拉（惡基礎，1 獎賞）
const ENERGY = '14102';   // 基本【草】能量
const hpOf = cid => Number(pool.get(cid)?.hp ?? 0);

let nn = 0;
const inst = (cid, e = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...e });
const prize = n => Array.from({ length: n }, () => inst(ENERGY));

// 攻擊方 小獅獅(1[無]能量) vs 對手 active(預設 damage=hp-10) + 指定備戰；可加我方備戰影藏 holder。
function mk({ defCid, defBench = [], myBench = [], defPreDamage }) {
  const dmg = defPreDamage ?? (hpOf(defCid) - 10);
  return { phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false, log: [], pendingSelection: null,
    setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], ancientEnergyMinusOneUsed: [false, false],
    players: [
      { name: 'P1', active: inst(LION, { energyAttached: [inst(ENERGY)] }), bench: myBench, hand: [], deck: [inst(ENERGY)], discard: [], prizes: prize(6) },
      { name: 'P2', active: inst(defCid, { damage: dmg }), bench: defBench, hand: [], deck: [inst(ENERGY)], discard: [], prizes: prize(6) },
    ] };
}
const ATK = { type: 'ATTACK', attackIndex: 0 };
const prizesTaken = out => 6 - out.players[0].prizes.length;

let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };

// G1 一般基礎 1 獎賞 + 有備戰 → KO、戰鬥位待補、取 1 獎賞、非終局
T('G1 一般基礎KO→取1獎賞,非終局', () => {
  const out = applyAction(mk({ defCid: WILLDUN, defBench: [inst(WILLDUN)] }), ATK, pool);
  assert.equal(prizesTaken(out), 1, '獎賞應=1 實=' + prizesTaken(out));
  assert.notEqual(out.phase, 'game-over', '不應終局');
  assert.ok(out.players[1].discard.some(c => c.cardId === WILLDUN), '被KO者應進棄牌');
});

// G2 ex 2 獎賞
T('G2 ex KO→取2獎賞', () => {
  const out = applyAction(mk({ defCid: LAPRAS, defBench: [inst(WILLDUN)] }), ATK, pool);
  assert.equal(prizesTaken(out), 2, 'ex 獎賞應=2 實=' + prizesTaken(out));
});

// G3 KO 對手最後一隻（無備戰）→ 終局、攻擊方獲勝
T('G3 KO最後一隻→終局,攻擊方勝', () => {
  const out = applyAction(mk({ defCid: WILLDUN, defBench: [] }), ATK, pool);
  assert.equal(out.phase, 'game-over', '應終局');
  assert.equal(out.winner, 0, '攻擊方(0)應獲勝');
});

// G4 影藏：小獅獅(非ex)KO 惡寶可夢、我方對面有超級耿鬼ex → 非 ex 攻擊方不觸發影藏 → 取 1 獎賞
//   （影藏只在「對手 ex 招式傷害」昏厥時 -1；攻擊方非 ex → 正常 1 獎賞，鎖住此邊界）
T('G4 非ex攻擊方KO惡(對手有影藏)→影藏不觸發,取1獎賞', () => {
  const out = applyAction(mk({ defCid: SNEASEL, defBench: [inst(GENGAR)] }), ATK, pool);
  assert.equal(prizesTaken(out), 1, '非ex攻擊方不觸發影藏,應=1 實=' + prizesTaken(out));
});

// ── 反擊 / 雙殺：攻擊方 拉普拉斯ex｜衝浪(水×3,140) vs 布里卡隆(尖刺盔甲,草能量×30 反擊) ──
const WATER = '18519';
const LAPRAS_ATK = '14085';
const CHESNAUGHT = '18427';
const ATK_SURF = { type: 'ATTACK', attackIndex: 1 };
function mkRetal({ atkPreDamage = 0, defPreDamage = 0 }) {
  return { phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false, log: [], pendingSelection: null,
    setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], ancientEnergyMinusOneUsed: [false, false],
    players: [
      { name: 'P1', active: inst(LAPRAS_ATK, { energyAttached: [inst(WATER), inst(WATER), inst(WATER)], damage: atkPreDamage }), bench: [inst(WILLDUN)], hand: [], deck: [inst(ENERGY)], discard: [], prizes: prize(6) },
      { name: 'P2', active: inst(CHESNAUGHT, { energyAttached: [inst(ENERGY)], damage: defPreDamage }), bench: [inst(WILLDUN)], hand: [], deck: [inst(ENERGY)], discard: [], prizes: prize(6) },
    ] };
}
const oppPrizesTaken = out => 6 - out.players[1].prizes.length;

T('G5 反擊非KO→攻擊方被反擊30,對手存活', () => {
  const out = applyAction(mkRetal({}), ATK_SURF, pool);
  assert.equal(out.players[0].active.damage, 30, '攻擊方應被反擊30 實=' + out.players[0].active?.damage);
  assert.ok(out.players[1].active && out.players[1].active.cardId === CHESNAUGHT, '布里卡隆應存活');
});

T('G6 反擊KO→對手KO+攻擊方仍被反擊30,P1取1獎賞', () => {
  const out = applyAction(mkRetal({ defPreDamage: 40 }), ATK_SURF, pool);
  assert.ok(out.players[1].discard.some(c => c.cardId === CHESNAUGHT), '布里卡隆應KO進棄牌');
  assert.equal(out.players[0].active.damage, 30, 'KO時尖刺盔甲仍反擊30 實=' + out.players[0].active?.damage);
  assert.equal(prizesTaken(out), 1, '布里卡隆非ex→P1取1獎賞 實=' + prizesTaken(out));
});

T('G7 雙殺→兩邊KO,各取獎賞(P1取1/P2取2)', () => {
  const out = applyAction(mkRetal({ atkPreDamage: 180, defPreDamage: 40 }), ATK_SURF, pool);
  assert.ok(out.players[1].discard.some(c => c.cardId === CHESNAUGHT), '布里卡隆應KO');
  assert.ok(out.players[0].discard.some(c => c.cardId === LAPRAS_ATK), '拉普拉斯ex應被反擊KO');
  assert.equal(prizesTaken(out), 1, 'P1取1(布里卡隆) 實=' + prizesTaken(out));
  assert.equal(oppPrizesTaken(out), 2, 'P2取2(拉普拉斯ex) 實=' + oppPrizesTaken(out));
});

T('G8 中毒checkup KO→P0取1獎賞', () => {
  const st = { phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false, log: [], pendingSelection: null,
    setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
    players: [
      { name: 'P1', active: inst(LION, { energyAttached: [inst(ENERGY)] }), bench: [inst(WILLDUN)], hand: [], deck: [inst(ENERGY)], discard: [], prizes: prize(6) },
      { name: 'P2', active: inst(WILLDUN, { damage: 100, status: 'poisoned' }), bench: [inst(WILLDUN)], hand: [], deck: [inst(ENERGY)], discard: [], prizes: prize(6) },
    ] };
  const out = applyAction(st, { type: 'END_TURN' }, pool);
  assert.ok(out.players[1].discard.some(c => c.cardId === WILLDUN), '中毒應KO願增猿進棄牌');
  assert.equal(prizesTaken(out), 1, '中毒KO→P0取1獎賞 實=' + prizesTaken(out));
});

console.log('\nKO 結算黃金基準網:PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
