/**
 * v6.129 守衛：deck-search filter 的 AI 端不得「完全沒過濾」。
 *
 * 背景（玩家回報）：蓋諾賽克特ex｜金屬信號(I)「從自己的牌庫選擇最多2張【鋼】屬性的進化寶可夢卡」，
 *   跟 AI 對戰時 AI 卻抓到「火箭隊的拉姆達」(支援者)、「火箭隊的接收器」(物品)。
 *   根因：filter 'Stage1Or2:Metal' 只有 UI(+page.svelte) 有 inline case，ai.ts 完全沒有 →
 *   落到 ai.ts deck-search 的 `return true` fallthrough ＝ 整副牌庫都是候選。
 *
 * 這類漂移共 7 個 filter（見下表），一次收斂進中央 selection-filter.ts。
 *
 * ⚠本守衛刻意用**行為端**（真的跑 getAIAction 看它選了什麼），不用靜態 grep：
 *   ai.ts 有 `f.startsWith('Trainer:')` / `'Pokemon:'` 等 generic prefix 分支，
 *   字面量 grep 會把 'Trainer:Supporter' 誤判成「AI 沒有」（假陽性），
 *   也會把「有 case 但寫錯」的判成有（假陰性）。只有行為端說得準。
 * ⚠掃描器自身防假綠：filter 全集有**數量下限斷言**（掃不到就是掃描器壞了，不是「乾淨」）。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.p-s.js'), E = join(ROOT, '.p-e.ts'), O = join(ROOT, '.p-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { getAIAction } from './src/lib/game/ai';\n"
  + "export { evaluateSelectionFilter, isKnownSelectionFilter } from './src/lib/game/selection-filter';\n"
  + "export { applyAction, sanitizeSelectedIids } from './src/lib/game/engine';\n"
  + "export { RESOLVERS } from './src/lib/game/effects/_shared';\n"
  + "import './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log('  FAIL:', msg); } };

// ── 代表卡：每一「卡型」一張真卡（HIJ） ───────────────────────────────────
const pick = (fn) => { for (const [id, c] of pool) if (c.regulationMark && 'HIJ'.includes(c.regulationMark) && fn(c)) return id; return null; };
const REPS = {
  Supporter: pick(c => c.supertype === 'Trainer' && c.subtype === 'Supporter'),
  Item:      pick(c => c.supertype === 'Trainer' && c.subtype === 'Item'),
  Stadium:   pick(c => c.supertype === 'Trainer' && c.subtype === 'Stadium'),
  Tool:      pick(c => c.supertype === 'Trainer' && c.subtype === 'PokemonTool'),
  BasicE:    pick(c => c.supertype === 'Energy' && c.subtype === 'Basic'),
  SpecialE:  pick(c => c.supertype === 'Energy' && c.subtype !== 'Basic'),
  BasicP:    pick(c => c.supertype === 'Pokemon' && c.stage === 'Basic' && c.subtype !== 'ex'),
  Stage1P:   pick(c => c.supertype === 'Pokemon' && c.stage === 'Stage1' && c.subtype !== 'ex'),
  Stage2P:   pick(c => c.supertype === 'Pokemon' && c.stage === 'Stage2' && c.subtype !== 'ex'),
  ExP:       pick(c => c.supertype === 'Pokemon' && c.subtype === 'ex'),
};
const REPIDS = Object.entries(REPS);
ok(REPIDS.every(([, id]) => id != null), '代表卡齊全（缺一種就代表卡池篩選壞了）');

// ── 現役 deck-search filter 全集（卡面驅動：從 effects 端枚舉 pending 宣告） ──
const filters = new Set();
const walk = (d) => {
  for (const f of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, f.name);
    if (f.isDirectory()) walk(p);
    else if (f.name.endsWith('.ts')) {
      const s = readFileSync(p, 'utf8');
      for (const m of s.matchAll(/type:\s*'deck-search'[\s\S]{0,800}?filter:\s*'([^']+)'/g)) filters.add(m[1]);
    }
  }
};
walk(join(ROOT, 'src/lib/game'));
// ⚠ Rule：掃描器要有下限斷言 —— 掃不到東西時測試會「全部通過」，看起來跟乾淨一樣。
ok(filters.size >= 70, `deck-search filter 全集只掃到 ${filters.size} 個（<70）→ 掃描器壞了，不是乾淨`);

// 'any'/'Any' 卡面語義就是「任意卡」，全選是正確的。白名單只准縮不准擴。
const ALL_OK = new Set(['any', 'Any']);

const mkState = (filter, params) => {
  const deck = REPIDS.map(([, id], i) => ({ iid: 'd' + i, cardId: id, damage: 0, energyAttached: [], toolsAttached: [] }));
  const act = { iid: 'a0', cardId: REPS.BasicP, damage: 0, energyAttached: [], toolsAttached: [] };
  const mk = (d) => ({ name: 'P', active: JSON.parse(JSON.stringify(act)), bench: [], hand: [], deck: d, discard: [], prizes: [] });
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
    log: [], setupDone: [true, true], players: [mk(deck), mk([])],
    pendingSelection: { type: 'deck-search', actorIdx: 0, sourcePlayerIdx: 0, filter, minCount: 0,
      maxCount: REPIDS.length, effectKey: 'guard-scan', ...(params ? { params } : {}) },
  };
};
const aiPicks = (filter, params) => {
  const act = mod.getAIAction(mkState(filter, params), pool, 0);
  const sel = new Set(act?.selectedIids ?? []);
  return REPIDS.filter(([, ], i) => sel.has('d' + i)).map(([k]) => k);
};

console.log('① 每個現役 deck-search filter：AI 不得把全部候選都選走（＝filter 完全沒作用）');
for (const f of [...filters].sort()) {
  if (ALL_OK.has(f)) continue;
  const kinds = aiPicks(f);
  ok(kinds.length < REPIDS.length,
    `filter '${f}' — AI 選走了全部 ${REPIDS.length} 類候選（${kinds.join(',')}）` +
    ` ⇒ ai.ts 落到 deck-search 的 \`return true\` fallthrough。請把 predicate 收進 selection-filter.ts`);
}

console.log('② 逐卡：v6.129 收斂的 7 個 filter 語義正確（正對照，不只是「有擋」）');
const S1 = REPS.Stage1P, S2 = REPS.Stage2P;
// 蓋諾賽克特ex｜金屬信號：只能是【鋼】屬性的 Stage1/Stage2
{
  const metalS1 = pick(c => c.supertype === 'Pokemon' && c.pokemonType === 'Metal' && c.stage === 'Stage1');
  const metalBasic = pick(c => c.supertype === 'Pokemon' && c.pokemonType === 'Metal' && c.stage === 'Basic');
  const ev = (id, iid) => mod.evaluateSelectionFilter('deck-search', 'Stage1Or2:Metal', { iid }, pool.get(id), {});
  ok(ev(metalS1, 'x') === true,  '金屬信號：【鋼】Stage1 應可選');
  ok(ev(metalBasic, 'x') === false, '金屬信號：【鋼】基礎（非進化）不可選');
  ok(ev(REPS.Supporter, 'x') === false, '金屬信號：支援者不可選（玩家回報的火箭隊的拉姆達）');
  ok(ev(REPS.Item, 'x') === false, '金屬信號：物品不可選（玩家回報的火箭隊的接收器）');
  ok(ev(S1, 'x') === false, '金屬信號：非【鋼】屬性的 Stage1 不可選');
  // ex 進化寶可夢 subtype='ex' → 必須靠 stage 欄位判，否則整組 ex 進化卡被漏掉
  const metalExEvo = pick(c => c.supertype === 'Pokemon' && c.pokemonType === 'Metal' && c.subtype === 'ex' && (c.stage === 'Stage1' || c.stage === 'Stage2'));
  if (metalExEvo) ok(ev(metalExEvo, 'x') === true, '金屬信號：【鋼】ex 進化寶可夢應可選（stage 而非 subtype）');
  ok(mod.isKnownSelectionFilter('deck-search', 'Stage1Or2:Metal') === true,
    "'Stage1Or2:Metal' 必須被 isKnownSelectionFilter 認得（否則 engine 的 Stage2 語義閘 fail-open）");
}
// 哈克龍｜進化指引
{
  const ev = (id) => mod.evaluateSelectionFilter('deck-search', 'EvolutionPokemon', { iid: 'x' }, pool.get(id), {});
  ok(ev(S1) === true && ev(S2) === true, '進化指引：Stage1/Stage2 應可選');
  ok(ev(REPS.BasicP) === false, '進化指引：基礎寶可夢不可選');
  ok(ev(REPS.Item) === false, '進化指引：物品不可選');
}
// 時拉比｜時間輪轉
{
  const ev = (id) => mod.evaluateSelectionFilter('deck-search', 'GrassPokemonOrStadium', { iid: 'x' }, pool.get(id), {});
  const grassP = pick(c => c.supertype === 'Pokemon' && c.pokemonType === 'Grass');
  ok(ev(grassP) === true, '時間輪轉：【草】寶可夢應可選');
  ok(ev(REPS.Stadium) === true, '時間輪轉：競技場卡應可選');
  ok(ev(REPS.Supporter) === false && ev(REPS.BasicE) === false, '時間輪轉：支援者/能量不可選');
}
// 熔蟻獸｜舔舔捕捉
{
  const ev = (id) => mod.evaluateSelectionFilter('deck-search', 'FirePokemonOrBasicFireEnergy', { iid: 'x' }, pool.get(id), {});
  const fireP = pick(c => c.supertype === 'Pokemon' && c.pokemonType === 'Fire');
  const fireE = pick(c => c.supertype === 'Energy' && c.subtype === 'Basic' && c.name.includes('【火】'));
  const grassE = pick(c => c.supertype === 'Energy' && c.subtype === 'Basic' && c.name.includes('【草】'));
  ok(ev(fireP) === true && ev(fireE) === true, '舔舔捕捉：【火】寶可夢與基本【火】能量應可選');
  ok(ev(grassE) === false, '舔舔捕捉：基本【草】能量不可選');
  ok(ev(REPS.Item) === false, '舔舔捕捉：物品不可選');
}
// 越橘的一步棋（TOP7 ∩【惡】寶可夢）— TOP 型必須同時驗「在 topN 內」與「卡型」兩個條件
{
  const darkP = pick(c => c.supertype === 'Pokemon' && c.pokemonType === 'Darkness');
  const ev = (id, iid, top7) => mod.evaluateSelectionFilter('deck-search', 'DarknessPokemon:TOP7', { iid }, pool.get(id), { params: { top7Iids: top7 } });
  ok(ev(darkP, 'i1', ['i1']) === true, '越橘的一步棋：top7 內的【惡】寶可夢應可選');
  ok(ev(darkP, 'i9', ['i1']) === false, '越橘的一步棋：top7 **外**的【惡】寶可夢不可選（TOP 範圍限制）');
  ok(ev(REPS.Supporter, 'i1', ['i1']) === false, '越橘的一步棋：top7 內的支援者不可選');
}
// 金屬怪｜金屬製造者（TOP4 ∩ 基本【鋼】能量）
{
  const metalE = pick(c => c.supertype === 'Energy' && c.subtype === 'Basic' && c.name.includes('【鋼】'));
  const ev = (id, iid, top4) => mod.evaluateSelectionFilter('deck-search', 'BasicMetalEnergy:TOP4', { iid }, pool.get(id), { params: { top4Iids: top4 } });
  ok(ev(metalE, 'i1', ['i1']) === true, '金屬製造者：top4 內的基本【鋼】能量應可選');
  ok(ev(metalE, 'i9', ['i1']) === false, '金屬製造者：top4 **外**的基本【鋼】能量不可選');
  ok(ev(REPS.BasicP, 'i1', ['i1']) === false, '金屬製造者：top4 內的寶可夢不可選');
}
// deckSameNameBenchPost（一家鼠｜家族行軍 等）
{
  const ev = (id, targetName) => mod.evaluateSelectionFilter('deck-search', 'Basic:SameName', { iid: 'x' }, pool.get(id), { params: { targetName } });
  const nm = pool.get(REPS.BasicP).name;
  ok(ev(REPS.BasicP, nm) === true, '同名放備戰：同名寶可夢應可選');
  ok(ev(REPS.Stage1P, nm) === false, '同名放備戰：不同名的寶可夢不可選');
  ok(ev(REPS.Item, nm) === false, '同名放備戰：物品不可選');
}

console.log('③ 迴歸：既有已收錄 filter 語義沒被 inst 參數擴充改壞');
{
  ok(mod.evaluateSelectionFilter('deck-search', 'ex', { iid: 'x' }, pool.get(REPS.ExP), {}) === true, "'ex' 仍認得 ex 寶可夢");
  ok(mod.evaluateSelectionFilter('deck-search', 'Supporter', { iid: 'x' }, pool.get(REPS.Supporter), {}) === true, "'Supporter' 仍認得支援者");
  ok(mod.evaluateSelectionFilter('deck-search', 'Supporter', { iid: 'x' }, pool.get(REPS.Item), {}) === false, "'Supporter' 仍排除物品");
  ok(mod.evaluateSelectionFilter('deck-search', '這個filter不存在', { iid: 'x' }, pool.get(REPS.Item), {}) === null, '未收錄 filter 仍回 null（三態 fail-open 契約不變）');
}

console.log('④ engine 的 Stage2 語義閘不得誤殺 TOP 型 filter 的合法選擇（行為端）');
//   ⚠這是把 TOP 型 predicate 收進中央時最大的回歸點：sanitizeSelectedIids 若沒把 pending.params
//     傳給 evaluator，topN 集合會是空的 ⇒ 玩家**合法**選的那張也被濾掉 ⇒ 效果靜默不發生
//     （越橘的一步棋按了沒反應、金屬製造者選的鋼能量憑空消失）。
{
  const darkP = pick(c => c.supertype === 'Pokemon' && c.pokemonType === 'Darkness' && c.stage === 'Basic');
  const deck = [
    { iid: 'k1', cardId: darkP, damage: 0, energyAttached: [], toolsAttached: [] },
    ...Array.from({ length: 6 }, (_, i) => ({ iid: 'f' + i, cardId: REPS.Item, damage: 0, energyAttached: [], toolsAttached: [] })),
  ];
  const pend = {
    type: 'deck-search', actorIdx: 0, sourcePlayerIdx: 0, filter: 'DarknessPokemon:TOP7',
    minCount: 0, maxCount: 1, effectKey: 'lingonberry-pick',
    params: { topIids: deck.map(c => c.iid), top7Iids: deck.map(c => c.iid) },
  };
  const st = {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
    log: [], setupDone: [true, true], pendingSelection: pend,
    players: [
      { name: 'A', active: { iid: 'a0', cardId: REPS.BasicP, damage: 0, energyAttached: [], toolsAttached: [] }, bench: [], hand: [], deck, discard: [], prizes: [] },
      { name: 'B', active: { iid: 'b0', cardId: REPS.BasicP, damage: 0, energyAttached: [], toolsAttached: [] }, bench: [], hand: [], deck: [], discard: [], prizes: [] },
    ],
  };
  const kept = mod.sanitizeSelectedIids(st, pend, ['k1'], pool);
  ok(kept.length === 1 && kept[0] === 'k1',
    `越橘的一步棋：玩家選 top7 內的【惡】寶可夢，engine 閘不得清掉（實得 ${JSON.stringify(kept)}）`
    + ' ⇒ sanitizeSelectedIids 必須把 pending.params 傳進 evaluateSelectionFilter');
  // 反向對照：不在 top7 內的卡仍要被閘清掉（不能因為傳了 params 就變成放行一切）
  const outside = { ...pend, params: { topIids: ['zzz'], top7Iids: ['zzz'] } };
  const kept2 = mod.sanitizeSelectedIids(st, outside, ['k1'], pool);
  ok(kept2.length === 0, '越橘的一步棋：top7 **外**的卡仍必須被 engine 閘清掉（反向對照，防閘變成全放行）');
  // 金屬製造者同型
  const metalE = pick(c => c.supertype === 'Energy' && c.subtype === 'Basic' && c.name.includes('【鋼】'));
  const deck2 = [{ iid: 'm1', cardId: metalE, damage: 0, energyAttached: [], toolsAttached: [] }];
  const pend2 = { type: 'deck-search', actorIdx: 0, sourcePlayerIdx: 0, filter: 'BasicMetalEnergy:TOP4',
    minCount: 0, maxCount: 4, effectKey: 'metal-maker-attach', params: { top4Iids: ['m1'] } };
  const st2 = { ...st, players: [{ ...st.players[0], deck: deck2 }, st.players[1]], pendingSelection: pend2 };
  const kept3 = mod.sanitizeSelectedIids(st2, pend2, ['m1'], pool);
  ok(kept3.length === 1, `金屬製造者：玩家選 top4 內的基本【鋼】能量，engine 閘不得清掉（實得 ${JSON.stringify(kept3)}）`);
}

console.log('⑤ pending 頂層 validIids ＝死資料：限制必須真的生效（光子纜線行為端）');
//   密勒頓(J)｜光子纜線 卡面：「這隻寶可夢在戰鬥場上受到對手的寶可夢招式的傷害而【昏厥】時，
//   選擇最多2張**這隻寶可夢身上附加的**「基本【雷】能量」卡，改附於1隻備戰寶可夢身上。」
//   v6.128 以前 validIids 寫在 pending **頂層**（型別只認 params.validIids）＋ resolver 不驗卡型
//   ⇒ 棄牌區任意卡（訓練家/寶可夢）都能被當能量附到備戰寶可夢身上。
{
  const SUP = REPS.Supporter;
  const lightE = pick(c => c.supertype === 'Energy' && c.subtype === 'Basic' && c.name.includes('【雷】'));
  const mkSt = (discard) => ({
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
    log: [], setupDone: [true, true], pendingSelection: null,
    players: [
      { name: 'A', active: null, bench: [{ iid: 'b1', cardId: REPS.BasicP, damage: 0, energyAttached: [], toolsAttached: [] }],
        hand: [], deck: [], discard, prizes: [] },
      { name: 'B', active: { iid: 'b0', cardId: REPS.BasicP, damage: 0, energyAttached: [], toolsAttached: [] }, bench: [], hand: [], deck: [], discard: [], prizes: [] },
    ],
  });
  const run = (discard, sendIids, validIids) => {
    let st = mkSt(discard);
    st = mod.RESOLVERS.get('photon-code-pick-energy')(st, 0, sendIids, { validIids }, pool);
    if (!st.pendingSelection) return [];   // phase1 擋掉 → 沒有能量會被搬
    st = mod.RESOLVERS.get('m5-mirieton-photon-code')(st, 0, ['b1'], st.pendingSelection.params, pool);
    return st.players[0].bench[0].energyAttached.map((e) => pool.get(e.cardId)?.supertype);
  };
  // 攻擊面：client 送「棄牌區的支援者卡」，validIids 是本次 KO 前身上的雷能量（不含它）
  const cheated = run([{ iid: 'X1', cardId: SUP }, { iid: 'E1', cardId: lightE }], ['X1'], ['E1']);
  ok(cheated.length === 0,
    `光子纜線：client 送 validIids 外的棄牌區卡（支援者）不得被當能量附上去（實得 ${JSON.stringify(cheated)}）`
    + ' ⇒ validIids 必須放在 params，且 phase1 resolver 要自驗交集');
  // 正對照：合法的基本【雷】能量必須照常運作（防「修成全擋」）
  const legit = run([{ iid: 'E1', cardId: lightE }], ['E1'], ['E1']);
  ok(legit.length === 1 && legit[0] === 'Energy',
    `光子纜線：validIids 內的基本【雷】能量必須照常搬到備戰寶可夢身上（實得 ${JSON.stringify(legit)}）`);
}

console.log(`\nv6129 deck-search filter parity：PASS ${pass} / FAIL ${fail}`);
if (fail > 0) process.exit(1);
