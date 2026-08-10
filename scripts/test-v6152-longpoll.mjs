#!/usr/bin/env node
/**
 * v6.152 守衛：`/state?wait=1` 長輪詢（灰度，伺服器端預設關閉）
 *
 * 這一版最重要的性質是「**旗標關著時，行為必須與上一版逐字相同**」——
 *   client 只有在伺服器宣告 `longPoll: true` 之後才會送 `wait=1` 並放寬逾時。
 *
 * 行為端：把 LONGPOLL BLOCK 抽出來用 `new Function` 跑（注入假的 TCONFIG / TROOMS），
 *   驗四條喚醒路徑（通知 / 保險輪詢 / 逾時 / client 斷線）、掛起上限、以及資源不外洩。
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

// ── 0. 抽出 LONGPOLL BLOCK + 掃描器自我驗證 ────────────────────────────────
const B0 = '── v6.152 LONGPOLL BLOCK BEGIN ──', B1 = '── v6.152 LONGPOLL BLOCK END ──';
const i0 = SRC.indexOf(B0), i1 = SRC.indexOf(B1);
ok('LONGPOLL BLOCK 標記存在', i0 > 0 && i1 > i0, `i0=${i0} i1=${i1}`);
const BLOCK = (i0 > 0 && i1 > i0) ? SRC.slice(i0 + B0.length, i1) : '';
for (const fn of ['lpConfig', '_lpNotify', '_lpWait']) {
  ok(`BLOCK 含 ${fn}`, BLOCK.includes('function ' + fn), `len=${BLOCK.length}`);
}
if (!BLOCK) { console.log(`\n${pass} PASS / ${fail} FAIL`); process.exit(1); }

function mk(cfgDoc, roomVersion = 5) {
  const state = { version: roomVersion };
  const TCONFIG = { findOne: async () => cfgDoc };
  const TROOMS = { findOne: async () => ({ _id: 'r', version: state.version }) };
  const api = new Function('TCONFIG', 'TROOMS',
    BLOCK + '\nreturn { lpConfig, _lpNotify, _lpWait, held: () => _lpHeld, waiters: () => _lpWaiters, TLP_DEFAULT };'
  )(TCONFIG, TROOMS);
  return { api, state };
}
const mkReq = () => { const h = []; return { on: (e, f) => h.push([e, f]), off: () => {}, removeListener: () => {}, _h: h }; };

// ── 1. 設定：預設關閉、只有明確 true 才開、數值 clamp ──────────────────────
{
  ok('★沒有設定文件時＝關閉（灰度的預設必須是關）', (await mk(null).api.lpConfig()).enabled === false);
  ok('enabled 不是 boolean true 就當關閉（避免 "true" 字串誤開）',
    (await mk({ enabled: 'true' }).api.lpConfig()).enabled === false);
  ok('明確 true 才開', (await mk({ enabled: true }).api.lpConfig()).enabled === true);
  const c = await mk({ enabled: true, maxWaitMs: 999999, pollMs: 1, maxHold: 999999 }).api.lpConfig();
  ok('maxWaitMs 被 clamp（不可掛到天荒地老）', c.maxWaitMs === 60000, String(c.maxWaitMs));
  ok('pollMs 被 clamp（保險輪詢不可變成壓測）', c.pollMs === 300, String(c.pollMs));
  ok('maxHold 被 clamp', c.maxHold === 2000, String(c.maxHold));
  const d = await mk({ enabled: true }).api.lpConfig();
  ok('預設值合理（25 秒掛起 / 1.5 秒保險輪詢 / 200 條上限）',
    d.maxWaitMs === 25000 && d.pollMs === 1500 && d.maxHold === 200);
}

// ── 2. 行為：四條喚醒路徑 ──────────────────────────────────────────────────
const CFG = { enabled: true, maxWaitMs: 300, pollMs: 1000, maxHold: 200 };   // 逾時快、保險輪詢慢
const CFG_POLL = { enabled: true, maxWaitMs: 3000, pollMs: 30, maxHold: 200 }; // 保險輪詢快、逾時慢
{
  const { api } = mk({ enabled: true });
  const p = api._lpWait('r', 5, CFG, mkReq());
  setTimeout(() => api._lpNotify('r'), 20);
  ok('★/action 的 in-process 通知會叫醒掛起的請求', (await p) === 'event');
  ok('喚醒後沒有殘留掛起計數（不洩漏連線）', api.held() === 0);
  ok('喚醒後 waiters map 已清空（不洩漏記憶體）', api.waiters().size === 0);
}
{
  const { api, state } = mk({ enabled: true }, 5);
  const p = api._lpWait('r', 5, CFG_POLL, mkReq());
  setTimeout(() => { state.version = 6; }, 40);
  ok('★保險輪詢會抓到「通知沒送到」的版本變動（pm2 cluster／scheduler 寫入）',
    (await p) === 'poll');
}
{
  const { api } = mk({ enabled: true });
  ok('★沒有任何動靜就等到逾時（回 unchanged，不是壞掉）',
    (await api._lpWait('r', 5, CFG, mkReq())) === 'timeout');
}
{
  const { api } = mk({ enabled: true });
  const req = mkReq();
  const p = api._lpWait('r', 5, CFG_POLL, req);
  setTimeout(() => { for (const [e, f] of req._h) if (e === 'close') f(); }, 20);
  ok('★client 中途離開 ⇒ 立刻釋放（不要佔著連線等滿逾時）', (await p) === 'closed');
  ok('離開後也不殘留掛起計數', api.held() === 0);
}
{
  const { api } = mk({ enabled: true });
  ok('★超過掛起上限 ⇒ 立即回 full（退化成短輪詢，不是拒絕服務）',
    (await api._lpWait('r', 5, { enabled: true, maxWaitMs: 300, pollMs: 1000, maxHold: 0 }, mkReq())) === 'full');
}
{
  // 同一個房間多人掛起，一次通知要全部叫醒
  const { api } = mk({ enabled: true });
  const ps = [api._lpWait('r', 5, CFG, mkReq()), api._lpWait('r', 5, CFG, mkReq())];
  setTimeout(() => api._lpNotify('r'), 20);
  const rs = await Promise.all(ps);
  ok('同一房間的多個等待者會被同一次通知一起叫醒', rs.every((x) => x === 'event'), rs.join(','));
  ok('全部釋放後計數歸零', api.held() === 0);
}

// ── 3. 靜態：/state 的接線與「關閉時零影響」────────────────────────────────
{
  const s0 = SRC.indexOf("app.get('/api/tournament/state'");
  const s1 = SRC.indexOf("app.post('/api/tournament/action'");
  ok('/state 區段可定位', s0 > 0 && s1 > s0);
  const seg = SRC.slice(s0, s1);
  ok('★掛起的三個條件缺一不可（旗標開 ∧ client 要求 ∧ 版本相符）',
    /_lpCfgNow\.enabled && String\(req\.query\.wait \|\| ''\) === '1'\s*\n\s*&& Number\.isFinite\(cv\) && cv >= 0 && cv === light\.version/.test(seg));
  // ⚠⚠ v6.155（Fable 5 最終審查抓到的**安慰劑**）：這條原本是對整個 /state 區段比對，
  //   而掛起**之前**的第一次輕量讀 `let light = await TROOMS.findOne({ _id: room }, …)`
  //   本身就含有一模一樣的字面 ⇒ 把醒來後的重讀整段刪掉，這支測試照樣 44 PASS / 0 FAIL。
  //   而那個 bug 的後果正是長輪詢**空轉**：被 _lpNotify 叫醒後拿舊 light.version 去比對，
  //   判定「沒變」→ 回 unchanged → client 立刻再掛一發 ⇒ 長輪詢退化成忙碌等待。
  //   ⇒ 必須 scope 到 `_lpWait(...)` 之後、版本比對之前的那一小段。
  {
    const w0 = seg.indexOf('const _why = await _lpWait(');
    const w1 = seg.indexOf('if (Number.isFinite(cv) && cv >= 0 && cv === light.version) {', w0 + 1);
    ok('掛起段可定位', w0 > 0 && w1 > w0, `w0=${w0} w1=${w1}`);
    const wseg = seg.slice(w0, w1);
    ok('★掛起醒來後會重讀一次盤面版本（否則叫醒了卻回舊版本 ⇒ 長輪詢空轉）',
      /light = await TROOMS\.findOne\(\{ _id: room \}, \{ projection: \{ gameState: 0 \} \}\);/.test(wseg));
    // 自我驗證（正向）：證明「掛起之前」的區段確實含有會誤中的同一條字面 ——
    //   這就是舊寫法之所以是安慰劑的原因，也證明上面的 scope 不是裝飾。
    ok('（自我驗證）掛起前的第一次輕量讀確實會誤中同一條 regex',
      /light = await TROOMS\.findOne\(\{ _id: room \}, \{ projection: \{ gameState: 0 \} \}\);/.test(seg.slice(0, w0)));
  }
  ok('★client 已離開就不要再寫回應（避免 write-after-end）', /if \(_why === 'closed'\) return;/.test(seg));
  ok('回應會宣告伺服器是否已啟用（client 據此決定要不要送 wait=1）', /longPoll: _lpCfgNow\.enabled/.test(seg));
  ok('unchanged 回應帶 waited（0 不帶）', /if \(_waited\) _un\.waited = _waited;/.test(seg));
  ok('full（超過上限）不重讀、直接照原路回應', /if \(_why !== 'full'\)/.test(seg));
}
{
  const a0 = SRC.indexOf("app.post('/api/tournament/action'");
  const a1 = SRC.indexOf("app.post('/api/tournament/reset'");
  const seg = SRC.slice(a0, a1);
  ok('/action 寫入成功後會通知掛起者', /_lpNotify\(room\);/.test(seg));
  // ⚠ 位置：必須在 CAS 寫入成功之後（寫入前通知＝叫醒了卻讀到舊版本，白跑一趟）
  const iCas = seg.indexOf('if (!wr || wr.matchedCount === 0)');
  const iNotify = seg.indexOf('_lpNotify(room);');
  ok('★通知寫在 CAS 成功之後（寫入前通知會讓對方讀到舊版本、白跑一趟）',
    iCas > -1 && iNotify > iCas, `iCas=${iCas} iNotify=${iNotify}`);
}
{
  ok('admin 開關端點有管理員 gate',
    /app\.(get|post)\('\/api\/tournament\/admin\/longpoll'[\s\S]{0,400}isTournAdmin\(id\)/.test(SRC));
  // ⚠⚠ v6.155（Fable 5 最終審查抓到的**安慰劑**）：原本全檔比對 `_lpCfgAt = 0;`，
  //   會被**宣告行** `let _lpCfg = null, _lpCfgAt = 0;` 滿足 ⇒ 刪掉 admin POST 裡真正的
  //   失效行，測試照樣全綠。同一款坑 v6.150 那支已經修過一次（`_redactAt = 0;`），
  //   這支當時沒跟著修。⇒ scope 到 admin POST 區段。
  {
    const p0 = SRC.indexOf("app.post('/api/tournament/admin/longpoll'");
    const p1 = SRC.indexOf("app.post('/api/tournament/admin/event/create'", p0 + 1);
    ok('admin POST longpoll 區段可定位', p0 > 0 && p1 > p0, `p0=${p0} p1=${p1}`);
    const pseg = SRC.slice(p0, p1);
    ok('★改設定後會讓快取立刻失效（否則要等 10 秒才生效）', /_lpCfgAt = 0;/.test(pseg));
    // 自我驗證（正向）：證明宣告行確實含有會誤中的同一條字面。
    ok('（自我驗證）宣告行確實會誤中同一條 regex', /let _lpCfg = null, _lpCfgAt = 0;/.test(SRC));
  }
  ok('admin 查詢會回目前掛起數（開啟後用來觀察負載）', /held: _lpHeld, rooms: _lpWaiters\.size/.test(SRC));
}

// ── 4. 前端：只有伺服器宣告啟用才會用長輪詢 ────────────────────────────────
{
  ok('有 tLongPollReady 狀態', PAGE.includes('let tLongPollReady = $state(false);'));
  ok('三個回應讀取點都接上', (PAGE.match(/typeof \w+\.longPoll === 'boolean'\) tLongPollReady = \w+\.longPoll;/g) || []).length === 3);
  ok('★沒有伺服器宣告就不會啟用（旗標關著時行為與上一版相同）',
    PAGE.includes("const _lp = tLongPollReady && !isTournSpectator && !!game && (game as any).phase !== 'game-over';"));
  ok('★wait=1 只在長輪詢模式送', PAGE.includes("(_lp ? '&wait=1' : '')"));
  ok('★逾時只在長輪詢模式放寬（否則網路黑洞要 30 秒才發現）',
    PAGE.includes('_lp ? { timeoutMs: 30000 } : undefined'));
  ok('長輪詢模式不套 tPollDesiredMs 節流（否則延遲降不下來）',
    PAGE.includes('if (!_lp && _now - _lastFetchAt < tPollDesiredMs(false)) return;'));
  ok('對戰結束後不長輪詢（那時要的是降頻）', PAGE.includes("(game as any).phase !== 'game-over'"));
  // ⚠ v6.155（Fable 5 最終審查）：這一條原本是 `PAGE.includes('&& !_lpInFlight')` 全檔比對 ——
  //   新鮮度看門狗補上守衛之後，全檔會有兩處，刪掉任何一處都還是綠 ⇒ 會退化成安慰劑。
  //   ⇒ 改成把兩條看門狗各自 scope 出來、分別斷言，並驗證兩段切片真的沒重疊。
  {
    const d0 = PAGE.indexOf('const _lpInFlight = _tLongPollAt > 0 && (Date.now() - _tLongPollAt) < 30000;');
    ok('_lpInFlight 定義可定位', d0 > 0, `d0=${d0}`);
    const i0 = PAGE.indexOf('const _freshStaleMs =', d0 + 1);
    const i1 = PAGE.indexOf('tForceResync();', i0 + 1);
    ok('兩條看門狗區段可定位且順序正確', i0 > d0 && i1 > i0, `i0=${i0} i1=${i1}`);
    const segStall = PAGE.slice(d0, i0);   // 6 秒停擺看門狗
    const segFresh = PAGE.slice(i0, i1);   // 20 秒新鮮度看門狗
    ok('★輪詢停擺看門狗在長輪詢在途時不誤判（那一發本來就會掛 25 秒）', /&& !_lpInFlight/.test(segStall));
    // ⭐ v6.155 新增：長輪詢在途時 20 秒新鮮度看門狗也必須整條停用。沒有這個守衛會有三個後果：
    //   ①每 20 秒白抓一份 v=-1 全量（抵銷長輪詢省下來的流量）②順帶的 startTournamentPoll()
    //   會 ++tPollGen，把掛在伺服器上、對手一動就回的那一發判為過期丟棄 ⇒ 反而多等一個 RTT
    //   ③_freshWatchdogFires 累加到 3 而 tVersion 沒動 ⇒ 誤發 stale-version 診斷指紋，
    //     污染站長在 admin 監控分頁用來判讀「版本是不是真的卡住」的訊號。
    ok('★長輪詢在途時新鮮度看門狗不觸發（否則白抓全量＋丟棄在途長輪詢＋誤報 stale-version）',
      /&& !_lpInFlight/.test(segFresh));
    // 掃描器自我驗證：兩段切片必須各自恰含一條看門狗的節流標記，否則一條守衛會滿足兩個斷言。
    ok('（自我驗證）兩段切片不重疊且各自恰含一條看門狗',
      (segStall.match(/_tPollStallGuardAt = Date\.now\(\);/g) || []).length === 1
      && (segFresh.match(/_tLastForceResyncAt = Date\.now\(\);/g) || []).length === 1
      && !/_tLastForceResyncAt = Date\.now\(\);/.test(segStall));
  }
  ok('在途旗標一定會被放掉（finally）', PAGE.includes('finally { _pollBusy = false; _tLongPollAt = 0; }'));
  ok('離場會清乾淨', PAGE.includes('tLongPollReady = false; _tLongPollAt = 0;'));
  ok('★掃描器自我驗證：舊寫法（無條件節流）會被判為未修',
    !'      if (_now - _lastFetchAt < tPollDesiredMs(false)) return;'.includes('!_lp &&'));
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
