// ⭐⭐⭐ v6.330 守衛：奇異時鐘的退化層數，一律讀「實際進化堆疊深度」而非卡面印的 stage
//
// 玩家回報（2026-09-08）：
//   「使用 奇異時鐘 退回 由 神奇糖果進化的胡地（凱西⇒神奇糖果＋胡地進化，中間沒有勇基拉）時，
//     會沒有辦法退回變成凱西。依據官方QA，在中間沒有一階進化卡牌的情況下，
//     應該還是可以直接從胡地退回凱西。」
//
// 根因：`odd-clock-step1` 用**卡面印的 stage** 決定選單 —— 只要是【2階進化】就一律給
//   「①退化 1 層（→ 1 階進化）／②退化 2 層（→ 基礎）」兩個選項。
//   但神奇糖果跳過 1 階直接進化的胡地，`evolvedFromStack` 只有 [凱西]、深度 **1**：
//     ・選②「退化 2 層」 → `stack.length(1) < 2` → 「堆疊深度不足以退化 2 層，取消」
//       而奇異時鐘**已經打出去了** ⇒ 卡片白白浪費（＝玩家看到的「沒有辦法退回」）
//     ・選①雖然真的會退回凱西，但標籤寫「→ 1 階進化」是錯的
//   ⇒ 引擎層的 `buildDevolvedInstance` 本來就是讀堆疊、行為正確；壞掉的純粹是**選單**。
//
// 修法：中央 `devolvableLayers(inst)`（= `evolvedFromStack.length`）為唯一來源，
//   選項數 ＝ 實際深度、標籤直接寫出「退化後會變成哪一張」；深度 1 直接自動退 1 層不再多問；
//   深度 0（進化寶可夢被**直接放置**於場上，例如 齒輪怪｜緊急迴轉、烈箭鷹ex｜激動俯衝，
//   官方 Q&A 亦有「幻影變化直接放置的[1階進化]寶可夢」這一類）一律不列為可選目標。
//
// ⚠ 同維度掃描結論（v6.330）：全站 38 個 `modal-choice` 裡，只有 `odd-clock-step2` 的靜態選項
//   **可能是玩家做不到的**；其餘都是 yes/no、狀態名、keep/discard 這類恆可達的選項。
//   本檔的 D 區把這個不變量鎖住，避免日後又有人寫死「做不到的選項」。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, fail = 0;
const ok = (c, m) => { if (!c) throw new Error(m); };
function T(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; }
}

const S = join(ROOT, '.x6330-s.js'), E = join(ROOT, '.x6330-e.ts'), O = join(ROOT, '.x6330-o.mjs');
const cleanup = () => { for (const p of [S, E, O]) { try { if (existsSync(p)) unlinkSync(p); } catch { /* ignore */ } } };
let M;
try {
  writeFileSync(S, 'export const base="";');
  writeFileSync(E,
    "export { applyAction } from './src/lib/game/engine';\n"
    + "export { devolvableLayers, buildEvolvedInstance, buildDevolvedInstance, RESOLVERS } from './src/lib/game/effects/_shared';\n"
    + "import './src/lib/game/effects';\n");
  await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
    alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
  M = await import(pathToFileURL(O).href + '?v=' + Date.now());
} finally { cleanup(); }

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const byName = (n, p) => [...pool.values()].find((c) => c.name === n
  && ['H', 'I', 'J'].includes(c.regulationMark) && (!p || p(c)));
let _n = 0;
const inst = (cid, e = {}) => ({ iid: `G${++_n}`, cardId: String(cid), damage: 0, energyAttached: [], ...e });
const nameOf = (i) => (i ? (pool.get(i.cardId)?.name ?? '?') : '(無)');

const ABRA = byName('凱西');
const KADABRA = byName('勇基拉');
const ALAKAZAM = byName('胡地', (c) => (c.subtype === 'Stage2' || c.stage === 'Stage2'));
const CLOCK = byName('奇異時鐘');
const FILLER = byName('基本【水】能量');
const STADIUMLESS = { activeStadium: null };

console.log('A. 中央述詞：可退化層數只看實際堆疊，不看卡面 stage');

