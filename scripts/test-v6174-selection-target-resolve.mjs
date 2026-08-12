// v6.174 守衛：picker「目標解析失敗」不得留下半套盤面（牌張守恆）＋ pending 必須有出口。
//
// 玩家回報（錦標賽「薪水小偷 R2：南崁大雞雞 vs 蛋蛋戰隊-起士蛋」最後一回合）：
//   使用 火焰雞ex｜沸騰鬥志 後對戰 log 出現
//     `沸騰鬥志：將 基本【超】能量 附給 ?`
//   然後玩家無法繼續操作。
//
// 真因（six_decks.ts blaziken-boiling-attach）：resolver **先**把能量從棄牌區 filter 掉、
//   **後**才用 selectedIids[0] 找目標；目標解析失敗時只把 log 的名字寫成 `?` 就 return
//   ⇒ 能量既沒留在棄牌區也沒附到任何寶可夢身上 = **整張卡從遊戲中消失**（牌張不守恆）。
//   同型寫法成群：岩石武裝（手牌）／惡棍衝天（牌庫）／N的ＰＰ提升劑（棄牌區）。
//   換場型（老大的指令／頂尖捕捉器）則是「先 addLog 宣告換好、後 findIndex 靜默不換」
//   ⇒ log 騙玩家（實戰 dump 已出現 `呼叫 ? 到對手戰鬥場`）。
//
// 收斂：_shared.ts 的 attachEnergyFromZoneToOwnPokemon / promoteOppBenchToActive
//   （先解析、全成功才動盤面，失敗完全 no-op），加上 engine.sanitizeSelectedIids
//   對所有非 distribute 型 pending 一律套 params.validIids 交集。
//
// 跑法：node scripts/test-v6174-selection-target-resolve.mjs
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.g6174-s.js'), E = join(ROOT, '.g6174-e.ts'), O = join(ROOT, '.g6174-o.mjs');
const O2 = join(ROOT, 'scripts', '.g6174-sel.o.mjs');
process.on('exit', () => { for (const p of [S, E, O, O2]) { try { unlinkSync(p); } catch { /* */ } } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { applyAction, getUsableAbilities, sanitizeSelectedIids } from './src/lib/game/engine';\n"
  + "export { TRAINER_EFFECTS, RESOLVERS, ATTACK_POST } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({
  entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error',
});
const mod = await import(pathToFileURL(O).href);
await build({ entryPoints: [join(ROOT, 'src/lib/game/selection-ui.ts')], outfile: O2, bundle: true, format: 'esm', platform: 'node', logLevel: 'error' });
const SEL = await import(pathToFileURL(O2).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const byName = (n) => { for (const [, c] of pool) if (c.name === n) return c; return null; };
const inst = (name, iid, extra = {}) => {
  const c = byName(name);
  if (!c) throw new Error('fixture 缺卡：' + name);
  return { iid, cardId: String(c.id), damage: 0, energyAttached: [], ...extra };
};

let pass = 0; const fail = [];
const ck = (n, ok, d = '') => { if (ok) pass++; else fail.push(n + (d ? ' — ' + d : '')); };

/** 全域牌張守恆：數出雙方所有區域（含附加能量/道具/進化鏈）的 iid 總數。 */
function countAllCards(st) {
  let n = 0;
  const walk = (c) => {
    if (!c) return;
    n++;
    for (const e of c.energyAttached ?? []) walk(e);
    if (c.toolAttached) walk(c.toolAttached);
    for (const t of c.extraTools ?? []) walk(t);
    for (const b of c.evolvedFromStack ?? []) walk(b);
  };
  for (const p of st.players) {
    for (const z of ['hand', 'deck', 'discard', 'prizes', 'bench']) for (const c of p[z] ?? []) walk(c);
    walk(p.active);
  }
  return n;
}

const baseState = (p0, p1) => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
  isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
  players: [p0, p1],
});

