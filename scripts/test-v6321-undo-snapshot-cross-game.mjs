// v6.321 守衛 —— 悔棋快照跨局殘留（新局 setup 按 ↶ 整包退回上一局；換了座位＝看到上一局對手的手牌）
//                ＋ 開局可重選戰鬥場（engine 本來就接受，缺 UI 入口）
//
// ── 玩家回報（站長逐字轉述）────────────────────────────────────────────────
//   「一般對戰(休閒對戰)開局準備的時候我戰鬥場那一隻放錯，本來想說用倒退，然後直接退到我上一局跟別人打的，
//    重點是我是對面呆呆王，他直接給我退到上一局我跟對面打對面的視角」
//
// ── 根因（三者疊加；本守衛【A】用真引擎＋逐字抽出的頁面規則重現）──────────────────
//   1. `undoSnapshot` 是 page 級變數、跨局從不清（第 1 局以攻擊直接終局時 END_TURN 根本沒跑到）。
//   2. 手機直式的 ↶ 鈕沒有 phase 閘（只看「有快照」）⇒ setup 階段就亮著；桌機鈕有 playing 閘所以看不到。
//   3. 整條悔棋管線（performUndo／對手 modal／agreed $effect／rollback）都不比對 game.id。
//
// ── 這一版的修法 ─────────────────────────────────────────────────────────
//   A 單一接線點：`$effect` 看到 `undoSnapshot.id !== game.id`（含 game=null）就清快照＋四個伴隨旗標。
//   B 綁 gameId：快照本身是 GameState（id 就是拍下時那一局）；顯示條件／performUndo／agreed $effect 都比對；
//     requestUndo 帶 `gameId`（房間 doc 是不透明 JSON，伺服器原樣存 ⇒ 不需 server 先上）；
//     對手 modal：帶 gameId 必須相等、沒帶（舊 client）退回 phase 閘（不擋死舊 client 的正常悔棋）。
//   C 手機 ↶ 讀同一份 `undoBtnVisible`（playing＋我的回合＋無 pending＋快照屬於本局＋allowUndo）。
//   D `setup-active-swap`：setup 且尚未按準備完成、已有戰鬥場寶可夢時，手牌基礎卡可換上場（舊的回手牌）。
//   E 收端：`apply-undo` 拒收異局 rollback（舊 client 發起方仍可能推上一局快照；只加在頁面層，不動 sync-guards）。
//
// ── 紀律 ──────────────────────────────────────────────────────────────
//   ・【A】是行為端主證明：真 createGame/applyAction ＋ 頁面規則**逐字抽出來執行**；
//     抽取器對 BASE／HEAD 都適用 ⇒ 對 BASE blob 跑同一組 fixture 必須看到洩漏（拿不到歷史時 SHALLOW-SKIP）。
//   ・【G】突變：每一條主張都要能被弄紅（改原始碼字串後重跑同一組判準）。
//   ・只捕捉 assert.AssertionError（其他例外一律炸出來）。
// Run: node scripts/test-v6321-undo-snapshot-cross-game.mjs
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
import { build, transformSync } from 'esbuild';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE_PATH = 'src/routes/game/+page.svelte';
const MPB_PATH = 'src/routes/game/MobilePortraitBattle.svelte';
const HCO_PATH = 'src/lib/game/hand-card-ops.ts';
const RO_PATH = 'src/lib/game/room-oracle.ts';
const RF_PATH = 'src/lib/game/room.ts';
const PAGE = readFileSync(join(ROOT, PAGE_PATH), 'utf8');
const MPB = readFileSync(join(ROOT, MPB_PATH), 'utf8');
const HCO = readFileSync(join(ROOT, HCO_PATH), 'utf8');
const RO = readFileSync(join(ROOT, RO_PATH), 'utf8');
const RF = readFileSync(join(ROOT, RF_PATH), 'utf8');
// ⚠ 任何一版都可能被 pin 死 —— 這裡的 BASE 只拿來做 HEAD-FAIL 對照，拿不到就 SHALLOW-SKIP，主判準不靠它。
const BASE_SHA = '9e41a5d55394cfc8547d0217c4095ef7dbe2c888';   // v6.320

let pass = 0, fail = 0;
const T = (n, fn) => {
  try { fn(); console.log('  OK  ', n); pass++; }
  catch (e) { if (e instanceof assert.AssertionError) { console.log('  FAIL', n, '::', e.message); fail++; } else throw e; }
};
const ok = (c, m) => assert.ok(c, m);
function mustBreak(name, run) {
  let red = null;
  try { run(); }
  catch (e) { if (!(e instanceof assert.AssertionError)) throw e; red = e.message.split('\n')[0].slice(0, 96); }
  if (red !== null) { console.log('  OK   ' + name + '（如預期紅：' + red + '）'); pass++; return; }
  console.log('  FAIL ' + name + ' :: 突變後竟然還是綠的 —— 這條守衛沒有在守');
  fail++;
}
const ts = (s) => transformSync(s, { loader: 'ts', target: 'node18' }).code;

// ═══════════════════════════════════════════════════════════
// 引擎 bundle（真 createGame／applyAction／getHandCardOps／handOpForDropTarget）
// ═══════════════════════════════════════════════════════════
const S = join(ROOT, '.v6321-s.js'), E = join(ROOT, '.v6321-e.ts'), O = join(ROOT, '.v6321-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* ignore */ } } });
writeFileSync(S, 'export const base="";');
writeFileSync(E,
  "export { createGame, applyAction, isOpeningInProgress } from './src/lib/game/engine';\n"
+ "import './src/lib/game/effects';\n"
+ "export { getHandCardOps, handOpForDropTarget, HAND_CARD_OPS, HAND_OP_DROP_TARGET } from './src/lib/game/hand-card-ops';\n");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const M = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const LION = '18508', WILLDUN = '14086', ENERGY = '14102';
ok(pool.get(LION) && pool.get(WILLDUN) && pool.get(ENERGY), 'fixture 卡不在卡庫');
const pick = (pred, n) => [...pool.values()].filter(pred).slice(0, n).map(c => String(c.id));
const X_HAND = pick(c => c.supertype === 'Trainer' && c.subtype === 'Supporter' && /^[一-鿿]{2,4}$/.test(c.name), 4);
const P_HAND = pick(c => c.supertype === 'Trainer' && c.subtype === 'Item' && c.name.length <= 4, 4);
ok(X_HAND.length === 4 && P_HAND.length === 4 && X_HAND.join() !== P_HAND.join(), '辨識用手牌抓不到');
let nn = 0;
const inst = (cid, e = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...e });
const prize = n => Array.from({ length: n }, () => inst(ENERGY));

