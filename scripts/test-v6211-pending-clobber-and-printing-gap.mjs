// ⭐⭐⭐ v6.211 假 log 族：「hook 內直接覆寫 state.pendingSelection」會把別人已開好的 picker 蓋掉
//
// 玩家回報（2026-08）：
//   「使用招式【青草命令】不會被寶可夢道具【手持循環扇】觸發丟能量的 picker
//     （對戰 log 會顯示，但實際上沒有產生效果）。」
//
// 卡面（static/cards 台灣官方，逐字）：
//   君主蛇ex｜青草命令 attacks[0].effect
//     「若希望，從自己的牌庫任意選擇最多3張卡加入手牌。並且重洗牌庫。」cost=[Grass,C,C,C] dmg=150
//     （SV11B 12945/13764/13772、MC 16513，I 標）
//   手持循環扇 rulesText（Trainer / PokemonTool，SV6 10509，H 標）
//     「附有這張卡的寶可夢在戰鬥場受到對手的寶可夢招式的傷害時，選擇1個使用招式的寶可夢
//       身上附加的能量，改附於對手的備戰寶可夢身上。」
//
// 真因：ATTACK 流程中，防守方道具的 TOOL_ON_DAMAGED 在**傷害結算當下**就已經
//   `withPending(...)` 開好自己的 picker；ATTACK_POST 比它晚跑，而
//   `v2590_i_wave9_misc3.ts`（青草命令）與 `v2490_i_wave3a_conditional.ts`
//   （snipeOneBenchPost，5 張狙擊招式共用）是寫 `return { ...s, pendingSelection: {…} }`
//   ——**直接覆寫**，繞過 `withPending` 的 `pendingChainQueue` 排隊機制。
//   結果：道具的 log 已經印出去了，picker 卻消失、效果從未發生＝**假 log**。
//
// ⭐⭐ v6.215 更新：官方處理順序是「招式效果 → 受到傷害時的道具效果」
//   （PTCG RULES §17.22.A L1530-1531 幸運頭盔 vs 脅迫獠牙）。engine 已把
//   幸運頭盔／逆境保險／手持循環扇 延後到 ATTACK_POST 之後才觸發，
//   於是 A 段的**排隊順序反過來**了：現在 pendingSelection = 招式自己的 picker、
//   手持循環扇排在 pendingChainQueue。
//   ⚠ 本守衛要防的東西沒變：**兩個 picker 都必須存在，且兩邊的效果都要真的發生**
//   （v6.211 的 bug 是「道具 log 印了、picker 卻被蓋掉」＝假 log）。
//
// 三段：
//   A) 行為端重現＋修復驗證（完整 ATTACK → RESOLVE_SELECTION 鏈，斷言到「盤面真的變了」，
//      不是只斷言「有呼叫某函式」）。HEAD 時 A 段全紅。
//   B) 正對照：沒有防守方道具時，這些招式原本的 picker 行為完全不變（防止修出迴歸）。
//   C) 靜態接線守衛：`src/lib/game/effects/**` 內禁止 `pendingSelection:` 物件字面量
//      （唯一白名單 = `_shared.ts` addPendingPrize，且它必須保留 `!state.pendingSelection` 前置閘）。
//      含**正對照**（餵違規樣本必須被抓到）＋**下限斷言**（掃描器自己壞掉時要紅）。
//   D) 卡庫：同一張卡的不同印刷，招式／特性不得少收（v6.211 SV-P-H 10100~10103 那一批）。
//      含正對照與下限斷言。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripCommentsBlankChecked, stripCommentsBlank } from './lib/strip-comments.mjs';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E = join(ROOT, '.pc-e.ts'), O = join(ROOT, '.pc-o.mjs'), S = join(ROOT, '.pc-s.mjs');
process.on('exit', () => { for (const p of [E, O, S]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, `export { applyAction, getEffectiveAttacks, getAvailableAttacks } from './src/lib/game/engine';\n`
  + `import './src/lib/game/effects';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { applyAction, getEffectiveAttacks, getAvailableAttacks } = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const POOL = new Map();
const ALLCARDS = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    if (c?.id != null) { POOL.set(String(c.id), c); ALLCARDS.push(c); }
  }
}
let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; }
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }
function card(name, pred) {
  for (const c of POOL.values()) if (c.name === name && (!pred || pred(c))) return c;
  throw new Error('找不到卡：' + name);
}
let _n = 0;
const inst = (c, extra = {}) => ({ iid: 'i' + (++_n), cardId: String(c.id), damage: 0, energyAttached: [], ...extra });
function mkState(p0, p1) {
  const mk = (name, o) => ({ name, hand: [], deck: [], active: null, bench: [], discard: [], prizes: [],
    energyAttachedThisTurn: false, supporterPlayedThisTurn: false, retreatedThisTurn: false, ...o });
  return { phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
    isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
    players: [mk('P1', p0), mk('P2', p1)] };
}
const FAN = card('手持循環扇');
const EG = card('基本【草】能量');
const WALL = card('超級拉帝亞斯ex');                   // hp280、無弱點 → 不會被一擊 KO（KO 走另一條分支）
const OPPBENCH = card('伊布', c => c.id === '17035');
const MYBENCH = card('木棉球', c => c.id === '16514');
const logsOf = (s) => s.log.map(l => l.message || '');
const qOf = (s) => (s.pendingChainQueue ?? []).map(q => q.effectKey);

console.log('A) 行為端：防守方道具已開 picker 時，攻方 ATTACK_POST 不得把它蓋掉（HEAD 全紅）');

function buildFanBoard(attackerCard, energyCount) {
  const a = inst(attackerCard);
  a.energyAttached = Array.from({ length: energyCount }, () => inst(EG));
  const d = inst(WALL); d.toolAttached = inst(FAN);
  const myBench = inst(MYBENCH), oppBench = inst(OPPBENCH);
  const st = mkState(
    { active: a, bench: [myBench], deck: [inst(EG), inst(EG), inst(EG), inst(EG)], prizes: [inst(EG), inst(EG)] },
    { active: d, bench: [oppBench], deck: [inst(EG)], prizes: [inst(EG), inst(EG)] });
  return { st, myBench, oppBench, attackerInst: a };
}

T('⭐⭐⭐ 君主蛇ex｜青草命令：手持循環扇的 picker 必須還在（不是只有 log）', () => {
  const serp = card('君主蛇ex', c => c.id === '12945');
  const ai = serp.attacks.findIndex(x => x.name === '青草命令');
  ok(ai >= 0, '卡面沒有「青草命令」——卡片資料變了？');
  const { st } = buildFanBoard(serp, 4);
  const s = applyAction(st, { type: 'ATTACK', attackIndex: ai, actorIdx: 0 }, POOL);
  ok(logsOf(s).some(m => m.includes('手持循環扇')), '手持循環扇連 log 都沒出現 —— 盤面沒佈對');
  // v6.215 官方序：招式效果（青草命令）先、道具（手持循環扇）後。
  ok(s.pendingSelection?.effectKey === 'wave9-take-any-from-deck',
    'pendingSelection 應該是招式自己的 picker（官方序先跑），現在是 ' + s.pendingSelection?.effectKey);
  ok(qOf(s).includes('cycle-fan-step1-pick-energy'),
    '手持循環扇的 picker 沒有排進 pendingChainQueue（＝被蓋掉，只剩假 log）：' + JSON.stringify(qOf(s)));
});

T('⭐⭐⭐ 青草命令：兩個 picker 全解完後，**盤面真的變了**（能量移動 ＋ 手牌加卡）', () => {
  const serp = card('君主蛇ex', c => c.id === '12945');
  const ai = serp.attacks.findIndex(x => x.name === '青草命令');
  const { st, myBench } = buildFanBoard(serp, 4);
  let s = applyAction(st, { type: 'ATTACK', attackIndex: ai, actorIdx: 0 }, POOL);
  // v6.215 官方序：先解招式自己的 picker（青草命令加手牌），再解道具的。
  ok(s.pendingSelection?.effectKey === 'wave9-take-any-from-deck',
    '第一個 picker 應是青草命令：' + s.pendingSelection?.effectKey);
  const before = s.players[0].hand.length;
  const pick = s.players[0].deck.slice(0, 2).map(c => c.iid);
  s = applyAction(s, { type: 'RESOLVE_SELECTION', selectedIids: pick, actorIdx: 0 }, POOL);
  ok(s.players[0].hand.length === before + 2,
    '青草命令加手牌沒發生：' + before + ' → ' + s.players[0].hand.length);
  ok(s.pendingSelection?.effectKey === 'cycle-fan-step1-pick-energy',
    '排隊中的手持循環扇 picker 沒有接上來：' + s.pendingSelection?.effectKey);
  // v6.215：option id 改用「能量 iid」（原本是陣列索引，招式自丟能量時會位移）。
  const fanOpt = s.pendingSelection.params.options[0].id;
  ok(s.players[0].active.energyAttached.some(e => e.iid === fanOpt),
    '手持循環扇的候選 id 不是攻擊方身上的能量 iid：' + fanOpt);
  s = applyAction(s, { type: 'RESOLVE_SELECTION', selectedIids: [fanOpt], actorIdx: 1 }, POOL);
  ok(s.pendingSelection?.effectKey === 'cycle-fan-step2-place-energy',
    '手持循環扇第 2 段沒開：' + s.pendingSelection?.effectKey);
  s = applyAction(s, { type: 'RESOLVE_SELECTION', selectedIids: [myBench.iid], actorIdx: 1 }, POOL);
  ok(s.players[0].active.energyAttached.length === 3,
    '攻擊方戰鬥位能量沒被拿走（' + s.players[0].active.energyAttached.length + '，期望 3）');
  ok(s.players[0].bench[0].energyAttached.length === 1,
    '能量沒改附到攻擊方備戰（' + s.players[0].bench[0].energyAttached.length + '，期望 1）＝效果沒發生');
  ok(!s.pendingSelection, '流程結束後還留著 pending：' + s.pendingSelection?.effectKey);
});

T('⭐⭐ 赫普的蒼響ex｜剎那斬（snipeOneBenchPost 共用 factory）：同一族不得蓋掉道具 picker', () => {
  const zac = card('赫普的蒼響ex');
  const ai = zac.attacks.findIndex(x => x.name === '剎那斬');
  ok(ai >= 0, '卡面沒有「剎那斬」');
  const { st } = buildFanBoard(zac, zac.attacks[ai].cost.length);
  const s = applyAction(st, { type: 'ATTACK', attackIndex: ai, actorIdx: 0 }, POOL);
  ok(logsOf(s).some(m => m.includes('手持循環扇')), '手持循環扇沒觸發 —— 盤面沒佈對');
  // v6.215 官方序：招式效果（剎那斬狙擊）先、道具後。
  ok(s.pendingSelection?.effectKey === 'wave3a-snipe-bench',
    'pendingSelection 應是剎那斬的狙擊 picker：' + s.pendingSelection?.effectKey);
  ok(qOf(s).includes('cycle-fan-step1-pick-energy'),
    '手持循環扇的 picker 被剎那斬蓋掉了（只剩假 log）：' + JSON.stringify(qOf(s)));
});

console.log('B) 正對照：沒有防守方道具時，原本的行為完全不變');

function buildPlainBoard(attackerCard, energyCount) {
  const a = inst(attackerCard);
  a.energyAttached = Array.from({ length: energyCount }, () => inst(EG));
  const myBench = inst(MYBENCH), oppBench = inst(OPPBENCH);
  return { st: mkState(
    { active: a, bench: [myBench], deck: [inst(EG), inst(EG), inst(EG), inst(EG)], prizes: [inst(EG), inst(EG)] },
    { active: inst(WALL), bench: [oppBench], deck: [inst(EG)], prizes: [inst(EG), inst(EG)] }), myBench, oppBench };
}

T('青草命令（無道具）：仍直接開 deck-search，minCount=1、maxCount=3，且能正常解掉', () => {
  const serp = card('君主蛇ex', c => c.id === '12945');
  const ai = serp.attacks.findIndex(x => x.name === '青草命令');
  const { st } = buildPlainBoard(serp, 4);
  let s = applyAction(st, { type: 'ATTACK', attackIndex: ai, actorIdx: 0 }, POOL);
  ok(s.pendingSelection?.effectKey === 'wave9-take-any-from-deck', '沒開 picker：' + s.pendingSelection?.effectKey);
  ok(s.pendingSelection.minCount === 1 && s.pendingSelection.maxCount === 3,
    'min/max 變了（v6.126 官方裁定必選 ≥1）：' + s.pendingSelection.minCount + '/' + s.pendingSelection.maxCount);
  ok(qOf(s).length === 0, '不該有 queue：' + JSON.stringify(qOf(s)));
  const before = s.players[0].hand.length;
  s = applyAction(s, { type: 'RESOLVE_SELECTION', selectedIids: [s.players[0].deck[0].iid], actorIdx: 0 }, POOL);
  ok(s.players[0].hand.length === before + 1, '加手牌失效：' + before + ' → ' + s.players[0].hand.length);
});

T('剎那斬（無道具）：仍直接開 opp-bench-choose，且解完備戰真的受傷 30', () => {
  const zac = card('赫普的蒼響ex');
  const ai = zac.attacks.findIndex(x => x.name === '剎那斬');
  const { st, oppBench } = buildPlainBoard(zac, zac.attacks[ai].cost.length);
  let s = applyAction(st, { type: 'ATTACK', attackIndex: ai, actorIdx: 0 }, POOL);
  ok(s.pendingSelection?.effectKey === 'wave3a-snipe-bench', '沒開 picker：' + s.pendingSelection?.effectKey);
  ok(qOf(s).length === 0, '不該有 queue：' + JSON.stringify(qOf(s)));
  s = applyAction(s, { type: 'RESOLVE_SELECTION', selectedIids: [oppBench.iid], actorIdx: 0 }, POOL);
  const b = s.players[1].bench.find(x => x.iid === oppBench.iid);
  ok(b && b.damage === 30, '狙擊傷害沒進去：' + (b && b.damage));
});

console.log('C) 靜態接線：effects/** 禁寫 pendingSelection 物件字面量');

// ⭐v6.325 批2：區塊註解剝除改走中央 helper（scripts/lib/strip-comments.mjs 的行級狀態機）。
//   ⚠ 原本的 `/\/\*[\s\S]*?\*\//g` 會被**行註解裡的** `cards/*.ts` 這種字樣騙開假區塊：
//     effects.ts 有兩處（:27 的 `effects/cards/*.ts` 吃到 :147、:7905 的 `cards/*.ts` 吃到 :8203），
//     合計把 273 行真程式碼變成空白 ⇒ 掃在那段裡的違規一律靜默漏掉。
//   ⚠ 一律用**等長留白**版（不是刪行版）：本檔靠行號／位移回報，刪行會讓行號整體位移。
//   ⚠ 行尾 `//` 的處理**保留在這裡** —— 中央 helper 只剝行首 `//`，正向斷言目標若落在
//     行尾註解裡會假綠。行尾正則是單行、不跨行 ⇒ 不會像區塊正則那樣開洞。
function stripComments(src, label = '') {
  return stripCommentsBlankChecked(src, { label })
    .replace(/\/\/.*$/gm, '')
    .replace(/[\u200b-\u200d\ufeff]/g, '');
}
/** 回傳 [{file,line,text}]；白名單前先全抓，讓「白名單失效」也看得見。 */
function scanDirectWrites(files) {
  const hits = [];
  for (const { rel, src } of files) {
    const raw = src.split('\n');
    stripComments(src, rel).split('\n').forEach((l, i) => {
      if (/pendingSelection\s*:\s*\{/.test(l)) hits.push({ file: rel, line: i + 1, text: raw[i].trim() });
    });
  }
  return hits;
}
const EFFECT_FILES = [];
(function walk(d, prefix) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p, prefix + f + '/');
    else if (f.endsWith('.ts')) EFFECT_FILES.push({ rel: prefix + f, src: readFileSync(p, 'utf8') });
  }
})(join(ROOT, 'src/lib/game/effects'), 'effects/');
EFFECT_FILES.push({ rel: 'effects.ts', src: readFileSync(join(ROOT, 'src/lib/game/effects.ts'), 'utf8') });

T('⭐ 掃描器自我驗證：檔案數與體積達下限（掃不到東西時不准綠燈）', () => {
  // ⭐v6.325：40 → 97（實測 98）、1_500_000 → 2_500_000（實測 2,548,259）。
  ok(EFFECT_FILES.length >= 97, '只掃到 ' + EFFECT_FILES.length + ' 個 .ts —— 掃描器路徑壞了？');
  const bytes = EFFECT_FILES.reduce((a, x) => a + x.src.length, 0);
  ok(bytes > 2_500_000, '只掃到 ' + bytes + ' bytes —— 大檔被截斷或讀錯目錄');
  ok(EFFECT_FILES.some(x => x.rel === 'effects.ts'), '主檔 effects.ts 沒掃到');
  ok(EFFECT_FILES.some(x => x.rel === 'effects/_shared.ts'), '_shared.ts 沒掃到');
});

T('⭐ 判準正對照：餵一個違規樣本必須被抓到（否則這條是安慰劑）', () => {
  const bad = scanDirectWrites([{ rel: 'X.ts', src: 'return { ...s,\n  pendingSelection: {\n type: "deck-search" } };' }]);
  ok(bad.length === 1 && bad[0].line === 2, '偵測器抓不到違規樣本：' + JSON.stringify(bad));
  const good = scanDirectWrites([{ rel: 'Y.ts', src: '// pendingSelection: { 註解不算\nreturn withPending(s, { type: "x" });' }]);
  ok(good.length === 0, '偵測器把註解／withPending 誤判成違規：' + JSON.stringify(good));
});

T('⭐⭐⭐ effects/** 內只剩唯一白名單（addPendingPrize），其餘一律 withPending', () => {
  const hits = scanDirectWrites(EFFECT_FILES);
  const allowed = hits.filter(h => h.file === 'effects/_shared.ts');
  const bad = hits.filter(h => h.file !== 'effects/_shared.ts');
  ok(bad.length === 0,
    bad.length + ' 處直接覆寫 pendingSelection（會蓋掉別人已開好的 picker ＝ 假 log）：\n      '
    + bad.map(h => h.file + ':' + h.line + '  ' + h.text).join('\n      ')
    + '\n      → 改成 withPending(state, {...})');
  ok(allowed.length === 1, '_shared.ts 的白名單數量變了（' + allowed.length + '）—— 請重新檢視');
});

T('⭐ 白名單本身要有前置閘：addPendingPrize 必須先確認沒有既存 pending', () => {
  const src = stripComments(readFileSync(join(ROOT, 'src/lib/game/effects/_shared.ts'), 'utf8'), 'effects/_shared.ts');
  const i = src.indexOf('export function addPendingPrize');
  ok(i > 0, '找不到 addPendingPrize —— anchor 失效');
  const j = src.indexOf('pendingSelection: {', i);
  ok(j > i, 'addPendingPrize 內找不到那個字面量 —— anchor 失效或已被改寫');
  const win = src.slice(i, j);
  ok(win.length < 4000, 'anchor 之間距離 ' + win.length + ' 太遠，窗口可能失效');
  ok(/!\s*state\.pendingSelection/.test(win),
    'addPendingPrize 失去了 `!state.pendingSelection` 前置閘 —— 它會開始蓋掉別人的 picker');
});

T('⭐⭐ engine.ts 的直接覆寫處數量凍結（新增第 19 處要回來說明為何安全）', () => {
  const src = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8');
  const hits = scanDirectWrites([{ rel: 'engine.ts', src }]);
  ok(src.length > 460_000, 'engine.ts 只讀到 ' + src.length + ' 字元（BASE 為 478844）—— mount 讀取被截斷了');
  ok(hits.length === 18,
    'engine.ts 直接覆寫 pendingSelection 的處數從 18 變成 ' + hits.length + '：\n      '
    + hits.map(h => h.line + '  ' + h.text).join('\n      ')
    + '\n      → 現有 18 處之所以安全，靠的是 handlePlaying 的「已有 pending 就只收 RESOLVE_SELECTION」'
    + '全域閘（＋ enforceBenchLimit 自帶閘）。新增的那一處請確認同樣在閘後，或改走 withPending。');
});

T('⭐⭐⭐ engine 全域閘還在：有 pending 時只收 RESOLVE_SELECTION（上面那條的地基）', () => {
  const src = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8');
  const stripped = stripComments(src, 'engine.ts');
  const i = stripped.indexOf('function handlePlaying');
  ok(i > 0, '找不到 handlePlaying —— anchor 失效');
  const win = stripped.slice(i, i + 3000);
  ok(/if\s*\(\s*state\.pendingSelection\s*&&\s*action\.type\s*!==\s*'RESOLVE_SELECTION'\s*\)\s*return state;/.test(win),
    'handlePlaying 開頭的全域閘不見了 —— engine 那 18 處直接覆寫立刻全部變成地雷');
  const j = stripped.indexOf('function enforceBenchLimit');
  ok(j > 0, '找不到 enforceBenchLimit');
  ok(/if\s*\(state\.pendingSelection\)\s*return state;/.test(stripped.slice(j, j + 800)),
    'enforceBenchLimit 失去自帶的 pending 前置閘（它在 applyAction 末尾跑，不受 handlePlaying 閘保護）');
});

T('⭐ 上兩條的正對照：把閘拿掉的合成原始碼必須被判成紅', () => {
  const fake = 'function handlePlaying(state, action, pool) {\n  const aIdx = 0;\n  return state;\n}';
  // ⚠ 合成樣本用**無護欄**的純函式版：護欄①（留存率）是「整份吐空」偵測器，
  //   對 3 行的合成片段本來就沒有意義（片段可能 100% 是註解）。真檔一律走 checked 版。
  const stripped = stripCommentsBlank(fake).replace(/\/\/.*$/gm, '');
  const i = stripped.indexOf('function handlePlaying');
  const win = stripped.slice(i, i + 3000);
  ok(!/if\s*\(\s*state\.pendingSelection\s*&&/.test(win), '判準連「沒有閘」都判成有 —— 這條是安慰劑');
});

console.log('D) 卡庫：同一張卡的不同印刷不得少收招式／特性');

/** 同名＋同HP＋同stage＋同繪師＋同屬性＋同弱點＋同撤退費＋同標記 ⇒ 視為同一張卡的不同印刷。 */
function printingKey(c) {
  return JSON.stringify([c.name, c.hp, c.stage, c.illustrator, c.pokemonType,
    c.weakness ?? null, c.retreatCost ?? [], c.regulationMark]);
}
function findPrintingGaps(cards) {
  const g = new Map();
  for (const c of cards) {
    if (c.supertype !== 'Pokemon') continue;
    const k = printingKey(c);
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(c);
  }
  const out = [];
  let groups = 0;
  for (const v of g.values()) {
    if (v.length < 2) continue;
    groups++;
    const rich = v.reduce((a, b) =>
      (b.attacks ?? []).length + (b.abilities ?? []).length > (a.attacks ?? []).length + (a.abilities ?? []).length ? b : a);
    for (const c of v) {
      if ((c.attacks ?? []).length < (rich.attacks ?? []).length
        || (c.abilities ?? []).length < (rich.abilities ?? []).length) {
        out.push({ c, rich });
      }
    }
  }
  return { out, groups };
}

T('⭐ 掃描器自我驗證：重印分組數達下限＋正對照抓得到人工少收的樣本', () => {
  const { groups } = findPrintingGaps(ALLCARDS);
  ok(ALLCARDS.length > 3000, '卡池只有 ' + ALLCARDS.length + ' 張 —— 讀取壞了');
  ok(groups > 300, '只分出 ' + groups + ' 組重印 —— 分組判準壞了');
  const probe = card('猛雷鼓ex', c => c.id === '10103');
  const broken = JSON.parse(JSON.stringify(probe)); broken.attacks = [];
  const { out } = findPrintingGaps(ALLCARDS.map(c => (c.id === probe.id ? broken : c)));
  ok(out.some(x => String(x.c.id) === '10103'), '人工弄壞一張卡，判準卻沒抓到 —— 這條是安慰劑');
});

T('⭐⭐⭐ 沒有任何印刷少收招式／特性（v6.211 SV-P-H 10100~10103 那批）', () => {
  const { out } = findPrintingGaps(ALLCARDS);
  ok(out.length === 0,
    out.length + ' 張印刷比同卡其他印刷少收招式/特性（scraper 漏抓 → 玩家「只能用第一招」）：\n      '
    + out.map(x => `${x.c.setCode}#${x.c.id} ${x.c.name} atk=[${(x.c.attacks ?? []).map(a => a.name)}]`
      + ` abil=[${(x.c.abilities ?? []).map(a => a.name)}]`
      + `  ← 對照 ${x.rich.setCode}#${x.rich.id} atk=[${(x.rich.attacks ?? []).map(a => a.name)}]`
      + ` abil=[${(x.rich.abilities ?? []).map(a => a.name)}]`).join('\n      '));
});

T('⭐⭐ 猛雷鼓ex（SV-P-H 10103）：【極降駕】必須可用且實跑 140 傷害', () => {
  const c = card('猛雷鼓ex', x => x.id === '10103');
  const atk = c.attacks.find(a => a.name === '極降駕');
  ok(atk, 'SV-P-H#10103 仍缺【極降駕】');
  ok(JSON.stringify(atk.cost) === JSON.stringify(['Lightning', 'Fighting']),
    '【極降駕】cost 不是【雷】【鬥】：' + JSON.stringify(atk.cost));
  const eL = card('基本【雷】能量'), eF = card('基本【鬥】能量');
  const a = inst(c); const e1 = inst(eL), e2 = inst(eF); a.energyAttached = [e1, e2];
  const st = mkState({ active: a, bench: [], deck: [inst(eL)], prizes: [inst(eL), inst(eL)] },
    { active: inst(WALL), bench: [], deck: [inst(eL)], prizes: [inst(eL), inst(eL)] });
  const ai = getEffectiveAttacks(st, a, POOL).findIndex(x => x.atk.name === '極降駕');
  ok(ai === 1, '極降駕不在 index 1：' + ai);
  ok(getAvailableAttacks(st, POOL).includes(ai), '引擎判定【極降駕】不可用（雷+鬥在身上）');
  const s = applyAction(st, { type: 'ATTACK', attackIndex: ai, actorIdx: 0, discardedEnergyIids: [e1.iid, e2.iid] }, POOL);
  ok(s.players[1].active.damage === 140, '丟 2 個基本能量應為 140，實得 ' + s.players[1].active.damage);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
