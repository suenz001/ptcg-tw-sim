// v6.120 守衛：「受到傷害時」道具在同一次傷害被觸發兩次。
//
// 玩家回報：手持循環扇「發動 2 次」。
//
// 根因（維度＝同一個效果掛在兩個 hook 上）：
//   `registerToolOnDamagedAndKO` 把同一支 fn 同時塞進 TOOL_ON_DAMAGED 與 TOOL_ON_KO。
//   這個鏡射是為了「引擎主管線」——那裡 KO 分支與非 KO 分支是**互斥**的 if/else，
//   KO 時不會跑 TOOL_ON_DAMAGED，所以需要鏡射才會觸發（卡面「受到傷害時」依 PTCG
//   規則含被打死的情況）。
//   但**中央傷害 helper**（狙擊／延後傷害／多目標）的結構不同：
//   先 fireDefenderOnDamaged、KO 時再 fireDefenderOnKO，**兩條都會跑** ⇒ 觸發兩次。
//   影響全部 6 張：幸運頭盔（抽 4 張）／凸凸頭盔（反傷 40）／火箭隊的催眠裝置／
//   逆境保險／奢華炸彈／手持循環扇（被抽走 2 個能量）。
//
// 修法：tools.ts 公開 TOOL_ON_KO_MIRRORED_FROM_DAMAGED；fireDefenderOnKO 新增
//   onDamagedAlreadyFired 參數，為 true 時跳過鏡射來的那批（引擎主管線傳 false／不傳，
//   行為完全不變）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x120-s.js'), E = join(ROOT, '.x120-e.ts'), O = join(ROOT, '.x120-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* */ } } });
writeFileSync(S, 'export const base="";');
writeFileSync(E,
  "export { dealAttackDamageToTarget, TOOL_ON_DAMAGED, TOOL_ON_KO } from './src/lib/game/effects';\n"
  + "export { PASSIVE_RETALIATION, PASSIVE_ON_DAMAGED, PASSIVE_KO_RETALIATION, PASSIVE_ON_KO } from './src/lib/game/effects';\n"
  + "export { SPECIAL_ENERGY_ON_DAMAGED } from './src/lib/game/effects/_shared';\n"
  + "export { TOOL_ON_KO_MIRRORED_FROM_DAMAGED } from './src/lib/game/effects/cards/tools';\n"
  + "export { applyAction } from './src/lib/game/engine';\n"
  + "import './src/lib/game/effects';\n");
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
const HIJ = (c) => ['H', 'I', 'J'].includes(c.regulationMark);
function byName(n) { for (const [id, c] of pool) if (c.name === n && HIJ(c)) return id; return null; }

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; }
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }

const LUCK = byName('幸運頭盔');      // 受傷時抽 2
const FAN = byName('手持循環扇');     // 受傷時抽走攻擊方 1 個能量
const BATON = byName('沉重接力棒');   // 真正的「昏厥時」道具（不得被誤跳過）
ok(LUCK && FAN && BATON, '找不到測試用道具卡');

// 場面素材：低 HP 防守方（一擊必死）＋ 不帶特性的攻擊方/備戰
let DEF = null, ATK = null, BEN = null;
for (const [id, c] of pool) {
  if (!String(c.supertype || '').startsWith('Pok') || !HIJ(c)) continue;
  if (c.stage === 'Basic' && c.hp <= 60 && !c.abilities?.length && !DEF) DEF = id;
  if (c.stage === 'Basic' && c.hp >= 120 && !c.abilities?.length && !ATK) ATK = id;
  else if (c.stage === 'Basic' && c.hp >= 120 && !c.abilities?.length && !BEN && id !== ATK) BEN = id;
}
ok(DEF && ATK && BEN, '找不到測試用寶可夢');