T('⭐⭐⭐ A1 devolvableLayers 只數 evolvedFromStack，與卡面印的 stage 無關', () => {
  const candy = M.buildEvolvedInstance(inst(ABRA.id), inst(ALAKAZAM.id), STADIUMLESS, pool);
  const normal = M.buildEvolvedInstance(
    M.buildEvolvedInstance(inst(ABRA.id), inst(KADABRA.id), STADIUMLESS, pool),
    inst(ALAKAZAM.id), STADIUMLESS, pool);
  ok(pool.get(candy.cardId).stage === 'Stage2' || pool.get(candy.cardId).subtype === 'Stage2',
    '前提壞了：胡地不是【2階進化】');
  ok(M.devolvableLayers(candy) === 1,
    '神奇糖果跳階進化的【2階進化】深度應為 1，實得 ' + M.devolvableLayers(candy)
    + '（⚠ 卡面是 Stage2，但實際只疊了 1 張進化卡）');
  ok(M.devolvableLayers(normal) === 2, '正規兩階進化深度應為 2，實得 ' + M.devolvableLayers(normal));
  ok(M.devolvableLayers(inst(ALAKAZAM.id)) === 0, '直接放置（無堆疊）的進化寶可夢深度應為 0');
  ok(M.devolvableLayers(null) === 0 && M.devolvableLayers(undefined) === 0, 'null/undefined 應為 0');
});

console.log('B. 行為端：奇異時鐘走完整 PLAY_TRAINER → RESOLVE 流程');

/** 打出奇異時鐘、選好目標，回傳當下的 state（可能已經退化完，也可能停在層數 modal） */
function playClock(active) {
  const st0 = {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0,
    turn: 5, isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
    players: [
      { name: 'A', active, bench: [], hand: [inst(CLOCK.id)], deck: [inst(FILLER.id)], discard: [], prizes: [] },
      { name: 'B', active: inst(ABRA.id), bench: [], hand: [], deck: [inst(FILLER.id)], discard: [], prizes: [] },
    ],
  };
  const played = M.applyAction(st0, { type: 'PLAY_TRAINER', iid: st0.players[0].hand[0].iid }, pool);
  return { played, picked: played.pendingSelection
    ? M.applyAction(played, { type: 'RESOLVE_SELECTION', selectedIids: [active.iid] }, pool) : null };
}
const optionsOf = (st) => (st?.pendingSelection?.params?.options ?? []).map((o) => o.text);

T('⭐⭐⭐ B1 神奇糖果進化的胡地（深度 1）：不再詢問層數，直接退回凱西', () => {
  const candy = M.buildEvolvedInstance(inst(ABRA.id), inst(ALAKAZAM.id), STADIUMLESS, pool);
  const { played, picked } = playClock(candy);
  ok(played.pendingSelection?.effectKey === 'odd-clock-step1',
    '奇異時鐘沒開選目標的 picker：' + played.pendingSelection?.effectKey);
  ok((played.pendingSelection?.params?.validIids ?? []).includes(candy.iid), '糖果進化的胡地不在可選清單裡');
  ok(picked.pendingSelection == null,
    '深度只有 1 卻還在問層數（舊版就是在這裡給了做不到的「退化 2 層」）：' + JSON.stringify(optionsOf(picked)));
  ok(nameOf(picked.players[0].active) === '凱西',
    '應直接退回凱西，實得 ' + nameOf(picked.players[0].active));
  ok(picked.players[0].hand.some((c) => nameOf(c) === '胡地'), '移除的胡地沒有放回手牌');
});

T('⭐⭐⭐ B2 正規兩階進化的胡地（深度 2）：兩個選項，且標籤寫出實際會變成哪一張', () => {
  const normal = M.buildEvolvedInstance(
    M.buildEvolvedInstance(inst(ABRA.id), inst(KADABRA.id), STADIUMLESS, pool),
    inst(ALAKAZAM.id), STADIUMLESS, pool);
  const { picked } = playClock(normal);
  const opts = optionsOf(picked);
  ok(picked.pendingSelection?.effectKey === 'odd-clock-step2', '深度 2 應該要問層數');
  ok(opts.length === 2, '選項數應等於實際深度 2，實得 ' + opts.length + '：' + JSON.stringify(opts));
  ok(opts[0].includes('勇基拉') && opts[1].includes('凱西'),
    '標籤必須寫出實際結果卡名（退 1 層→勇基拉、退 2 層→凱西），實得 ' + JSON.stringify(opts));
  for (const [pick, want] of [['1', '勇基拉'], ['2', '凱西']]) {
    const done = M.applyAction(picked, { type: 'RESOLVE_SELECTION', selectedIids: [pick] }, pool);
    ok(nameOf(done.players[0].active) === want,
      `選「${pick}」應變成 ${want}，實得 ` + nameOf(done.players[0].active));
    const logTxt = (done.log ?? []).map((l) => l?.message ?? l).join('\n');
    ok(!/堆疊深度不足/.test(logTxt), `選「${pick}」竟然撞到「堆疊深度不足」：` + logTxt.slice(-160));
  }
});

