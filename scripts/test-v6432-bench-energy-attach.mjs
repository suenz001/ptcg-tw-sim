// ⭐v6.432 守衛：戰鬥位已經有招可用時，AI 也要把能量附給備戰裡需要能量的寶可夢（ai-energy.ts pickBenchEnergyAttach）
//
// 背景：ai.ts 附能量分支「若已有招式可發，不附能量」（v2.357）⇒ 戰鬥位打得出招的回合整回合不附能量。
//   scripts/diag-ai-energy-skip.mjs：56 副預組 3,733 個回合收尾裡 16.2% 是「手上有能量卡、這回合沒附」，98% 是這個原因。
//
// 守的東西：
//   N1 ⭐ 戰鬥位有招可用、備戰拉帝亞斯ex 差 1 個能量 ⇒ 附給拉帝亞斯ex（舊版直接出招、不附）
//   N2   零回歸：備戰每一招都付得起 ⇒ 不附
//   N3 ⭐ 主打手優先：備戰有主打手（拉帝亞斯ex，0 能量）與非主打手（呆呆獸，差 1 個就能出招）⇒ 附給主打手
//   N4 ⭐ 屬性：備戰呆呆獸（超念力要【超】【超】【無】、身上 1 個【超】），手上【鋼】與【超】⇒ 附【超】
//   N5   被鎖住不能附能量的（cantAttachEnergyThisTurn）不當候選 ⇒ 只有牠需要能量時不附
//   N6   戰鬥位打不出招時走原本的分支（不經過 pickBenchEnergyAttach）：戰鬥位卡比獸沒能量、備戰沒有主打手 ⇒ 照舊附給戰鬥位
//   N8 ⭐ 回合結束會被丟的能量（燃火能量）不附
//   N9 ⭐ 會被當場丟棄的能量（火箭隊能量給非火箭隊）不附；有火箭隊的寶可夢就附給牠
//   N7 ⭐ 中央述詞直呼：付不付得起問 canAffordAttack（不是數張數）——身上 3 個【鋼】的呆呆獸（超念力要【超】【超】【無】）仍算需要能量
// 卡片事實一律取自 static/cards（台灣官方卡面）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x-v6432-s.js'), E = join(ROOT, '.x-v6432-e.ts'), O = join(ROOT, '.x-v6432-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
const has = (p) => existsSync(join(ROOT, p));
writeFileSync(E, [
  "export * as ENG from './src/lib/game/engine';",
  "export { getAIAction } from './src/lib/game/ai';",
  has('src/lib/game/ai-energy.ts') ? "export * as EN from './src/lib/game/ai-energy';" : 'export const EN = {};',
  "import './src/lib/game/effects';",
].join('\n'));
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { ENG, getAIAction, EN } = await import(pathToFileURL(O).href);
const { createGame, getAvailableAttacks } = ENG;
// ⚠ Rule 41：本版新增的中央述詞在 BASE 上不存在 ⇒ 用哨兵包起來，讓每一條各自誠實翻紅
const MISSING = Symbol('missing');
const F = (n) => (typeof EN?.[n] === 'function' ? EN[n] : () => MISSING);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const C = { latias: '16783', kangaskhan: '14071', slowpoke: '18072', snorlax: '17038', psy: '17220', metal: '17219', tablet: '17133', burn: '17207', rocketEn: '17213', rocketMimik: '14739' };
for (const [k, id] of Object.entries(C)) assert.ok(pool.get(id), `找不到 ${k} ${id}（卡池變了？）`);
// 卡面前提（變了就要重新查證）
assert.deepEqual(pool.get(C.kangaskhan).attacks.map((a) => a.cost.join('')), ['ColorlessColorlessColorless'], '超級袋獸ex｜機關槍合擊的能量變了');
assert.ok(pool.get(C.slowpoke).attacks.some((a) => a.name === '超念力' && a.cost.join(',') === 'Psychic,Psychic,Colorless'), '呆呆獸｜超念力的能量變了');
assert.ok(/在自己的回合結束時丟棄/.test(pool.get(C.burn).rulesText ?? ''), '燃火能量卡面變了');
assert.ok(/只可附於「火箭隊的寶可夢」身上，若附於「火箭隊的寶可夢」以外的寶可夢身上，則將其丟棄/.test(pool.get(C.rocketEn).rulesText ?? ''), '火箭隊能量卡面變了');
assert.ok(pool.get(C.rocketMimik).name.startsWith('火箭隊的'), '火箭隊的謎擬Ｑ 卡號變了');
assert.ok(pool.get(C.latias).attacks.some((a) => a.name === '無限之刃' && a.cost.join(',') === 'Psychic,Psychic,Colorless'), '拉帝亞斯ex｜無限之刃的能量變了');

