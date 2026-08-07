// v6.124 守衛：「（翻回反面並重洗，）放回牌庫下方」的**重洗範圍**不得擴及整副牌庫。
//
// 卡面重洗的主詞是「那些卡」（剛查看過的 N 張／剛收回的手牌／獎賞），
// 所以只有那幾張要被打亂，**牌庫其餘部分的順序必須原封不動**。
//
// 這是一個重複發生 3 次的 bug 型：
//   ・v4.08  特殊紅牌 誤用 returnHandToDeck（hand+deck 一起洗）
//   ・v6.123 推理組合 寫成 shuffle(rest)（洗錯邊，把沒看到的部分洗掉）
//   ・v6.124 越橘的一步棋（3 處）＋悟松 寫成 shuffle([...rest, ...toBottom])（整副洗掉）
// ⇒ v6.124 收斂成單一中央管線 `deckWithCardsToBottom(rest, toBottom, mode)`，mode 必填。
//
// ⚠ 極易混淆的對照組（**不得**被本守衛誤殺）：
//   卡面寫「放回牌庫**並重洗**」（沒有「下方」）＝ 洗整副，是另一條規則。
//   例：杜若(H)、女服務生(J)、滑稽演員(I) —— 它們的 shuffle(整副) 是**正確**的。
//   兩者的差別只有「下方」兩個字，所以本守衛用**卡面文字**枚舉，不用寫法猜。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x124-s.js'), E = join(ROOT, '.x124-e.ts'), O = join(ROOT, '.x124-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* */ } } });
writeFileSync(S, 'export const base="";');
writeFileSync(E,
  "export { TRAINER_EFFECTS, RESOLVERS, ABILITY_EFFECTS, ABILITY_EFFECTS_BY_NAME, deckWithCardsToBottom }\n"
  + "  from './src/lib/game/effects/_shared';\n"
  + "export { ATTACK_POST } from './src/lib/game/effects';\n"
  + "import './src/lib/game/effects';\n");
await build({
  entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error',
});
const mod = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
const byName = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    if (c?.id == null) continue;
    pool.set(String(c.id), c);
    // ⚠ 同名卡有多張 HIJ 印刷、特性/招式可能不同（金屬怪就有帶與不帶「金屬製造者」的兩種）
    //   → 收「所有 HIJ 印刷的文字聯集」，只取第一張會漏掉。
    if (['H', 'I', 'J'].includes(c.regulationMark)) {
      const t = [c.rulesText || '', ...(c.attacks || []).map((a) => a.effect || ''),
        ...(c.abilities || []).map((a) => a.effect || '')].join('\n');
      byName.set(c.name, (byName.get(c.name) || '') + '\n' + t);
    }
  }
}

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e && e.message)); fail++; }
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }

// 牌庫填充物：用一張「不會被任何受測卡選中」的訓練家，避免 picker 誤選。
let FILLER = null;
for (const [id, c] of pool) { if (c.supertype === 'Trainer') { FILLER = id; break; } }
ok(FILLER, '找不到訓練家當填充物');
const inst = (iid, cardId = FILLER) => ({ iid, cardId, damage: 0, energyAttached: [], evolvedFromStack: [] });
const ids = (arr) => arr.map((c) => c.iid).join(',');

function mkState(deckLen = 30, handLen = 0) {
  const mk = (pfx) => ({
    name: pfx, active: inst(pfx + 'act'), bench: [], prizes: [],
    hand: Array.from({ length: handLen }, (_, i) => inst(pfx + 'h' + i)),
    deck: Array.from({ length: deckLen }, (_, i) => inst(pfx + 'd' + i)),
    discard: [],
  });
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
    isFirstTurn: false, log: [], pendingSelection: null, pendingChainQueue: [],
    setupDone: [true, true], pendingPrizes: [0, 0], players: [mk('p'), mk('q')],
  };
}