T('⭐⭐ B3 一階進化（深度 1）維持原本行為：直接退 1 層，不問', () => {
  const yuji = M.buildEvolvedInstance(inst(ABRA.id), inst(KADABRA.id), STADIUMLESS, pool);
  const { picked } = playClock(yuji);
  ok(picked.pendingSelection == null, '一階進化不該詢問層數');
  ok(nameOf(picked.players[0].active) === '凱西', '應退回凱西，實得 ' + nameOf(picked.players[0].active));
});

T('⭐⭐⭐ B4 身上沒有疊進化卡的進化寶可夢，不得列為可選目標（否則白白用掉奇異時鐘）', () => {
  // 站內真的有「把自己從手牌直接放置於備戰區」的進化寶可夢（齒輪怪｜緊急迴轉、烈箭鷹ex｜激動俯衝），
  // 官方 Q&A 也有「幻影變化直接放置的[1階進化]寶可夢」這一類 ⇒ 堆疊是空的、根本無法退化。
  const bare = inst(ALAKAZAM.id);                     // 卡面 Stage2、但 evolvedFromStack 是空的
  ok(M.devolvableLayers(bare) === 0, '前提壞了');
  const { played } = playClock(bare);
  const valid = played.pendingSelection?.params?.validIids ?? [];
  ok(!valid.includes(bare.iid),
    '沒有進化堆疊的寶可夢竟然可選 —— 選了之後會取消，奇異時鐘白白浪費');
});

console.log('C. 否定對照：修正不得放寬「只能選自己的【超】進化寶可夢」');

T('⭐⭐ C1 基礎／對手的／非【超】的寶可夢都不可選（⚠ 場上必須有一隻合法目標，否則整條是恆真斷言）', () => {
  // ⚠⚠ 本檔第一版就是**恆真斷言**：場上只放基礎凱西 ⇒ regG 回 false ⇒ 卡根本打不出去
  //   ⇒ pendingSelection 是 undefined ⇒ `valid` 是空陣列 ⇒ 三個 !includes 全部恆成立。
  //   對抗性審查用「picker 改掃雙方場上」「拿掉【超】屬性 gate」兩個突變證明它什麼都沒守。
  //   ⇒ 一定要先放一隻**合法目標**讓卡打得出來，斷言才有意義。
  const legal = M.buildEvolvedInstance(inst(ABRA.id), inst(KADABRA.id), STADIUMLESS, pool);  // 自己的【超】1階，深度 1
  const basic = inst(ABRA.id);                                                              // 自己的基礎
  const nonPsychic = [...pool.values()].find((c) => c.supertype === 'Pokemon'
    && ['H', 'I', 'J'].includes(c.regulationMark) && c.pokemonType && c.pokemonType !== 'Psychic'
    && (c.stage === 'Stage1' || c.subtype === 'Stage1') && c.evolvesFrom);
  ok(nonPsychic, '找不到非【超】的 1 階寶可夢當對照');
  const nonPsyBase = [...pool.values()].find((c) => c.name === nonPsychic.evolvesFrom);
  const nonPsyInst = nonPsyBase
    ? M.buildEvolvedInstance(inst(nonPsyBase.id), inst(nonPsychic.id), STADIUMLESS, pool)
    : null;
  const oppEvo = M.buildEvolvedInstance(inst(ABRA.id), inst(KADABRA.id), STADIUMLESS, pool);
  const st0 = {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0,
    turn: 5, isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
    players: [
      { name: 'A', active: legal, bench: [basic, ...(nonPsyInst ? [nonPsyInst] : [])],
        hand: [inst(CLOCK.id)], deck: [inst(FILLER.id)], discard: [], prizes: [] },
      { name: 'B', active: oppEvo, bench: [], hand: [], deck: [inst(FILLER.id)], discard: [], prizes: [] },
    ],
  };
  const played = M.applyAction(st0, { type: 'PLAY_TRAINER', iid: st0.players[0].hand[0].iid }, pool);
  ok(played.pendingSelection?.effectKey === 'odd-clock-step1',
    '⚠ 卡沒打出去 ⇒ 這條又變成恆真斷言：' + played.pendingSelection?.effectKey);
  const valid = played.pendingSelection?.params?.validIids ?? [];
  ok(valid.includes(legal.iid), '合法目標竟然不在可選清單（前提壞了，下面的否定斷言會變恆真）');
  ok(!valid.includes(basic.iid), '基礎寶可夢竟然可選');
  ok(!valid.includes(oppEvo.iid), '對手的寶可夢竟然可選（卡面是「自己的」）');
  if (nonPsyInst) ok(!valid.includes(nonPsyInst.iid),
    `非【超】的進化寶可夢（${nonPsychic.name}）竟然可選（卡面是「【超】寶可夢」）`);
});

