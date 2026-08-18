// ⭐ v6.209 化石採掘場（M5 19223，J）—— 「放置於備戰區」的 double-check 改走中央述詞
//    isFossilItemCard（engine.ts / FOSSIL_ITEM_NAMES），取代原本的 name.includes('陳舊的')。
//
// ⚠ 兩層條件語義不同，本測試分開驗：
//   (a) picker 的 filter 'NameContains:陳舊的' = **卡面逐字**判準（rulesText：「名稱中有
//       『陳舊的』的物品卡」）→ 維持卡名比對，7 張化石都要被列出來。
//   (b) resolver 的 double-check = 「能不能放上場」的前提 → 必須是化石 Item。
//
// 本測試包含：
//   1) 差分實跑：7 張化石逐張跑完整 USE_STADIUM → RESOLVE_SELECTION，行為必須與換判準前一致
//      （放上備戰、fossilOnField、牌庫少一張、有重洗 log）。
//   2) ★HEAD-FAIL 反例：合成一張「陳舊的地圖」（Trainer/Item，名字含『陳舊的』但**不是化石**）
//      放進牌庫並選它 —— 舊判準會把它變成非法的 HP60 備戰幽靈，新判準必須拒絕。
//   3) 絆線守衛：全站 H/I/J 現役卡中，凡 Trainer/Item 且名稱含「陳舊的」者，都必須被
//      isFossilItemCard 認得（＝已登錄 FOSSIL_ITEM_NAMES）。出新化石卻忘了登錄 → 這裡變紅。
//   4) 掃描器下限斷言：掃到的化石張數必須 >= 7，否則是掃描器壞了而不是「乾淨」。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E = join(ROOT, '.fx-e.ts'), O = join(ROOT, '.fx-o.mjs'), S = join(ROOT, '.fx-s.mjs');
process.on('exit', () => { for (const p of [E, O, S]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, `export { applyAction, isFossilItemCard, FOSSIL_ITEM_NAMES } from './src/lib/game/engine';\n`
  + `export { evaluateSelectionFilter } from './src/lib/game/selection-filter';\n`
  + `import './src/lib/game/effects';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { applyAction, isFossilItemCard, FOSSIL_ITEM_NAMES, evaluateSelectionFilter } = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

let pass = 0, fail = 0;
const ck = (l, c, e) => { if (c) { pass++; console.log('  PASS', l); } else { fail++; console.log('  FAIL', l, e ?? ''); } };

// ── 枚舉：現役 H/I/J 中所有名稱含「陳舊的」的卡 ────────────────────────────
const HIJ = [...pool.values()].filter(c => ['H', 'I', 'J'].includes(c.regulationMark));
const nameHits = HIJ.filter(c => (c.name ?? '').includes('陳舊的'));
const uniqNames = [...new Set(nameHits.map(c => c.name))].sort();
console.log('0) 枚舉：名稱含「陳舊的」的現役 H/I/J 卡 =', uniqNames.length, '種 →', uniqNames.join('、'));
ck('掃描器下限：至少掃到 7 種化石（否則是掃描器壞了）', uniqNames.length >= 7, '實際=' + uniqNames.length);
ck('掃描器下限：卡片實體 >= 7 張', nameHits.length >= 7, '實際=' + nameHits.length);

console.log('\n1) 絆線守衛：凡 Trainer/Item 且名稱含「陳舊的」→ 必須被 isFossilItemCard 認得');
{
  // ⚠ 這條絆線刻意留一個「已確認**不是**化石」的出口 —— 本版改判準的動機正是
  //   「未來可能出現名字帶『陳舊的』卻不能上場的物品卡」，若只允許「登錄成化石」
  //   就會逼下一個人做錯誤登錄。真出了那種卡：查卡面 rulesText 有沒有
  //   「可作為…寶可夢放置於場上」，**沒有**就把卡名加進下面這個白名單（並在此註明理由）。
  const CONFIRMED_NON_FOSSIL = new Set([/* 目前為空：現役 7 張「陳舊的」Item 全是化石 */]);
  const orphans = nameHits.filter(c => c.supertype === 'Trainer' && c.subtype === 'Item'
    && !isFossilItemCard(c) && !CONFIRMED_NON_FOSSIL.has(c.name));
  ck('無「名稱含陳舊的但既未登錄 FOSSIL_ITEM_NAMES、也未列入已確認非化石白名單」的 Item',
    orphans.length === 0,
    '待裁定=' + [...new Set(orphans.map(c => c.name))].join('、')
    + '（是化石→加進 engine.ts FOSSIL_ITEM_NAMES；不是化石→加進本測試的 CONFIRMED_NON_FOSSIL）');
  // 正對照：判準真的會抓（餵一個違規樣本）
  const bogus = { id: 'X', name: '陳舊的地圖', supertype: 'Trainer', subtype: 'Item', regulationMark: 'J' };
  ck('正對照：合成的「陳舊的地圖」被 isFossilItemCard 判為 false（判準不是恆真）',
    isFossilItemCard(bogus) === false, 'isFossilItemCard=' + isFossilItemCard(bogus));
  ck('正對照：合成的「陳舊的地圖」仍被卡面 filter NameContains:陳舊的 列出（卡面逐字判準未被改動）',
    evaluateSelectionFilter('deck-search', 'NameContains:陳舊的', { iid: 'z' }, bogus) === true,
    'filter=' + evaluateSelectionFilter('deck-search', 'NameContains:陳舊的', { iid: 'z' }, bogus));
  ck('FOSSIL_ITEM_NAMES 至少 7 個條目', FOSSIL_ITEM_NAMES.size >= 7, '實際=' + FOSSIL_ITEM_NAMES.size);
}

// ── 盤面 ────────────────────────────────────────────────────────────────────
const EXCAV = '19223';   // 化石採掘場（Stadium）
const SKARM = '16965';   // 大吾的盔甲鳥（無特性 Basic，當戰鬥位）
const W = '18519';       // 基本【水】能量（牌庫填充）
let n = 0;
const I = (cid, x = {}) => ({ iid: 'i' + (++n), cardId: String(cid), damage: 0, energyAttached: [], ...x });
function mkState(deckExtra) {
  return { phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
    pendingPrizes: [0, 0], log: [], pendingSelection: null, setupDone: [true, true],
    stadiumUsedThisTurn: [false, false],
    activeStadium: { iid: 'st', cardId: EXCAV },
    players: [
      { name: 'P0', active: I(SKARM), bench: [], hand: [],
        deck: [...deckExtra, ...Array.from({ length: 10 }, () => I(W))], discard: [],
        prizes: Array.from({ length: 6 }, () => I(W)) },
      { name: 'P1', active: I(SKARM), bench: [], hand: [],
        deck: Array.from({ length: 10 }, () => I(W)), discard: [],
        prizes: Array.from({ length: 6 }, () => I(W)) },
    ] };
}
function excavate(cardIds, poolOverride) {
  const P = poolOverride ?? pool;
  const deckExtra = cardIds.map(id => I(id));
  let s = mkState(deckExtra);
  const targetIids = s.players[0].deck.slice(0, cardIds.length).map(c => c.iid);
  const deckBefore = s.players[0].deck.length;
  s = applyAction(s, { type: 'USE_STADIUM' }, P);
  if (!s.pendingSelection) return { err: '沒有開 picker' };
  const ps = s.pendingSelection;
  const listed = s.players[0].deck.filter(c => evaluateSelectionFilter('deck-search', ps.filter, c, P.get(c.cardId)) === true).map(c => c.iid);
  s = applyAction(s, { type: 'RESOLVE_SELECTION', selectedIids: targetIids }, P);
  return { state: s, bench: s.players[0].bench, deckBefore, deckAfter: s.players[0].deck.length,
    listed, filter: ps.filter, log: s.log.map(l => (typeof l === 'string' ? l : (l?.message ?? ''))).join('\n') };
}

console.log('\n2) 差分實跑：7 張化石逐張走完整 化石採掘場 流程（換判準後行為必須不變）');
{
  const fossilIds = [];
  for (const nm of uniqNames) {
    const c = nameHits.find(x => x.name === nm);
    fossilIds.push([nm, String(c.id)]);
  }
  ck('取到 7 張化石代表卡', fossilIds.length >= 7, '實際=' + fossilIds.length);
  for (const [nm, id] of fossilIds) {
    const r = excavate([id]);
    if (r.err) { ck(nm + ' 流程正常', false, r.err); continue; }
    const placed = r.bench.length === 1 && P0name(r.bench[0]) === nm;
    ck(`${nm}：被列入 picker 候選`, r.listed.length >= 1, 'listed=' + r.listed.length);
    ck(`${nm}：放上備戰且 fossilOnField=true`, placed && r.bench[0].fossilOnField === true,
      'bench=' + JSON.stringify(r.bench.map(b => [P0name(b), b.fossilOnField])));
    ck(`${nm}：牌庫少 1 張`, r.deckAfter === r.deckBefore - 1, `${r.deckBefore}→${r.deckAfter}`);
    ck(`${nm}：log 沒出現「不符合條件」`, !r.log.includes('不符合條件'), r.log.split('\n').slice(-2).join(' / '));
  }
  function P0name(inst) { return pool.get(inst.cardId)?.name; }
}

console.log('\n3) ★HEAD-FAIL 反例：「陳舊的地圖」（名字含陳舊的但非化石）不得被放上備戰');
{
  const P = new Map(pool);
  const BOGUS = '9900001';
  P.set(BOGUS, { id: BOGUS, name: '陳舊的地圖', supertype: 'Trainer', subtype: 'Item',
    regulationMark: 'J', rulesText: '（測試用合成卡：名字含「陳舊的」但沒有「可作為寶可夢放置於場上」的卡面）' });
  const r = excavate([BOGUS], P);
  ck('流程正常（有開 picker）', !r.err, r.err);
  ck('卡面 filter 仍會列出它（NameContains 是卡面逐字判準，刻意不改）',
    r && r.listed && r.listed.length === 1, 'listed=' + (r.listed ? r.listed.length : 'n/a'));
  ck('★ 備戰區沒有被放進「陳舊的地圖」（舊判準 name.includes 會放 → HEAD 這條紅）',
    r.bench && r.bench.length === 0, 'bench=' + JSON.stringify((r.bench ?? []).map(b => P.get(b.cardId)?.name)));
  ck('★ 牌庫張數不變（被拒絕 → 只重洗不移出）',
    r.deckAfter === r.deckBefore, `${r.deckBefore}→${r.deckAfter}`);
  ck('★ log 出現拒絕訊息', (r.log ?? '').includes('不符合條件'), (r.log ?? '').split('\n').slice(-2).join(' / '));
}

console.log('\n4) 混合：真化石 + 陳舊的地圖 同時選 → 只放化石');
{
  const P = new Map(pool);
  const BOGUS = '9900002';
  P.set(BOGUS, { id: BOGUS, name: '陳舊的鑰匙', supertype: 'Trainer', subtype: 'Item', regulationMark: 'J' });
  const realId = String(nameHits.find(c => c.supertype === 'Trainer' && c.subtype === 'Item').id);
  const r = excavate([realId, BOGUS], P);
  ck('備戰只有 1 隻（合成卡被濾掉）', r.bench && r.bench.length === 1,
    'bench=' + JSON.stringify((r.bench ?? []).map(b => P.get(b.cardId)?.name)));
  ck('備戰那隻是真化石', r.bench && r.bench[0] && isFossilItemCard(P.get(r.bench[0].cardId)) === true);
}

console.log('\n化石採掘場中央述詞 PASS ' + pass + ' / FAIL ' + fail);
console.log('SCRIPT_END_MARKER test-fossil-excavation-central-predicate');
process.exitCode = fail ? 1 : 0;
