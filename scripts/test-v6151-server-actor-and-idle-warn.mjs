#!/usr/bin/env node
/**
 * v6.151 守衛：伺服器權威 actorSeat ＋ 判負前 60 秒警告 ＋ 三項對戰收尾
 *
 * 背景（v6.149 事故）：閒置判負是**伺服器**用它自己那份盤面算的，而 client 各自本地推算 ——
 *   只要 client 的版本落後，「誰在倒數」就會反向（玩家看到「對手閒置中」，伺服器其實在倒數他）。
 *   這一版把 actorSeat 變成伺服器權威欄位，並在判負前 60 秒主動推播 + 在房間 log 塞系統訊息
 *   （bump 版本＝順便打醒「還活著但版本卡住」的 client）。
 *
 * 行為端：把 `idleWarn60` 從 patch 抽出來用 `new Function` 跑（注入假的 TROOMS / sendPushToUids），
 *   驗它「推給誰、寫了什麼、有沒有動到 lastActionAt」。靜態端一律附掃描器自我驗證（Rule 25）。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');
const PAGE = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
};

// ── 0. 抽出 IDLE WARN BLOCK + 掃描器自我驗證 ────────────────────────────────
const B0 = '── v6.151 IDLE WARN BLOCK BEGIN ──', B1 = '── v6.151 IDLE WARN BLOCK END ──';
const i0 = SRC.indexOf(B0), i1 = SRC.indexOf(B1);
ok('IDLE WARN BLOCK 標記存在', i0 > 0 && i1 > i0, `i0=${i0} i1=${i1}`);
const BLOCK = (i0 > 0 && i1 > i0) ? SRC.slice(i0 + B0.length, i1) : '';
ok('BLOCK 含 idleWarn60', BLOCK.includes('async function idleWarn60'));
ok('BLOCK 含 maybeIdleWarn60（窗口判斷＋冪等搶占）', BLOCK.includes('async function maybeIdleWarn60'));
ok('BLOCK 長度合理（>600）', BLOCK.length > 600, String(BLOCK.length));
if (!BLOCK) { console.log(`\n${pass} PASS / ${fail} FAIL`); process.exit(1); }

// ── 1. 行為：idleWarn60 推給誰、寫了什麼 ────────────────────────────────────
function mkHarness(gs, opts = {}) {
  const calls = { updates: [], pushes: [], claims: [] };
  const TROOMS = {
    findOne: async () => ({ _id: 'mr_x', gameState: gs, version: 7 }),
    updateOne: async (filter, upd) => { calls.updates.push({ filter, upd }); return { matchedCount: opts.casFails ? 0 : 1, modifiedCount: opts.casFails ? 0 : 1 }; },
  };
  const TMATCH = {
    updateOne: async (filter, upd) => { calls.claims.push({ filter, upd }); return { modifiedCount: opts.claimFails ? 0 : 1 }; },
  };
  const currentActorSeat = (g) => (g && typeof g._actor !== 'undefined') ? g._actor : null;
  const sendPushToUids = (uids, payload) => { calls.pushes.push({ uids, payload }); };
  const api = new Function('TROOMS', 'TMATCH', 'currentActorSeat', 'sendPushToUids',
    BLOCK + '\nreturn { idleWarn60, maybeIdleWarn60 };')(TROOMS, TMATCH, currentActorSeat, sendPushToUids);
  return { fn: api.idleWarn60, maybe: api.maybeIdleWarn60, calls };
}
const MATCH = { _id: 'm1', roomId: 'mr_x', round: 3, p1uid: 'u1', p2uid: 'u2', p1name: '阿一', p2name: '阿二' };
const mkGs = (over = {}) => Object.assign({ phase: 'playing', turn: 5, log: [{ turn: 4, playerIndex: 0, message: '舊訊息' }] }, over);

{
  const h = mkHarness(mkGs({ _actor: 1 }));
  await h.fn(MATCH, 3, 1700000000000);
  ok('只推給「該動作的那一方」', h.calls.pushes.length === 1 && h.calls.pushes[0].uids[0] === 'u2',
    JSON.stringify(h.calls.pushes.map((p) => p.uids)));
  ok('推播內容含對手名與輪次', /第 3 輪/.test(h.calls.pushes[0].payload.body) && /阿一/.test(h.calls.pushes[0].payload.body));
  ok('推播 tag 帶 matchId（同一場不會互相蓋掉別場）', h.calls.pushes[0].payload.tag === 'ptcg-t-idle-m1');
  const upd = h.calls.updates[0];
  ok('有寫回房間（bump 版本＝順便打醒版本卡住的 client）', !!upd && upd.upd.$set.version === 8);
  ok('★**沒有**動到 lastActionAt（動了等於幫掛機方把倒數重置）', !('lastActionAt' in upd.upd.$set));
  const log = upd.upd.$set.gameState.log;
  ok('log 多了一則系統訊息（playerIndex=null）', log.length === 2 && log[1].playerIndex === null);
  ok('系統訊息內容講得出「60 秒」與判負', /60 秒/.test(log[1].message) && /判負/.test(log[1].message));
  ok('系統訊息帶 timestamp（前端動畫游標靠它偵測新事件）', typeof log[1].timestamp === 'number');
  ok('舊 log 沒有被洗掉', log[0].message === '舊訊息');
  ok('警告的是掛機方的名字', /阿二/.test(log[1].message));
}
{
  const h = mkHarness(mkGs({ _actor: -1 }));
  await h.fn(MATCH, 3, 1700000000000);
  ok('actor = -1（雙方都該動作）⇒ 兩邊都推', h.calls.pushes.length === 2);
  ok('actor = -1 的 log 寫「雙方」', /雙方/.test(h.calls.updates[0].upd.$set.gameState.log[1].message));
}
{
  const h = mkHarness(mkGs({ phase: 'game-over', _actor: 1 }));
  await h.fn(MATCH, 3, 1700000000000);
  ok('game-over 不推也不寫（★正對照：這條若失效上面那些斷言就沒有鑑別度）',
    h.calls.pushes.length === 0 && h.calls.updates.length === 0);
}
{
  const h = mkHarness(mkGs({ _actor: null }));
  await h.fn(MATCH, 3, 1700000000000);
  ok('算不出 actor ⇒ 什麼都不做（fail-closed）', h.calls.pushes.length === 0 && h.calls.updates.length === 0);
}
{
  // 讀完整 doc、不能用 projection（v6.119：整包寫回會把 log 永久洗掉）
  ok('idleWarn60 讀房間時沒有帶 projection', !/findOne\(\{ _id: m\.roomId \}, \{ projection/.test(BLOCK));
  ok('★掃描器自我驗證：帶 projection 的樣本會被抓到',
    /findOne\(\{ _id: m\.roomId \}, \{ projection/.test('await TROOMS.findOne({ _id: m.roomId }, { projection: { x: 1 } })'));
}

// ── 1b. 行為：寫回必須 CAS（★這是全檔第一個「非終局」的整包寫回）────────────
{
  const h = mkHarness(mkGs({ _actor: 1 }));
  await h.fn(MATCH, 3, 1700000000000);
  const f = h.calls.updates[0].filter;
  ok('★寫回帶 version CAS（否則會把玩家剛送出的動作整個蓋掉，而且版本號一樣）',
    f && f.version === 7, JSON.stringify(f));
  const hc = mkHarness(mkGs({ _actor: 1 }), { casFails: true });
  await hc.fn(MATCH, 3, 1700000000000);
  ok('★CAS 未命中（對方剛動作過）⇒ 連推播都不發（他根本沒閒置）', hc.calls.pushes.length === 0);
  ok('★正對照：CAS 命中時是會推播的（證明上一條有鑑別度）', h.calls.pushes.length === 1);
}

// ── 2. 行為：maybeIdleWarn60 的窗口與冪等搶占 ──────────────────────────────
const T0 = 1700000000000;     // 「現在」
const IDLE = 3;               // 3 分鐘判負
{
  // 窗口＝(deadline-60s, deadline]。lastAt 選在剛好讓 now 落在窗口內／外。
  const inWindow = T0 - (IDLE * 60000 - 30000);   // 還剩 30 秒 → 窗口內
  const tooEarly = T0 - (IDLE * 60000 - 90000);   // 還剩 90 秒 → 太早
  const tooLate  = T0 - (IDLE * 60000 + 1000);    // 已經過了 deadline → 交給判負本身處理

  const a = mkHarness(mkGs({ _actor: 1 }));
  ok('還剩 90 秒 ⇒ 不警告、也不搶占（不浪費一次 DB 寫入）',
    (await a.maybe(MATCH, IDLE, T0, tooEarly)) === false && a.calls.claims.length === 0);

  const b = mkHarness(mkGs({ _actor: 1 }));
  ok('已過判負門檻 ⇒ 不警告（該判負了，不是警告）',
    (await b.maybe(MATCH, IDLE, T0, tooLate)) === false && b.calls.claims.length === 0);

  const c = mkHarness(mkGs({ _actor: 1 }));
  ok('★剩 30 秒 ⇒ 警告送出', (await c.maybe(MATCH, IDLE, T0, inWindow)) === true && c.calls.pushes.length === 1);
  const cf = c.calls.claims[0].filter;
  ok('搶占是 per-match 的', cf._id === 'm1');
  ok('搶占判準是「idleWarnAt 比這一輪的 lastActionAt 舊」而不是「存在與否」',
    Array.isArray(cf.$or) && cf.$or.some((o) => o.idleWarnAt && o.idleWarnAt.$lt === inWindow));
  ok('搶占會寫入 idleWarnAt', c.calls.claims[0].upd.$set.idleWarnAt === T0);

  const d = mkHarness(mkGs({ _actor: 1 }), { claimFails: true });
  ok('★搶占失敗（另一個 tick 已經推過）⇒ 不重複推播',
    (await d.maybe(MATCH, IDLE, T0, inWindow)) === false && d.calls.pushes.length === 0);

  // idleWarn60 內部炸掉不可以讓整個 scheduler 掛掉
  const e = mkHarness(null);   // gs = null ⇒ findOne 回的 gameState 是 null
  ok('房間盤面讀不到時安全早退（不丟例外）',
    (await e.maybe(MATCH, IDLE, T0, inWindow)) === true && e.calls.pushes.length === 0);
}

// ── 2b. 靜態：呼叫點的位置與 v6.119 降載 ──────────────────────────────────
{
  const i = SRC.indexOf('const idleMin = (ev.idleForfeitMin > 0 ? ev.idleForfeitMin : 3);');
  const j = SRC.indexOf('// v0.44 對局時限');
  ok('閒置判負區段可定位', i > 0 && j > i);
  const seg = SRC.slice(i, j);
  ok('有呼叫 maybeIdleWarn60', /await maybeIdleWarn60\(m, idleMin, now, _lastLight\)/.test(seg));
  // ⚠ 位置斷言：警告必須在「還沒到判負門檻就 continue」**之前**，否則永遠走不到
  const iWarn = seg.indexOf('maybeIdleWarn60(m, idleMin, now, _lastLight)');
  const iCont = seg.indexOf('if (now <= _lastLight + idleMin * 60000) continue;');
  ok('★警告寫在早退之前（寫在之後＝永遠不會執行的死碼）', iWarn > -1 && iCont > -1 && iWarn < iCont,
    `iWarn=${iWarn} iCont=${iCont}`);
  ok('v6.119 的輕量讀降載沒有被破壞（仍先只讀 lastActionAt/updatedAt）',
    /projection: \{ lastActionAt: 1, updatedAt: 1 \}/.test(seg));
  ok('v6.119 守衛比對的早退字面沒有被改動（它用「輕量讀後 600 字元」的窗口掃）',
    seg.indexOf('if (now <= _lastLight + idleMin * 60000) continue;') - seg.indexOf('projection: { lastActionAt: 1, updatedAt: 1 }') < 600);
}

// ── 3. 靜態：伺服器權威 actorSeat 的產生與回傳 ─────────────────────────────
{
  ok('/action 寫盤面時一併存 actorSeat', /lastActionAt: Date\.now\(\), actorSeat: currentActorSeat\(newGs\)/.test(SRC));
  ok('/state 的 unchanged 精簡回應回傳存下來的 actorSeat',
    /if \(typeof light\.actorSeat === 'number'\) _un\.actorSeat = light\.actorSeat;/.test(SRC));
  // ⚠ 欄位缺席時**必須省略這個鍵**（不能回 null）：client 只把 undefined 當「伺服器沒講」，
  //   null 會被當成權威的「無人該動作」⇒ 掛機中的房（永遠不會有 /action 補寫欄位）倒數整條消失。
  ok('★unchanged 分支不會把「欄位缺席」壓成 null', !/unchanged: true[\s\S]{0,300}actorSeat: [^;]*: null/.test(SRC));
  ok('/action 回應也帶 actorSeat（省掉一個輪詢週期的落差）',
    /version: nv, actorSeat: currentActorSeat\(newGs\)/.test(SRC));
  ok('/state 完整回應用同一支 currentActorSeat 現算',
    /const _actorSeat = doc\.gameState \? currentActorSeat\(doc\.gameState\) : null;/.test(SRC)
    && /actorSeat: _actorSeat/.test(SRC));
  ok('建局（match/enter）寫入初始 actorSeat', /\$setOnInsert: \{[^}]*actorSeat: currentActorSeat\(gs\)/.test(SRC));
  ok('admin 重建房也寫入初始 actorSeat',
    (SRC.match(/actorSeat: currentActorSeat\(gs\)/g) || []).length >= 2);
  // 一致性：兩邊必須是同一支函式，不能各寫一份（會漂移）
  ok('全檔只有一份 currentActorSeat 定義', (SRC.match(/function currentActorSeat\(/g) || []).length === 1);
}

// ── 4. 前端：閒置倒數改讀伺服器權威 ────────────────────────────────────────
{
  ok('有 tServerActorSeat 狀態', PAGE.includes('let tServerActorSeat = $state<number | null | undefined>(undefined);'));
  ok('三個回應讀取點都接上（主輪詢 / 強制同步 / 進場）',
    (PAGE.match(/tServerActorSeat = \(typeof \w+\.actorSeat === 'number' \? \w+\.actorSeat : null\)/g) || []).length === 3);
  ok('⭐旗標有被消費：閒置倒數方向改讀伺服器（新增狀態必問「誰在用它」）',
    PAGE.includes("const actor = (tServerActorSeat !== undefined) ? tServerActorSeat : tCurrentActorSeat(game);"));
  ok('保留本地推算當 fallback（舊伺服器不回這個欄位）', PAGE.includes('tCurrentActorSeat(game);'));
  ok('★掃描器自我驗證：舊寫法樣本會被判為未修',
    !'    const actor = tCurrentActorSeat(game);'.includes('tServerActorSeat !== undefined'));
}

// ── 5. 前端：新鮮度看門狗放寬 + stale-version 指紋 ─────────────────────────
{
  ok('playing 的保險放寬到 20 秒', PAGE.includes("(game && game.phase === 'setup') ? 3500 : 20000;"));
  ok('setup 維持 3.5 秒（事故最密集的區段不放寬）', PAGE.includes('? 3500 :'));
  ok('★舊的 8 秒門檻已不存在', !PAGE.includes("? 3500 : 8000"));
  ok('新增 stale-version 診斷指紋', PAGE.includes("_tSendClientDiag('stale-version')"));
  ok('指紋判準是「連續觸發且版本沒前進」',
    /_freshWatchdogFires >= 3 && game && game\.phase === 'playing' && tVersion === _freshWatchdogVersionAt/.test(PAGE));
  ok('看門狗第一次觸發會記下當時版本（否則判準永遠成立或永遠不成立）',
    PAGE.includes('if (_freshWatchdogFires === 1) _freshWatchdogVersionAt = tVersion;'));
}

// ── 6. 前端：visibilitychange ──────────────────────────────────────────────
{
  ok('有註冊 visibilitychange', PAGE.includes("document.addEventListener('visibilitychange', onVis)"));
  ok('⭐有解除註冊（onMount 回傳 cleanup，否則換頁會殘留 listener）',
    PAGE.includes("document.removeEventListener('visibilitychange', onVis)"));
  ok('回前景會強制同步 + 重啟輪詢', /void tForceResync\(\);\s*\n\s*startTournamentPoll\(\);/.test(PAGE));
  ok('回前景會先把時鐘拉回現在', PAGE.includes('tNow = Date.now() + tClockOffset;   // 先把時鐘拉回現在'));
  ok('回前景後短暫抑制倒數提示（避免用背景期間的舊時鐘算出「剩 0 秒」）',
    PAGE.includes('if (_tForegroundAt > 0 && tNow - _tForegroundAt < 3000) return null;'));
  // ⚠ 兩個運算元必須同一個時鐘域：tNow 是伺服器域，_tForegroundAt 若寫 Date.now()（本機域），
  //   兩者差值就等於 tClockOffset ⇒ 裝置時鐘慢 3 秒以上抑制永遠不生效、快 30 秒抑制長達 33 秒。
  ok('★_tForegroundAt 與 tNow 同時鐘域', PAGE.includes('_tForegroundAt = tNow;'));
  ok('★掃描器自我驗證：本機時鐘域的舊寫法會被判為未修', !'      _tForegroundAt = Date.now();'.includes('_tForegroundAt = tNow;'));
  ok('觀戰/非對戰狀態不會亂觸發強制同步',
    PAGE.includes("if (!isTournament || isTournSpectator || !tActiveRoom || tStep !== 'playing') return;"));
}

// ── 7. 前端：RTT 量測 ──────────────────────────────────────────────────────
{
  ok('動作往返有量測', PAGE.includes('_tRecordRtt(Date.now() - _rttT0);'));
  ok('離場會清掉跨場次殘留（actorSeat / RTT 樣本）',
    PAGE.includes('tServerActorSeat = undefined; _rttSamples = []; _rttDiagSent = false;'));
  ok('診斷 payload 帶 rtt 統計', PAGE.includes('rtt: _rttStats(),'));
  ok('取樣有上限（不會無限長大）', PAGE.includes('if (_rttSamples.length > 30) _rttSamples.shift();'));
  ok('樣本太少不回報（避免第一發就誤判）', PAGE.includes('_rttSamples.length < 10'));
  ok('只回報一次（診斷不能變成常態上報）', PAGE.includes('_rttDiagSent = true;'));
  ok('門檻是 p95 ≥ 3 秒', PAGE.includes('st.p95 >= 3000'));
  ok('★逾時的那一發不計入（12 秒會扭曲統計）', !/catch[\s\S]{0,200}_tRecordRtt/.test(PAGE));
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
