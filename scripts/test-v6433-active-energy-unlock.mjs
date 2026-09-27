// ⭐v6.433 守衛：戰鬥位有招可用、但再附 1 個能量就能多出一招更好的 ⇒ 這回合的能量附給戰鬥位（ai-energy.ts pickActiveEnergyUnlock）
//
// 背景：v6.432 讓「戰鬥位有招可用」的回合改附給備戰，但戰鬥位差 1 個能量就能用大招時也照樣附給備戰（fable 審查 v6.432 B 點名）。
// 規則：只看「附了才付得起的新招式」的試打分數，要高過現在可用招式的最佳分數才附戰鬥位；否則照 v6.432 附給備戰。
//
// 守的東西：
//   U1 ⭐ 青銅鐘（身上【鋼】【鋼】：重摑 40 可用），手上【鋼】⇒ 附給戰鬥位（金屬障礙 120）——不是備戰的拉帝亞斯ex
//   U2   零回歸：兩招都已經付得起 ⇒ 照 v6.432 附給備戰
//   U3 ⭐ 燃火能量（回合結束就丟）附給戰鬥位是對的：這回合就能用來出金屬障礙（附在進化寶可夢上視為 3 個【無】）
//   U4 ⭐ 現在的招就已經打得倒（對手只剩 30 HP）⇒ 新招不會更好 ⇒ 不附戰鬥位，照 v6.432 附給備戰
//   U5   戰鬥位被鎖住不能附能量 ⇒ 不附戰鬥位
//   U6 ⭐ 只比新招：擲幣招（機關槍合擊）附前附後的試打雜訊不可以讓它改附戰鬥位
//   U7 ⭐ 小增益（衝撞 20）不搶備戰主打手的能量（fable 審查 A：門檻 60）
//   U8   現有招試打停在對手視窗（挑釁抓擊）⇒ 不比、不改附（審查 B）
// 卡片事實一律取自 static/cards（台灣官方卡面）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x-v6433-s.js'), E = join(ROOT, '.x-v6433-e.ts'), O = join(ROOT, '.x-v6433-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
const has = (p) => existsSync(join(ROOT, p));
writeFileSync(E, [
  "export * as ENG from './src/lib/game/engine';",
  "export { getAIAction } from './src/lib/game/ai';",
  has('src/lib/game/ai-energy.ts') ? "export * as EN from './src/lib/game/ai-energy';" : 'export const EN = {};',
  "import './src/lib/game/effects';",
].join('\n'));
// 起點可調的試打亂數種子（與 scripts/lib/ai-sim-harness.mjs 同一招：只在本打包附加，不改 src/）
const seedResetPlugin = { name: 'sim-seed-reset', setup(b) {
  b.onLoad({ filter: /[\\/]ai-eval\.ts$/ }, (args) => {
    const src = readFileSync(args.path, 'utf8');
    const m = /let _simSeed = (0x[0-9a-fA-F]+|\d+);/.exec(src);
    if (!m) throw new Error('ai-eval.ts 找不到 `let _simSeed = …;`（改名了？請更新本守衛）');
    return { contents: src + `\nexport function __testResetSimSeed(k = 0) { _simSeed = (${m[1]} + k * 0x9e3779b9) >>> 0; }\n`, loader: 'ts' };
  });
} };
writeFileSync(E, readFileSync(E, 'utf8') + "\nexport * as EVAL from './src/lib/game/ai-eval';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', plugins: [seedResetPlugin],
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { ENG, getAIAction, EN, EVAL } = await import(pathToFileURL(O).href);
const { createGame, getAvailableAttacks } = ENG;
const MISSING = Symbol('missing');
const F = (n) => (typeof EN?.[n] === 'function' ? EN[n] : () => MISSING);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const C = { bronzong: '19206', latias: '16783', kangaskhan: '14071', drilbur: '12540', grimmsnarl: '10961', dark: '17214', snorlax: '17038', metal: '17219', psy: '17220', burn: '17207', tablet: '17133' };
for (const [k, id] of Object.entries(C)) assert.ok(pool.get(id), `找不到 ${k} ${id}（卡池變了？）`);
// 卡面前提（變了就要重新查證）
const bz = pool.get(C.bronzong);
assert.ok(bz.evolvesFrom && bz.attacks.length === 2
  && bz.attacks[0].name === '重摑' && bz.attacks[0].cost.join(',') === 'Metal' && bz.attacks[0].damage === '40'
  && bz.attacks[1].name === '金屬障礙' && bz.attacks[1].cost.join(',') === 'Metal,Metal,Colorless' && bz.attacks[1].damage === '120', '青銅鐘（19206）卡面變了');
assert.ok(pool.get(C.drilbur).attacks.map((a) => `${a.name}:${a.cost.length}:${a.damage}`).join('|') === '交替:1:|衝撞:2:20', '土龍弟弟（12540）卡面變了');
assert.ok(/由對手選擇放置於戰鬥場的寶可夢/.test(pool.get(C.grimmsnarl).attacks[0].effect ?? '') && pool.get(C.grimmsnarl).attacks[1].cost.join(',') === 'Darkness,Colorless,Colorless', '長毛巨魔（10961）卡面變了');
assert.ok(/若附於進化寶可夢身上，則視為提供3個【無】能量/.test(pool.get(C.burn).rulesText ?? ''), '燃火能量卡面變了');

let nn = 0;
const inst = (cid, e = [], x = {}) => ({ iid: 'u' + (++nn), cardId: String(cid), damage: 0, energyAttached: e, ...x });
const en = (cid) => inst(cid);
const fill = (n, cid = C.tablet) => Array.from({ length: n }, () => inst(cid));
function mk({ active, bench = [], hand = [], oppDamage = 0, oppCid = C.snorlax }) {
  const s = createGame({ name: 'P1', entries: [{ cardId: C.snorlax, count: 1 }] },
    { name: 'P2', entries: [{ cardId: C.snorlax, count: 1 }] }, pool);
  return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
    isFirstTurn: false, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
    pendingSelection: null, activeStadium: null, stadiumUsedThisTurn: [false, false],
    players: [
      { ...s.players[0], hand, deck: fill(12), discard: [], prizes: fill(6), active, bench, energyAttachedThisTurn: false, supporterPlayedThisTurn: false },
      { ...s.players[1], hand: [], deck: fill(20, C.snorlax), discard: [], prizes: fill(6, C.snorlax), active: inst(oppCid, [], { damage: oppDamage }), bench: [inst(C.snorlax)] }] };
}