/**
 * 核心判準：牌庫「未參與」的那一段（原本第 skipTop 張之後、且沒被移走的部分）
 * 在效果結算後必須**以完全相同的順序**留在牌庫最前面。
 * @param before 效果前的 deck
 * @param after  效果後的 deck
 * @param movedTop 被拿去「放到下方」的張數（從牌庫頂算）
 */
function untouchedPrefixIntact(before, after, movedTop) {
  const expect = before.slice(movedTop).map((c) => c.iid);
  const got = after.slice(0, expect.length).map((c) => c.iid);
  return expect.join(',') === got.join(',');
}

console.log('① 中央管線本身（單元）');

T('⭐⭐⭐ deckWithCardsToBottom：\'shuffled\' 只洗 toBottom，rest 順序不動', () => {
  const f = mod.deckWithCardsToBottom;
  ok(typeof f === 'function', '找不到中央 helper deckWithCardsToBottom');
  const rest = Array.from({ length: 30 }, (_, i) => inst('r' + i));
  const bottom = Array.from({ length: 6 }, (_, i) => inst('b' + i));
  let everDiffered = false;
  for (let k = 0; k < 8; k++) {
    const out = f(rest, bottom, 'shuffled');
    ok(out.length === 36, '長度不對');
    ok(ids(out.slice(0, 30)) === ids(rest), 'rest 的順序被動到了 —— 這正是本守衛要擋的 bug');
    ok(new Set(out.slice(30).map((c) => c.iid)).size === 6, '底部 6 張內容不對');
    if (ids(out.slice(30)) !== ids(bottom)) everDiffered = true;
  }
  ok(everDiffered, '\'shuffled\' 跑 8 次都沒洗到 —— 根本沒重洗');
});

T('deckWithCardsToBottom：\'keep-order\' 完全不洗', () => {
  const rest = Array.from({ length: 5 }, (_, i) => inst('r' + i));
  const bottom = Array.from({ length: 4 }, (_, i) => inst('b' + i));
  for (let k = 0; k < 5; k++) {
    ok(ids(mod.deckWithCardsToBottom(rest, bottom, 'keep-order')) === ids([...rest, ...bottom]),
      '\'keep-order\' 竟然改了順序');
  }
});

T('⭐ 正對照：舊寫法 shuffle([...rest, ...toBottom]) 必須被同一判準抓到', () => {
  const before = Array.from({ length: 30 }, (_, i) => inst('d' + i));
  const bad = (deck, n) => {
    const rest = deck.slice(n), top = deck.slice(0, n);
    const all = [...rest, ...top];
    for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
    return all;
  };
  let caught = 0;
  for (let k = 0; k < 8; k++) if (!untouchedPrefixIntact(before, bad(before, 4), 4)) caught++;
  ok(caught === 8, '正對照失效 —— untouchedPrefixIntact 抓不到「洗整副」（' + caught + '/8）');
});

console.log('② 行為端：逐卡驗「牌庫其餘部分順序不動」');

// ── 越橘的一步棋（I）——「將剩餘卡全部翻回反面並重洗，放回牌庫下方」──────────
T('⭐⭐⭐ 越橘的一步棋：未選擇時，牌庫第 8 張之後的順序不得被動到', () => {
  const fn = mod.TRAINER_EFFECTS.get('越橘的一步棋');
  ok(fn, '找不到越橘的一步棋');
  for (let k = 0; k < 5; k++) {
    const s0 = mkState(30);
    const before = s0.players[0].deck;
    const s1 = fn(s0, 0, pool);
    ok(s1.pendingSelection?.effectKey === 'lingonberry-pick', '沒開 lingonberry-pick picker');
    const r = mod.RESOLVERS.get('lingonberry-pick');
    const s2 = r(s1, 0, [], s1.pendingSelection.params, pool);
    ok(untouchedPrefixIntact(before, s2.players[0].deck, 7),
      '牌庫第 8 張以後被重洗了 —— 卡面只說「將**剩餘卡**重洗放回下方」');
  }
});

