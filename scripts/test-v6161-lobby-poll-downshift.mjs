// v6.161 守衛：「沒有在對戰的人」大廳輪詢降頻
//   跑法：node scripts/test-v6161-lobby-poll-downshift.mjs
//
// ⚠⚠ 這支刻意**不是**只驗字串存在。本專案反覆踩的坑是「斷言有呼叫某函式 ≠ 那件事發生了」，
//   所以這裡把三段**實際會被打包出去的原始碼**（tLobbyResume / tPollDesiredMs / 大廳
//   setInterval 的回呼）從 .svelte 切出來，用 esbuild 剝掉 TS 型別後**真的跑起來**：
//   驗 tPollDesiredMs 的回傳值，並且跑 30 個 base tick **數實際送出了幾發請求**。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import assert from 'node:assert/strict';
import { transformSync } from 'esbuild';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');

let pass = 0; const fails = [];
const T = (name, fn) => { try { fn(); pass++; } catch (e) { fails.push(name + ' — ' + (e && e.message)); } };

// ── 切片（錨點鎖語義，不鎖排版）─────────────────────────────────────
function slice(from, to, startAt = 0) {
  const i = SRC.indexOf(from, startAt);
  assert.ok(i >= 0, '找不到錨點：' + from);
  const j = SRC.indexOf(to, i + from.length);
  assert.ok(j > i, '找不到結束錨點：' + to);
  return SRC.slice(i, j);
}
let FN_DESIRED = '', FN_RESUME = '', CB = '', _cbStart = -1;
let SLICE_OK = true, SLICE_ERR = '';
try {
  FN_DESIRED = slice('  function tPollDesiredMs(', '\n  function startTournamentPoll()');
  FN_RESUME = slice('  function tLobbyResume() {', '\n  }\n') + '\n  }\n';
  _cbStart = SRC.indexOf('tEventPollTimer = setInterval(');
  assert.ok(_cbStart > 0, '找不到大廳輪詢 setInterval');
  const _cbEnd = SRC.indexOf('}, 3000);', _cbStart);
  assert.ok(_cbEnd > _cbStart, '大廳輪詢的 base tick 不再是 3000ms（守衛錨點需同步更新）');
  CB = SRC.slice(_cbStart + 'tEventPollTimer = setInterval('.length, _cbEnd + 1);
} catch (e) { SLICE_OK = false; SLICE_ERR = (e && e.message) || String(e); }

const ts = (s) => transformSync(s, { loader: 'ts' }).code;

// ── 整合式 harness：真正的 tLobbyResume + tPollDesiredMs + 大廳 tick 回呼，接在一起跑 ──
function makeLobby(now0) {
  const st = { now: now0, ev: 0, chat: 0, br: 0, eventOk: true };   // eventOk=false ⇒ 模擬 /event 一直失敗
  const body = `
    var Date = { now: function () { return st.now; } };
    var _tLobbyResumeAt = 0;
    var _tLobbyEventAt = st.now, _tLobbyChatAt = st.now, _tLobbyBracketAt = st.now;
    var _tEventOkAt = st.now, _tTabHidden = false, tMyMatch = null, tEvents = [];
    var game = null, mySeatIdx = 0, _tLastStateChangeAt = 0;
    var tNow = 0, tClockOffset = 0;
    function tournLoadEvent() { st.ev++; if (st.eventOk) _tEventOkAt = Date.now(); }   // 真實行為：成功回應才刷新新鮮度
    function tChatLoad() { st.chat++; }
    function tBracketLoad() { st.br++; }
    ${ts(FN_RESUME)}
    ${ts(FN_DESIRED)}
    var _cb = ${ts(CB)};
    return {
      cb: _cb,
      resume: tLobbyResume,
      desired: function () { return tPollDesiredMs(false, 'lobby'); },
      set: function (k, v) {
        if (k === 'tMyMatch') tMyMatch = v;
        else if (k === '_tTabHidden') _tTabHidden = v;
        else if (k === '_tEventOkAt') _tEventOkAt = v;
        else if (k === '_tLobbyResumeAt') _tLobbyResumeAt = v;
        else if (k === 'tEvents') tEvents = v;
        else throw new Error('unknown key ' + k);
      },
    };
  `;
  const h = new Function('st', body)(st);
  h.st = st;
  h.tick = (n) => { for (let i = 0; i < n; i++) { st.now += 3000; h.cb(); } };
  return h;
}
// 預設情境：/event 剛成功、沒有進入寬限期
function idleLobby() {
  const h = makeLobby(1000000);
  h.set('_tLobbyResumeAt', 0);
  return h;
}