// 任一「基本能量」的實際 id（⚠ 卡名是「基本【草】能量」這種帶全形括號的格式，
//   別自己拼字串 —— 拼錯會讓招式付不出能量／沉重接力棒找不到基本能量，測試假失敗）
let BASIC_ENERGY = null;
for (const [id, c] of pool) { if (c.supertype === 'Energy' && c.subtype === 'Basic') { BASIC_ENERGY = id; break; } }
ok(BASIC_ENERGY, '找不到任何基本能量卡');

const inst = (cardId, iid, extra = {}) => ({ iid, cardId, damage: 0, energyAttached: [], evolvedFromStack: [], ...extra });
function mkState(toolId, opts = {}) {
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
    log: [], pendingSelection: null, pendingChainQueue: [], setupDone: [true, true], pendingPrizes: [0, 0],
    players: [
      {
        name: 'P1', active: inst(ATK, 'a1', { energyAttached: opts.atkEnergy ?? [] }),
        bench: [inst(BEN, 'ab1')], hand: [], deck: [], discard: [], prizes: [],
      },
      {
        name: 'P2', active: inst(DEF, 'd1', { toolAttached: inst(toolId, 't1'), damage: opts.defDamage ?? 0 }),
        bench: [inst(BEN, 'db1')], hand: [],
        deck: Array.from({ length: 12 }, (_, i) => inst(BEN, 'dk' + i)), discard: [], prizes: [],
      },
    ],
  };
}
const fanLogs = (s) => s.log.filter((l) => String(l.message ?? l.text ?? '').includes('手持循環扇')).length;

console.log('① 中央傷害 helper（狙擊／延後傷害）— KO 時不得觸發兩次');

T('⭐⭐⭐ 幸運頭盔：中央 helper 一擊 KO → 只抽 2 張（bug 版會抽 4）', () => {
  const s = mod.dealAttackDamageToTarget(mkState(LUCK), 0, 'd1', 300, pool, { kind: 'attack-damage', label: 'T' });
  ok(s.players[1].active === null, '防守方戰鬥位應已被 KO');
  ok(s.players[1].hand.length === 2,
    '幸運頭盔在同一次傷害被觸發了 ' + (s.players[1].hand.length / 2) + ' 次（手牌 ' + s.players[1].hand.length + ' 張，卡面應為 2）。\n'
    + '      中央 helper 先跑 fireDefenderOnDamaged、KO 時又跑 fireDefenderOnKO，\n'
    + '      而 TOOL_ON_KO 裡有一份是從 TOOL_ON_DAMAGED 鏡射來的 → 觸發兩次。');
});

T('⭐⭐⭐ 手持循環扇：中央 helper 一擊 KO → 只開 1 個 pending（bug 版會多排一個到 chain queue）', () => {
  const s = mod.dealAttackDamageToTarget(
    mkState(FAN, { atkEnergy: [inst(BASIC_ENERGY, 'e1'), inst(BASIC_ENERGY, 'e2')] }),
    0, 'd1', 300, pool, { kind: 'attack-damage', label: 'T' });
  ok(fanLogs(s) === 1, '手持循環扇 log 出現 ' + fanLogs(s) + ' 次（應為 1）');
  ok((s.pendingChainQueue ?? []).length === 0,
    '手持循環扇被排了第二個 pending 進 chain queue（玩家會被要求選兩次能量）');
});

console.log('② 不得矯枉過正：該觸發的一次都不能少');

T('中央 helper 非 KO → 幸運頭盔仍抽 2', () => {
  const s = mod.dealAttackDamageToTarget(mkState(LUCK), 0, 'd1', 10, pool, { kind: 'attack-damage', label: 'T' });
  ok(s.players[1].active !== null, '不該被 KO');
  ok(s.players[1].hand.length === 2, '非 KO 情況抽了 ' + s.players[1].hand.length + ' 張');
});

T('⭐ 中央 helper 一擊 KO → 幸運頭盔仍要觸發（不能因為修 bug 而整個不觸發）', () => {
  const s = mod.dealAttackDamageToTarget(mkState(LUCK), 0, 'd1', 300, pool, { kind: 'attack-damage', label: 'T' });
  ok(s.players[1].hand.length > 0,
    '幸運頭盔完全沒觸發 —— 卡面「受到傷害時」依規則含被打死的情況，不能整個跳過');
});

