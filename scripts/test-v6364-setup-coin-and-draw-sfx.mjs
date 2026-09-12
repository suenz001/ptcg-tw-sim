#!/usr/bin/env node
// v6.364 守衛（站長裁定 六-1 開局擲幣動畫／六-8 平手音效）。
//
// ⭐ 意圖（這支守衛真正要釘的兩件事）：
//   【A】六-1「開局擲幣的視覺只有一套，而且它是對的」——
//        玩家看到的開局擲幣是 `game.id` 驅動的**全螢幕硬幣 overlay**；
//        log 解析那條路（parseCoinFlipAnimationEvents → enqueueCoinFlip）
//        對引擎實際寫出來的 setup log 必須**一次動畫都不產生**，
//        而且 enqueue 路徑上**不得有任何亂數**（舊死碼會顯示一個捏造的正反面）。
//   【B】六-8「對局結束一定聽得到結果」——
//        平手（v6.361：`phase==='game-over'` ＋ 沒有 `winner` key ＋ `isDraw:true`）
//        ⇒ **雙方都**收到既有的落敗音 `game-lose`；有勝方的路徑**行為完全不變**；
//        還沒結束 ⇒ 一個勝負音都不准有。
//
// ⚠ 方法論（照站上既有前端守衛的形狀）：
//   · 能 bundle 起來真的呼叫的，一律真的呼叫：`parseCoinFlipAnimationEvents`、
//     `flipCoinsWithLog`（中央擲幣器）、`computeSfxEvents`、`applyAction`（真引擎）。
//     ——【B】的平手／勝負／未終局三種盤面**都是真引擎跑出來的**，不是手捏的旗標。
//   · 只能靠原始碼比對的（Svelte 元件的 $effect 沒辦法在 node 裡跑），
//     用 **sha256 pin ＋ 哨兵剝除**（形狀抄 test-v6293 E1 的 stripSentinelBlocks），
//     不用關鍵字 includes。
//   · 每一條掃描器都自驗（突變一個位元必須紅），禁恆真斷言、禁用 `||` 放寬。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripCommentsBlank } from './lib/strip-comments.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6364-s.js'), E = join(ROOT, '.v6364-e.ts'), O = join(ROOT, '.v6364-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, [
  "export { parseCoinFlipAnimationEvents } from './src/lib/game/coinAnimation';",
  "export { flipCoinsWithLog } from './src/lib/game/effects';",
  "export { computeSfxEvents } from './src/lib/audio/sfx-events';",
  "export { applyAction } from './src/lib/game/engine';",
  "import './src/lib/game/effects';",
].join('\n'));
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { parseCoinFlipAnimationEvents: parse, flipCoinsWithLog, computeSfxEvents, applyAction } =
  await import(pathToFileURL(O).href);