// ── 對戰／觀戰用的獨立 harness（正對照，用真的 Date）─────────────────
function battleDesired(ctx, spectate) {
  const f = new Function('ctx', `
    var game = ctx.game, mySeatIdx = ctx.mySeatIdx, _tLastStateChangeAt = ctx._tLastStateChangeAt;
    var _tEventOkAt = 0, _tLobbyResumeAt = 0, _tTabHidden = false, tMyMatch = null, tEvents = [];
    ${ts(FN_DESIRED)}
    return tPollDesiredMs;
  `)(ctx);
  return f(spectate);
}

T('前提：tLobbyResume / tPollDesiredMs / 大廳 tick 回呼三段原始碼都切得出來', () => {
  assert.ok(SLICE_OK, SLICE_ERR);
});

// ══ ① 正對照：在對戰中／觀戰中的頻率一個字都不能變 ═══════════════════
T('①正對照：對戰中的輪詢頻率完全不變（1200 / 800 快檔 / game-over 12000 / 平手 6000）', () => {
  const base = { mySeatIdx: 0, _tLastStateChangeAt: 0 };
  assert.equal(battleDesired({ ...base, game: { phase: 'playing', activePlayerIndex: 0 } }, false), 1200,
    '自己回合的一般節奏被改動了');
  assert.equal(battleDesired({ ...base, game: { phase: 'playing', activePlayerIndex: 1 }, _tLastStateChangeAt: Date.now() }, false), 800,
    '「等對手＋盤面剛動過」的快檔被改動了');
  assert.equal(battleDesired({ ...base, game: { phase: 'playing', activePlayerIndex: 1 }, _tLastStateChangeAt: Date.now() - 60000 }, false), 1200,
    '長考時應退回 1200');
  assert.equal(battleDesired({ ...base, game: { phase: 'setup', activePlayerIndex: 1 }, _tLastStateChangeAt: Date.now() }, false), 1200,
    'setup 不該進快檔');
  assert.equal(battleDesired({ ...base, game: { phase: 'game-over', winner: 1 } }, false), 12000);
  assert.equal(battleDesired({ ...base, game: { phase: 'game-over', winner: null } }, false), 6000);
  assert.equal(battleDesired({ ...base, game: null }, false), 1200);
});
T('①正對照：觀戰頻率完全不變（2000 / game-over 10000）', () => {
  const base = { mySeatIdx: 0, _tLastStateChangeAt: 0 };
  assert.equal(battleDesired({ ...base, game: { phase: 'playing', activePlayerIndex: 1 } }, true), 2000);
  assert.equal(battleDesired({ ...base, game: { phase: 'game-over', winner: 1 } }, true), 10000);
});
T('①正對照：大廳輪詢的 base tick 仍是 3 秒（降的是送出頻率，不是把 timer 拉長）', () => {
  assert.ok(SRC.indexOf('}, 3000);', _cbStart) > 0);
});

// ══ ② 閒置玩家（出局／輪空／本輪已打完）頻率降低 ══════════════════════
T('②閒置玩家：lobby 模式回 9000（不是 3000）', () => {
  assert.equal(idleLobby().desired(), 9000);
});
T('②閒置玩家：30 個 base tick 只送出 10 發 /event（原本 30 發）', () => {
  const h = idleLobby(); h.tick(30);
  assert.equal(h.st.ev, 10, '/event 實際送出數不是 10（原本 30）');
  assert.equal(h.st.chat, 10, '/chat 實際送出數不是 10');
  assert.equal(h.st.br, 3, '/bracket 實際送出數不是 3（原本 10）');
});
T('②背景分頁的閒置玩家更保守（21000；30 tick 只送 4 發）', () => {
  const h = idleLobby(); h.set('_tTabHidden', true);
  assert.equal(h.desired(), 21000);
  h.tick(30);
  assert.equal(h.st.ev, 4, '背景閒置的 /event 實際送出數不是 4');
});