// ── A. 火焰雞ex｜沸騰鬥志 — 完整流程 USE_ABILITY → RESOLVE → RESOLVE ─────────────
// 卡面（SVM 12086）：「在自己的回合時可使用1次。從自己的棄牌區選擇1張基本能量卡，附於自己的寶可夢身上。」
function blazikenState() {
  return baseState(
    {
      name: 'P0', active: inst('莉莉艾的皮皮ex', 'ravmbo09'),
      bench: [inst('火焰雞ex', '94iqs0uq'), inst('火稚雞', '48h5nkce')],
      hand: [], deck: [], discard: [inst('基本【超】能量', 'ENG1')], prizes: [],
    },
    { name: 'P1', active: inst('皮卡丘', 'opp1'), bench: [], hand: [], deck: [], discard: [], prizes: [] },
  );
}
{
  const st0 = blazikenState();
  const total0 = countAllCards(st0);
  const ua = mod.getUsableAbilities(st0, pool);
  ck('沸騰鬥志：備戰的火焰雞ex 可發動', ua.some((a) => a.abilityName === '沸騰鬥志' && a.iid === '94iqs0uq'));

  // A1 正常路徑（回歸保護）
  let s = mod.applyAction(st0, { type: 'USE_ABILITY', iid: '94iqs0uq', abilityIndex: 0 }, pool);
  s = mod.applyAction(s, { type: 'RESOLVE_SELECTION', selectedIids: ['ENG1'] }, pool);
  ck('沸騰鬥志：第2步開 heal-target 且 validIids 含 active+bench',
    s.pendingSelection?.effectKey === 'blaziken-boiling-attach'
    && (s.pendingSelection?.params?.validIids ?? []).includes('94iqs0uq')
    && (s.pendingSelection?.params?.validIids ?? []).includes('ravmbo09'));
  const okS = mod.applyAction(s, { type: 'RESOLVE_SELECTION', selectedIids: ['94iqs0uq'] }, pool);
  ck('沸騰鬥志：正常選目標 → 能量真的附上去',
    okS.players[0].bench.find((b) => b.iid === '94iqs0uq')?.energyAttached.length === 1);
  ck('沸騰鬥志：正常路徑牌張守恆', countAllCards(okS) === total0, `${countAllCards(okS)} vs ${total0}`);

  // A2 ★ 真因重現：client 送空陣列（玩家按安全網「放棄」／線上 race）
  const emptyS = mod.applyAction(s, { type: 'RESOLVE_SELECTION', selectedIids: [] }, pool);
  ck('★沸騰鬥志：送空選擇 → 能量必須留在棄牌區（不得蒸發）',
    emptyS.players[0].discard.some((c) => c.iid === 'ENG1'));
  ck('★沸騰鬥志：送空選擇 → 牌張守恆', countAllCards(emptyS) === total0, `${countAllCards(emptyS)} vs ${total0}`);
  ck('★沸騰鬥志：送空選擇 → log 不得出現「附給 ?」',
    !emptyS.log.some((l) => /附給\s*\?/.test(l.message)));
  ck('★沸騰鬥志：送空選擇 → pending 必須關閉（不得軟鎖）', !emptyS.pendingSelection);

  // A3 ★ client 送場上不存在的 iid（版本 skew / 竄改）
  const badS = mod.applyAction(s, { type: 'RESOLVE_SELECTION', selectedIids: ['ghost-iid'] }, pool);
  ck('★沸騰鬥志：送不存在的 iid → 能量留在棄牌區',
    badS.players[0].discard.some((c) => c.iid === 'ENG1'));
  ck('★沸騰鬥志：送不存在的 iid → 牌張守恆', countAllCards(badS) === total0);

  // A4 ★ client 送「對手的」寶可夢 iid（卡面明寫「自己的寶可夢」）
  const oppS = mod.applyAction(s, { type: 'RESOLVE_SELECTION', selectedIids: ['opp1'] }, pool);
  ck('★沸騰鬥志：送對手 iid → 不得附到對手身上',
    (oppS.players[1].active?.energyAttached ?? []).length === 0);
  ck('★沸騰鬥志：送對手 iid → 牌張守恆', countAllCards(oppS) === total0);
}

