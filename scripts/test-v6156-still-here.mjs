#!/usr/bin/env node
/**
 * v6.156 守衛：閒置判負前的「我還在」確認彈窗（站長 2026-08-10 裁定）
 *
 * 站長的三個裁定：①點了就重置倒數、不限次數 ②所有閒置情境都彈
 *   ③死角（雙方都完成準備卻推不動）→ 改判**平手** ＋ 通知站長人工裁定。
 *
 * 這支測試的重點在**行為端**：把 `/api/tournament/still-here` 的 handler 從 patch 抽出來，
 * 注入假的 TROOMS / TMATCH / tournIdentity / currentActorSeat 實跑。純字串比對擋不住的
 * 兩個真漏洞都由行為端釘住：
 *   ⚠ **等待方不能替掛機的對手續命**（規格沒寫，實作時查證後補的規則）
 *   ⚠ **對局時限到了就不再重置**（否則拖延方每 3 分鐘點一次，最後回合永遠打不完）
 *
 * ⚠ 第 2 輪 Fable 5 審查抓到的**嚴重**問題也釘在這裡：死角場一旦設成 `status:'done'`，
 *   `admin/match/resolve` 回 409、`admin/pending-matches` 也不列 —— 「請站長人工裁定」
 *   就變成純文案，實質仍是雙淘汰。⇒ 必須是 `pending-admin`，而且**不能推進輪次**。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');
const PAGE = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
const ADMIN = readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  ' + extra : '')); }
};

// ══════════════════════════════════════════════════════════════════════════
// 1. /still-here 端點：把真 handler 抽出來實跑
// ══════════════════════════════════════════════════════════════════════════
console.log('\n── 1. /still-here 端點行為（真程式碼實跑）──');

const B0 = SRC.indexOf("app.post('/api/tournament/still-here'");
const B1 = SRC.indexOf('// ── v6.156 STILL HERE BLOCK END ──');
ok('STILL HERE BLOCK 可定位', B0 > 0 && B1 > B0, `B0=${B0} B1=${B1}`);
const blockSeg = SRC.slice(B0, B1);
const _bodyStart = blockSeg.indexOf('{', blockSeg.indexOf('async (req, res) =>')) + 1;
const _bodyEnd = blockSeg.lastIndexOf('\n    });');
ok('handler 函式體可切出', _bodyStart > 0 && _bodyEnd > _bodyStart, `s=${_bodyStart} e=${_bodyEnd}`);
const BODY = blockSeg.slice(_bodyStart, _bodyEnd);
// 自我驗證（正向）：切出來的東西必須真的是那個 handler，而不是碰巧的一段字
ok('（自我驗證）切出的函式體含端點的三個關鍵決策，不是碰巧的片段',
  BODY.includes('not-your-turn') && BODY.includes('time-limit') && BODY.includes('lastActionAt'));

const makeHandler = () => new Function('TROOMS', 'TMATCH', 'tournIdentity', 'currentActorSeat',
  'return async function (req, res) {' + BODY + '\n};');

function mkRes() {
  const out = { code: 200, body: null };
  const r = { status(c) { out.code = c; return r; }, json(b) { out.body = b; return r; }, out };
  return r;
}
/**
 * 假環境。
 * ⚠ 假件刻意**檢查收到的參數**（Fable 5 審查：忽略參數的假件會讓
 *   `currentActorSeat(null)` 這類退化照樣全綠）。
 */
function mkEnv(o = {}) {
  const writes = [];
  const seen = { actorArg: undefined, matchFilter: undefined, roomFilter: undefined };
  const doc = o.noRoom ? null : {
    _id: 'R1',
    seats: o.seats || ['uidA', 'uidB'],
    matchId: o.matchId !== undefined ? o.matchId : 'M1',
    gameState: o.phase === null ? null : { phase: o.phase || 'playing', _tag: 'GS' },
    version: 7,
    lastActionAt: 1000,
  };
  const TROOMS = {
    async findOne(f) { seen.roomFilter = f; return doc; },
    async updateOne(filter, update) { writes.push({ filter, update }); return { matchedCount: 1, modifiedCount: 1 }; },
  };
  const TMATCH = {
    async findOne(f) { seen.matchFilter = f; return { _id: 'M1', timeLimitReached: !!o.timeLimit }; },
  };
  const tournIdentity = async () => (o.idError
    ? { error: '需要登入', code: 401 }
    : { uid: o.uid || 'uidA', verified: o.verified !== false, name: 'P' });
  const currentActorSeat = (gs) => { seen.actorArg = gs; return (o.actor === undefined ? 0 : o.actor); };
  return { writes, seen, handler: makeHandler()(TROOMS, TMATCH, tournIdentity, currentActorSeat) };
}
const call = async (env, body = { room: 'R1' }) => {
  const res = mkRes();
  await env.handler({ body }, res);
  return res.out;
};

