#!/usr/bin/env node
/**
 * 回歸測試網：線上同步推/收兩端的防舊/合併決策（src/lib/game/sync-guards.ts）。
 *
 * 背景：收端 merge/guard 原 inline 在 +page.svelte handleRoomUpdate，多版本手修堆疊
 *   （v3.34/v3.39/v3.42/v4.494/v4.499/v5.339/v5.346/v5.364/v5.366/v5.390/v5.400…），
 *   無自動化測試 → 「補一個破一個」風險高。本網把每條規則的決策路由與合併數學固化。
 *   新增/修改同步規則時，請在對應區塊加一條。
 *
 * Run: node scripts/test-online-sync-guards.mjs   (exit 0=全過 / 1=有 FAIL)
 */
import { build } from 'esbuild';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENTRY = join(ROOT, '.tmp-sync-entry.ts');
const OUT = join(ROOT, '.tmp-sync-bundle.mjs');
const SHIM = join(ROOT, '.tmp-sync-shim.mjs');
process.on('exit', () => { for (const p of [ENTRY, OUT, SHIM]) { try { unlinkSync(p); } catch {} } });
writeFileSync(SHIM, 'export const base="";export const assets="";');
writeFileSync(ENTRY, `export { shouldSkipStalePush, resolveRoomUpdate, mergeSetupMonotonic, mergePrizeMonotonic } from './src/lib/game/sync-guards';`);
await build({
  entryPoints: [ENTRY], outfile: OUT, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': SHIM }, logLevel: 'error',
});
const { shouldSkipStalePush, resolveRoomUpdate, mergeSetupMonotonic, mergePrizeMonotonic } =
  await import(pathToFileURL(OUT).href);

// ── 最小 GameState fixture（只填 resolveRoomUpdate 讀到的欄位）──
let gid = 0;
function mkGS(o = {}) {
  return {
    id: o.id ?? 'G1',
    createdAt: o.createdAt,
    phase: o.phase ?? 'playing',
    log: Array.from({ length: o.logLen ?? 5 }, (_, i) => ({ msg: 'l' + i })),
    setupDone: o.setupDone ?? [false, false],
    mulliganRevealConfirmed: o.mrc ?? [false, false],
    pendingMulliganDraw: o.pmd ?? [0, 0],
    mulliganPostBenchOpen: o.mpbo ?? [false, false],
    pendingPrizes: o.pendingPrizes ?? [0, 0],
    firstPlayerIdx: 0,
    players: o.players ?? [
      { name: 'P0', prizes: Array.from({ length: o.p0prizes ?? 6 }, () => ({})), deck: [] },
      { name: 'P1', prizes: Array.from({ length: o.p1prizes ?? 6 }, () => ({})), deck: [] },
    ],
  };
}
const ctx = (o = {}) => ({ myPlayerIndex: o.me ?? 0, roomLastUndoApplyAt: o.room ?? 0, lastSeenUndoApplyAt: o.seen ?? 0 });