T('⭐⭐⭐ C2 場上沒有可退化的目標時，奇異時鐘**打不出去**（卡必須留在手上，不得白白消耗）', () => {
  // ⚠ 這是本版最有行為風險的新行為（regG 由 devolvableLayers>=1 收緊），
  //   對抗性審查用 `regG('奇異時鐘', () => true)` 的突變證明它原本**完全沒有守衛**。
  const bare = inst(ALAKAZAM.id);                 // 卡面 Stage2，但堆疊 0 ⇒ 退化不了
  const st0 = {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0,
    turn: 5, isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
    players: [
      { name: 'A', active: bare, bench: [], hand: [inst(CLOCK.id)], deck: [inst(FILLER.id)], discard: [], prizes: [] },
      { name: 'B', active: inst(ABRA.id), bench: [], hand: [], deck: [inst(FILLER.id)], discard: [], prizes: [] },
    ],
  };
  const clockIid = st0.players[0].hand[0].iid;
  const played = M.applyAction(st0, { type: 'PLAY_TRAINER', iid: clockIid }, pool);
  ok(played.pendingSelection == null, '不該開任何 picker：' + played.pendingSelection?.effectKey);
  ok(played.players[0].hand.some((c) => c.iid === clockIid),
    '奇異時鐘被消耗掉了 —— 沒有可退化的目標時應該根本打不出去（官方判準：效果完全無法執行 ⇒ 不能使用）');
  ok(played.players[0].discard.every((c) => c.iid !== clockIid), '奇異時鐘進了棄牌區');
});