T('⭐⭐ 真正的「昏厥時」道具（沉重接力棒）不得被誤跳過', () => {
  // v6.136 ⚠ 卡面條件是「附有這張卡的【撤退】所需的能量**為4個**的寶可夢…昏厥時」，
  //   所以持有者必須是撤退費 4 才會觸發。原本的 DEF 是「HP ≤ 60 的基礎寶可夢」，
  //   撤退費不一定是 4 —— 這一項要驗的是「鏡射跳過邏輯不得誤傷沉重接力棒」，
  //   不是撤退費條件本身（那個由 test-v6136-heavy-baton-* 負責），所以這裡把前提補正。
  let DEF4 = null;
  for (const [id, c] of pool) {
    if (!String(c.supertype || '').startsWith('Pok') || !HIJ(c)) continue;
    if (c.stage !== 'Basic' || c.abilities?.length) continue;
    if ((c.retreatCost?.length ?? 0) === 4) { DEF4 = id; break; }
  }
  ok(DEF4, '找不到撤退費 4 且無特性的基礎寶可夢（沉重接力棒卡面前提）');
  const st = mkState(BATON);
  st.players[1].active = inst(DEF4, 'd1', { toolAttached: inst(BATON, 't1') });
  st.players[1].active.energyAttached = [inst(BASIC_ENERGY, 'be1'), inst(BASIC_ENERGY, 'be2')];
  const s = mod.dealAttackDamageToTarget(st, 0, 'd1', 300, pool, { kind: 'attack-damage', label: 'T' });
  const hit = s.log.some((l) => String(l.message ?? l.text ?? '').includes('沉重接力棒'))
    || (s.pendingSelection && String(s.pendingSelection.effectKey || '').length > 0)
    || (s.players[1].bench[0]?.energyAttached?.length ?? 0) > 0;
  ok(hit, '沉重接力棒（卡面是「昏厥時」，不在鏡射名單）被誤跳過了');
});

console.log('③ 引擎主管線：鏡射機制本身不能被破壞');

T('⭐⭐ 引擎主管線一擊 KO → 幸運頭盔仍抽 2（它靠鏡射進 TOOL_ON_KO 才會觸發）', () => {
  // 找一個「零效果、純傷害」的招式來走 engine ATTACK 主管線
  let atkId = null, atkIdx = -1, cost = null;
  for (const [id, c] of pool) {
    if (!String(c.supertype || '').startsWith('Pok') || !HIJ(c) || c.stage !== 'Basic') continue;
    if (c.abilities?.length) continue;
    const i = (c.attacks ?? []).findIndex((a) => !a.effect && (a.damage || '').match(/^\d+$/) && Number(a.damage) >= 10);
    if (i >= 0) { atkId = id; atkIdx = i; cost = c.attacks[i].cost ?? []; break; }
  }
  ok(atkId, '找不到零效果純傷害招式');
  const st = mkState(LUCK, { defDamage: 0 });
  st.players[0].active = inst(atkId, 'a1', {
    energyAttached: cost.map((_, i) => inst(BASIC_ENERGY, 'en' + i)),
  });
  // 讓防守方一定被打死
  st.players[1].active = inst(DEF, 'd1', { toolAttached: inst(LUCK, 't1'), damage: pool.get(DEF).hp - 10 });
  const s = mod.applyAction(st, { type: 'ATTACK', attackIndex: atkIdx, actorIdx: 0 }, pool);
  ok(s.players[1].active === null || s.players[1].active.damage >= pool.get(DEF).hp,
    '主管線這一擊沒有 KO，測試前提不成立');
  ok(s.players[1].hand.length === 2,
    '引擎主管線 KO 時幸運頭盔抽了 ' + s.players[1].hand.length + ' 張（應為 2）。\n'
    + '      這條路徑不跑 TOOL_ON_DAMAGED，完全靠鏡射進 TOOL_ON_KO 才會觸發 ——\n'
    + '      修 bug 時若把鏡射整個拿掉，這裡會變成 0。');
});