// ══ ③ 在對戰／有新比賽 → 立即恢復正常頻率 ═══════════════════════════
T('③有本輪未完成的對戰（含還沒進場）⇒ 3000，且 30 tick 實際送滿 30 發', () => {
  const h = idleLobby();
  h.set('tMyMatch', { matchId: 'm1', enterOpenAt: 0 });
  assert.equal(h.desired(), 3000);
  h.tick(30);
  assert.equal(h.st.ev, 30, '有比賽的人被降頻了（這會害人被判未進場）');
  assert.equal(h.st.br, 10, '有比賽的人 /bracket 也不該被降頻');
});
T('③輪次推進：閒置中途出現新比賽 ⇒ **下一個 tick** 就送出，不必等完 9 秒', () => {
  const h = idleLobby();
  h.tick(9);                       // 閒置跑 27 秒
  const before = h.st.ev;
  h.set('tMyMatch', { matchId: 'm2' });
  h.tick(1);                       // 只前進一個 base tick（3 秒）
  assert.equal(h.st.ev - before, 1, '新比賽出現後沒有在下一個 tick 立刻恢復送出');
});
T('③tLobbyResume() 真的把節奏錨點歸零 ⇒ 下一個 tick 立刻送出 /event /chat /bracket', () => {
  const h = idleLobby();
  h.tick(1);                       // 錨點才剛推進（離下一發還有 6 秒）
  const b = { ev: h.st.ev, chat: h.st.chat, br: h.st.br };
  h.resume();
  h.tick(1);
  assert.equal(h.st.ev - b.ev, 1, 'resume 後 /event 沒有立刻送出');
  assert.equal(h.st.chat - b.chat, 1, 'resume 後 /chat 沒有立刻送出');
  assert.equal(h.st.br - b.br, 1, 'resume 後 /bracket 沒有立刻送出');
});
T('③resume 後 60 秒內一律正常頻率（3000）', () => {
  const h = idleLobby();
  h.resume();
  assert.equal(h.desired(), 3000);
});
T('③報到／賽程產生中（我有報名）⇒ 正常頻率', () => {
  const h = idleLobby();
  h.set('tEvents', [{ _id: 'e1', registered: true, status: 'checkin' }]);
  assert.equal(h.desired(), 3000);
  h.set('tEvents', [{ _id: 'e1', registered: true, status: 'bracket_ready' }]);
  assert.equal(h.desired(), 3000);
  h.set('tEvents', [{ _id: 'e1', registered: false, status: 'checkin' }]);
  assert.equal(h.desired(), 9000, '沒報名的旁觀者不必維持高頻');
});
T('③tournLoadEvent 必須在**覆寫 tEvents/tMyMatch 之前**取舊值，並在有差異時呼叫 tLobbyResume', () => {
  const fn = slice('  async function tournLoadEvent() {', '\n  // 載入賽程表');
  const iPrev = fn.indexOf('const _prevSig');
  const iOver = fn.indexOf('tEvents = Array.isArray');
  assert.ok(iPrev >= 0 && iOver > iPrev, '舊值沒有在覆寫之前取 ⇒ 永遠比不出差異');
  assert.ok(/currentRound/.test(fn.slice(iPrev, iOver)), '對照簽章沒有含 currentRound（輪次推進偵測不到）');
  assert.ok(/_prevMatchId/.test(fn), '沒有對照「我的對戰」有沒有換');
  assert.ok(/tLobbyResume\(\)/.test(fn), 'tournLoadEvent 沒有在偵測到差異時立即恢復頻率');
  assert.ok(/_tEventOkAt = Date\.now\(\)/.test(fn), '沒有記錄 /event 成功時刻（fail-open 判準的來源）');
  assert.ok(fn.indexOf('_tEventOkAt = Date.now()') > fn.indexOf("await tApi('/event')"),
    '_tEventOkAt 必須在拿到回應之後才寫（寫在前面等於「失敗也算成功」）');
});

// ══ ④ 判斷不出來 ⇒ fail-open 用正常頻率 ═══════════════════════════════
T('④fail-open：/event 從沒成功過／一直失敗 ⇒ 3000，30 tick 送滿 30 發', () => {
  const h = idleLobby();
  h.st.eventOk = false;   // 每一發 /event 都失敗 ⇒ _tEventOkAt 永遠停在 0
  h.set('_tEventOkAt', 0);
  assert.equal(h.desired(), 3000);
  h.tick(30);
  assert.equal(h.st.ev, 30, '資料不明時被降頻了（fail-open 破功）');
});
T('④fail-open：/event 已超過 30 秒沒有成功回應 ⇒ 3000', () => {
  const h = idleLobby();
  h.set('_tEventOkAt', 1000000 - 31000);
  assert.equal(h.desired(), 3000);
});
T('④fail-open：判準只用伺服器資料，lobby 分支不得讀畫面狀態（tStep / tBusy / tError…）', () => {
  const i = FN_DESIRED.indexOf("if (mode === 'lobby')");
  assert.ok(i > 0, 'lobby 分支不見了');
  const branch = FN_DESIRED.slice(i, FN_DESIRED.indexOf('const g = game as', i));
  for (const bad of ['tStep', 'tBusy', 'tError', 'tActiveRoom', 'isTournSpectator']) {
    assert.ok(!branch.includes(bad), 'lobby 分支用了畫面狀態 ' + bad + ' 來判斷（必須用賽事資料）');
  }
  assert.ok(branch.includes('tMyMatch'), 'lobby 分支沒有讀伺服器回的 myMatch');
});