// ═══════════════════════════════════════════════════════════
// 頁面規則抽取器（對 BASE／HEAD 都適用；缺席就回 null，由呼叫端決定紅綠）
// ═══════════════════════════════════════════════════════════
const RX_OWNED = /function undoSnapshotOwnedBy\(snap: GameState \| null, g: GameState \| null\): snap is GameState \{[\s\S]*?\n  \}\n/;
const RX_EFFECT = /\$effect\(\(\) => \{\n    if \(undoSnapshot && !undoSnapshotOwnedBy\(undoSnapshot, game\)\) \{[\s\S]*?\n  \}\);\n/;
const RX_VIS = /const undoBtnVisible = \$derived\(([\s\S]*?)\);\n/;
const RX_PROP = /undoAvailable=\{([^}]+)\}/;
const RX_AGREED = /if \(req\.status === 'agreed' && ([^\n]*?)\) \{\n/;
const RX_REQGATE = /function undoRequestForThisGame\(req: \{ gameId\?: string \} \| null \| undefined, g: GameState \| null\): boolean \{[\s\S]*?\n  \}\n/;

function pageRules(src) {
  const undoable = new Set(src.match(/const UNDOABLE_ACTIONS = new Set<string>\(\[[\s\S]*?\]\);/)[0].match(/'([A-Z_]+)'/g).map(s => s.replace(/'/g, '')));
  const ownedFn = src.match(RX_OWNED)?.[0] ?? null;
  const effect = src.match(RX_EFFECT)?.[0] ?? null;
  const prop = src.match(RX_PROP)?.[1]?.trim() ?? null;
  const visDerived = src.match(RX_VIS)?.[1] ?? null;
  const agreed = src.match(RX_AGREED)?.[1] ?? null;
  const reqGate = src.match(RX_REQGATE)?.[0] ?? null;
  return { undoable, ownedFn, effect, prop, visDerived, agreed, reqGate };
}

/** 模擬頁面：一個可以「換局」並跑接線點／顯示條件／agreed 條件的小型 page 狀態機。 */
function makePage(src) {
  const R = pageRules(src);
  const st = { game: null, undoSnapshot: null, undoActionDesc: null, undoDeniedThisSnapshot: false, undoAwaitingResponse: false,
    mode: 'online', roomData: { allowUndo: true }, mySeatIdx: 1, aiPlayerIndex: null, roomCode: 'ROOMA', cleared: [] };
  const ownedJs = R.ownedFn ? ts(R.ownedFn) : '';
  const clearUndoRequestApi = async () => { st.cleared.push(st.roomCode); };
  const runEffect = () => {
    if (!R.effect) return false;
    const body = R.effect.replace(/^\$effect\(\(\) => \{/, '').replace(/\}\);\n$/, '');
    const f = new Function('undoSnapshot', 'game', 'undoActionDesc', 'undoDeniedThisSnapshot', 'undoAwaitingResponse', 'mode', 'roomCode', 'clearUndoRequestApi',
      ownedJs + '\n' + ts(body) + '\nreturn { undoSnapshot, undoActionDesc, undoDeniedThisSnapshot, undoAwaitingResponse };');
    const r = f(st.undoSnapshot, st.game, st.undoActionDesc, st.undoDeniedThisSnapshot, st.undoAwaitingResponse, st.mode, st.roomCode, clearUndoRequestApi);
    Object.assign(st, r);
    return true;
  };
  const dispatch = (action) => {
    const prev = st.game;
    const next = M.applyAction(prev, action, pool);
    const undoModeOn = (st.mode !== 'online' && st.aiPlayerIndex !== null) || (st.mode === 'online' && st.roomData?.allowUndo === true && st.mySeatIdx >= 0 && st.mySeatIdx <= 1);
    if (undoModeOn && next !== prev) {
      if (action.type === 'END_TURN') { st.undoSnapshot = null; st.undoActionDesc = null; st.undoDeniedThisSnapshot = false; }
      else if (R.undoable.has(action.type)) { st.undoSnapshot = prev; st.undoActionDesc = action.type; st.undoDeniedThisSnapshot = false; }
    }
    st.game = next; runEffect();
    return next;
  };
  const setGame = (g) => { st.game = g; runEffect(); };
  const visible = () => {
    const expr = R.prop === 'undoBtnVisible' ? R.visDerived : R.prop;
    ok(expr, '抓不到手機 ↶ 的顯示條件');
    const g = st.game;
    const pendingSelection = g?.pendingSelection ?? null;
    const isMyTurn = () => !!g && (g.phase === 'setup' ? true : g.activePlayerIndex === st.mySeatIdx);
    return !!new Function('undoSnapshot', 'game', 'undoAwaitingResponse', 'undoDeniedThisSnapshot', 'pendingSelection', 'mode', 'roomData', 'mySeatIdx', 'isMyTurn', 'aiPlayerIndex',
      ownedJs + '\nreturn (' + ts(expr).replace(/;\s*$/, '') + ');')(
      st.undoSnapshot, g, st.undoAwaitingResponse, st.undoDeniedThisSnapshot, pendingSelection, st.mode, st.roomData, st.mySeatIdx, isMyTurn, st.aiPlayerIndex);
  };
  /** 按 ↶ → 線上：requestUndo → 對手同意 → agreed 條件成立就 game = snap。回傳 {pressed, adopted} */
  const pressUndoAndAgree = () => {
    if (!visible()) return { pressed: false, adopted: false };
    st.undoAwaitingResponse = true;
    ok(R.agreed, '抓不到 agreed 條件');
    const cond = new Function('req', 'undoSnapshot', 'game', ownedJs + '\nreturn (' + ts(R.agreed).replace(/;\s*$/, '') + ');')(
      { status: 'agreed', fromSeatIdx: st.mySeatIdx }, st.undoSnapshot, st.game);
    if (cond) { st.game = st.undoSnapshot; return { pressed: true, adopted: true }; }
    return { pressed: true, adopted: false };
  };
  const reqGate = (req, g) => {
    ok(R.reqGate, '抓不到對手端 modal 的 undoRequestForThisGame');
    return !!new Function('req', 'g', ts(R.reqGate) + '\nreturn undoRequestForThisGame(req, g);')(req, g);
  };
  return { st, R, dispatch, setGame, runEffect, visible, pressUndoAndAgree, reqGate };
}

/** 第 1 局：P 坐 seat 1，X 坐 seat 0，P 一招 KO X 最後一隻 → 終局（END_TURN 不會跑到）。 */
function game1Fixture() {
  const g1 = M.createGame({ name: 'X', entries: [{ cardId: WILLDUN, count: 1 }] }, { name: 'P', entries: [{ cardId: WILLDUN, count: 1 }] }, pool, { forceLegacyOpening: true });
  return { ...g1, phase: 'playing', turnPhase: 'main', activePlayerIndex: 1, firstPlayerIdx: 1, turn: 6, isFirstTurn: false,
    setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], pendingSelection: null, log: [],
    players: [
      { ...g1.players[0], name: 'X', hand: X_HAND.map(id => inst(id)), deck: [inst(ENERGY)], discard: [], prizes: prize(6), active: inst(WILLDUN, { damage: 100 }), bench: [] },
      { ...g1.players[1], name: 'P', hand: P_HAND.map(id => inst(id)), deck: [inst(ENERGY)], discard: [], prizes: prize(1), active: inst(LION, { energyAttached: [inst(ENERGY)] }), bench: [] },
    ] };
}
const ATK = { type: 'ATTACK', attackIndex: 0 };
/** 完整情境：第 1 局攻擊終局 → 離房 → 第 2 局換座位（P 坐 seat 0）setup → 按 ↶ → 對手同意。回傳畫面手牌。 */
function scenario(src, { leaveFirst = true, toPlaying = false } = {}) {
  const pg = makePage(src);
  pg.setGame(game1Fixture());
  const after = pg.dispatch(ATK);
  assert.strictEqual(after.phase, 'game-over', '第 1 局沒有以攻擊終局（fixture 壞了）');
  const kept1 = !!pg.st.undoSnapshot;
  if (leaveFirst) { pg.st.roomCode = ''; pg.setGame(null); }
  const g2 = M.createGame({ name: 'P', entries: [{ cardId: WILLDUN, count: 1 }] }, { name: 'Y', entries: [{ cardId: WILLDUN, count: 1 }] }, pool, { forceLegacyOpening: true });
  pg.st.mySeatIdx = 0; pg.st.roomCode = 'ROOMB';
  pg.setGame(g2);
  assert.strictEqual(pg.st.game.phase, 'setup');
  // toPlaying：第 2 局已進入 playing 且輪到我（桌機鈕的 playing 閘擋不住這個變體 —— 只有「快照屬於本局」擋得住）
  if (toPlaying) pg.setGame({ ...g2, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, setupDone: [true, true], pendingSelection: null });
  const kept2 = !!pg.st.undoSnapshot;
  const vis = pg.visible();
  const r = pg.pressUndoAndAgree();
  const shown = pg.st.game.players[0].hand.map(c => c.cardId);
  return { pg, kept1, kept2, vis, ...r, shown, leak: shown.join() === X_HAND.join(), ownHand: shown.join() === g2.players[0].hand.map(c => c.cardId).join() };
}

// ═══════════════════════════════════════════════════════════
console.log('\n【A】主證明（行為端）：第 1 局攻擊終局 → 第 2 局換座位 setup 按 ↶ → 不可以看到上一局對手的手牌');
// ═══════════════════════════════════════════════════════════
T('A1 ⭐⭐⭐ 本版：第 2 局 setup 的 ↶ 不顯示、按了也不會退回上一局、畫面手牌是第 2 局自己的', () => {
  const r = scenario(PAGE);
  ok(r.kept1, '第 1 局攻擊終局後快照應該還在（這是 bug 的前提；不在代表 fixture 沒對上路徑）');
  assert.strictEqual(r.kept2, false, '換局之後快照沒被清（A 接線點沒生效）');
  assert.strictEqual(r.vis, false, '第 2 局 setup 階段手機 ↶ 仍然顯示');
  assert.strictEqual(r.adopted, false, 'game 被換成上一局的快照');
  assert.strictEqual(r.leak, false, '畫面手牌 = 第 1 局對手 X 的手牌（洩漏）：' + JSON.stringify(r.shown));
  ok(r.ownHand, '畫面手牌不是第 2 局自己的：' + JSON.stringify(r.shown));
  // 變體：第 2 局進入 playing 且輪到我 —— 桌機鈕的 playing 閘擋不住，只有「快照屬於本局」擋得住
  const r2 = scenario(PAGE, { toPlaying: true });
  assert.strictEqual(r2.vis, false, '第 2 局 playing 我的回合仍顯示上一局的悔棋鈕');
  assert.strictEqual(r2.leak, false, 'playing 變體洩漏');
});
T('A2 ⭐ 同房再來一局（沒有離房那一步、只有 game.id 變）也一樣清掉', () => {
  const r = scenario(PAGE, { leaveFirst: false });
  assert.strictEqual(r.kept2, false, '同房換局快照沒被清');
  assert.strictEqual(r.leak, false, '同房換局洩漏');
  const r2 = scenario(PAGE, { leaveFirst: false, toPlaying: true });
  assert.strictEqual(r2.vis, false, '同房換局＋playing 我的回合仍顯示上一局的悔棋鈕');
  assert.strictEqual(r2.leak, false, '同房換局 playing 變體洩漏');
});
T('A3 正對照：同一局內的正常悔棋不受影響（快照保留、playing＋我的回合時 ↶ 顯示、同意後真的退回）', () => {
  const pg = makePage(PAGE);
  pg.setGame({ ...game1Fixture(), players: [
    { ...game1Fixture().players[0], active: inst(WILLDUN, { damage: 0 }), bench: [inst(WILLDUN)] },
    game1Fixture().players[1] ] });
  const before = pg.st.game;
  const after = pg.dispatch(ATK);
  assert.notStrictEqual(after.phase, 'game-over', '正對照 fixture 不該終局');
  ok(pg.st.undoSnapshot === before, '同一局的快照被清掉了');
  // 攻擊後回合仍是我的（turnPhase 進 end 或仍 main 都算同一局同回合）
  pg.st.game = { ...pg.st.game, activePlayerIndex: 1, pendingSelection: null }; pg.runEffect();
  assert.strictEqual(pg.visible(), true, '同一局 playing＋我的回合，↶ 應該顯示');
  const r = pg.pressUndoAndAgree();
  ok(r.pressed && r.adopted, '同一局的正常悔棋沒有退回');
  assert.strictEqual(pg.st.game, before);
});
T('A4 HEAD-FAIL：對 BASE(v6.320) 的頁面規則跑同一組 fixture ⇒ 必須看到洩漏（證明抽取器與情境真的抓得到 bug）', () => {
  if (!hasBaseCommit(ROOT, BASE_SHA)) { shallowSkip('【A4】BASE 頁面規則的洩漏重現', '由【G】的突變測試涵蓋同一件事'); return; }
  const b = readBaseBlob(ROOT, BASE_SHA, PAGE_PATH);
  ok(b.ok, '讀不到 BASE 的 +page.svelte');
  const r = scenario(b.out);
  ok(r.kept2 && r.vis && r.adopted && r.leak, 'BASE 上竟然沒有重現洩漏（抽取器或 fixture 壞了）：' + JSON.stringify({ kept2: r.kept2, vis: r.vis, adopted: r.adopted, shown: r.shown }));
});

// ═══════════════════════════════════════════════════════════
console.log('\n【B】A 接線點：單一 $effect、換局／離房都清、同局不清、撤回 pending 請求');
// ═══════════════════════════════════════════════════════════
T('B1 接線點存在且是 $effect（不是散在 leaveOnlineGame／adopt 各處）', () => {
  ok(RX_EFFECT.test(PAGE), '找不到 v6.321 的快照歸屬 $effect');
  ok(RX_OWNED.test(PAGE), '找不到 undoSnapshotOwnedBy');
  const fn = PAGE.match(RX_OWNED)[0];
  ok(/snap\.id === g\.id/.test(fn), '歸屬判定不是比 game.id');
});
T('B2 game=null（離房／回大廳）⇒ 快照與伴隨旗標全清', () => {
  const pg = makePage(PAGE);
  pg.setGame(game1Fixture()); pg.dispatch(ATK);
  pg.st.undoDeniedThisSnapshot = true; pg.st.undoAwaitingResponse = true;
  pg.setGame(null);
  assert.strictEqual(pg.st.undoSnapshot, null);
  assert.strictEqual(pg.st.undoActionDesc, null);
  assert.strictEqual(pg.st.undoDeniedThisSnapshot, false);
  assert.strictEqual(pg.st.undoAwaitingResponse, false);
});
T('B3 換局時若還在等對手回應（pending 請求掛在房間）⇒ best-effort 撤回（clearUndoRequestApi 被叫到一次）', () => {
  const pg = makePage(PAGE);
  pg.setGame(game1Fixture()); pg.dispatch(ATK);
  pg.st.undoAwaitingResponse = true;
  const g2 = M.createGame({ name: 'P', entries: [{ cardId: WILLDUN, count: 1 }] }, { name: 'Y', entries: [{ cardId: WILLDUN, count: 1 }] }, pool, { forceLegacyOpening: true });
  pg.setGame(g2);
  assert.deepStrictEqual(pg.st.cleared, ['ROOMA'], '沒有撤回房間裡的 pending 請求');
  // 正對照：沒在等回應就不打 API
  const pg2 = makePage(PAGE);
  pg2.setGame(game1Fixture()); pg2.dispatch(ATK); pg2.setGame(g2);
  assert.deepStrictEqual(pg2.st.cleared, [], '沒在等回應也去撤回（多打一次 API）');
});
T('B4 正對照：同一局 game 物件被替換（同 id 的新盤面）⇒ 快照保留', () => {
  const pg = makePage(PAGE);
  pg.setGame(game1Fixture()); pg.dispatch(ATK);
  const snap = pg.st.undoSnapshot; ok(snap);
  pg.setGame({ ...pg.st.game, log: [...pg.st.game.log, { t: 'x' }] });
  assert.strictEqual(pg.st.undoSnapshot, snap, '同一局換物件也被清了（會把正常悔棋弄壞）');
});

// ═══════════════════════════════════════════════════════════
console.log('\n【C】B 綁 gameId：請求帶 id、對手 modal 閘（版本 skew：舊 client 沒帶 ⇒ phase 閘）、agreed 條件、收端拒收異局');
// ═══════════════════════════════════════════════════════════
T('C1 performUndo 的 requestUndo 呼叫帶上 game!.id', () => {
  ok(/await requestUndoApi\(roomCode, mySeatIdx, undoActionDesc \?\? '上一手', game!\.id\);/.test(PAGE), 'requestUndoApi 沒帶 game.id');
});
function runRequestUndo(src, gameId) {
  const fnSrc = src.match(/export async function requestUndo\([\s\S]*?\n\}\n/)?.[0];
  ok(fnSrc, '抓不到 room-oracle.ts 的 requestUndo');
  let written = null;
  const oracleTx = async (_code, fn) => { written = fn({ seats: [], other: 1 }); return written; };
  const f = new Function('oracleTx', ts(fnSrc.replace('export async function', 'async function')) + '\nreturn requestUndo;')(oracleTx);
  // async 函式本體在第一個 await 之前是同步執行的：`await oracleTx(...)` 會同步呼叫 stub ⇒ written 立刻有值
  f('abcd', 1, '上一手', gameId);
  ok(written, 'requestUndo 沒有同步呼叫 oracleTx（抽取器對不上）');
  return written;
}
T('C2 room-oracle.ts 的 requestUndo：帶 gameId 就寫進 undoRequest；不帶（舊 client 呼叫形狀）就沒有這個 key（其餘欄位逐字相同）', () => {
  const w1 = runRequestUndo(RO, 'G-2');
  assert.deepStrictEqual(w1.undoRequest, { fromSeatIdx: 1, actionDesc: '上一手', status: 'pending', gameId: 'G-2' });
  assert.strictEqual(w1.other, 1, '其他欄位被洗掉');
  const w0 = runRequestUndo(RO, undefined);
  assert.deepStrictEqual(w0.undoRequest, { fromSeatIdx: 1, actionDesc: '上一手', status: 'pending' });
  ok(!('gameId' in w0.undoRequest), '沒帶 gameId 卻多了 key（Firestore 版會寫 undefined 炸掉）');
});
T('C3 room.ts（Firestore 版）鏡射：型別加 gameId?、requestUndo 有值才放（不寫 undefined）', () => {
  ok(/undoRequest\?: \{\n    fromSeatIdx: number;\n    actionDesc: string;\n    status: 'pending' \| 'agreed' \| 'rejected';\n[\s\S]*?gameId\?: string;\n  \};/.test(RF), 'Room.undoRequest 型別沒有 gameId?');
  ok(/gameId\?: string,[^\n]*\n\): Promise<void> \{\n  const uid = auth\.currentUser\?\.uid;/.test(RF), 'room.ts requestUndo 沒有 gameId 參數');
  ok(/status: 'pending',\n      \.\.\.\(gameId \? \{ gameId \} : \{\}\),/.test(RF), 'room.ts 不是「有值才放」');
});
T('C4 對手端 modal 閘：帶 gameId 必須等於本局；沒帶（舊 client）退回 phase 閘 ⇒ setup 不顯示、playing 顯示', () => {
  const pg = makePage(PAGE);
  const playing = { id: 'G-2', phase: 'playing' }, setup = { id: 'G-2', phase: 'setup' };
  assert.strictEqual(pg.reqGate({ gameId: 'G-2' }, playing), true);
  assert.strictEqual(pg.reqGate({ gameId: 'G-1' }, playing), false, '異局請求在 playing 也不可以顯示');
  assert.strictEqual(pg.reqGate({ gameId: 'G-2' }, setup), false, 'setup 階段不顯示');
  assert.strictEqual(pg.reqGate({}, playing), true, '舊 client（沒 gameId）在 playing 的正常悔棋被擋死了');
  assert.strictEqual(pg.reqGate({}, setup), false, '舊 client 在 setup 的請求不該顯示');
  assert.strictEqual(pg.reqGate({ gameId: 'G-2' }, null), false);
  ok(/&& undoRequestForThisGame\(roomData\.undoRequest, game\)\}/.test(PAGE), 'modal 的 {#if} 沒接上 undoRequestForThisGame');
});
T('C5 agreed $effect 的條件比對本局（undoSnapshotOwnedBy）', () => {
  const R = pageRules(PAGE);
  assert.strictEqual(R.agreed, 'undoSnapshotOwnedBy(undoSnapshot, game)');
});
// 收端：把 handleRoomUpdate 的 apply-undo case 抽出來真的跑（沿用 test-v6265 的抽取視窗）
function applyUndoCase(src) {
  const a = src.indexOf("        case 'apply-undo':\n");
  ok(a > 0, '抓不到 apply-undo case');
  const e = src.indexOf("\n        case ", a + 10);
  const blk = src.slice(a, e > a ? e : undefined);
  const body = blk.replace(/^\s*case 'apply-undo':\n/, '');
  return new Function('game', 'decision', 'room',
    `let lastSeenUndoApplyAt = 0, _unpushedState = {}, _repushAttempts = 3, undoSnapshot = {}, undoActionDesc = 'x', undoAwaitingResponse = true, undoDeniedThisSnapshot = true;
     let floatingEvoMenu = 1, floatingRetreatMenu = 1, selectedEnergyIid = 'e', prizeAnimKey = [0, 0], arrivingIids = new Set([1]), justArrivedIids = new Set([1]);
     const console = { warn() {}, log() {} };
     (() => { ${ts(body)} })();
     return { game, lastSeenUndoApplyAt, _unpushedState, undoSnapshot };`);
}
T('C6 ⭐ 收端 apply-undo：異局 rollback 拒收（盤面不換），同局 rollback 照常套用', () => {
  const f = applyUndoCase(PAGE);
  const local = { id: 'G-2', phase: 'setup' }, foreign = { id: 'G-1', phase: 'playing' }, same = { id: 'G-2', phase: 'playing' };
  const r1 = f(local, { game: foreign }, { lastUndoApplyAt: 777 });
  assert.strictEqual(r1.game, local, '異局 rollback 被吃下去了');
  assert.strictEqual(r1.lastSeenUndoApplyAt, 777, '拒收也要推進一次性標記（否則每次輪詢都重進）');
  const r2 = f(local, { game: same }, { lastUndoApplyAt: 778 });
  assert.strictEqual(r2.game, same, '同局 rollback 沒套用');
  assert.strictEqual(r2._unpushedState, null); assert.strictEqual(r2.undoSnapshot, null);
  const r3 = f(null, { game: same }, { lastUndoApplyAt: 779 });
  assert.strictEqual(r3.game, same, '本地還沒有盤面時（首發）不該擋');
});

// ═══════════════════════════════════════════════════════════
console.log('\n【D】C 手機 ↶ 閘：三種版面讀同一份 undoBtnVisible（playing＋我的回合＋無 pending＋本局快照）');
// ═══════════════════════════════════════════════════════════
T('D1 手機直式 prop 與桌機兩顆鈕都只讀 undoBtnVisible；performUndo 同源早退', () => {
  assert.strictEqual(pageRules(PAGE).prop, 'undoBtnVisible', '手機 undoAvailable 不是讀 undoBtnVisible');
  ok(PAGE.includes("{#if undoBtnVisible && mode !== 'online'}"), '桌機 AI 悔棋鈕沒改讀 undoBtnVisible');
  ok(PAGE.includes("{#if undoBtnVisible && mode === 'online'}"), '桌機線上悔棋鈕沒改讀 undoBtnVisible');
  ok(/async function performUndo\(\) \{\n[\s\S]{0,400}?if \(!undoBtnVisible\) return;/.test(PAGE), 'performUndo 沒有同源早退');
  ok(/\{#if undoAvailable && onUndo && !isSpectator\}/.test(MPB), '手機直式 ↶ 的 {#if} 變了（它應該只讀 prop）');
  const hits = PAGE.match(/\{#if undoSnapshot &&/g) || [];
  assert.strictEqual(hits.length, 0, '桌機還有直接讀 undoSnapshot 的悔棋鈕 {#if}（第二份條件）');
});
function visMatrix(src) {
  const pg = makePage(src);
  const g = game1Fixture();
  const out = {};
  const set = (patch, extra = {}) => { Object.assign(pg.st, { mode: 'online', roomData: { allowUndo: true }, mySeatIdx: 1, aiPlayerIndex: null }, extra); pg.st.game = { ...g, ...patch }; pg.st.undoSnapshot = { ...g, ...patch, id: patch.snapId ?? g.id }; pg.st.undoAwaitingResponse = false; pg.st.undoDeniedThisSnapshot = false; return pg.visible(); };
  out.setup = set({ phase: 'setup', activePlayerIndex: 1 });
  out.playingMine = set({ phase: 'playing', activePlayerIndex: 1 });
  out.playingOpp = set({ phase: 'playing', activePlayerIndex: 0 });
  out.gameOver = set({ phase: 'game-over', activePlayerIndex: 1 });
  out.pending = set({ phase: 'playing', activePlayerIndex: 1, pendingSelection: { type: 'x' } });
  out.otherGame = set({ phase: 'playing', activePlayerIndex: 1, snapId: 'OTHER' });
  out.noAllow = set({ phase: 'playing', activePlayerIndex: 1 }, { roomData: { allowUndo: false } });
  out.spectator = set({ phase: 'playing', activePlayerIndex: 1 }, { mySeatIdx: 2 });
  out.aiPlaying = set({ phase: 'playing', activePlayerIndex: 1 }, { mode: 'local', aiPlayerIndex: 0 });
  out.aiSetup = set({ phase: 'setup', activePlayerIndex: 1 }, { mode: 'local', aiPlayerIndex: 0 });
  out.local2p = set({ phase: 'playing', activePlayerIndex: 1 }, { mode: 'local', aiPlayerIndex: null });
  return out;
}
T('D2 顯示矩陣：setup 不顯示；playing＋我的回合顯示；對手回合／終局／pending／異局快照／未開悔棋／觀戰／本機雙人 不顯示；vs AI playing 顯示', () => {
  const m = visMatrix(PAGE);
  assert.deepStrictEqual(m, { setup: false, playingMine: true, playingOpp: false, gameOver: false, pending: false, otherGame: false,
    noAllow: false, spectator: false, aiPlaying: true, aiSetup: false, local2p: false }, JSON.stringify(m));
});

// ═══════════════════════════════════════════════════════════
console.log('\n【E】D 開局重選戰鬥場（行為端）：準備完成前可換、準備完成後鎖死、互動式開局不受影響、三版面入口');
// ═══════════════════════════════════════════════════════════
function setupFixture() {
  const g = M.createGame({ name: 'P', entries: [{ cardId: WILLDUN, count: 30 }, { cardId: LION, count: 30 }] },
    { name: 'Y', entries: [{ cardId: WILLDUN, count: 1 }] }, pool, { forceLegacyOpening: true });
  assert.strictEqual(g.phase, 'setup');
  return g;
}
T('E1 ⭐ 放了戰鬥場之後，手牌基礎卡有 setup-active-swap；PLACE_ACTIVE 真的換上場、原本那隻回手牌', () => {
  const g = setupFixture();
  const first = g.players[0].hand.find(c => pool.get(c.cardId)?.supertype === 'Pokemon');
  const placed = M.applyAction(g, { type: 'PLACE_ACTIVE', iid: first.iid, senderIdx: 0 }, pool);
  assert.strictEqual(placed.players[0].active?.iid, first.iid);
  const another = placed.players[0].hand.find(c => pool.get(c.cardId)?.supertype === 'Pokemon');
  ok(another, 'fixture 手牌沒有第二張基礎');
  const ops = M.getHandCardOps(placed, 0, pool, { isMyTurn: true, isMySetupTurn: true });
  ok(ops.get(another.iid)?.has('setup-active-swap'), '已有 active 時手牌基礎卡沒有 setup-active-swap：' + JSON.stringify([...(ops.get(another.iid) ?? [])]));
  ok(!ops.get(another.iid)?.has('setup-active'), '已有 active 時不該再給 setup-active（那是空戰鬥場的釋放區）');
  const re = M.applyAction(placed, { type: 'PLACE_ACTIVE', iid: another.iid, senderIdx: 0 }, pool);
  assert.strictEqual(re.players[0].active?.iid, another.iid, 'engine 沒有換上場');
  ok(re.players[0].hand.some(c => c.iid === first.iid), '原本的戰鬥場寶可夢沒有回手牌');
  ok(!re.players[0].hand.some(c => c.iid === another.iid));
  // 非基礎卡（能量／訓練家）不給
  for (const inst of placed.players[0].hand) if (pool.get(inst.cardId)?.supertype !== 'Pokemon') ok(!ops.get(inst.iid)?.has('setup-active-swap'), '非寶可夢卡也拿到 swap');
});
T('E2 ⭐ 按下「準備完成」之後鎖死：中央述詞不給 swap、engine 也拒絕（不可放寬）', () => {
  const g = setupFixture();
  const first = g.players[0].hand.find(c => pool.get(c.cardId)?.supertype === 'Pokemon');
  let s = M.applyAction(g, { type: 'PLACE_ACTIVE', iid: first.iid, senderIdx: 0 }, pool);
  s = M.applyAction(s, { type: 'FINISH_SETUP', senderIdx: 0 }, pool);
  assert.strictEqual(s.setupDone[0], true, 'FINISH_SETUP 沒生效');
  const another = s.players[0].hand.find(c => pool.get(c.cardId)?.supertype === 'Pokemon');
  const ops = M.getHandCardOps(s, 0, pool, { isMyTurn: true, isMySetupTurn: true });
  ok(!ops.get(another.iid)?.has('setup-active-swap'), '準備完成後仍給 swap');
  const re = M.applyAction(s, { type: 'PLACE_ACTIVE', iid: another.iid, senderIdx: 0 }, pool);
  assert.strictEqual(re.players[0].active?.iid, first.iid, 'engine 在 setupDone 之後接受了換戰鬥場（不可放寬）');
  // mulligan 補抽後的備戰開放期（setupDone=true, mulliganPostBenchOpen=true）也不給 swap
  const s2 = { ...s, mulliganPostBenchOpen: [true, false] };
  const ops2 = M.getHandCardOps(s2, 0, pool, { isMyTurn: true, isMySetupTurn: true });
  ok(!ops2.get(another.iid)?.has('setup-active-swap'), 'mulliganPostBenchOpen 期間給了 swap（engine 只開放備戰）');
});
T('E3 空戰鬥場時行為不變：只有 setup-active、沒有 swap；觀戰／非我方 setup 不給', () => {
  const g = setupFixture();
  const first = g.players[0].hand.find(c => pool.get(c.cardId)?.supertype === 'Pokemon');
  const ops = M.getHandCardOps(g, 0, pool, { isMyTurn: true, isMySetupTurn: true });
  ok(ops.get(first.iid)?.has('setup-active') && !ops.get(first.iid)?.has('setup-active-swap'));
  const placed = M.applyAction(g, { type: 'PLACE_ACTIVE', iid: first.iid, senderIdx: 0 }, pool);
  const another = placed.players[0].hand.find(c => pool.get(c.cardId)?.supertype === 'Pokemon');
  const opsSpec = M.getHandCardOps(placed, 0, pool, { isMyTurn: false, isMySetupTurn: false });
  ok(!opsSpec.get(another.iid)?.has('setup-active-swap'), '非我方 setup 也給 swap');
});
T('E4 互動式開局（閃焰王牌流程）尚未雙方定案時 engine 仍擋住 PLACE_ACTIVE（本版沒動 engine）', () => {
  const g = M.createGame({ name: 'P', entries: [{ cardId: WILLDUN, count: 30 }, { cardId: LION, count: 30 }] },
    { name: 'Y', entries: [{ cardId: WILLDUN, count: 1 }] }, pool, {});
  if (!M.isOpeningInProgress(g)) { console.log('    ℹ createGame 預設不是互動式開局（forceLegacyOpening 之外的旗標）—— 用 openingFlow 強制'); }
  const gi = { ...g, openingFlow: 'interactive', openingDone: [false, false], openingFinalized: false };
  ok(M.isOpeningInProgress(gi), 'fixture 不是互動式開局進行中');
  const first = gi.players[0].hand.find(c => pool.get(c.cardId)?.supertype === 'Pokemon');
  const r = M.applyAction(gi, { type: 'PLACE_ACTIVE', iid: first.iid, senderIdx: 0 }, pool);
  assert.strictEqual(r, gi, '互動式開局進行中 PLACE_ACTIVE 竟然生效');
});
T('E5 釋放區對照：swap 的釋放區是「寶可夢」（自己的戰鬥場）；拖到空備戰格仍是 basic-setup', () => {
  assert.strictEqual(M.HAND_OP_DROP_TARGET['setup-active-swap'], 'poke');
  ok(M.HAND_CARD_OPS.includes('setup-active-swap'));
  const ops = new Set(['basic-setup', 'setup-active-swap']);
  assert.strictEqual(M.handOpForDropTarget(ops, 'poke'), 'setup-active-swap');
  assert.strictEqual(M.handOpForDropTarget(ops, 'bench-empty'), 'basic-setup');
  assert.strictEqual(M.handOpForDropTarget(ops, 'active-empty'), null);
});
T('E6 桌機入口：拖曳結算分支核對「是自己的戰鬥場 iid」＋ setup；戰鬥場 drop-zone 亮起；手牌提示', () => {
  ok(PAGE.includes("} else if (op === 'setup-active-swap' && tIid && game?.phase === 'setup' && myPlayer?.active && tIid === myPlayer.active.iid) {\n      // ⭐v6.321"), '拖曳結算分支缺席或條件不對');
  const after = PAGE.slice(PAGE.indexOf("op === 'setup-active-swap' && tIid"), PAGE.indexOf("op === 'setup-active-swap' && tIid") + 400);
  ok(/await dispatch\(GameActions\.placeActive\(d\.iid, myIdx\)\);/.test(after), 'swap 分支沒有 dispatch placeActive');
  ok(PAGE.includes("|| dragOpFor('poke')==='setup-active-swap')}\n            class:drop-hover={dropTargetIid===myPlayer.active.iid}"), '自己的戰鬥場 drop-zone 沒接 swap');
  ok(!PAGE.includes("|| dragOpFor('poke')==='setup-active-swap')}\n              class:drop-hover={dropTargetIid===b.iid}"), '備戰格也亮 swap（釋放在備戰上不會換戰鬥場）');
  ok(/\{@const canSwapActive=ops\.has\('setup-active-swap'\)\}/.test(PAGE), '手牌提示沒有 canSwapActive');
  ok(PAGE.includes('🔁 拖到戰鬥場換上場'), '手牌提示文字缺席');
});
T('E7 手機直式入口：sheet 動作清單問 ops.has(setup-active-swap) → playBasicToActive（同一支 PLACE_ACTIVE）', () => {
  ok(/if \(ops\.has\('setup-active-swap'\)\) \{\n\s*out\.push\(\{ label: '🔁 換上戰鬥場（原本的回手牌）', action: \(\) => playBasicToActive\(iid\) \}\);/.test(MPB), '手機 sheet 沒有 swap 入口');
});

// ═══════════════════════════════════════════════════════════
console.log('\n【F】接線＋守衛鏈');
// ═══════════════════════════════════════════════════════════
T('F1 本守衛在 package.json 的 test chain 裡（不在 chain＝沒有在守）', () => {
  const pkg = readFileSync(join(ROOT, 'package.json'), 'utf8');
  ok(pkg.includes('node scripts/test-v6321-undo-snapshot-cross-game.mjs'), '不在 test chain');
});
T('F2 undoSnapshot 的賦值點枚舉：除了既有的 dispatch／END_TURN／悔棋後清／apply-undo 之外，只多了接線點那一處', () => {
  const lines = PAGE.split('\n').filter(l => /^\s*undoSnapshot\s*=\s*[^=]/.test(l));
  // dispatch 內清＋存、apply-undo 清、performUndo 清、agreed 清、接線點清
  assert.strictEqual(lines.length, 6, '賦值點數量異常：' + lines.length + '\n' + lines.join('\n'));
});

// ═══════════════════════════════════════════════════════════
console.log('\n【G】突變：每一條主張都要能被弄紅（改原始碼字串後重跑同一組判準）');
// ═══════════════════════════════════════════════════════════
const mut = (a, b) => { ok(PAGE.includes(a), '突變錨點不存在：' + a.slice(0, 60)); return PAGE.replace(a, b); };
mustBreak('G1 拿掉接線點 $effect ⇒ A1 紅（快照跨局殘留）', () => {
  const src = PAGE.replace(RX_EFFECT, '');
  const r = scenario(src); assert.strictEqual(r.kept2, false, '換局之後快照沒被清');
});
mustBreak('G2 歸屬判定改成恆真（snap.id === g.id → true）⇒ A1 紅', () => {
  const src = mut('return !!snap && !!g && snap.id === g.id;', 'return !!snap && !!g && true;');
  // 同房再來一局（不經過 game=null）＋ 第 2 局 playing 我的回合：歸屬恆真 ⇒ 快照留著、鈕亮、同意後整包退回上一局
  const r = scenario(src, { leaveFirst: false, toPlaying: true }); assert.strictEqual(r.leak, false, 'playing 變體洩漏');
});
mustBreak('G3 手機 prop 退回舊條件（只看有快照）⇒ D1 紅', () => {
  const src = mut('undoAvailable={undoBtnVisible}', 'undoAvailable={!!undoSnapshot && !undoAwaitingResponse && !undoDeniedThisSnapshot}');
  assert.strictEqual(pageRules(src).prop, 'undoBtnVisible', '手機 undoAvailable 不是讀 undoBtnVisible');
});
mustBreak('G4 undoBtnVisible 拿掉 playing 閘 ⇒ D2 矩陣紅（setup 會亮）', () => {
  const src = mut("game!.phase === 'playing' && !pendingSelection", '!pendingSelection');
  const m = visMatrix(src); assert.strictEqual(m.setup, false, 'setup 亮了');
});
mustBreak('G5 undoBtnVisible 拿掉 isMyTurn() ⇒ D2 矩陣紅（對手回合會亮）', () => {
  const src = mut('mySeatIdx >= 0 && mySeatIdx <= 1 && isMyTurn())', 'mySeatIdx >= 0 && mySeatIdx <= 1)');
  const m = visMatrix(src); assert.strictEqual(m.playingOpp, false, '對手回合亮了');
});
mustBreak('G6 requestUndo 不帶 game.id ⇒ C1 紅', () => {
  const src = mut("undoActionDesc ?? '上一手', game!.id);", "undoActionDesc ?? '上一手');");
  ok(/await requestUndoApi\(roomCode, mySeatIdx, undoActionDesc \?\? '上一手', game!\.id\);/.test(src), 'requestUndoApi 沒帶 game.id');
});
mustBreak('G7 對手 modal 閘改成不比 gameId ⇒ C4 紅', () => {
  const src = mut('return req.gameId ? req.gameId === g.id : true;', 'return true;');
  const pg = makePage(src);
  assert.strictEqual(pg.reqGate({ gameId: 'G-1' }, { id: 'G-2', phase: 'playing' }), false, '異局請求在 playing 也不可以顯示');
});
mustBreak('G8 對手 modal 閘拿掉 phase 閘 ⇒ C4 紅（舊 client 在 setup 的請求會顯示）', () => {
  const src = mut("if (!req || !g || g.phase !== 'playing') return false;", 'if (!req || !g) return false;');
  const pg = makePage(src);
  assert.strictEqual(pg.reqGate({}, { id: 'G-2', phase: 'setup' }), false, '舊 client 在 setup 的請求不該顯示');
});
mustBreak('G9 agreed 條件退回只看有快照 ⇒ C5 紅', () => {
  const src = mut("if (req.status === 'agreed' && undoSnapshotOwnedBy(undoSnapshot, game)) {", "if (req.status === 'agreed' && undoSnapshot) {");
  assert.strictEqual(pageRules(src).agreed, 'undoSnapshotOwnedBy(undoSnapshot, game)');
});
mustBreak('G10 收端拿掉異局拒收 ⇒ C6 紅', () => {
  const src = mut("          if (game && decision.game.id !== game.id) { console.warn('[undo] 拒收異局 rollback', decision.game.id, '!==', game.id); return; }\n", '');
  const f = applyUndoCase(src);
  const local = { id: 'G-2', phase: 'setup' };
  assert.strictEqual(f(local, { game: { id: 'G-1' } }, { lastUndoApplyAt: 1 }).game, local, '異局 rollback 被吃下去了');
});
mustBreak('G11 performUndo 拿掉同源早退 ⇒ D1 紅', () => {
  const src = mut('    if (!undoBtnVisible) return;\n', '');
  ok(/async function performUndo\(\) \{\n[\s\S]{0,400}?if \(!undoBtnVisible\) return;/.test(src), 'performUndo 沒有同源早退');
});
mustBreak('G12 中央述詞 swap 條件改成 setupOpen（準備完成後仍給）⇒ 判準紅（E2 的行為端已由本版證明；突變只驗判準抓得到）', () => {
  const h = HCO.replace("if (isBasicCard && setupFresh && !!me.active) ops.add('setup-active-swap');", "if (isBasicCard && setupOpen && !!me.active) ops.add('setup-active-swap');");
  ok(/if \(isBasicCard && setupFresh && !!me\.active\) ops\.add\('setup-active-swap'\);/.test(h), '中央述詞的 swap 沒有綁 setupFresh（準備完成後會給）');
});
T('G12b 上一條靜態判準對本版是綠的（正對照）', () => {
  ok(/if \(isBasicCard && setupFresh && !!me\.active\) ops\.add\('setup-active-swap'\);/.test(HCO));
});
mustBreak('G13 room-oracle requestUndo 把 gameId 拿掉 ⇒ C2 紅（實跑抽出來的 requestUndo）', () => {
  const r = RO.replace(", ...(gameId ? { gameId } : {}) } as unknown as RoomData['undoRequest']", " } as unknown as RoomData['undoRequest']");
  const w1 = runRequestUndo(r, 'G-2');
  assert.deepStrictEqual(w1.undoRequest, { fromSeatIdx: 1, actionDesc: '上一手', status: 'pending', gameId: 'G-2' });
});

console.log(`\n=== v6.321 悔棋快照跨局殘留＋開局重選戰鬥場：${pass} PASS, ${fail} FAIL ===`);
if (fail > 0) process.exit(1);
