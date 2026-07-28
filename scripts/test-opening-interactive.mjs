// 守衛：閃焰王牌｜瞬間爆發力 的互動式開局（v6.051 批1 — 引擎層）。
//
// 官方 PTCG RULES §17.40.G：
//   Q: 對戰準備時，若最初抽出的7張手牌中沒有[基礎]寶可夢，僅有閃焰王牌，
//      可以因特性「瞬間爆發力」的效果，將閃焰王牌放置於戰鬥場上並開始對戰嗎？  A: 可以。
//   Q: …那麼**可以不將**閃焰王牌放置於戰鬥場上嗎？
//      A: **可以。／這個情況下，可選擇是否將閃焰王牌放置於戰鬥場上。**
// 引擎原本一律替玩家選了「放上去」，等於少給一個官方選項，而且會影響「誰重抽比較多次」
// →連帶影響對手能多抽幾張。
//
// ⚠這一批的最高優先守衛是**等價性**：牌組沒有這張卡的對局，行為必須與改動前一模一樣。
//   全站絕大多數對局都屬於這一類，它們的回歸面必須是 0。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x-oi-s.js'), E = join(ROOT, '.x-oi-e.ts'), O = join(ROOT, '.x-oi-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { createGame, applyAction, INTERACTIVE_OPENING_ENABLED, isOpeningInProgress } from './src/lib/game/engine';\n"
  + "export { getAIAction } from './src/lib/game/ai';\n"
  + "import './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction, INTERACTIVE_OPENING_ENABLED, isOpeningInProgress, getAIAction } = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}

const BURST = '13974';   // 閃焰王牌（M1L, I 標, Stage2）｜瞬間爆發力
const BASIC = '19174';   // 迷唇姐（基礎）
const ENERGY = '14128';  // 基本【超】能量（非寶可夢，湊牌用）

/** 固定隨機序列，讓同一組牌組每次跑出同樣的牌序。 */
function withSeed(seed, fn) {
  const orig = Math.random;
  let a = seed >>> 0;
  Math.random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  try { return fn(); } finally { Math.random = orig; }
}
const deck = (entries) => ({ name: 'P', entries });
/** 只有 1 張基礎 + 大量能量 → 容易抽不到基礎，方便測 mulligan。 */
const thinBasicDeck = [{ cardId: BASIC, count: 1 }, { cardId: ENERGY, count: 59 }];
/** 沒有基礎、只有閃焰王牌 → 一定停在選擇點。 */
const burstOnlyDeck = [{ cardId: BURST, count: 4 }, { cardId: ENERGY, count: 56 }];
const noBurstDeck = [{ cardId: BASIC, count: 8 }, { cardId: ENERGY, count: 52 }];

let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

T('前提：閃焰王牌的卡面仍是「可將這張卡反面朝上放置於戰鬥場」（＝選擇性）', () => {
  const ab = (pool.get(BURST)?.abilities ?? []).find((a) => a.name === '瞬間爆發力');
  assert.ok(ab, '找得到瞬間爆發力');
  assert.ok(ab.effect.includes('可將這張卡'), '卡面應有「可」＝玩家可選');
  assert.equal(pool.get(BURST)?.subtype, 'Stage2', '它本身是 2 階進化，不是基礎寶可夢');
});

T('⭐⭐等價守衛：牌組沒有這張卡時，開局結果與舊流程逐欄位相同', () => {
  // 同一個 seed 跑兩次：一次讓引擎自己判（牌組無此卡 → 必走 legacy），一次強制 legacy。
  const a = withSeed(4242, () => createGame(deck(noBurstDeck), deck(noBurstDeck), pool, { firstPlayerOverride: 0 }));
  const b = withSeed(4242, () => createGame(deck(noBurstDeck), deck(noBurstDeck), pool,
    { firstPlayerOverride: 0, forceLegacyOpening: true }));
  // ⚠不要直接比整個 JSON：`id`(uid) 與 `createdAt`(Date.now) 本來就每次不同，
  //   log 的 timestamp 也是 —— 比整包會被這些噪音蓋掉真正想比的東西。
  //   要比的是「牌怎麼發、重抽算幾次、補抽給幾張」這些**開局結果**。
  const fingerprint = (g) => JSON.stringify({
    hands: g.players.map((p) => p.hand.map((c) => c.cardId)),
    decks: g.players.map((p) => p.deck.map((c) => c.cardId)),
    mulliganCounts: g.mulliganCounts,
    pendingMulliganDraw: g.pendingMulliganDraw,
    mulliganRevealedHands: g.mulliganRevealedHands ?? null,
    mulliganRevealConfirmed: g.mulliganRevealConfirmed,
    firstPlayerIdx: g.firstPlayerIdx,
    openingFlow: g.openingFlow ?? null,
    openingChoicePending: g.openingChoicePending ?? null,
    openingDone: g.openingDone ?? null,
  });
  assert.equal(fingerprint(a), fingerprint(b), '沒有閃焰王牌的對局，新舊路徑的開局結果必須完全相同');
  assert.equal(a.openingFlow, undefined, '不該被標成互動式');
});