T('⭐⭐ 越橘的一步棋：成功放備戰時同樣不得洗到牌庫其餘部分', () => {
  // 找一張 live 的【惡】基礎寶可夢當標的
  let dark = null;
  for (const [, c] of pool) {
    if (c.supertype === 'Pokemon' && c.pokemonType === 'Darkness' && (c.stage === 'Basic' || c.subtype === 'Basic')) { dark = c; break; }
  }
  ok(dark, '卡池裡找不到【惡】基礎寶可夢');
  for (let k = 0; k < 5; k++) {
    const s0 = mkState(30);
    s0.players[0].deck[3] = inst('DARK', String(dark.id));
    const before = s0.players[0].deck;
    const s1 = mod.TRAINER_EFFECTS.get('越橘的一步棋')(s0, 0, pool);
    const s2 = mod.RESOLVERS.get('lingonberry-pick')(s1, 0, ['DARK'], s1.pendingSelection.params, pool);
    ok(s2.players[0].bench.some((b) => b.iid === 'DARK'), '沒放到備戰區');
    ok(untouchedPrefixIntact(before, s2.players[0].deck, 7), '牌庫第 8 張以後被重洗了');
  }
});

// ── 悟松（H）——「雙方各將手牌全部翻回反面並重洗，放回牌庫下方」───────────
T('⭐⭐⭐ 悟松：手牌洗到牌庫下方，牌庫原本的順序不得被動到（雙方）', () => {
  const fn = mod.TRAINER_EFFECTS.get('悟松');
  ok(fn, '找不到悟松');
  for (let k = 0; k < 5; k++) {
    const s0 = mkState(30, 5);
    const b0 = s0.players[0].deck, b1 = s0.players[1].deck;
    const s1 = fn(s0, 0, pool);
    for (const [i, before] of [[0, b0], [1, b1]]) {
      // 悟松會接著抽 6 或 3 張，抽走的是牌庫頂 → 用「剩下的牌庫」對齊原順序的尾段
      const after = s1.players[i].deck;
      const drawn = before.length + 5 - after.length;   // 手牌 5 張進牌庫、又抽走 drawn 張
      ok(ids(after.slice(0, before.length - drawn)) === ids(before.slice(drawn)),
        'P' + (i + 1) + ' 的牌庫被整副重洗了 —— 卡面只說「將**手牌**重洗放回牌庫下方」');
    }
  }
});

// ── 推理組合（H）── v6.123 的 altAction 分支 ──────────────────────────────
T('⭐⭐ 推理組合｜重洗放回下方：只洗那 3 張', () => {
  for (let k = 0; k < 5; k++) {
    const s0 = mkState(30);
    const before = s0.players[0].deck;
    const s1 = mod.TRAINER_EFFECTS.get('推理組合')(s0, 0, pool);
    const alt = s1.pendingSelection?.params?.altAction;
    ok(alt?.id, '推理組合沒帶 altAction（v6.123 的次要動作不見了）');
    const s2 = mod.RESOLVERS.get(s1.pendingSelection.effectKey)(s1, 0, [alt.id], s1.pendingSelection.params, pool);
    ok(untouchedPrefixIntact(before, s2.players[0].deck, 3), '牌庫第 4 張以後被重洗了');
  }
});

// ── 特殊紅牌（J）/ 妨害信函（H）：把「對手手牌」洗到對手牌庫下方 ──────────
for (const [card, prizesLeft] of [['特殊紅牌', 3], ['妨害信函', 6]]) {
  T('⭐⭐ ' + card + '：對手牌庫原本的順序不得被動到', () => {
    const fn = mod.TRAINER_EFFECTS.get(card);
    ok(fn, '找不到 ' + card);
    for (let k = 0; k < 5; k++) {
      const s0 = mkState(30, 4);
      s0.players[1].prizes = Array.from({ length: prizesLeft }, (_, i) => inst('z' + i));
      const before = s0.players[1].deck;
      const s1 = fn(s0, 0, pool);
      const after = s1.players[1].deck;
      const drawn = before.length + 4 - after.length;
      ok(ids(after.slice(0, before.length - drawn)) === ids(before.slice(drawn)),
        '對手牌庫被整副重洗了');
    }
  });
}