let pass = 0, fail = 0; const failed = [];
const T = (n, f) => { try { f(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; failed.push(n.split(' ')[0]); } };

T('U1 ⭐ 青銅鐘 身上【鋼】【鋼】（重摑可用），手上【鋼】⇒ 附給戰鬥位（金屬障礙 120），不是備戰的拉帝亞斯ex', () => {
  const st = mk({ active: inst(C.bronzong, [en(C.metal), en(C.metal)]), bench: [inst(C.latias)], hand: [en(C.metal)] });
  assert.equal(getAvailableAttacks(st, pool).length, 1, '前置條件：現在只有重摑可用');
  const a = getAIAction(st, pool, 0);
  assert.equal(a?.type, 'ATTACH_ENERGY', JSON.stringify(a));
  assert.equal(a.targetIid, st.players[0].active.iid, '應附給戰鬥位的青銅鐘：' + JSON.stringify(a));
});

T('U2 零回歸：兩招都已經付得起 ⇒ 照 v6.432 附給備戰的拉帝亞斯ex', () => {
  const st = mk({ active: inst(C.bronzong, [en(C.metal), en(C.metal), en(C.metal)]), bench: [inst(C.latias)], hand: [en(C.psy)] });
  const a = getAIAction(st, pool, 0);
  assert.equal(a?.type, 'ATTACH_ENERGY', JSON.stringify(a));
  assert.equal(a.targetIid, st.players[0].bench[0].iid, JSON.stringify(a));
});

T('U3 ⭐ 燃火能量附給戰鬥位是對的（這回合就用來出金屬障礙）', () => {
  const st = mk({ active: inst(C.bronzong, [en(C.metal), en(C.metal)]), bench: [inst(C.latias)], hand: [en(C.burn)] });
  const a = getAIAction(st, pool, 0);
  assert.equal(a?.type, 'ATTACH_ENERGY', JSON.stringify(a));
  assert.equal(a.targetIid, st.players[0].active.iid, '燃火能量應附給戰鬥位的青銅鐘：' + JSON.stringify(a));
});

T('U4 ⭐ 現在的招就已經打得倒（對手卡比獸只剩 30 HP）⇒ 新招不會更好 ⇒ 附給備戰', () => {
  const st = mk({ active: inst(C.bronzong, [en(C.metal), en(C.metal)]), bench: [inst(C.latias)], hand: [en(C.metal)], oppDamage: 130 });
  const a = getAIAction(st, pool, 0);
  assert.equal(a?.type, 'ATTACH_ENERGY', JSON.stringify(a));
  assert.equal(a.targetIid, st.players[0].bench[0].iid, '重摑就打得倒，不必附給戰鬥位：' + JSON.stringify(a));
  // 中央述詞直呼：同一個盤面回 null；U1 的盤面回那張【鋼】
  const pick = F('pickActiveEnergyUnlock');
  assert.equal(pick(st, 0, pool), null);
  const st1 = mk({ active: inst(C.bronzong, [en(C.metal), en(C.metal)]), bench: [inst(C.latias)], hand: [en(C.metal)] });
  assert.equal(pick(st1, 0, pool), st1.players[0].hand[0].iid);
});

T('U5 戰鬥位被鎖住不能附能量 ⇒ 不附戰鬥位', () => {
  const st = mk({ active: inst(C.bronzong, [en(C.metal), en(C.metal)], { cantAttachEnergyThisTurn: true }), bench: [inst(C.latias)], hand: [en(C.metal)] });
  const a = getAIAction(st, pool, 0);
  assert.ok(!(a?.type === 'ATTACH_ENERGY' && a.targetIid === st.players[0].active.iid), JSON.stringify(a));
});

T('U6 ⭐ 只比「附了才付得起的新招」：超級袋獸ex（機關槍合擊已可用、擲幣）多附能量不會多出新招 ⇒ 16 個起點都不附戰鬥位', () => {
  // 若連「同一招附前附後」也拿來比，擲幣招的試打雜訊會讓約一半的起點誤判成「附了更好」
  // 對手戰鬥位也是超級袋獸ex（300 HP）：機關槍合擊 200＋擲幣，要擲出 2 次以上正面才擊倒 ⇒ 試打分數有雜訊
  const st = mk({ active: inst(C.kangaskhan, [en(C.psy), en(C.psy), en(C.psy)]), bench: [inst(C.latias)], hand: [en(C.psy)], oppCid: C.kangaskhan });
  let toActive = 0;
  for (let k = 0; k < 16; k++) {
    EVAL.__testResetSimSeed(k);
    if (F('pickActiveEnergyUnlock')(st, 0, pool) !== null) toActive++;
  }
  assert.equal(toActive, 0, `16 個起點裡有 ${toActive} 次想把能量附給戰鬥位的超級袋獸ex（沒有新招可解鎖）`);
});

T('U7 ⭐ 小增益不搶主打手的能量：土龍弟弟（交替可用；再 1 個能量解鎖衝撞 20）⇒ 附給備戰的拉帝亞斯ex', () => {
  const st = mk({ active: inst(C.drilbur, [en(C.psy)]), bench: [inst(C.latias)], hand: [en(C.psy)] });
  const a = getAIAction(st, pool, 0);
  assert.equal(a?.type, 'ATTACH_ENERGY', JSON.stringify(a));
  assert.equal(a.targetIid, st.players[0].bench[0].iid, '衝撞 20 的增益太小，不該改附戰鬥位：' + JSON.stringify(a));
});

T('U8 現在的招試打會停在對手的選擇視窗（長毛巨魔｜挑釁抓擊）⇒ 分數不可信，不改附戰鬥位', () => {
  const st = mk({ active: inst(C.grimmsnarl, [en(C.psy), en(C.psy)]), bench: [inst(C.latias)], hand: [en(C.dark)] });
  assert.equal(F('pickActiveEnergyUnlock')(st, 0, pool), null, '挑釁抓擊的試打分數不可信，不應改附戰鬥位');
});

console.log(`\n=== v6.433 戰鬥位差 1 個能量就有更好的招時附給戰鬥位：PASS ${pass} / FAIL ${fail} ===`);
if (fail) { console.log('紅的：' + failed.join('、')); process.exit(1); }