const T = [];
T.push((async () => {
  const env = mkEnv({ uid: 'uidA', actor: 0 });
  const out = await call(env);
  ok('★該動作方按「我還在」→ ok:true', out.body && out.body.ok === true, JSON.stringify(out));
  ok('★只 $set lastActionAt，不碰 gameState/version（v6.151 整包寫回的教訓）',
    env.writes.length === 1
    && Object.keys(env.writes[0].update).join(',') === '$set'
    && Object.keys(env.writes[0].update.$set).join(',') === 'lastActionAt',
    JSON.stringify(env.writes));
  ok('回傳新的 lastActionAt 給 client 立刻收掉彈窗',
    out.body && typeof out.body.lastActionAt === 'number' && out.body.lastActionAt > 0);
  ok('★currentActorSeat 收到的是這個房間的真盤面（假件不忽略參數）',
    env.seen.actorArg && env.seen.actorArg._tag === 'GS', JSON.stringify(env.seen.actorArg));
  ok('★TMATCH 查的是這個房間掛的 matchId（不是隨便一場）',
    env.seen.matchFilter && env.seen.matchFilter._id === 'M1', JSON.stringify(env.seen.matchFilter));
})());

T.push((async () => {
  // ⚠ 等待方（seat 1，actor 0）→ 必須拒絕，且不能有任何寫入
  const env = mkEnv({ uid: 'uidB', actor: 0 });
  const out = await call(env);
  ok('★⚠ 等待方不能替掛機的對手續命（reason: not-your-turn）',
    out.body && out.body.ok === false && out.body.reason === 'not-your-turn', JSON.stringify(out));
  ok('★⚠ 拒絕時完全沒有寫入（否則倒數還是被重置了）', env.writes.length === 0, JSON.stringify(env.writes));
})());

T.push((async () => {
  for (const uid of ['uidA', 'uidB']) {
    const env = mkEnv({ uid, actor: -1 });
    const out = await call(env);
    ok(`★死角（actor=-1）${uid} 也能確認（站長裁定②所有閒置情境都彈）`,
      out.body && out.body.ok === true && out.body.actorSeat === -1, JSON.stringify(out));
  }
  // actor 判不出（null）→ 保守拒絕
  const envN = mkEnv({ uid: 'uidA', actor: null });
  const outN = await call(envN);
  ok('★actor 判不出（null）時保守拒絕，不重置', outN.body && outN.body.ok === false && envN.writes.length === 0);
})());

T.push((async () => {
  const env = mkEnv({ uid: 'uidA', actor: 0, timeLimit: true });
  const out = await call(env);
  ok('★⚠ timeLimitReached 之後不再重置（否則最後回合永遠打不完）',
    out.body && out.body.ok === false && out.body.reason === 'time-limit', JSON.stringify(out));
  ok('★⚠ 時限拒絕時也完全沒有寫入', env.writes.length === 0, JSON.stringify(env.writes));
})());

T.push((async () => {
  const env = mkEnv({ uid: 'uidZ', actor: 0 });
  const out = await call(env);
  ok('★非該房玩家 → 403', out.code === 403, JSON.stringify(out));
  ok('403 時沒有寫入', env.writes.length === 0);
})());

T.push((async () => {
  const env = mkEnv({ uid: 'uidA', actor: 0, verified: false, matchId: 'M1' });
  ok('★正式賽房未驗證身分 → 403（擋「替對手按我還在」）', (await call(env)).code === 403);
  const env2 = mkEnv({ uid: 'uidA', actor: 0, verified: false, matchId: null });
  ok('測試房不要求 verified（playerId fallback 仍可用）', (await call(env2)).body?.ok === true);
})());