// ── 調換票（I）：獎賞洗到自己牌庫下方 ─────────────────────────────────────
T('⭐⭐ 調換票：獎賞洗到牌庫下方，牌庫原順序不得被動到', () => {
  const fn = mod.TRAINER_EFFECTS.get('調換票');
  ok(fn, '找不到調換票');
  for (let k = 0; k < 5; k++) {
    const s0 = mkState(30);
    s0.players[0].prizes = Array.from({ length: 6 }, (_, i) => inst('z' + i));
    const before = s0.players[0].deck;
    const s1 = fn(s0, 0, pool);
    // 6 張獎賞接到牌庫底 → 再從牌庫頂抽 6 張當新獎賞
    ok(ids(s1.players[0].deck.slice(0, before.length - 6)) === ids(before.slice(6)),
      '牌庫被整副重洗了 —— 卡面只說「將**獎賞卡**重洗放回牌庫下方」');
  }
});

// ── 多龍奇｜偵查指令（H）：卡面**沒有**「重洗」→ 完全不得洗 ────────────────
T('⭐ 偵查指令：卡面沒有「重洗」字樣 → 剩餘那張原封不動接到牌庫下方', () => {
  const fn = mod.ABILITY_EFFECTS.get('多龍奇|0') ?? mod.ABILITY_EFFECTS_BY_NAME.get('多龍奇|偵查指令');
  ok(fn, '找不到多龍奇｜偵查指令');
  for (let k = 0; k < 3; k++) {
    const s0 = mkState(30);
    const before = s0.players[0].deck;
    const s1 = fn(s0, 0, pool);
    ok(s1.pendingSelection?.effectKey === 'scouting-order', '沒開 scouting-order picker');
    const s2 = mod.RESOLVERS.get('scouting-order')(s1, 0, ['pd0'], s1.pendingSelection.params, pool);
    const after = s2.players[0].deck;
    ok(ids(after) === ids([...before.slice(2), before[1]]),
      '偵查指令的剩餘卡沒有原封不動放到牌庫下方（卡面沒有「重洗」）');
  }
});


// ── Fable 5 審查補強：這幾張原本只有 VERIFIED 的人工承諾，沒有行為斷言 ──────
T('⭐⭐ 金屬怪｜金屬製造者：未選能量時，牌庫第 5 張之後的順序不得被動到', () => {
  const fn = mod.ABILITY_EFFECTS.get('金屬怪|0') ?? mod.ABILITY_EFFECTS_BY_NAME.get('金屬怪|金屬製造者');
  ok(fn, '找不到金屬怪｜金屬製造者');
  for (let k = 0; k < 5; k++) {
    const s0 = mkState(30);
    const before = s0.players[0].deck;
    const s1 = fn(s0, 0, pool);
    ok(s1.pendingSelection?.effectKey === 'metal-maker-attach', '沒開 metal-maker-attach picker');
    const s2 = mod.RESOLVERS.get('metal-maker-attach')(s1, 0, [], s1.pendingSelection.params, pool);
    ok(untouchedPrefixIntact(before, s2.players[0].deck, 4), '牌庫第 5 張以後被重洗了');
  }
});