// ── B. sanitizeSelectedIids 中央閘：validIids 之外的 iid 一律濾掉 ───────────────
{
  const st = blazikenState();
  const pending = {
    type: 'heal-target', actorIdx: 0, sourcePlayerIdx: 0, minCount: 1, maxCount: 1,
    effectKey: 'blaziken-boiling-attach', params: { validIids: ['94iqs0uq'] },
  };
  ck('★sanitize：heal-target 濾掉 validIids 外的 iid',
    JSON.stringify(mod.sanitizeSelectedIids(st, pending, ['ravmbo09', '94iqs0uq'], pool)) === JSON.stringify(['94iqs0uq']));
  const noValid = { ...pending, params: {} };
  ck('sanitize：沒有 validIids 時原封放行',
    JSON.stringify(mod.sanitizeSelectedIids(st, noValid, ['ravmbo09'], pool)) === JSON.stringify(['ravmbo09']));
  const dist = {
    type: 'damage-distribute', actorIdx: 0, sourcePlayerIdx: 1, minCount: 1, maxCount: 6,
    effectKey: 'x', params: { validIids: ['opp1'] },
  };
  ck('sanitize：distribute 型保留重複 iid（計數語義）',
    JSON.stringify(mod.sanitizeSelectedIids(st, dist, ['opp1', 'opp1', 'opp1'], pool)) === JSON.stringify(['opp1', 'opp1', 'opp1']));
}

// ── C. 老大的指令 / 頂尖捕捉器：目標解析失敗不得印「已換場」的假 log ─────────────
function gustState() {
  return baseState(
    {
      name: 'P0', active: inst('皮卡丘', 'me-a'), bench: [inst('火稚雞', 'me-b')],
      hand: [inst('老大的指令', 'boss1'), inst('頂尖捕捉器', 'cat1')], deck: [], discard: [], prizes: [],
    },
    {
      name: 'P1', active: inst('願增猿', 'opp-a'), bench: [inst('皮卡丘', 'opp-b')],
      hand: [], deck: [], discard: [], prizes: [],
    },
  );
}
for (const [cardName, iid, key] of [['老大的指令', 'boss1', 'gust-opp'], ['頂尖捕捉器', 'cat1', 'top-catcher-opp']]) {
  const st0 = gustState();
  const total0 = countAllCards(st0);
  const opened = mod.applyAction(st0, { type: 'PLAY_TRAINER', iid }, pool);
  ck(`${cardName}：開出對手備戰 picker`, opened.pendingSelection?.effectKey === key,
    JSON.stringify(opened.pendingSelection ?? null));
  const emptyS = mod.applyAction(opened, { type: 'RESOLVE_SELECTION', selectedIids: [] }, pool);
  ck(`★${cardName}：送空選擇 → 不得出現「呼叫 ? 到對手戰鬥場」的假 log`,
    !emptyS.log.some((l) => /呼叫\s*\?\s*到對手戰鬥場/.test(l.message)));
  ck(`★${cardName}：送空選擇 → 對手戰鬥場不得被換走`, emptyS.players[1].active?.iid === 'opp-a');
  ck(`${cardName}：送空選擇 → 牌張守恆`, countAllCards(emptyS) === total0);
  // 正常路徑回歸
  const okS = mod.applyAction(opened, { type: 'RESOLVE_SELECTION', selectedIids: ['opp-b'] }, pool);
  ck(`${cardName}：正常選目標 → 對手備戰真的上場`, okS.players[1].active?.iid === 'opp-b');
}
{
  // ★ 頂尖捕捉器特有：解析失敗時不得繼續往下開「自己換誰上場」的 picker（半套盤面）
  const st0 = gustState();
  const opened = mod.applyAction(st0, { type: 'PLAY_TRAINER', iid: 'cat1' }, pool);
  const emptyS = mod.applyAction(opened, { type: 'RESOLVE_SELECTION', selectedIids: [] }, pool);
  ck('★頂尖捕捉器：對手沒換成功時，不得再要求我方換場',
    emptyS.pendingSelection?.effectKey !== 'do-switch',
    JSON.stringify(emptyS.pendingSelection ?? null));
}