let pass = 0; const fails = [];
const ck = (n, ok, d = '') => { ok ? pass++ : fails.push(`${n}${d ? ' — ' + d : ''}`); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ════ A. push 端防舊 shouldSkipStalePush ════
ck('push: playing 較舊 log → skip',
   shouldSkipStalePush(mkGS({ logLen: 3 }), mkGS({ logLen: 5 })) === true);
ck('push: playing 等長 → 不 skip',
   shouldSkipStalePush(mkGS({ logLen: 5 }), mkGS({ logLen: 5 })) === false);
ck('push: playing 較新 → 不 skip',
   shouldSkipStalePush(mkGS({ logLen: 7 }), mkGS({ logLen: 5 })) === false);
ck('push: current 為 null → 不 skip',
   shouldSkipStalePush(mkGS({ logLen: 3 }), null) === false);
ck('push: 非 playing → 不 skip',
   shouldSkipStalePush(mkGS({ logLen: 3, phase: 'setup' }), mkGS({ logLen: 5, phase: 'setup' })) === false);

// ════ A2. 跨局防舊（v5.457 再來一局後舊局殘留覆蓋新局）════
ck('push: 跨局-舊局(log長,createdAt早)蓋新局(log短,createdAt晚) → skip',
   shouldSkipStalePush(mkGS({ id: 'OLD', createdAt: 100, logLen: 153 }), mkGS({ id: 'NEW', createdAt: 200, logLen: 5 })) === true);
ck('push: 跨局-新局(createdAt晚)蓋舊局(createdAt早) → 不 skip',
   shouldSkipStalePush(mkGS({ id: 'NEW', createdAt: 200, logLen: 5 }), mkGS({ id: 'OLD', createdAt: 100, logLen: 153 })) === false);
ck('push: 跨局-兩局皆無 createdAt(舊版相容) → 回退長度比較(較長不 skip)',
   shouldSkipStalePush(mkGS({ id: 'OLD', logLen: 153 }), mkGS({ id: 'NEW', logLen: 5 })) === false);

// ════ A3. game-over 終態保護（v5.465 獲勝瞬間被輸方補位 push 覆蓋→卡住）════
ck('push: 房間 game-over，輸方補位 playing(log較長) → skip(不蓋勝利)',
   shouldSkipStalePush(mkGS({ phase: 'playing', logLen: 9 }), mkGS({ phase: 'game-over', logLen: 5 })) === true);
ck('push: 房間 playing，勝方寫 game-over → 不 skip(允許寫入勝利)',
   shouldSkipStalePush(mkGS({ phase: 'game-over', logLen: 5 }), mkGS({ phase: 'playing', logLen: 9 })) === false);
ck('push: 房間 game-over，再寫 game-over → 不 skip(允許更新終態)',
   shouldSkipStalePush(mkGS({ phase: 'game-over', logLen: 6 }), mkGS({ phase: 'game-over', logLen: 5 })) === false);
ck('push: 跨局 game-over→新局 playing(createdAt晚) → 不 skip(再來一局放行)',
   shouldSkipStalePush(mkGS({ id: 'NEW', createdAt: 200, phase: 'playing', logLen: 3 }), mkGS({ id: 'OLD', createdAt: 100, phase: 'game-over', logLen: 9 })) === false);
ck('收端: 本地 playing 收到 game-over → adopt(輸方收到勝利畫面)',
   resolveRoomUpdate(mkGS({ phase: 'playing', logLen: 9 }), mkGS({ phase: 'game-over', logLen: 5 }), ctx()).kind === 'adopt');
ck('收: 跨局-本地新局收到殘留舊局(game-over,createdAt早) → reject stale-old-game',
   resolveRoomUpdate(mkGS({ id: 'NEW', createdAt: 200, phase: 'playing', logLen: 5 }),
                     mkGS({ id: 'OLD', createdAt: 100, phase: 'game-over', logLen: 163 }), ctx()).reason === 'stale-old-game');
ck('收: 跨局-本地舊局收到新局(createdAt晚) → adopt',
   resolveRoomUpdate(mkGS({ id: 'OLD', createdAt: 100, phase: 'game-over', logLen: 163 }),
                     mkGS({ id: 'NEW', createdAt: 200, phase: 'setup', logLen: 1 }), ctx()).kind === 'adopt');
ck('收: 跨局-兩局皆無 createdAt(舊版相容) → adopt(原行為)',
   resolveRoomUpdate(mkGS({ id: 'OLD', logLen: 5 }), mkGS({ id: 'NEW', logLen: 6 }), ctx()).kind === 'adopt');
// v5.492 開局/再來一局 race 修法依賴：輸掉 startGame transaction 的一端保持 game=null，
//   待 canonical 局 push 進來 adopt（不在 phantom 局抽牌/設置→不會被回復重洗）。
ck('收: 輸方清局(local=null)收到 canonical setup 局 → adopt（v5.492 開局race修依賴）',
   resolveRoomUpdate(null, mkGS({ id: 'CANON', createdAt: 200, phase: 'setup', logLen: 1 }), ctx()).kind === 'adopt');

// ════ B. 收端 resolveRoomUpdate 決策路由 ════
ck('收: 無 incoming → ignore',
   resolveRoomUpdate(mkGS(), null, ctx()).kind === 'ignore');
ck('收: 不同 game.id → adopt（createGame race）',
   resolveRoomUpdate(mkGS({ id: 'A' }), mkGS({ id: 'B' }), ctx()).kind === 'adopt');
ck('收: 悔棋 marker 遞增 → apply-undo（即使 log 較短）',
   resolveRoomUpdate(mkGS({ logLen: 10 }), mkGS({ logLen: 3 }), ctx({ room: 100, seen: 0 })).kind === 'apply-undo');
ck('收: marker 未遞增 + log 較短 → reject stale',
   resolveRoomUpdate(mkGS({ logLen: 10 }), mkGS({ logLen: 3 }), ctx({ room: 50, seen: 50 })).kind === 'reject');
ck('收: playing 較短 log → reject stale',
   resolveRoomUpdate(mkGS({ logLen: 10 }), mkGS({ logLen: 3 }), ctx()).kind === 'reject');
ck('收: playing 等長 → 不擋（adopt）',
   resolveRoomUpdate(mkGS({ logLen: 5 }), mkGS({ logLen: 5 }), ctx()).kind === 'adopt');
ck('收: game-over 終態 + incoming playing → reject',
   resolveRoomUpdate(mkGS({ phase: 'game-over' }), mkGS({ phase: 'playing' }), ctx()).kind === 'reject');
ck('收: game-over + incoming game-over → adopt',
   resolveRoomUpdate(mkGS({ phase: 'game-over' }), mkGS({ phase: 'game-over' }), ctx()).kind === 'adopt');
ck('收: playing + incoming setup → reject phase 倒退',
   resolveRoomUpdate(mkGS({ phase: 'playing' }), mkGS({ phase: 'setup' }), ctx()).kind === 'reject');
ck('收: 一般較新 → adopt',
   resolveRoomUpdate(mkGS({ logLen: 5 }), mkGS({ logLen: 8 }), ctx()).kind === 'adopt');

// reject reason 正確性
ck('收: reject reason=stale-snapshot',
   resolveRoomUpdate(mkGS({ logLen: 10 }), mkGS({ logLen: 3 }), ctx()).reason === 'stale-snapshot');
ck('收: reject reason=game-over-terminal',
   resolveRoomUpdate(mkGS({ phase: 'game-over' }), mkGS({ phase: 'playing' }), ctx()).reason === 'game-over-terminal');
ck('收: reject reason=phase-rollback',
   resolveRoomUpdate(mkGS({ phase: 'playing' }), mkGS({ phase: 'setup' }), ctx()).reason === 'phase-rollback');

// ════ C. setup 單調 merge（OR / MIN / 對手側防回退）════
{
  // 本地對手已 setupDone=true，incoming 對手 setupDone=false（stale）→ 保留本地對手 + OR
  const local = mkGS({ phase: 'setup', setupDone: [true, true], mrc: [true, true], pmd: [0, 0],
    players: [{ name: 'P0', prizes: [], deck: [] }, { name: 'P1-LOCAL', prizes: [], deck: [] }] });
  const inc = mkGS({ phase: 'setup', setupDone: [true, false], mrc: [true, false], pmd: [0, 2],
    players: [{ name: 'P0', prizes: [], deck: [] }, { name: 'P1-INC', prizes: [], deck: [] }] });
  const m = mergeSetupMonotonic(local, inc, 0);
  ck('merge-setup: setupDone OR → [T,T]', eq(m.setupDone, [true, true]), JSON.stringify(m.setupDone));
  ck('merge-setup: mulliganRevealConfirmed OR → [T,T]', eq(m.mulliganRevealConfirmed, [true, true]));
  ck('merge-setup: pendingMulliganDraw MIN → [0,0]', eq(m.pendingMulliganDraw, [0, 0]), JSON.stringify(m.pendingMulliganDraw));
  ck('merge-setup: 自己側保留本地 players[0]', m.players[0].name === 'P0');
  ck('merge-setup: 對手側 stale setupDone=false → 保留本地對手', m.players[1].name === 'P1-LOCAL');
}
{
  // resolveRoomUpdate 走 merge-setup 分支（未完成 → 不 advance）
  const local = mkGS({ phase: 'setup', setupDone: [true, false] });
  const inc = mkGS({ phase: 'setup', setupDone: [false, false] });
  const d = resolveRoomUpdate(local, inc, ctx({ me: 0 }));
  ck('收: setup×setup → merge-setup', d.kind === 'merge-setup' && d.advanced === false);
}

// ════ D. 獎賞單調保護（v5.364/366）════
{
  // 我方(me=0)獎賞本地剩 3，incoming 變回 5（回朔）→ 保護：保留本地我方半 + pendingPrizes[me]
  const local = mkGS({ phase: 'playing', logLen: 5, pendingPrizes: [0, 1],
    players: [{ name: 'P0', prizes: [{}, {}, {}], deck: [] }, { name: 'P1', prizes: [{}, {}], deck: [] }] });
  const inc = mkGS({ phase: 'playing', logLen: 5, pendingPrizes: [1, 0],
    players: [{ name: 'P0', prizes: [{}, {}, {}, {}, {}], deck: [] }, { name: 'P1-NEW', prizes: [{}], deck: [] }] });
  const d = resolveRoomUpdate(local, inc, ctx({ me: 0 }));
  ck('收: 我方獎賞被回朔(3→5) → merge-prize', d.kind === 'merge-prize', d.kind);
  ck('merge-prize: 保留本地我方 players[0](3 張)', d.game && d.game.players[0].prizes.length === 3);
  ck('merge-prize: 對手側採 incoming(P1-NEW)', d.game && d.game.players[1].name === 'P1-NEW');
  ck('merge-prize: pendingPrizes[me] 保留本地(0)', d.game && d.game.pendingPrizes[0] === 0, JSON.stringify(d.game?.pendingPrizes));
}
{
  // 我方獎賞沒變多(等長) → 不保護 → adopt
  const local = mkGS({ phase: 'playing', logLen: 5, players: [{ name: 'P0', prizes: [{}, {}], deck: [] }, { name: 'P1', prizes: [{}, {}], deck: [] }] });
  const inc = mkGS({ phase: 'playing', logLen: 6, players: [{ name: 'P0', prizes: [{}, {}], deck: [] }, { name: 'P1', prizes: [{}], deck: [] }] });
  ck('收: 我方獎賞未回朔 → adopt（非 merge-prize）', resolveRoomUpdate(local, inc, ctx({ me: 0 })).kind === 'adopt');
}

// ════ B3. 取獎賞窗口 per-player 單調合併（v5.459 咒詛炸彈雙KO卡住）════
{
  // P0 端：我方取獎賞+補位(pp[0,1],log9) 收到 對手只取獎賞(pp[1,0],log8,較短) → 不可 reject，要 merge 收斂
  const local = mkGS({ id:'G', phase:'playing', logLen:9, pendingPrizes:[0,1],
    players:[{name:'P0',prizes:[{},{},{},{},{}],deck:[]},{name:'P1',prizes:[{},{},{},{},{},{}],deck:[]}] });
  const inc = mkGS({ id:'G', phase:'playing', logLen:8, pendingPrizes:[1,0],
    players:[{name:'P0',prizes:[{},{},{},{},{},{}],deck:[]},{name:'P1',prizes:[{},{},{},{},{}],deck:[]}] });
  const d = resolveRoomUpdate(local, inc, ctx({ me:0 }));
  ck('收: 取獎賞窗口-對手取獎賞(log較短) → merge-prize(不 reject)', d.kind==='merge-prize', d.kind);
  ck('  取獎賞窗口 → pendingPrizes 收斂 [0,0]', d.game && d.game.pendingPrizes[0]===0 && d.game.pendingPrizes[1]===0, JSON.stringify(d.game?.pendingPrizes));
  ck('  取獎賞窗口 → 保留我方已取獎賞(P0 5張)', d.game && d.game.players[0].prizes.length===5);
  ck('  取獎賞窗口 → 併入對手取獎賞(P1 5張)', d.game && d.game.players[1].prizes.length===5);
}
{
  // 對手未前進(較短log、對手側無變化) → 不誤合併 → 維持原 stale-reject
  const local = mkGS({ id:'G', phase:'playing', logLen:9, pendingPrizes:[0,1],
    players:[{name:'P0',prizes:[{},{},{},{},{}],deck:[]},{name:'P1',prizes:[{},{},{},{},{},{}],deck:[]}] });
  const inc = mkGS({ id:'G', phase:'playing', logLen:8, pendingPrizes:[0,1],
    players:[{name:'P0',prizes:[{},{},{},{},{}],deck:[]},{name:'P1',prizes:[{},{},{},{},{},{}],deck:[]}] });
  ck('收: 取獎賞窗口-對手未前進(較短log) → 不誤合併(維持 reject)', resolveRoomUpdate(local, inc, ctx({ me:0 })).kind==='reject');
}
{
  // 無取獎賞窗口(pendingPrizes全0) → 不觸發窗口合併 → 照常 adopt
  const local = mkGS({ id:'G', phase:'playing', logLen:5, pendingPrizes:[0,0] });
  const inc = mkGS({ id:'G', phase:'playing', logLen:6, pendingPrizes:[0,0] });
  ck('收: 無取獎賞窗口 → 不觸發窗口合併(adopt)', resolveRoomUpdate(local, inc, ctx({ me:0 })).kind==='adopt');
}

console.log(`\n線上同步守衛測試網：PASS ${pass} / FAIL ${fails.length}`);
for (const f of fails) console.log('  ❌', f);
if (fails.length > 0) { console.log('\n有同步決策回歸！'); process.exit(1); }
console.log('全部通過 ✅');