T('⭐⭐ 超級烈空坐ex｜霸者咆哮：未附能量時，牌庫第 5 張之後的順序不得被動到', () => {
  const fn = mod.ABILITY_EFFECTS_BY_NAME.get('超級烈空坐ex|霸者咆哮');
  ok(fn, '找不到超級烈空坐ex｜霸者咆哮');
  for (let k = 0; k < 5; k++) {
    const s0 = mkState(30);
    const before = s0.players[0].deck;
    const self = s0.players[0].active;
    const s1 = fn(s0, 0, pool, self);
    ok(s1.pendingSelection?.effectKey === 'm6-overlord-roar', '沒開 m6-overlord-roar picker');
    const s2 = mod.RESOLVERS.get('m6-overlord-roar')(s1, 0, [], s1.pendingSelection.params, pool);
    ok(untouchedPrefixIntact(before, s2.players[0].deck, 4), '牌庫第 5 張以後被重洗了');
  }
});

T('⭐⭐ 彩粉蝶｜大飛翅：對手牌庫原本的順序不得被動到', () => {
  const fn = mod.ABILITY_EFFECTS.get('彩粉蝶|0') ?? mod.ABILITY_EFFECTS_BY_NAME.get('彩粉蝶|大飛翅');
  ok(fn, '找不到彩粉蝶｜大飛翅');
  for (let k = 0; k < 5; k++) {
    const s0 = mkState(30, 4);
    const before = s0.players[1].deck;
    const s1 = fn(s0, 0, pool);
    const after = s1.players[1].deck;
    const drawn = before.length + 4 - after.length;   // 手牌 4 張進牌庫底、對手抽 4 張
    ok(ids(after.slice(0, before.length - drawn)) === ids(before.slice(drawn)),
      '對手牌庫被整副重洗了');
  }
});

T('⭐⭐ 海岱：2 張手牌照**玩家送出的順序**接到牌庫下方（卡面「以任意順序排列」）', () => {
  const fn = mod.TRAINER_EFFECTS.get('海岱');
  ok(fn, '找不到海岱');
  const s0 = mkState(30, 5);
  const before = s0.players[0].deck;
  const s1 = fn(s0, 0, pool);
  ok(s1.pendingSelection?.effectKey === 'hydai-bottom-draw4', '沒開 hydai-bottom-draw4 picker');
  const hand = s1.players[0].hand;
  // 刻意送「手牌後面那張在前」的順序 —— 若實作照手牌原序排就會被抓到
  const sent = [hand[3].iid, hand[1].iid];
  const s2 = mod.RESOLVERS.get('hydai-bottom-draw4')(s1, 0, sent, s1.pendingSelection.params, pool);
  const deck2 = s2.players[0].deck;
  // 牌庫：原 deck + [送出順序的 2 張] → 再從頂抽 4 張
  const expect = [...before.slice(4).map((c) => c.iid), ...sent];
  ok(ids(deck2) === expect.join(','),
    '海岱沒有照玩家送出的順序放到牌庫下方（卡面是「以任意順序排列」）。\n'
    + '      got   =' + ids(deck2).slice(-40) + '\n      expect=' + expect.join(',').slice(-40));
});

T('⭐ N的扒手貓｜暗槓 / 能量撢子：單張放回**對手**牌庫下方，對手牌庫順序不得被動到', () => {
  const post = mod.ATTACK_POST.get('N的扒手貓|暗槓');
  ok(post, '找不到 N的扒手貓｜暗槓');
  const s0 = mkState(30, 4);
  const before = s0.players[1].deck;
  const s1 = post(s0, 0, pool, {});
  const pick = s1.players[1].hand[2].iid;
  const s2 = mod.RESOLVERS.get('lie-cheat-to-deck-bottom')(s1, 0, [pick], s1.pendingSelection.params, pool);
  ok(ids(s2.players[1].deck) === ids([...before, { iid: pick }]),
    '暗槓沒有把那張原封不動接到對手牌庫下方');
});

console.log('③ 枚舉守衛：卡面有「放回牌庫下方」的 HIJ 卡都必須列管');