T('⭐⭐⭐ C3 送進做不到的層數（未經消毒的 modal-choice 輸入）不得讓卡白白浪費', () => {
  // ⚠ engine 的 VALID_IIDS_GATE_EXEMPT 含 'modal-choice' ⇒ payload 原封進 resolver、不做白名單交集。
  //   v6.330 把層數改成 parseInt 之後，若不夾制在實際深度內，送 '3' 到深度 2 的目標會撞
  //   「堆疊深度不足」取消 ⇒ 又多一條「白白浪費奇異時鐘」的路徑（對抗性審查抓到）。
  const deep = M.buildEvolvedInstance(
    M.buildEvolvedInstance(inst(ABRA.id), inst(KADABRA.id), STADIUMLESS, pool),
    inst(ALAKAZAM.id), STADIUMLESS, pool);
  const { picked } = playClock(deep);
  ok(picked.pendingSelection?.effectKey === 'odd-clock-step2', '前提壞了：深度 2 應該要問層數');
  // ⚠ 範圍：只驗「**超出實際深度的層數**」被夾制 —— 那才是 v6.330 改的東西。
  // ⭐⭐⭐ v6.331 更新：現在有**兩層**防護，任何一層擋住都算「卡沒有白白浪費」——
  //   第一層（v6.331，engine）：modal-choice 的 payload 對不上 params.options 就原地退回、**pending 留著**
  //     ⇒ 玩家可以重選一次，卡片的效果還沒有被結算掉。
  //   第二層（v6.330，resolver）：層數夾制在實際深度內 ⇒ 就算輸入穿過第一層也不會撞「堆疊深度不足」。
  //   ⚠ 這裡刻意**兩層各自驗**：只驗第一層的話，把 v6.330 的夾制拿掉不會翻紅（守衛會退化成安慰劑）。
  for (const bogus of ['3', '9', '999', 'abc']) {
    const done = M.applyAction(picked, { type: 'RESOLVE_SELECTION', selectedIids: [bogus] }, pool);
    const logTxt = (done.log ?? []).map((l) => l?.message ?? l).join('\n');
    ok(!/堆疊深度不足/.test(logTxt),
      `送 choice='${bogus}' 竟然撞「堆疊深度不足」而取消（卡白白浪費）：` + logTxt.slice(-120));
    const kept = done.pendingSelection?.effectKey === 'odd-clock-step2';
    const devolved = nameOf(done.players[0].active) !== '胡地';
    ok(kept || devolved,
      `送 choice='${bogus}' 之後 pending 被關掉、場上還是胡地 ⇒ 什麼都沒發生、卡卻用掉了`);
  }
  // ⭐ 第二層單獨驗：直接呼叫 resolver（繞過 v6.331 的 engine 閘），確認 v6.330 的夾制本身還在。
  const r = M.RESOLVERS.get('odd-clock-step2');
  ok(typeof r === 'function', 'odd-clock-step2 resolver 不見了');
  const bare = { ...picked, pendingSelection: undefined };
  const prm = picked.pendingSelection.params;
  for (const bogus of ['3', '9', '999']) {
    const toMax = r(bare, 0, [bogus], prm, pool);
    ok(nameOf(toMax.players[0].active) === '凱西',
      `resolver 直呼 choice='${bogus}'：超出深度的層數應夾制成「退到底」，實得 ` + nameOf(toMax.players[0].active));
    ok(!/堆疊深度不足/.test((toMax.log ?? []).map((l) => l?.message ?? l).join('\n')),
      `resolver 直呼 choice='${bogus}' 仍撞「堆疊深度不足」`);
  }
  ok(nameOf(r(bare, 0, ['abc'], prm, pool).players[0].active) === '勇基拉',
    "resolver 直呼 choice='abc'：解析不出數字 ⇒ 退 1 層＝勇基拉");
});

console.log('D. 結構：層數不得再由卡面 stage 推論，選項不得寫死做不到的數字');

// ⚠⚠ 否定型守衛一定要先**剝掉註解**再掃 —— 註解裡引用違規字面量會讓它誤報（v6.126 教訓；
//   本檔第一版就自己踩到：我在新註解裡寫了「不再寫死『→ 1 階進化』」，D1 立刻假紅）。
//   一律走中央 `scripts/lib/strip-comments.mjs`，不要自己再寫一份剝除器（v6.310~v6.320 七版的教訓）。
const { stripCommentsBlankChecked } = await import(pathToFileURL(join(ROOT, 'scripts/lib/strip-comments.mjs')).href);
/** 寫死層數標籤的判準（正式斷言與反安慰劑自檢**共用同一份**） */
const HARDCODED_LAYER_LABEL = /退化 2 層（→ 基礎）|→ 1 階進化/;