let pass = 0, fail = 0;
const chk = (t, c, extra = '') => { if (c) { pass++; console.log('  ✓', t); } else { fail++; console.log('  ❌', t, extra); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const LF = (s) => s.replace(/\r\n/g, '\n');

const GAME_PATH = join(ROOT, 'src/routes/game/+page.svelte');
const GAME = LF(readFileSync(GAME_PATH, 'utf8'));
const ENGINE = LF(readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8'));

// ════════════════════════════════════════════════════════════════════════════
console.log('── A1. 從 engine.ts 抓出「開局擲幣」真的寫出來的 setup log 樣板（不硬寫） ──');
// 中央先手決定那一段：`if (coinWinnerIdx === null) { … } else { … }`
const SETUP_A = 'if (coinWinnerIdx === null) {';
const SETUP_B = '// Mulligan log';
const sa = ENGINE.indexOf(SETUP_A), sb = ENGINE.indexOf(SETUP_B, sa);
chk('A1a 哨兵：engine.ts 抓得到先手決定區塊（coinWinnerIdx===null … Mulligan log）',
  sa > 0 && sb > sa && sb - sa < 1200, JSON.stringify([sa, sb]));
const setupBlock = sa > 0 && sb > sa ? ENGINE.slice(sa, sb) : '';

/** 把一段原始碼裡 `addLog(第一引數, '訊息' | \`訊息\`)` 的訊息字面全部抓出來。 */
const GRAB_RE = /addLog\(\s*[A-Za-z_$][\w$.[\]]*\s*,\s*(?:`((?:[^`\\]|\\.)*)`|'((?:[^'\\\n]|\\.)*)')/g;
const grabTemplates = (src) => [...src.matchAll(GRAB_RE)].map((m) => m[1] ?? m[2]);
/** 把樣板展開成實際會寫進 log 的字串（三元 `${a ? 'x' : 'y'}` 展開成兩種）。 */
function render(tpl) {
  const outs = [tpl];
  for (let i = 0; i < 8; i++) {
    const next = [];
    let changed = false;
    for (const s of outs) {
      const m = s.match(/\$\{[^}]*\}/);
      if (!m) { next.push(s); continue; }
      changed = true;
      const expr = m[0];
      const tern = expr.match(/\?\s*'([^']*)'\s*:\s*'([^']*)'/);
      if (tern) { next.push(s.replace(expr, tern[1]), s.replace(expr, tern[2])); }
      else { next.push(s.replace(expr, '阿倫')); }
    }
    outs.length = 0; outs.push(...next);
    if (!changed) break;
  }
  return outs;
}
const setupTpls = grabTemplates(setupBlock);
chk(`A1b 哨兵：先手決定區塊恰有 2 條 log 樣板（實際 ${setupTpls.length}）`, setupTpls.length === 2, JSON.stringify(setupTpls));
const setupLines = setupTpls.flatMap(render);
console.log('     setup log 實際字面：', JSON.stringify(setupLines));
chk('A1c 哨兵：其中一條含「先手」、另一條含「擲硬幣」（＝簡報對照表的前提）',
  setupLines.some((l) => l.includes('先手') && !l.includes('擲硬幣'))
  && setupLines.some((l) => l.includes('擲硬幣') && !l.includes('先手')),
  JSON.stringify(setupLines));

console.log('── A2. 引擎實際寫出來的 setup log ⇒ parser 回傳空陣列（0 次 chip 動畫） ──');
for (const line of setupLines) {
  chk(`A2 ⭐⭐⭐「${line}」⇒ 0 次動畫`, eq(parse(line), []), JSON.stringify(parse(line)));
}
// Setup 收尾那一行也含「先手」，一併釘住（它同樣不該產生 chip 動畫）
const SETUP_DONE = [...ENGINE.matchAll(/addLog\((?:st|state|next|s)\s*,\s*`(Setup 完成！[^`]*)`/g)].map((m) => m[1]);
chk(`A2b 哨兵：抓得到「Setup 完成！…」那一行樣板（實際 ${SETUP_DONE.length} 條）`, SETUP_DONE.length === 1, JSON.stringify(SETUP_DONE));
for (const line of SETUP_DONE.flatMap(render)) {
  chk(`A2c ⭐「${line}」⇒ 0 次動畫`, eq(parse(line), []), JSON.stringify(parse(line)));
}

console.log('── A3. 全站網：engine.ts 沒有任何 log 同時含「擲硬幣」＋「先手」 ──');
// ⭐ 這條是「死碼永遠進不去」這個事實的自動網：舊特例的條件就是
//   `msg.includes('擲硬幣') && msg.includes('先手')`。只要有人未來寫出同時含兩者的 log，
//   這條就會紅 —— 提醒他「開局擲幣視覺不是靠 log 的」。
const allTpls = grabTemplates(ENGINE).flatMap(render);
chk(`A3a 哨兵：engine.ts 抓到的 log 樣板夠多（實際 ${allTpls.length} 條；抓不到就是空真）`, allTpls.length >= 120, String(allTpls.length));
const both = allTpls.filter((l) => l.includes('擲硬幣') && l.includes('先手'));
chk('A3b ⭐⭐ 沒有任何 log 同時含「擲硬幣」與「先手」（舊死碼的進入條件永遠不成立）',
  both.length === 0, JSON.stringify(both.slice(0, 5)));
chk('A3c 掃描器自驗：把一條「擲硬幣…先手」餵進同一個判準必須被抓到（上一條不是恆真式）',
  [...allTpls, '🪙 擲硬幣：阿倫 先手'].filter((l) => l.includes('擲硬幣') && l.includes('先手')).length === 1);

console.log('── A4. 正對照：招式擲幣照樣有動畫（證明 parser 沒被關掉） ──');
const mkFlipState = () => ({
  turn: 1, log: [], activePlayerIndex: 0,
  players: [{ name: 'P1', active: null, bench: [] }, { name: 'P2', active: null, bench: [] }],
});
const withFlips = (seq, fn) => {
  const real = Math.random; let i = 0;
  Math.random = () => {
    if (i >= seq.length) throw new Error(`擲幣次數超出預期（只準備了 ${seq.length} 次）`);
    return seq[i++] === 'H' ? 0.1 : 0.9;
  };
  try { return fn(); } finally { Math.random = real; }
};
{
  const st0 = mkFlipState();
  const r = withFlips(['H', 'T', 'H'], () => flipCoinsWithLog(st0, 3, '能量硬幣', 0));
  const lines = r.state.log.slice(st0.log.length).map((e) => e.message);
  chk('A4a 哨兵：中央擲幣器真的寫了 3 行擲幣 log', lines.length === 3, JSON.stringify(lines));
  chk('A4b ⭐⭐ 招式擲幣仍逐次產生動畫 heads/tails/heads（parser 沒被關掉）',
    eq(lines.flatMap((l) => parse(l)).map((e) => e.result), ['heads', 'tails', 'heads']), JSON.stringify(lines));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('── A5. +page.svelte：coin enqueue 路徑上不得有任何亂數 ──');
/** coin 動畫路徑區間：processCoinQueue 起、到解析 log 的那個 $effect 收尾。 */
function coinEnqueueRegion(src) {
  const a = src.indexOf('  function processCoinQueue() {');
  if (a < 0) throw new Error('抓不到 processCoinQueue 起點');
  const p = src.indexOf('parseCoinFlipAnimationEvents(msg)', a);
  if (p < 0) throw new Error('抓不到 parseCoinFlipAnimationEvents(msg)');
  const END = '\n  });\n';
  const e = src.indexOf(END, p);
  if (e < 0) throw new Error('抓不到 coin log $effect 的收尾');
  return src.slice(a, e + END.length);
}
const REGION = coinEnqueueRegion(GAME);
chk('A5a 哨兵：區間抓得到且形狀合理（>1200 字元、含 enqueueCoinFlip、含 parser 呼叫、含 $effect）',
  REGION.length > 1200 && REGION.includes('function enqueueCoinFlip(')
  && REGION.includes('parseCoinFlipAnimationEvents(msg)') && REGION.includes('$effect(()'),
  String(REGION.length));
/** 亂數掃描器：先用站上中央 helper 剝註解（等長留白），再數 `Math.random`。 */
const randCount = (s) => (stripCommentsBlank(s).match(/Math\s*\.\s*random/g) || []).length;
chk('A5b ⭐⭐⭐ coin enqueue 路徑（剝註解後）零 `Math.random`（v6.364 刪掉的 setup 死碼就是它）',
  randCount(REGION) === 0, '剩 ' + randCount(REGION) + ' 處');
chk('A5c 掃描器自驗①：把亂數塞回**程式碼**（不是註解）⇒ 掃描器的計數必須 +1',
  randCount(REGION.replace('      const msg = entry.message;',
    "      const msg = entry.message;\n      if (Math.random() < 0.5) continue;")) === randCount(REGION) + 1);
chk('A5d 掃描器自驗②：剝註解沒有把程式碼吃掉（區間剝完仍看得到 enqueueCoinFlip 呼叫）',
  stripCommentsBlank(REGION).includes('enqueueCoinFlip(event.result, event.label)'));
// ⭐ 全站網：每一個 enqueueCoinFlip( 呼叫的引數裡都不得有亂數
const callArgs = [];
{
  const s = stripCommentsBlank(GAME);
  for (const m of s.matchAll(/enqueueCoinFlip\(/g)) {
    let d = 0, i = m.index + m[0].length - 1;
    for (; i < s.length; i++) {
      if (s[i] === '(') d++;
      else if (s[i] === ')') { d--; if (d === 0) break; }
    }
    callArgs.push(s.slice(m.index, i + 1));
  }
}
chk(`A5e 哨兵：全站抓到 ${callArgs.length} 個 enqueueCoinFlip( 呼叫點（0 個就是空真）`, callArgs.length >= 1, String(callArgs.length));
chk('A5f ⭐⭐ 每一個 enqueueCoinFlip 呼叫的引數都不含亂數（不准再 enqueue 捏造的正反面）',
  callArgs.every((c) => !/Math\s*\.\s*random/.test(c)), JSON.stringify(callArgs.filter((c) => /Math\s*\.\s*random/.test(c))));
chk('A5g 呼叫點掃描器自驗：人工加一個帶亂數的呼叫 ⇒ 必須被抓到',
  ["enqueueCoinFlip(Math.random() < 0.5 ? 'heads' : 'tails', 'x')"]
    .every((c) => /Math\s*\.\s*random/.test(c)));

// ════════════════════════════════════════════════════════════════════════════
console.log('── A6. 開局 overlay 的 $effect 仍由 game.id 驅動（sha256 pin ＋ 哨兵剝除） ──');
/** 剝掉成對哨兵之間（含兩行哨兵本身）；形狀與 test-v6293／test-v6265 相同。 */
function stripSentinelBlocks(src, tag) {
  let s = src;
  for (let guard = 0; ; guard++) {
    if (guard > 50) throw new Error('哨兵剝除迴圈：' + tag);
    const a = s.indexOf('>>> ' + tag);
    if (a < 0) return s;
    const b = s.indexOf('<<< ' + tag, a);
    if (!(b > a)) throw new Error('哨兵不成對（只有 >>>）：' + tag);
    const ls = s.lastIndexOf('\n', a) + 1;
    const le = s.indexOf('\n', b) + 1;
    if (!(le > 0)) throw new Error('哨兵收尾行沒有換行：' + tag);
    s = s.slice(0, ls) + s.slice(le);
  }
}
const OVL_A = '  // ── 擲硬幣動畫（Session 34） ─';
const OVL_B = '  // ── 獎賞卡放置動畫（開局發牌 0→6）';
function overlayRegion(src) {
  const a = src.indexOf(OVL_A), b = src.indexOf(OVL_B, a);
  if (a < 0 || b <= a) throw new Error('抓不到開局擲幣 overlay 的 $effect 區間');
  return stripSentinelBlocks(src.slice(a, b), 'v6364-setup-coin');
}
// ⭐ 這個 sha256 是 v6.364 當下「由 game.id 驅動」的那一段 $effect 的逐位元指紋。
//   任何人改動這一段（包含改成由 log 驅動、或把 game.id 換掉）都會翻紅。
//   要合法修改它 ⇒ 依 Rule 40 上移判準或更新 pin，不可以刪掉這條。
const OVERLAY_PIN = 'd3237b4d63f819fe12fdaacf2fab8409f75c6f2efd8a9b595017943371d04a74';
const ovl = overlayRegion(GAME);
chk('A6a 哨兵：overlay 區間抓得到且含一個 $effect（長度 ' + ovl.length + '）',
  ovl.length > 500 && ovl.length < 2000 && (ovl.match(/\$effect\(\(\) => \{/g) || []).length === 1,
  String(ovl.length));
chk('A6b ⭐⭐⭐ 開局 overlay 的 $effect 與 v6.364 交件版**逐位元相同**（sha256 pin）',
  sha256(ovl) === OVERLAY_PIN, '實得 ' + sha256(ovl));
chk('A6c 正對照：區間內多一個位元組 ⇒ pin 必須不同（不是恆真式）',
  sha256(ovl + ' ') !== OVERLAY_PIN && sha256(ovl) !== sha256(ovl + ' '));
chk('A6d 正對照：把驅動來源從 game.id 換成 log ⇒ pin 必須翻紅',
  sha256(overlayRegion(GAME.replace('if (coinFlipShownFor === game.id) return;',
    'if (coinFlipShownFor === String(game.log?.length)) return;'))) !== OVERLAY_PIN);
chk('A6e 剝除器自驗：哨兵只剝哨兵內那一塊 —— 區間內、哨兵外多一個位元組照樣翻紅',
  sha256(overlayRegion(GAME.replace(OVL_A, OVL_A + '─'))) !== OVERLAY_PIN);
// ⚠ 補充斷言（不單獨成立、只當說明）：pin 住的那一段語意就是「game.id 驅動」。
chk('A6f 補充：pin 住的區間裡確實是 game.id 在當重播鍵（補充斷言，主判準是 A6b 的 pin）',
  ovl.includes('coinFlipShownFor === game.id') && ovl.includes('coinFlipShownFor = game.id'));

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── B. 六-8 平手音效（盤面全部由**真引擎**跑出來） ──');
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const all = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) all.push(c);
}
const pool = new Map(all.map((c) => [String(c.id), c]));
const byId = (id) => { const c = pool.get(String(id)); if (!c) throw new Error('卡池抓不到 id ' + id); return c; };
const GENG = byId('19988');   // 耿鬼ex M6a HP280 Stage2【惡】｜死亡宣告（KO 我 ⇒ 擲幣，正面 ⇒ 攻擊方也昏厥）
const ICE = byId('19924');    // 急凍鳥 M6a HP120 Basic【水】非 ex｜冰雹
const PLAIN = all.find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic'
  && !(c.abilities || []).length && !(c.tags || []).includes('太晶')
  && Number(c.hp) >= 60 && c.pokemonType === 'Colorless');
const ZH = { Grass: '草', Fire: '火', Water: '水', Lightning: '雷', Psychic: '超', Fighting: '鬥', Darkness: '惡', Metal: '鋼' };
const EID = {};
for (const c of all) {
  if (c.supertype !== 'Energy') continue;
  for (const [k, z] of Object.entries(ZH)) if (c.name === `基本【${z}】能量` && !EID[k]) EID[k] = String(c.id);
}
EID.Colorless = EID.Water;
let nn = 0;
const inst = (cid, extra = {}) => ({
  iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [],
  abilityUsedThisTurn: false, evolvedThisTurn: false, playedFromHand: false,
  movedToActiveThisTurn: false, evolvedFromStack: [], ...extra,
});
const P = (o = {}) => ({ name: 'P', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [], abilityNamesUsedThisTurn: [], ...o });
const prizesN = (n) => Array.from({ length: n }, () => inst(PLAIN.id));
const deck3 = () => [inst(PLAIN.id), inst(PLAIN.id), inst(PLAIN.id)];
const mkState = (p0, p1) => ({
  id: 'g6364', phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5,
  isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
  pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
  coinFlippedThisAttack: false, _attackerActiveBonusDone: false,
  activeStadium: null, activeStadiumOwnerIdx: 0,
  players: [P({ name: 'A', deck: deck3(), prizes: prizesN(6), ...p0 }),
            P({ name: 'B', deck: deck3(), prizes: prizesN(6), ...p1 })],
});
const energyFor = (card, atkName) =>
  ((card.attacks || []).find((a) => a.name === atkName)?.cost ?? []).map((t) => inst(EID[t] ?? EID.Water));
const atkIdx = (card, name) => (card.attacks || []).findIndex((a) => a.name === name);
/** 攻擊方＝急凍鳥（冰雹 30，全體）；防守方戰鬥位＝耿鬼ex（差 30 就昏厥） */
const board = ({ b0 = 0, b1 = 0 } = {}) => mkState(
  { active: inst(ICE.id, { energyAttached: energyFor(ICE, '冰雹') }), bench: Array.from({ length: b0 }, () => inst(PLAIN.id)) },
  { active: inst(GENG.id, { damage: Number(GENG.hp) - 30 }), bench: Array.from({ length: b1 }, () => inst(PLAIN.id)) });
const ATTACK = { type: 'ATTACK', attackIndex: atkIdx(ICE, '冰雹') };
const withCoin = (heads, fn) => { const o = Math.random; Math.random = () => (heads ? 0.1 : 0.9); try { return fn(); } finally { Math.random = o; } };
const run = (st, heads = true) => withCoin(heads, () => applyAction(st, ATTACK, pool));
const HASWIN = (r) => Object.prototype.hasOwnProperty.call(r ?? {}, 'winner') && r.winner != null;
const sfx = (prev, next, ctx) => computeSfxEvents(prev, next, ATTACK, pool, ctx).map((e) => e.name);
const endEvt = (prev, next, ctx) => computeSfxEvents(prev, next, ATTACK, pool, ctx).filter((e) => e.name === 'game-win' || e.name === 'game-lose');

console.log('  · B0 fixture 自驗（抓錯卡 ⇒ 後面全是假綠）');
chk('B0a 耿鬼ex＝HP280 Stage2【惡】有特性「死亡宣告」；急凍鳥非 ex 有「冰雹」',
  Number(GENG.hp) === 280 && GENG.stage === 'Stage2' && GENG.pokemonType === 'Darkness'
  && (GENG.abilities || []).some((a) => a.name === '死亡宣告') && ICE.subtype !== 'ex' && atkIdx(ICE, '冰雹') >= 0,
  JSON.stringify([GENG?.hp, GENG?.stage, ICE?.subtype, atkIdx(ICE, '冰雹')]));

console.log('  · B1 ⭐⭐⭐ 平手：真引擎跑出來的「雙方最後一隻互相昏厥」');
const prevD = board({ b0: 0, b1: 0 });
const nextD = run(prevD, true);
chk('B1a 哨兵：這真的是平手盤面（雙方場上全空、phase=game-over、**沒有 winner key**、isDraw=true）',
  nextD.phase === 'game-over' && !HASWIN(nextD)
  && !Object.prototype.hasOwnProperty.call(nextD, 'winner') && nextD.isDraw === true
  && nextD.players[0].active == null && nextD.players[0].bench.length === 0
  && nextD.players[1].active == null && nextD.players[1].bench.length === 0,
  JSON.stringify([nextD.phase, nextD.winner, nextD.isDraw,
    Object.prototype.hasOwnProperty.call(nextD, 'winner')]));
for (const [who, ctx] of [['座位 0', { mode: 'online', myPlayerIndex: 0 }], ['座位 1', { mode: 'online', myPlayerIndex: 1 }]]) {
  chk(`B1b ⭐⭐⭐ 平手 ⇒ ${who} 收到恰好 1 個勝負音，且是**落敗音** game-lose`,
    eq(endEvt(prevD, nextD, ctx).map((e) => e.name), ['game-lose']),
    JSON.stringify(sfx(prevD, nextD, ctx)));
}
chk('B1c ⭐⭐ 平手時雙方**都沒有**勝利音（不是只有一方靜音）',
  [{ mode: 'online', myPlayerIndex: 0 }, { mode: 'online', myPlayerIndex: 1 }]
    .every((ctx) => !sfx(prevD, nextD, ctx).includes('game-win')));
chk('B1d ⭐ 平手的落敗音沿用既有的 delayMs 300（與勝負音同一個口徑）',
  endEvt(prevD, nextD, { mode: 'online', myPlayerIndex: 0 }).every((e) => e.delayMs === 300),
  JSON.stringify(endEvt(prevD, nextD, { mode: 'online', myPlayerIndex: 0 })));
chk('B1e ⭐ AI／本機 2P（沒有 myPlayerIndex）平手一樣聽得到落敗音',
  eq(endEvt(prevD, nextD, { aiPlayerIndex: 1 }).map((e) => e.name), ['game-lose'])
  && eq(endEvt(prevD, nextD, {}).map((e) => e.name), ['game-lose']),
  JSON.stringify([sfx(prevD, nextD, { aiPlayerIndex: 1 }), sfx(prevD, nextD, {})]));

console.log('  · B2 正對照：一般勝負的行為完全不變');
const prevW = board({ b0: 1, b1: 0 });
const nextW = run(prevW, true);
chk('B2a 哨兵：這真的是「A 獲勝」盤面（winner=0、沒有 isDraw）',
  nextW.phase === 'game-over' && nextW.winner === 0 && nextW.isDraw === undefined,
  JSON.stringify([nextW.phase, nextW.winner, nextW.isDraw]));
chk('B2b ⭐⭐⭐ 線上：勝方（座位 0）得勝利音、敗方（座位 1）得落敗音',
  eq(endEvt(prevW, nextW, { mode: 'online', myPlayerIndex: 0 }).map((e) => e.name), ['game-win'])
  && eq(endEvt(prevW, nextW, { mode: 'online', myPlayerIndex: 1 }).map((e) => e.name), ['game-lose']),
  JSON.stringify([sfx(prevW, nextW, { mode: 'online', myPlayerIndex: 0 }), sfx(prevW, nextW, { mode: 'online', myPlayerIndex: 1 })]));
chk('B2c ⭐⭐ AI 模式：AI 是 1 號 ⇒ 玩家得勝利音；AI 是 0 號 ⇒ 玩家得落敗音（既有判定逐條不變）',
  eq(endEvt(prevW, nextW, { aiPlayerIndex: 1 }).map((e) => e.name), ['game-win'])
  && eq(endEvt(prevW, nextW, { aiPlayerIndex: 0 }).map((e) => e.name), ['game-lose']),
  JSON.stringify([sfx(prevW, nextW, { aiPlayerIndex: 1 }), sfx(prevW, nextW, { aiPlayerIndex: 0 })]));
chk('B2d ⭐ 本機 2P（既沒 myPlayerIndex 也沒 aiPlayerIndex）仍是既有的 game-win（觀戰者同此慣例，行為未變）',
  eq(endEvt(prevW, nextW, {}).map((e) => e.name), ['game-win'])
  && eq(endEvt(prevW, nextW, { mode: 'online', myPlayerIndex: null }).map((e) => e.name), ['game-win']),
  JSON.stringify([sfx(prevW, nextW, {}), sfx(prevW, nextW, { mode: 'online', myPlayerIndex: null })]));
chk('B2e ⭐⭐ 勝負那一發的**完整事件序列**（不只勝負音）逐項不變 —— 沒有順手改壞 KO／取獎／抽牌音',
  eq(sfx(prevW, nextW, { mode: 'online', myPlayerIndex: 0 }), ['attack-Water', 'ko', 'game-win']),
  JSON.stringify(sfx(prevW, nextW, { mode: 'online', myPlayerIndex: 0 })));

console.log('  · B3 反對照：還沒結束 ⇒ 一個勝負音都沒有');
const prevP = board({ b0: 1, b1: 1 });
const nextP = run(prevP, true);
chk('B3a 哨兵：雙方都還有備戰 ⇒ phase 仍是 playing（而且戰鬥位真的昏厥了，不是整支沒跑）',
  nextP.phase === 'playing' && nextP.isDraw === undefined && !HASWIN(nextP)
  && nextP.players[1].active == null && nextP.players[1].bench.length === 1,
  JSON.stringify([nextP.phase, nextP.winner, nextP.isDraw]));
chk('B3b ⭐⭐ 未終局 ⇒ 沒有任何 game-win／game-lose 事件',
  [{ mode: 'online', myPlayerIndex: 0 }, { mode: 'online', myPlayerIndex: 1 }, {}]
    .every((ctx) => endEvt(prevP, nextP, ctx).length === 0),
  JSON.stringify(sfx(prevP, nextP, { mode: 'online', myPlayerIndex: 0 })));
chk('B3c 哨兵：這一發確實有別的音（KO／取獎）⇒ B3b 不是「整個音效關掉」造成的假綠',
  sfx(prevP, nextP, { mode: 'online', myPlayerIndex: 0 }).includes('ko'),
  JSON.stringify(sfx(prevP, nextP, { mode: 'online', myPlayerIndex: 0 })));

console.log('  · B4 去重：既有的「只播一次」慣例不變（level-trigger 在 phase 轉換那一拍）');
chk('B4a ⭐⭐ 平手盤面 → 平手盤面（已經 game-over）⇒ 不再播第二次',
  [{ mode: 'online', myPlayerIndex: 0 }, { mode: 'online', myPlayerIndex: 1 }]
    .every((ctx) => endEvt(nextD, nextD, ctx).length === 0),
  JSON.stringify(sfx(nextD, nextD, { mode: 'online', myPlayerIndex: 0 })));
chk('B4b ⭐ 勝負盤面 → 勝負盤面 ⇒ 一樣不再播（既有行為，對照組）',
  endEvt(nextW, nextW, { mode: 'online', myPlayerIndex: 0 }).length === 0,
  JSON.stringify(sfx(nextW, nextW, { mode: 'online', myPlayerIndex: 0 })));
chk('B4c ⭐ 觀戰者路徑（沒有 action 物件）平手一樣是落敗音、且一樣只播一次',
  eq(computeSfxEvents(prevD, nextD, null, pool, { mode: 'online', myPlayerIndex: null })
    .filter((e) => e.name.startsWith('game-')).map((e) => e.name), ['game-lose'])
  && computeSfxEvents(nextD, nextD, null, pool, { mode: 'online', myPlayerIndex: null })
    .filter((e) => e.name.startsWith('game-')).length === 0,
  JSON.stringify(computeSfxEvents(prevD, nextD, null, pool, { mode: 'online', myPlayerIndex: null }).map((e) => e.name)));

console.log('  · B5 反對照：game-over 但既沒 winner 也沒 isDraw（不是 v6.361 平手）⇒ 維持既有的靜音');
{
  const legacy = { ...nextD };
  delete legacy.isDraw;
  chk('B5 ⭐ 舊式「無勝方也無平手旗標」盤面的行為未被本版改動（仍不播勝負音）',
    endEvt(prevD, legacy, { mode: 'online', myPlayerIndex: 0 }).length === 0,
    JSON.stringify(sfx(prevD, legacy, { mode: 'online', myPlayerIndex: 0 })));
}

console.log(`\n═══ v6.364 setup-coin ＋ draw-sfx：PASS ${pass}／FAIL ${fail} ═══`);
process.exit(fail === 0 ? 0 : 1);