// ══ ⑤ 回到前景立即恢復 ════════════════════════════════════════════════
T('⑤visibilitychange：tLobbyResume() 必須在「不是 playing 就早退」**之前**呼叫', () => {
  const onVis = slice('    const onVis = (): void => {', "document.addEventListener('visibilitychange'");
  const iResume = onVis.indexOf('tLobbyResume()');
  const iBail = onVis.indexOf("if (!isTournament || isTournSpectator || !tActiveRoom || tStep !== 'playing') return;");
  assert.ok(iResume > 0, '回前景沒有恢復大廳頻率');
  assert.ok(iBail > 0, '前提：早退條件還在（錨點過期請更新）');
  assert.ok(iResume < iBail, '⚠ tLobbyResume 寫在早退之後 ⇒ 大廳的人（正好是 tStep !== playing）完全沒接上');
  const iHidden = onVis.indexOf('_tTabHidden =');
  assert.ok(iHidden > 0 && iHidden < onVis.indexOf("if (document.visibilityState !== 'visible') return;"),
    '_tTabHidden 必須在「不可見就 return」之前更新，否則進背景永遠設不起來');
});
T('⑤_tTabHidden 有初值（在背景載入的頁面收不到 visibilitychange）', () => {
  const seg = slice("    _tTabHidden = (document.visibilityState !== 'visible');   // ⭐v6.161 初值",
    "document.addEventListener('visibilitychange'");
  assert.ok(seg.length > 0);
});

// ══ 中央收斂：只能有一份節奏判準 ═══════════════════════════════════════
T('⭐節奏判準必須只有一份：大廳輪詢走中央述詞的 lobby 模式，不留輪數計數器', () => {
  assert.equal(SRC.split('function tPollDesiredMs(').length - 1, 1, 'tPollDesiredMs 不只一份');
  assert.ok(CB.includes("tPollDesiredMs(false, 'lobby')"), '大廳輪詢沒有走中央述詞');
  assert.ok(!CB.includes('_tPollTick'), 'v5.637 的輪數計數器還在（節奏一變就漂移）');
  assert.ok(!/%\s*3/.test(CB), '大廳輪詢還在用「每 N 輪」判準');
  assert.ok(!SRC.includes('let _tPollTick'), '_tPollTick 宣告沒清掉');
  assert.ok(/_brMs = _evMs \* 3/.test(CB), '/bracket 沒有維持 /event 的 1/3 比例');
});
T('⭐降幅保守：閒置降到 9000／背景 21000，沒有一次拉到 30 秒以上', () => {
  const i = FN_DESIRED.indexOf("if (mode === 'lobby')");
  const branch = FN_DESIRED.slice(i, FN_DESIRED.indexOf('const g = game as', i));
  const nums = (branch.match(/return (\d+);/g) || []).map((s) => parseInt(s.replace(/\D/g, ''), 10));
  assert.ok(nums.length > 0, 'lobby 分支沒有任何回傳值');
  assert.equal(Math.max(...nums), 21000, 'lobby 最慢的頻率不是 21000（降幅必須保守）');
  assert.equal(Math.min(...nums), 3000, 'lobby 的正常頻率不是 3000');
  for (const n of nums) assert.equal(n % 3000, 0, n + ' 不是 base tick(3000) 的倍數 ⇒ 文件與實際行為會不符');
});
T('⭐只降頻率，不動端點行為：大廳輪詢仍然只打 /event /chat /bracket 三支', () => {
  // ⚠ 先剝掉行註解再判 —— 回呼結尾的 v5.647 註解本來就會提到 tChampionsLoad()
  const code = CB.replace(/\/\/[^\n]*/g, '');
  assert.ok(/tournLoadEvent\(\)/.test(code) && /tChatLoad\(\)/.test(code) && /tBracketLoad\(\)/.test(code));
  assert.ok(!/tApi\(/.test(code), '大廳 tick 內直接打了新的端點（本版只准降頻）');
  assert.ok(!/tChampionsLoad\(\)/.test(code), '名人堂不該回到輪詢（v5.647）');
  assert.ok(!/tLeaderboardLoad\(\)|tSpectateLoad\(\)/.test(code), '大廳 tick 多打了別的端點');
});

T('⭐時鐘被往回校（NTP）⇒ 大廳輪詢不可停發（錨點跑到未來要立刻重錨）', () => {
  const h = idleLobby();
  h.tick(3);                 // 正常送出過一發
  const before = h.st.ev;
  h.st.now -= 600000;        // 牆鐘往回跳 10 分鐘 ⇒ 三個錨點都變成「未來」
  h.cb();
  assert.equal(h.st.ev - before, 1, '牆鐘往回校之後大廳輪詢停發了（最壞會害人被判未進場）');
  h.tick(3);                 // 之後仍要照常運作
  assert.ok(h.st.ev - before >= 2, '重錨之後節奏沒有恢復');
});

console.log(`v6.161 大廳輪詢降頻守衛：PASS ${pass} / FAIL ${fails.length}`);
if (fails.length) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