console.log('④ 枚舉守衛：鏡射名單必須與實際註冊一致');

T('⭐⭐ TOOL_ON_KO_MIRRORED_FROM_DAMAGED 必須＝「同時在兩張表裡」的那批，一個不多一個不少', () => {
  const both = [...mod.TOOL_ON_DAMAGED.keys()].filter((n) => mod.TOOL_ON_KO.has(n)).sort();
  const listed = [...mod.TOOL_ON_KO_MIRRORED_FROM_DAMAGED].sort();
  ok(both.length > 0, '沒有任何道具同時在兩張表裡？結構改了，請重新檢視本守衛');
  ok(JSON.stringify(both) === JSON.stringify(listed),
    '鏡射名單與實際註冊不一致。\n'
    + '      同時在兩張表：' + JSON.stringify(both) + '\n'
    + '      名單登記的：  ' + JSON.stringify(listed) + '\n'
    + '      ⚠ 新增「受到傷害時」道具時若沒走 registerToolOnDamagedAndKO 而是手動 set 兩張表，\n'
    + '      就會漏進名單 → 走中央 helper 的招式 KO 時又會觸發兩次。');
});

T('鏡射名單應涵蓋已知的 6 張「受到傷害時」道具', () => {
  for (const n of ['幸運頭盔', '凸凸頭盔', '火箭隊的催眠裝置', '逆境保險', '奢華炸彈', '手持循環扇']) {
    ok(mod.TOOL_ON_KO_MIRRORED_FROM_DAMAGED.has(n), n + ' 不在鏡射名單裡');
  }
});

T('⭐⭐ 跨表枚舉：任何「同時掛在受傷側與昏厥側」的名字都必須登記在鏡射名單', () => {
  // 這才是維度本身的守衛 —— 不只道具，特性／特殊能量若哪天也被同時掛兩邊，
  // 走中央傷害 helper 的招式一 KO 就會靜默觸發兩次。
  const dmgSide = new Set([
    ...mod.TOOL_ON_DAMAGED.keys(), ...mod.PASSIVE_RETALIATION.keys(),
    ...mod.PASSIVE_ON_DAMAGED.keys(), ...mod.SPECIAL_ENERGY_ON_DAMAGED.keys(),
  ]);
  const koSide = new Set([
    ...mod.TOOL_ON_KO.keys(), ...mod.PASSIVE_KO_RETALIATION.keys(), ...mod.PASSIVE_ON_KO.keys(),
  ]);
  const dual = [...dmgSide].filter((n) => koSide.has(n)).sort();
  const unlisted = dual.filter((n) => !mod.TOOL_ON_KO_MIRRORED_FROM_DAMAGED.has(n));
  ok(unlisted.length === 0,
    '有名字同時掛在「受傷側」與「昏厥側」但沒登記進鏡射名單：' + JSON.stringify(unlisted) + '\n'
    + '      中央傷害 helper 會先跑受傷側、KO 時再跑昏厥側 ⇒ 同一次傷害觸發兩次。\n'
    + '      若它是道具，請改用 registerToolOnDamagedAndKO；若是特性/能量，\n'
    + '      請比照擴充 fireDefenderOnKO 的跳過機制。');
});

T('⚠ 真正的「昏厥時」道具不得混進鏡射名單', () => {
  for (const n of ['沉重接力棒', '希望護身符']) {
    ok(!mod.TOOL_ON_KO_MIRRORED_FROM_DAMAGED.has(n), n + ' 卡面是「昏厥時」，不該被當成鏡射而跳過');
  }
});

console.log('\n=== v6.120「受到傷害時」道具重複觸發 守衛：PASS ' + pass + ' / FAIL ' + fail + ' ===');
process.exit(fail ? 1 : 0);