// 已逐張比對過卡面 → 實作的清單。新卡只要卡面出現「放回牌庫下方」就會逼你回來這裡。
const VERIFIED = new Set([
  '多龍奇',        // 特性 偵查指令 — 無「重洗」→ keep-order
  '妨害信函', '彩粉蝶', '悟松', '推理組合', '特殊紅牌', '調換票',
  '超級烈空坐ex', '越橘的一步棋', '金屬怪',
  '海岱',          // 「以任意順序排列，放回牌庫下方」— 無「重洗」→ keep-order
  '狂歡浪舞鴨', '胖嘟嘟',  // 單張手牌放回下方，無「重洗」
  'N的扒手貓', '能量撢子',  // 「放回**對手的**牌庫下方」— 無「重洗」→ keep-order
]);

T('⭐⭐ 卡面掃描：每張「放回牌庫下方」的 HIJ 卡都在列管清單裡', () => {
  const found = [];
  // ⚠ 措辭變體：卡面也會寫「放回**對手的**牌庫下方」（N的扒手貓｜暗槓、能量撢子）——
  //   舊 regex 少了這個 or 分支，那兩張整整逃過列管（Fable 5 審查抓到）。
  for (const [name, texts] of byName) if (/放回(對手的)?牌庫(最)?下方/.test(texts)) found.push(name);
  const missing = found.filter((n) => !VERIFIED.has(n));
  ok(missing.length === 0,
    '這些 HIJ 卡的卡面有「放回牌庫下方」，但沒被本守衛列管：\n      ' + missing.join('、')
    + '\n      → 請逐張比對「重洗的主詞是哪幾張卡」，改用 deckWithCardsToBottom(rest, toBottom, mode)，'
    + '\n        再把卡名加進 VERIFIED。');
  const stale = [...VERIFIED].filter((n) => !found.includes(n));
  ok(stale.length === 0, 'VERIFIED 有卡已不在 live HIJ 卡池（清單過時）：' + stale.join('、'));
});

T('⭐⭐ 反向對照：卡面「放回牌庫並重洗」（沒有「下方」）的卡不得被誤收進 VERIFIED', () => {
  // 這幾張洗整副是**正確**的，收進來會反過來把正確實作改壞。
  for (const n of ['杜若', '女服務生', '滑稽演員']) {
    const t = byName.get(n);
    if (!t) continue;   // 卡池變動就跳過，不誤殺
    ok(/放回牌庫並重洗/.test(t) && !/放回牌庫(最)?下方/.test(t),
      n + ' 的卡面已不是「放回牌庫並重洗」—— 請重新檢視本守衛的對照組');
    ok(!VERIFIED.has(n), n + ' 被誤收進 VERIFIED —— 它洗整副是正確的');
  }
});

console.log('④ 消費點必須走中央管線');

T('⭐⭐ 所有「放回牌庫下方」的實作都改用 deckWithCardsToBottom', () => {
  const files = [
    'src/lib/game/effects.ts',
    'src/lib/game/effects/cards/v169_supporters.ts',
    'src/lib/game/effects/cards/v172_hij_batch.ts',
    'src/lib/game/effects/cards/v154_decks.ts',
    'src/lib/game/effects/cards/m6_wave14.ts',
    'src/lib/game/effects/cards/maroon_dragon_deck.ts',
    'src/lib/game/effects/cards/items_misc.ts',
    'src/lib/game/effects/cards/v2354_j_mark_batch.ts',
    'src/lib/game/effects/cards/six_decks.ts',
  ];
  let n = 0;
  for (const f of files) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    n += (src.match(/deckWithCardsToBottom\(/g) || []).length;
  }
  ok(n >= 15, '中央管線的消費點只剩 ' + n + ' 處（應 ≥15）—— 有人改回手刻寫法了');
});

console.log('\n=== v6.124「重洗放回牌庫下方」範圍守衛：PASS ' + pass + ' / FAIL ' + fail + ' ===');
process.exit(fail ? 1 : 0);