// ── D. 「pending 開了卻沒有出口」中央述詞 ────────────────────────────────────────
{
  const mk = (type, minCount, effectKey = 'x') => ({ type, effectKey, actorIdx: 0, sourcePlayerIdx: 0, minCount });
  const hasFn = typeof SEL.selectionHasNoExit === 'function';
  ck('★中央述詞 selectionHasNoExit 必須存在（判斷不得留在 .svelte 內無法測）', hasFn);
  const noExit = hasFn ? SEL.selectionHasNoExit : () => false;
  ck('無出口：heal-target 候選 0 + minCount1 → 要放棄鈕', noExit(mk('heal-target', 1), 0));
  ck('★無出口：damage-distribute 候選 0 + minCount1 → 也要放棄鈕（原本被排除＝真卡死）',
    noExit(mk('damage-distribute', 1), 0));
  ck('★無出口：energy-distribute 候選 0 + minCount1 → 也要放棄鈕',
    noExit(mk('energy-distribute', 1), 0));
  ck('無出口：有候選時不給放棄鈕', !noExit(mk('heal-target', 1), 3));
  ck('無出口：minCount0（本來就能不選）不算卡死', !noExit(mk('heal-target', 0), 0));
  ck('無出口：已有【不選】鈕的 picker 不重複給', !noExit(mk('deck-search', 0), 0));
}