let nn = 0;
const inst = (cid, e = [], x = {}) => ({ iid: 'z' + (++nn), cardId: String(cid), damage: 0, energyAttached: e, ...x });
const en = (cid) => inst(cid);
const fill = (n, cid = C.tablet) => Array.from({ length: n }, () => inst(cid));
function mk({ active, bench = [], hand = [] }) {
  const s = createGame({ name: 'P1', entries: [{ cardId: C.snorlax, count: 1 }] },
    { name: 'P2', entries: [{ cardId: C.snorlax, count: 1 }] }, pool);
  return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
    isFirstTurn: false, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
    pendingSelection: null, activeStadium: null, stadiumUsedThisTurn: [false, false],
    players: [
      { ...s.players[0], hand, deck: fill(12), discard: [], prizes: fill(6), active, bench, energyAttachedThisTurn: false, supporterPlayedThisTurn: false },
      { ...s.players[1], hand: [], deck: fill(20, C.snorlax), discard: [], prizes: fill(6, C.snorlax), active: inst(C.snorlax), bench: [inst(C.snorlax)] }] };
}
// 戰鬥位：超級袋獸ex 帶 3 個能量（機關槍合擊可用）。⚠ 不用呆呆王當戰鬥位：那會走 v6.429 的牌庫頂借招分支
const readyActive = () => inst(C.kangaskhan, [en(C.psy), en(C.psy), en(C.psy)]);