T('⭐⭐⭐ D1 odd-clock 的選項必須由實際堆疊產生（不得再出現寫死的層數字面選項）', () => {
  const raw = readFileSync(join(ROOT, 'src/lib/game/effects/cards/items_misc.ts'), 'utf8');
  const src = stripCommentsBlankChecked(raw, { mustKeep: ["effectKey: 'odd-clock-step1'"] });
  const i = src.indexOf("effectKey: 'odd-clock-step1'");
  ok(i > 0, '找不到 odd-clock-step1（剝註解後）');
  const seg = src.slice(i, src.indexOf("regR('odd-clock-step2'", i));
  ok(seg.length > 200, '抽取視窗只有 ' + seg.length + ' 字 —— 掃描器多半壞了');
  ok(/devolvableLayers\(/.test(seg), 'odd-clock 沒有走中央 devolvableLayers');
  ok(!HARDCODED_LAYER_LABEL.test(seg),
    '仍然有寫死的層數選項標籤 —— 那正是本版修掉的 bug（糖果進化的 2 階其實只有 1 層）');
  ok(!/const stage = tCard\.subtype === 'Stage2'/.test(seg), '仍然用卡面 stage 決定層數');
});

T('⭐⭐ D2 devolvableLayers 是唯一來源：呼叫端不得自己再數一次 stack 長度來決定層數', () => {
  const shared = readFileSync(join(ROOT, 'src/lib/game/effects/_shared.ts'), 'utf8');
  ok(/export function devolvableLayers\(/.test(shared), 'devolvableLayers 不在 _shared.ts');
  const raw = readFileSync(join(ROOT, 'src/lib/game/effects/cards/items_misc.ts'), 'utf8');
  const im = stripCommentsBlankChecked(raw, { mustKeep: ["regR('odd-clock-step1'"] });
  const i = im.indexOf("regR('odd-clock-step1'");
  const seg = im.slice(i, im.indexOf('function doOddClockDevolve', i));
  ok(!/\.evolvedFromStack\s*\?\?\s*\[\]\s*\)\.length/.test(seg),
    'odd-clock-step1 自己又數了一次 stack 長度 —— 應該走 devolvableLayers');
});

T('⭐⭐ D3 反安慰劑：D1 的判準（同一個正則）對違規樣本會抓、對合規樣本不誤報', () => {
  const bad = "options: [{ id: '1', text: '①退化 1 層（→ 1 階進化）' }, { id: '2', text: '②退化 2 層（→ 基礎）' }]";
  ok(HARDCODED_LAYER_LABEL.test(bad), 'D1 的判準抓不到違規樣本 —— 它是安慰劑');
  ok(!HARDCODED_LAYER_LABEL.test('options: _opts'), 'D1 的判準對合規樣本誤報');
});

T('⭐⭐ D5 step2 的層數必須由選項 id **一般化解析**（不得寫死 1/2）', () => {
  // ⚠ 誠實說明：真實 PTCG 最深只有 基礎→1階→2階＝深度 2，所以「寫死 '2' ? 2 : 1」在現行卡池
  //   **行為上等價** —— 突變它不會紅。這條改用**合成的 3 層堆疊**直接走過解析路徑，
  //   讓「寫死」與「一般化解析」在行為上真的分得出來（否則這條就是安慰劑）。
  const layer = (cid) => ({ iid: `L${cid}_${Math.random().toString(36).slice(2, 6)}`, cardId: String(cid),
    damage: 0, energyAttached: [] });
  const deep = {
    ...inst(ALAKAZAM.id),
    evolvedFromStack: [layer(ABRA.id), layer(KADABRA.id), layer(ABRA.id)],
  };
  ok(M.devolvableLayers(deep) === 3, '前提壞了：合成堆疊深度應為 3');
  const { picked } = playClock(deep);
  const opts = (picked?.pendingSelection?.params?.options ?? []);
  ok(opts.length === 3, '深度 3 應該給 3 個選項，實得 ' + opts.length + '：'
    + JSON.stringify(opts.map((o) => o.text)));
  const done = M.applyAction(picked, { type: 'RESOLVE_SELECTION', selectedIids: ['3'] }, pool);
  ok(nameOf(done.players[0].active) === '凱西',
    '選「3」應退 3 層到堆疊最底那張（凱西），實得 ' + nameOf(done.players[0].active)
    + ' ⇒ step2 把層數寫死成 1/2 了');
  ok(done.players[0].hand.length === 3,
    '退 3 層應該有 3 張卡回到手牌，實得 ' + done.players[0].hand.length);
});

T('⭐⭐ D4 剝註解真的有作用：註解裡引用違規字面量不得讓 D1 假紅', () => {
  const withComment = "// 不再寫死「→ 1 階進化」\nconst _opts = [];\n";
  const stripped = stripCommentsBlankChecked(withComment, {});
  ok(HARDCODED_LAYER_LABEL.test(withComment), '前提壞了：樣本裡本來就沒有違規字面量');
  ok(!HARDCODED_LAYER_LABEL.test(stripped),
    '剝註解沒有生效 —— 否定型守衛會被自己的註解誤報（v6.126／本檔第一版都踩過）');
});

console.log(`\n${fail === 0 ? '✅' : '❌'} v6.330 奇異時鐘退化層數：${pass} PASS, ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