// ── E. 靜態掃描：四張「附能到場上目標」的卡必須走中央 helper（禁回退成 inline `'?'` fallback）──
{
  const src = readFileSync(join(ROOT, 'src/lib/game/effects/cards/six_decks.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/[​-‍﻿]/g, '');
  const keys = ['blaziken-boiling-attach', 'rock-armor-attach', 'rascal-skyward-attach', 'n-pp-attach'];
  ck('掃描器有掃到東西（下限斷言）', src.length > 20000, String(src.length));
  for (const k of keys) {
    const i = src.indexOf(`regR('${k}'`);
    ck(`掃描：找得到 ${k}`, i >= 0);
    if (i < 0) continue;
    const blk = src.slice(i, i + 1400);
    ck(`${k} 走中央 attachEnergyFromZoneToOwnPokemon`, blk.includes('attachEnergyFromZoneToOwnPokemon'));
    ck(`${k} 不得再有 inline 的 '?' 目標名 fallback`, !/tgtName\s*=\s*'\?'/.test(blk));
  }
  // 正對照：確認上面的否定型判準真的抓得到違規樣本
  ck('否定型判準自我驗證（正對照）', /tgtName\s*=\s*'\?'/.test("let tgtName = '?';"));
}

// ── F. 同型漏網（Fable 5 審查抓到）：牌庫附能型「神樂」族 ─────────────────────────
// 卡面（厄鬼椪 礎石/碧草/火灶/水井面具，I 標）：
//   「從自己的牌庫選擇1張『基本【X】能量』卡，附於自己的寶可夢身上。並且重洗牌庫。」
for (const [poke, atk, energyName] of [
  ['厄鬼椪 礎石面具', '石之神樂', '基本【鬥】能量'],
  ['厄鬼椪 碧草面具', '草之神樂', '基本【草】能量'],
]) {
  const st0 = baseState(
    {
      name: 'P0', active: inst(poke, 'me-a'), bench: [inst('火稚雞', 'me-b')],
      hand: [], deck: [inst(energyName, 'DE1'), inst('皮卡丘', 'deckfill')], discard: [], prizes: [],
    },
    { name: 'P1', active: inst('皮卡丘', 'opp-a'), bench: [], hand: [], deck: [], discard: [], prizes: [] },
  );
  const total0 = countAllCards(st0);
  const post = mod.ATTACK_POST.get(`${poke}|${atk}`);
  ck(`${atk}：ATTACK_POST 有註冊`, typeof post === 'function');
  if (typeof post !== 'function') continue;
  const opened = post(st0, 0, pool);
  ck(`★${atk}：pending 必須帶 validIids（UI/AI/中央閘的權威）`,
    Array.isArray(opened.pendingSelection?.params?.validIids)
    && opened.pendingSelection.params.validIids.includes('me-a')
    && opened.pendingSelection.params.validIids.includes('me-b'));
  // 正常路徑
  const okS = mod.applyAction(opened, { type: 'RESOLVE_SELECTION', selectedIids: ['me-b'] }, pool);
  ck(`${atk}：正常選目標 → 能量真的附上`,
    okS.players[0].bench.find((b) => b.iid === 'me-b')?.energyAttached.length === 1);
  ck(`${atk}：正常路徑牌張守恆`, countAllCards(okS) === total0);
  // ★ 目標解析失敗
  const badS = mod.applyAction(opened, { type: 'RESOLVE_SELECTION', selectedIids: ['ghost-iid'] }, pool);
  ck(`★${atk}：送無效 iid → 能量必須留在牌庫（不得蒸發）`,
    badS.players[0].deck.some((c) => c.iid === 'DE1'));
  ck(`★${atk}：送無效 iid → 牌張守恆`, countAllCards(badS) === total0,
    `${countAllCards(badS)} vs ${total0}`);
  const emptyS = mod.applyAction(opened, { type: 'RESOLVE_SELECTION', selectedIids: [] }, pool);
  ck(`★${atk}：送空選擇 → 牌張守恆`, countAllCards(emptyS) === total0);
  ck(`${atk}：不論成敗都要重洗牌庫（卡面獨立的一句）`,
    emptyS.log.some((l) => /神樂/.test(l.message)));
}

// ── G. ★接線斷言：分配型 picker 的逃生鈕必須真的**渲染在那個分支裡** ─────────────
//   （v6.154 教訓：純函式回傳 true ≠ 畫面上真的有那顆按鈕可以按。）
{
  const page = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
  const fi = page.indexOf('<div class="sel-footer">');
  const fj = page.indexOf('{/if}\n        </div>', fi);
  const footer = fi >= 0 && fj > fi ? page.slice(fi, fj) : '';
  ck('接線掃描：找得到 sel-footer（anchor 有效）', footer.length > 500 && footer.length < 8000, String(footer.length));
  const cut = (from, to) => {
    const i = footer.indexOf(from); const j = footer.indexOf(to, i + 1);
    return i >= 0 && j > i ? footer.slice(i, j) : '';
  };
  const dmgBranch = cut('{:else if isDmgDist}', '{:else if isEnergyDist}');
  const engBranch = cut('{:else if isEnergyDist}', "{:else if pendingSelection.type === 'reorder-deck-top'}");
  ck('接線掃描：切得出 isDmgDist 分支', dmgBranch.length > 100 && dmgBranch.length < 2500, String(dmgBranch.length));
  ck('接線掃描：切得出 isEnergyDist 分支', engBranch.length > 100 && engBranch.length < 2500, String(engBranch.length));
  ck('★damage-distribute 分支必須渲染 pendingStuckEmpty 逃生鈕',
    dmgBranch.includes('pendingStuckEmpty') && dmgBranch.includes('abandonSelection'));
  ck('★energy-distribute 分支必須渲染 pendingStuckEmpty 逃生鈕',
    engBranch.includes('pendingStuckEmpty') && engBranch.includes('abandonSelection'));
  // 正對照：判準確實抓得到「沒接線」的樣本
  ck('接線判準自我驗證（正對照）',
    !('{:else if isDmgDist}<button>x</button>'.includes('pendingStuckEmpty')));
}

// ── H. 換場失敗 log 不得出現雙冒號（label 已含前綴，helper 不得再自加） ───────────
{
  const st0 = gustState();
  const opened = mod.applyAction(st0, { type: 'PLAY_TRAINER', iid: 'cat1' }, pool);
  const emptyS = mod.applyAction(opened, { type: 'RESOLVE_SELECTION', selectedIids: [] }, pool);
  ck('頂尖捕捉器失敗 log 不得出現「：：」', !emptyS.log.some((l) => /：：/.test(l.message)));
}

console.log(`\n[test-v6174-selection-target-resolve] PASS ${pass} / FAIL ${fail.length}`);
for (const f of fail) console.log('  ✗ ' + f);
if (fail.length) process.exit(1);