let pass = 0, fail = 0; const failed = [];
const T = (n, f) => { try { f(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; failed.push(n.split(' ')[0]); } };

T('N1 ⭐ 戰鬥位有招可用、備戰拉帝亞斯ex 差 1 個能量 ⇒ 附給拉帝亞斯ex', () => {
  const st = mk({ active: readyActive(), bench: [inst(C.latias, [en(C.psy), en(C.psy)])], hand: [en(C.psy)] });
  assert.ok(getAvailableAttacks(st, pool).length > 0, '前置條件：戰鬥位應有招可用');
  const a = getAIAction(st, pool, 0);
  assert.equal(a?.type, 'ATTACH_ENERGY', '應該先附能量：' + JSON.stringify(a));
  assert.equal(a.targetIid, st.players[0].bench[0].iid, JSON.stringify(a));
});

T('N2 零回歸：備戰每一招都付得起 ⇒ 不附，照舊出招', () => {
  const st = mk({ active: readyActive(), bench: [inst(C.latias, [en(C.psy), en(C.psy), en(C.psy)])], hand: [en(C.psy)] });
  const a = getAIAction(st, pool, 0);
  // ⚠ 超級袋獸ex 在戰鬥位時會先用特性「使者衝刺」—— 這裡只斷言「不附能量」
  assert.notEqual(a?.type, 'ATTACH_ENERGY', JSON.stringify(a));
});

T('N3 ⭐ 主打手優先：主打手（拉帝亞斯ex，0 能量）vs 非主打手（呆呆獸，差 1 個就能出招）⇒ 附給主打手', () => {
  const st = mk({ active: readyActive(), bench: [inst(C.slowpoke, [en(C.psy), en(C.psy)]), inst(C.latias)], hand: [en(C.psy)] });
  const a = getAIAction(st, pool, 0);
  assert.equal(a?.type, 'ATTACH_ENERGY', JSON.stringify(a));
  assert.equal(a.targetIid, st.players[0].bench[1].iid, '應附給主打手拉帝亞斯ex：' + JSON.stringify(a));
});

T('N4 ⭐ 屬性：呆呆獸（超念力要【超】【超】【無】、身上 1 個【超】），手上【鋼】與【超】⇒ 附【超】', () => {
  const st = mk({ active: readyActive(), bench: [inst(C.slowpoke, [en(C.psy)])], hand: [en(C.metal), en(C.psy)] });
  const a = getAIAction(st, pool, 0);
  assert.equal(a?.type, 'ATTACH_ENERGY', JSON.stringify(a));
  assert.equal(a.energyIid, st.players[0].hand[1].iid, '應附【超】：' + JSON.stringify(a));
});

T('N5 被鎖住不能附能量的不當候選 ⇒ 只有牠需要能量時不附', () => {
  const st = mk({ active: readyActive(), bench: [inst(C.latias, [], { cantAttachEnergyThisTurn: true })], hand: [en(C.psy)] });
  const a = getAIAction(st, pool, 0);
  assert.notEqual(a?.type, 'ATTACH_ENERGY', JSON.stringify(a));
  // 正對照：沒被鎖時會附（否則上面的否定斷言是空真）
  const st2 = mk({ active: readyActive(), bench: [inst(C.latias)], hand: [en(C.psy)] });
  assert.equal(getAIAction(st2, pool, 0)?.type, 'ATTACH_ENERGY', '正對照：沒被鎖時應該附');
});

T('N6 戰鬥位打不出招時走原本的分支：戰鬥位卡比獸沒能量、備戰沒有主打手 ⇒ 照舊附給戰鬥位', () => {
  const st = mk({ active: inst(C.snorlax), bench: [inst(C.slowpoke)], hand: [en(C.psy)] });
  assert.equal(getAvailableAttacks(st, pool).length, 0, '前置條件：戰鬥位應打不出招');
  const a = getAIAction(st, pool, 0);
  assert.equal(a?.type, 'ATTACH_ENERGY', JSON.stringify(a));
  assert.equal(a.targetIid, st.players[0].active.iid, JSON.stringify(a));
});

T('N7 ⭐ 中央述詞直呼：付不付得起看屬性不看張數——身上 3 個【鋼】的呆呆獸仍算需要能量；【超】×3 的呆呆獸不需要', () => {
  const pick = F('pickBenchEnergyAttach');
  const stA = mk({ active: readyActive(), bench: [inst(C.slowpoke, [en(C.metal), en(C.metal), en(C.metal)])], hand: [en(C.psy)] });
  const rA = pick(stA, 0, pool);
  assert.notEqual(rA, MISSING, 'pickBenchEnergyAttach 不存在');
  assert.ok(rA && rA.targetIid === stA.players[0].bench[0].iid, '3 個【鋼】付不起超念力，應為候選：' + JSON.stringify(rA));
  const stB = mk({ active: readyActive(), bench: [inst(C.slowpoke, [en(C.psy), en(C.psy), en(C.psy)])], hand: [en(C.psy)] });
  assert.equal(pick(stB, 0, pool), null, '每一招都付得起時不應是候選');
});

T('N8 ⭐ 附上去回合結束就會被丟的能量（燃火能量）不附；手上另有基本能量時附基本能量', () => {
  const only = mk({ active: readyActive(), bench: [inst(C.latias)], hand: [en(C.burn)] });
  assert.notEqual(getAIAction(only, pool, 0)?.type, 'ATTACH_ENERGY', '只有燃火能量時不應附給備戰（回合結束就被丟）');
  const both = mk({ active: readyActive(), bench: [inst(C.latias)], hand: [en(C.burn), en(C.psy)] });
  const a = getAIAction(both, pool, 0);
  assert.equal(a?.type, 'ATTACH_ENERGY', JSON.stringify(a));
  assert.equal(a.energyIid, both.players[0].hand[1].iid, '應附基本【超】能量而不是燃火能量：' + JSON.stringify(a));
});

T('N9 ⭐ 附上去會被當場丟棄的能量（火箭隊能量給非火箭隊的寶可夢）不附；備戰有火箭隊的寶可夢就附給牠', () => {
  const non = mk({ active: readyActive(), bench: [inst(C.latias)], hand: [en(C.rocketEn)] });
  assert.notEqual(getAIAction(non, pool, 0)?.type, 'ATTACH_ENERGY', '火箭隊能量不應附給拉帝亞斯ex（會被丟棄）');
  const rk = mk({ active: readyActive(), bench: [inst(C.latias), inst(C.rocketMimik)], hand: [en(C.rocketEn)] });
  const a = getAIAction(rk, pool, 0);
  assert.equal(a?.type, 'ATTACH_ENERGY', JSON.stringify(a));
  assert.equal(a.targetIid, rk.players[0].bench[1].iid, '應附給火箭隊的謎擬Ｑ：' + JSON.stringify(a));
});

console.log(`\n=== v6.432 戰鬥位有招可用時也附能量給備戰：PASS ${pass} / FAIL ${fail} ===`);
if (fail) { console.log('紅的：' + failed.join('、')); process.exit(1); }