T.push((async () => {
  const env = mkEnv({ uid: 'uidA', actor: 0, phase: 'game-over' });
  const out = await call(env);
  ok('對戰已結束 → ok:false（reason: game-over）',
    out.body && out.body.ok === false && out.body.reason === 'game-over');
  ok('game-over 時沒有寫入', env.writes.length === 0);
})());

T.push((async () => {
  ok('房間不存在 → 404', (await call(mkEnv({ noRoom: true }))).code === 404);
  ok('缺少房間參數 → 400', (await call(mkEnv({}), {})).code === 400);
  ok('身分無效 → 401', (await call(mkEnv({ idError: true }))).code === 401);
})());

// ══════════════════════════════════════════════════════════════════════════
function staticChecks() {
  // ────────────────────────────────────────────────────────────────────────
  console.log('\n── 2. 死角改判平手，而且**站長真的裁定得到**（站長裁定③）──');
  const i0 = SRC.indexOf('} else if (actor === -1) {');
  const i1 = SRC.indexOf('if (!_deadlock) await checkRoundAdvance(ev._id);', i0 + 1);
  ok('閒置掃描的 actor===-1 分支可定位', i0 > 0 && i1 > i0, `i0=${i0} i1=${i1}`);
  const seg = SRC.slice(i0, i1 + 60);
  ok('★死角判準＝setup 階段且雙方 setupDone 皆 true',
    /_deadlock\s*=\s*gs\.phase === 'setup' && !!_sd\[0\] && !!_sd\[1\]/.test(seg));
  ok('★⚠ 死角場的 status 是 pending-admin，**不是 done**（done 會讓 resolve 回 409、pending 清單也不列）',
    /status: 'pending-admin', winnerUid: null, draw: true, deadlockDraw: true/.test(seg));
  ok('★⚠ 死角場**不推進輪次**（單淘汰下照推，這兩個人會直接從賽程消失）',
    /if \(!_deadlock\) await checkRoundAdvance\(ev\._id\);/.test(seg)
    && !/^\s*await checkRoundAdvance\(ev\._id\);\s*$/m.test(seg));
  ok('★非死角的雙方閒置仍走 doubleNoShow + done（沒有把舊行為一起改掉）',
    /: \{ status: 'done', winnerUid: null, doubleNoShow: true \}/.test(seg));
  ok('★死角會請站長到「待裁定場次」處理', /待裁定場次/.test(seg));
  ok('winReason 兩種情境分開寫（回放/賽果頁看得出差別）',
    /_deadlock \? '雙方皆已完成準備卻無人可行動/.test(seg));

  // ⭐ 這一段是行為證明，不是字面比對：pending-admin 必須真的能被兩個 admin 端點看到
  const rIdx = SRC.indexOf("app.post('/api/tournament/admin/match/resolve'");
  const pIdx = SRC.indexOf("app.get('/api/tournament/admin/pending-matches'");
  ok('resolve / pending-matches 端點可定位', rIdx > 0 && pIdx > 0, `r=${rIdx} p=${pIdx}`);
  const rSeg = SRC.slice(rIdx, rIdx + 1400), pSeg = SRC.slice(pIdx, pIdx + 900);
  const resolveRejectsDone = /if \(m\.status === 'done'\) return res\.status\(409\)/.test(rSeg);
  const pendingExcludesDone = /status: \{ \$ne: 'done' \}/.test(pSeg);
  ok('（前提）resolve 拒絕 done、pending 清單排除 done —— 這正是不能用 done 的原因',
    resolveRejectsDone && pendingExcludesDone, `resolve409=${resolveRejectsDone} pendingNe=${pendingExcludesDone}`);
  ok('★⚠ 綜合判定：死角場的 status 不在這兩個端點的排除範圍內（站長真的裁定得到）',
    !/status: 'done', winnerUid: null, draw: true/.test(seg));
  // 自我驗證（正向）：舊寫法（done + 立刻推進）套進同一組判準必須被判為不合格
  const OLD = "await TMATCH.updateOne({ _id: m._id }, { $set: { status: 'done', winnerUid: null, draw: true, deadlockDraw: true } });\n              await checkRoundAdvance(ev._id);";
  ok('（自我驗證）舊寫法（done ＋ 立刻推進輪次）會被判為未修',
    !/status: 'pending-admin'/.test(OLD) && !/if \(!_deadlock\) await checkRoundAdvance/.test(OLD));

  console.log('\n── 3. 賽果對帳認得死角平手（否則顯示「正常分勝負」）──');
  ok('★歸檔 mapping 帶 draw / deadlockDraw（兩處：歸檔與 summary）',
    (SRC.match(/draw: !!m\.draw, deadlockDraw: !!m\.deadlockDraw/g) || []).length === 2);
  ok('★admin 賽果文字認得 deadlockDraw，且排在 doubleNoShow 之前',
    ADMIN.indexOf('if (m.deadlockDraw) return') > 0
    && ADMIN.indexOf('if (m.deadlockDraw) return') < ADMIN.indexOf("if (m.doubleNoShow) return '雙方未進場'"));
  ok('待裁定與已裁定顯示不同文字', /pending-admin' \? '系統死角（待裁定）' : '系統死角改判平手'/.test(ADMIN));
  ok('★賽果分佈也分開計數（不會被算進「正常分勝負」）',
    /else if \(m\.deadlockDraw\) \{ outcome\.deadlockDraw/.test(ADMIN));

  // ────────────────────────────────────────────────────────────────────────
  console.log('\n── 4. client 彈窗（⚠ 必須在版面分支之外）──');
  const iDlg = PAGE.indexOf('class="tourn-still-here"');
  const iMobile = PAGE.indexOf('<MobilePortraitBattle');
  ok('彈窗與手機版面元件都可定位', iDlg > 0 && iMobile > 0, `dlg=${iDlg} mobile=${iMobile}`);
  // ⭐⭐ 真正的位置證明（Fable 5 審查：原本只比對「檔案先後順序」，把彈窗原地包進
  //   `{#if !isPortraitMobile}` 順序不變、測試照綠 ⇒ 安慰劑）。
  //   改成**巢狀深度證明**：從對戰畫面根分支的 `{:else}` 到彈窗自己的 `{#if` 之間，
  //   `{#if}` 與 `{/if}` 必須成對 —— 有任何一層未閉合，就代表彈窗被包在某個條件裡。
  const iOwnIf = PAGE.lastIndexOf('{#if', iDlg);
  const iRootElse = PAGE.lastIndexOf('\n{:else}\n', iOwnIf);
  ok('根分支 {:else} 與彈窗自己的 {#if} 可定位', iRootElse > 0 && iOwnIf > iRootElse, `else=${iRootElse} if=${iOwnIf}`);
  const depthSeg = PAGE.slice(iRootElse, iOwnIf);
  const nOpen = (depthSeg.match(/\{#if /g) || []).length;
  const nClose = (depthSeg.match(/\{\/if\}/g) || []).length;
  ok('★⚠ 彈窗的巢狀深度為 0 ＝ 不在任何條件分支內（v6.149 教訓：橫幅寫在桌機 else 裡手機看不到）',
    nOpen === nClose, `open=${nOpen} close=${nClose}`);
  ok('★彈窗在手機版面元件之前（同一段共用區）', iDlg < iMobile);
  // 自我驗證（正向）：把彈窗包進版面分支的樣本，必須被同一套判準判為不合格
  const MUT = '\n{:else}\n{#if isTournament && tError}<div class="tourn-toast">x</div>{/if}\n{#if isPortraitMobile}\n{#if tMyIdleSec != null}<div class="tourn-still-here">…';
  const mIf = MUT.lastIndexOf('{#if', MUT.indexOf('class="tourn-still-here"'));
  const mSeg = MUT.slice(MUT.lastIndexOf('\n{:else}\n', mIf), mIf);
  ok('（自我驗證）把彈窗包進 {#if isPortraitMobile} 的樣本會被判為不合格',
    (mSeg.match(/\{#if /g) || []).length !== (mSeg.match(/\{\/if\}/g) || []).length);

  ok('★方向以伺服器權威 actorSeat 為準（本地推算只是 fallback）',
    /const actor = \(tServerActorSeat !== undefined\) \? tServerActorSeat : tCurrentActorSeat\(game\);[\s\S]{0,200}actor === mySeatIdx \|\| actor === -1/.test(PAGE));
  ok('★死角時兩邊都彈（actor === -1）', /!\(actor === mySeatIdx \|\| actor === -1\)/.test(PAGE));
  ok('觀戰者不會看到（他不會被判負）', /isTournament && !isTournSpectator && tMyIdleSec/.test(PAGE));
  ok('剩 60 秒才彈（與 v6.151 的 60 秒推播對齊同一時點）', /tMyIdleSec != null && tMyIdleSec <= 60/.test(PAGE));
  const iMy = PAGE.indexOf('const tMyIdleSec');
  ok('回前景 3 秒內不顯示（背景 tick 被節流會先算出「剩 0 秒」嚇人）',
    /_tForegroundAt > 0 && tNow - _tForegroundAt < 3000/.test(PAGE.slice(iMy, iMy + 900)));

  // ⭐ Fable 5 審查：死角時兩個方向相反的提示不能同時出現
  const iWarn = PAGE.indexOf('const tIdleWarnSec');
  const warnSeg = PAGE.slice(iWarn, iMy);
  ok('★⚠「對手閒置中→自動判你勝」橫幅在死角（actor=-1）時必須關掉（那句話在死角是錯的）',
    /if \(actor == null \|\| actor === -1 \|\| actor === mySeatIdx\) return null;/.test(warnSeg));
  ok('（自我驗證）舊寫法（沒有排除 -1）會被判為未修',
    !/if \(actor == null \|\| actor === -1 \|\| actor === mySeatIdx\) return null;/
      .test('if (actor == null || actor === mySeatIdx) return null;'));

  console.log('\n── 5. client 送出與失敗處理 ──');
  const f0 = PAGE.indexOf('async function tStillHere()');
  const f1 = PAGE.indexOf('async function tournamentJoin()', f0 + 1);
  ok('tStillHere 可定位', f0 > 0 && f1 > f0, `f0=${f0} f1=${f1}`);
  const fseg = PAGE.slice(f0, f1);
  ok('★送出後採用伺服器回的 lastActionAt（彈窗才會立刻收掉）',
    /if \(typeof r\.lastActionAt === 'number'\) tLastActionAt = r\.lastActionAt;/.test(fseg));
  ok('★死角情境點了之後強制重抓盤面（點了還推不動才是真 bug）',
    /r\.actorSeat === -1\) \{\s*\n\s*tForceResync\(\);/.test(fseg));
  // ⭐ Fable 5 審查：伺服器回 -1 ≠「雙方都完成準備」，指紋不能無條件送、也不能吃光配額
  ok('★⚠ 指紋只在**真的**雙方 setupDone 時才送（-1 不等於雙方完成準備）',
    /phase === 'setup' && !!\(_sd && _sd\[0\]\) && !!\(_sd && _sd\[1\]\)[\s\S]{0,120}_tSendClientDiag\('setup-stalled-both-done'\)/.test(fseg));
  ok('★⚠ 指紋每場只送一次（診斷配額每頁只有 3 發，吃光了真的卡住就靜音了）',
    /!_stalledDiagSent &&/.test(fseg) && /_stalledDiagSent = true;/.test(fseg));
  ok('★時限已到顯示不同文案（按鈕在、但不會重置）', /reason === 'time-limit'[\s\S]{0,120}對局時限已到/.test(fseg));
  ok('伺服器說「不是你該動作」→ 重抓盤面（代表我落後了）',
    /reason === 'not-your-turn'[\s\S]{0,160}tForceResync\(\)/.test(fseg));
  ok('送出中防連點', /if \(tStillHereBusy\) return;/.test(fseg) && /finally \{ tStillHereBusy = false; \}/.test(fseg));
  ok('★跨場不殘留（上一場的「時限已到」不會出現在下一場）',
    /tStillHereBusy = false; tStillHereNote = ''; _stalledDiagSent = false;/.test(PAGE));

  console.log('\n── 6. 監控分頁認得新指紋 ──');
  ok('★admin 有 setup-stalled-both-done 的白話說明（v6154 守衛的同款要求）',
    /'setup-stalled-both-done': \[/.test(ADMIN));
  ok('說明講清楚「不是掛機、是系統卡住」', /不是掛機，是系統把局面卡住了/.test(ADMIN));
}

Promise.all(T).then(() => {
  staticChecks();
  console.log(`\n${pass} PASS / ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
});