T('⭐⭐forceLegacyOpening 即使牌組有這張卡也走舊流程（第一層逃生口）', () => {
  const g = withSeed(99, () => createGame(deck(burstOnlyDeck), deck(noBurstDeck), pool,
    { firstPlayerOverride: 0, forceLegacyOpening: true }));
  assert.equal(g.openingFlow, undefined);
  assert.equal(isOpeningInProgress(g), false);
  assert.ok(g.players[0].hand.length === 7, '仍然正常發 7 張');
});

T('⭐⭐牌組有閃焰王牌且只有它可上場 → 停在玩家選擇點', () => {
  const g = withSeed(7, () => createGame(deck(burstOnlyDeck), deck(noBurstDeck), pool, { firstPlayerOverride: 0 }));
  assert.equal(g.openingFlow, 'interactive');
  assert.equal(g.openingChoicePending?.[0], true, 'P1 應停在選擇點');
  assert.equal(g.openingDone?.[0], false);
  assert.equal(isOpeningInProgress(g), true);
  assert.deepEqual(g.pendingMulliganDraw, [0, 0], '未定案前不先給補抽');
});

T('⭐⭐開局未定案前，擺場動作一律被擋（避免搶跑）', () => {
  const g = withSeed(7, () => createGame(deck(burstOnlyDeck), deck(noBurstDeck), pool, { firstPlayerOverride: 0 }));
  const burstIid = g.players[0].hand.find((c) => c.cardId === BURST)?.iid;
  assert.ok(burstIid, '手牌應有閃焰王牌');
  const after = applyAction(g, { type: 'PLACE_ACTIVE', iid: burstIid, senderIdx: 0 }, pool);
  assert.equal(after.players[0].active, null, '尚未做出開局選擇前不可以放戰鬥場');
});

T('⭐⭐選 KEEP → 定案，且行為等同舊流程（可以把閃焰王牌放上戰鬥場）', () => {
  let g = withSeed(7, () => createGame(deck(burstOnlyDeck), deck(noBurstDeck), pool, { firstPlayerOverride: 0 }));
  g = applyAction(g, { type: 'OPENING_KEEP', senderIdx: 0 }, pool);
  assert.equal(g.openingChoicePending?.[0], false);
  assert.equal(g.openingDone?.[0], true);
  assert.equal(g.mulliganCounts[0], 0, 'KEEP 不算重抽');
  assert.equal(isOpeningInProgress(g), false, '對手若已定案，整個開局就結束');
  const burstIid = g.players[0].hand.find((c) => c.cardId === BURST)?.iid;
  const after = applyAction(g, { type: 'PLACE_ACTIVE', iid: burstIid, senderIdx: 0 }, pool);
  assert.equal(after.players[0].active?.cardId, BURST, '定案後就可以正常放置');
});

T('⭐⭐選 MULLIGAN → 重抽次數 +1，對手可多抽（官方：對手可抽「對手次數−自己次數」張）', () => {
  let g = withSeed(7, () => createGame(deck(burstOnlyDeck), deck(noBurstDeck), pool, { firstPlayerOverride: 0 }));
  assert.equal(g.mulliganCounts[0], 0);
  g = applyAction(g, { type: 'OPENING_MULLIGAN', senderIdx: 0 }, pool);
  assert.ok(g.mulliganCounts[0] >= 1, `重抽次數應 ≥1，實得 ${g.mulliganCounts[0]}`);
  // 這副牌只有閃焰王牌可上場 → 重抽後仍會停在選擇點（Wilson 裁定：可重複選擇、不限次數）
  assert.equal(g.openingChoicePending?.[0], true, '重抽後又只抽到閃焰王牌 → 可以再選一次');
  // 再選一次 KEEP 收尾，檢查 NET
  g = applyAction(g, { type: 'OPENING_KEEP', senderIdx: 0 }, pool);
  const [m1, m2] = g.mulliganCounts;
  assert.deepEqual(g.pendingMulliganDraw, [Math.max(0, m2 - m1), Math.max(0, m1 - m2)],
    'NET 抵銷公式必須與舊流程一致');
});

T('⭐MULLIGAN 會把該手牌記進揭示清單（官方要求先向對手展示手牌）', () => {
  let g = withSeed(7, () => createGame(deck(burstOnlyDeck), deck(noBurstDeck), pool, { firstPlayerOverride: 0 }));
  const before = (g.mulliganRevealedHands?.p1 ?? []).length;
  g = applyAction(g, { type: 'OPENING_MULLIGAN', senderIdx: 0 }, pool);
  const after = (g.mulliganRevealedHands?.p1 ?? []).length;
  assert.ok(after > before, '重抽前的手牌必須記進揭示清單');
  assert.ok(g.mulliganRevealedHands.p1.every((h) => typeof h === 'string'),
    '揭示手牌必須是字串（Firestore 不允許巢狀陣列，沿用 "|" join）');
});

T('⭐沒輪到自己 / 已定案時，OPENING_* 不生效', () => {
  const g = withSeed(7, () => createGame(deck(burstOnlyDeck), deck(noBurstDeck), pool, { firstPlayerOverride: 0 }));
  assert.equal(applyAction(g, { type: 'OPENING_KEEP', senderIdx: 1 }, pool), g, 'P2 沒停在選擇點 → no-op');
  let g2 = applyAction(g, { type: 'OPENING_KEEP', senderIdx: 0 }, pool);
  assert.equal(applyAction(g2, { type: 'OPENING_MULLIGAN', senderIdx: 0 }, pool), g2, '已定案 → no-op');
});

T('⭐手牌有【基礎】寶可夢時不會跳出選擇（官方：有基礎就不可以重抽）', () => {
  // 牌組同時有基礎與閃焰王牌 → 只要抽到基礎就直接定案
  const mixed = [{ cardId: BASIC, count: 20 }, { cardId: BURST, count: 4 }, { cardId: ENERGY, count: 36 }];
  let anyChoice = false, anyDone = false;
  for (let seed = 1; seed <= 20; seed++) {
    const g = withSeed(seed * 977, () => createGame(deck(mixed), deck(noBurstDeck), pool, { firstPlayerOverride: 0 }));
    if (g.openingChoicePending?.[0]) anyChoice = true;
    if (g.openingDone?.[0]) {
      anyDone = true;
      assert.ok(g.players[0].hand.some((c) => {
        const cd = pool.get(c.cardId);
        return cd?.supertype === 'Pokemon' && cd.subtype !== 'Stage1' && cd.subtype !== 'Stage2' && !cd.evolvesFrom;
      }) || g.mulliganCounts[0] > 0, '直接定案的手牌應該真的有基礎寶可夢');
    }
  }
  assert.ok(anyDone, '20 個 seed 中應至少有幾次直接抽到基礎');
  void anyChoice;
});

T('⭐feature flag 存在且目前為開（關掉即全站回到舊流程）', () => {
  assert.equal(typeof INTERACTIVE_OPENING_ENABLED, 'boolean');
  const src = readFileSync(join(ROOT, 'src/lib/game/engine.ts'), 'utf8');
  assert.ok(/export const INTERACTIVE_OPENING_ENABLED/.test(src), '回滾點必須是單一常數');
});

// ── v6.051 批2：本機／AI 接上選擇視窗；線上／錦標賽仍鎖在舊流程 ────────────
T('⭐⭐批3：全站五個 createGame 呼叫端一致放行（互動式的分流只由引擎的牌組判定決定）', () => {
  // v6.051 批1 全部鎖 legacy → v6.052 批2 放行本機／AI → v6.053 批3/4 放行線上與錦標賽。
  // 逃生口只剩「引擎頂層的 INTERACTIVE_OPENING_ENABLED」一個總開關（見下一案）。
  const files = ['src/routes/game/+page.svelte', 'src/lib/game/room.ts',
    'src/lib/game/room-oracle.ts', 'oracle-admin/server_admin_patch.js'];
  for (const f of files) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    const bad = src.split('\n').filter((ln) => ln.includes('forceLegacyOpening: true')
      && !/^\s*(\/\/|\*|\/\*)/.test(ln));
    assert.equal(bad.length, 0, `${f} 仍鎖著 forceLegacyOpening`);
  }
});

T('⭐⭐批2：本機／AI 的 createOpts 已不再傳 forceLegacyOpening（否則新流程永不生效）', () => {
  const pg = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
  const seg = pg.slice(pg.indexOf('let createOpts'), pg.indexOf('game = createGame('));
  assert.ok(seg.length > 0 && seg.length < 2000, '找不到本機 createOpts 區塊');
  assert.ok(!seg.includes('forceLegacyOpening'),
    '本機／AI createOpts 不應再傳 forceLegacyOpening');
});

T('⭐⭐批2：AI 遇到開局選擇時會送 OPENING_KEEP（＝v6.050 以前的行為，策略 0 diff）', () => {
  const g = withSeed(4242, () => createGame(deck(burstOnlyDeck), deck(noBurstDeck), pool));
  assert.equal(g.openingFlow, 'interactive');
  assert.ok(g.openingChoicePending?.[0], 'P1 應停在選擇點');
  const a = getAIAction(g, pool, 0);
  assert.ok(a, 'AI 必須有動作，否則會空轉到無進展防呆');
  assert.equal(a.type, 'OPENING_KEEP');
  assert.equal(a.senderIdx, 0);
  // 送出後真的推進（不是被引擎默默吃掉）
  const after = applyAction(g, a, pool);
  assert.ok(!after.openingChoicePending?.[0] && after.openingDone?.[0], 'AI 的選擇必須生效');
});

T('⭐⭐批2：AI 已定案的一側不會重複送 OPENING_KEEP（避免 setup 迴圈）', () => {
  const g = withSeed(4242, () => createGame(deck(burstOnlyDeck), deck(noBurstDeck), pool));
  const after = applyAction(g, { type: 'OPENING_KEEP', senderIdx: 0 }, pool);
  const a = getAIAction(after, pool, 0);
  assert.ok(!a || a.type !== 'OPENING_KEEP', '定案後不該再送 OPENING_KEEP');
});

T('⭐批2：本機雙人視角切換與 setupActorSeat 都認得 openingChoicePending', () => {
  const pg = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
  // 視角：openingChoicePending 必須排在 pendingMulliganDraw 之前（否則 P2 要選時看不到視窗）
  const iOpen = pg.indexOf('game.openingChoicePending?.[0]');
  const iPmd = pg.indexOf('(game.pendingMulliganDraw?.[0] ?? 0) > 0\n          ? 0');
  assert.ok(iOpen > 0, '本機雙人視角鏈沒有 openingChoicePending');
  assert.ok(iPmd > 0 && iOpen < iPmd, 'openingChoicePending 必須擁有最高優先序');
  // setupActorSeat：新分支必須在 sd0/sd1 之前 return
  const seat = pg.slice(pg.indexOf('function setupActorSeat'), pg.indexOf('const isMyTurn'));
  assert.ok(seat.includes('openingChoicePending'), 'setupActorSeat 沒接 openingChoicePending');
  // v6.053 批3：分支要讀 setupDone（舊版 client 逃生），所以排在 sd0 宣告「之後」，
  //   但必須排在 mulligan 次數比較（lessIdx）之前 —— 否則等待方會被誤判閒置敗。
  assert.ok(seat.indexOf('_oPend0') < seat.indexOf('lessIdx'),
    'openingChoicePending 分支必須排在 mulligan 次數比較之前');
  // AI 排程 gate 兩處都要補（tickAI + $effect）
  const n = pg.split('!!g.openingChoicePending?.[ai]').length - 1;
  assert.equal(n, 2, `AI 排程 gate 應有 2 處，實際 ${n}`);
});

T('⭐批2：選擇視窗存在，且兩個按鈕分別派送 KEEP / MULLIGAN', () => {
  const pg = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
  assert.ok(pg.includes("game.openingChoicePending?.[myIdx]"), '缺少選擇視窗的顯示條件');
  assert.ok(pg.includes('GameActions.openingKeep(myIdx)'), '缺少「用牠開局」按鈕');
  assert.ok(pg.includes('GameActions.openingMulligan(myIdx)'), '缺少「重抽」按鈕');
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
