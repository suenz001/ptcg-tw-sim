#!/usr/bin/env node
// 📡 對戰連線監控 — 完整 dump（在 Oracle VM 上執行）
//   用法: cd /opt/ptcg/api && node /tmp/dump-client-monitor.cjs [7d|24h|72h|<小時數>]
//   預設 7d（＝168 小時＝伺服器保留上限，見下方 TTL 說明）。
//
// ── 為什麼要有這支 ────────────────────────────────────────────────────────
//   admin 的「📡 對戰連線監控」分頁走 3 支 API，但那 3 支都是**給畫面看的摘要**：
//     GET /api/tournament/admin/longpoll   → { config:{enabled,maxWaitMs,pollMs,maxHold}, held, rooms }
//     GET /api/tournament/admin/redact     → { enabled }
//     GET /api/tournament/admin/clientdiag?hours=N
//         → byReason（整個時間窗，沒截斷）
//           slowRtt（伺服器端就先 .limit(200)，而且畫面只畫前 20 筆）
//           rows   （伺服器端硬寫 .limit(120)，**沒有** offset/limit 參數可以翻頁）
//   ⇒ 想把整包資料交給 AI 分析時，明細最多只拿得到 120 筆、RTT 最多 200 筆。
//   這支腳本**不改任何後端端點**，直接讀同一批 mongo collection，把整個時間窗撈乾淨：
//     tournamentClientDiag  ← 玩家端異常指紋（/api/tournament/clientdiag 寫入的那張表）
//     tournamentConfig      ← _id:'longPoll' / _id:'redactState'（兩個灰度旗標的持久化來源）
//
// ── ⚠ 兩個做不到的地方（誠實標示，不要腦補）─────────────────────────────
//   1. longpoll 的 held（現在掛著幾條連線）與 rooms（幾個房間）**只存在跑著的 server
//      process 記憶體裡**（server_admin_patch.js 的 _lpHeld / _lpWaiters.size），
//      沒有寫進 mongo ⇒ 這支腳本拿不到，一律輸出 null。要看即時值請開 admin 的 📡 分頁。
//      （而且它是「此刻」的瞬時值，賽事結束後再 dump 本來就會是 0，對事後分析沒有意義。）
//   2. tournamentClientDiag 有 TTL index（expireAfterSeconds: 604800 ＝ 7 天），
//      超過 7 天的資料是**真的被 mongo 刪掉了**，任何工具都撈不回來 ⇒ 7d 就是全部。
//
// ── ⚠ diag 欄位的截斷（判讀關鍵）────────────────────────────────────────
//   /api/tournament/clientdiag 寫入時會把 payload 截到上限（v6.184 起 8192 字元，之前是 2048）。
//   client payload 的 key 順序是 reason → room → ts → ver → colo（v6.227 起）→ state → render → poll → perf
//   → svelteWarn → env，所以一旦超過上限，被切掉的**一定是尾端的 perf / svelteWarn / env.ua**，
//   而且整串不再是合法 JSON。伺服器那支 /admin/clientdiag 對 JSON.parse 失敗的列是「直接略過」
//   ⇒ 這些列在畫面上連 slowRtt 表都不會出現。
//   本腳本的處理（兩層，缺一不可）：
//     ①**伺服器旗標**（v6.184 起）：doc 上的 `truncated`（布林）與 `rawLen`（截斷前的字元數）。
//       這是**紀錄**，不是推論 —— 連「原本有多長」都知道，才有辦法判斷 8KB 夠不夠用。
//     ②**文字比對後援**（v6.184 之前的舊列唯一的線索）：JSON.parse 失敗時退回 regex
//       抽 ver / ua / poll.rtt，並算成 legacy 截斷。
//   摘要裡兩個數字分開報（截斷率高本身就是一個發現，而且要分得出「新列被切」與「舊列」）。
//
// 輸出：/tmp/ptcg_monitor_dump.json（完整資料）
//       /tmp/ptcg_monitor_summary.txt（給站長看的人話摘要，UTF-8 with BOM）
const fs = require('fs');

function loadMongo() {
  for (const c of ['/opt/ptcg/api/node_modules/mongodb', 'mongodb']) { try { return require(c); } catch (e) { /* 換下一個 */ } }
  throw new Error('找不到 mongodb 模組（請在 /opt/ptcg/api 下執行）');
}
// ⭐v6.184 `loadMongo()` 由「模組一載入就跑」改成**進 main() 才跑**：
//   守衛（scripts/test-v6184-clientdiag-cap.mjs）要 require 這支來**實跑**截斷分類邏輯，
//   而開發機／CI 沒有 mongodb 模組 —— 原本頂層就 throw，整支根本 require 不進來。
//   ⚠ 在 VM 上直接執行時行為完全不變：main() 第一件事就是載，載不到照樣丟同一個訊息。

// ── mongo URI 探測（與 dump-match-records.cjs 同一套，已驗證可用）────────
function readEnvFile(p) {
  try {
    const txt = fs.readFileSync(p, 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/=\s*["']?(mongodb(?:\+srv)?:\/\/[^"'\s]+)/i);
      if (m) return m[1];
    }
  } catch (e) { /* 檔案不存在就換下一個 */ }
  return null;
}
// 從「正在執行的 server 行程」環境變數抓 mongo URI（與 server 同一條已認證連線，最準）。
function fromProcEnviron() {
  try {
    for (const pid of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(pid)) continue;
      let cmd = '';
      try { cmd = fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8'); } catch (e) { continue; }
      if (!/server\.js|ptcg/.test(cmd)) continue;
      let env = '';
      try { env = fs.readFileSync('/proc/' + pid + '/environ', 'utf8'); } catch (e) { continue; }
      for (const v of env.split('\0')) {
        const m = v.match(/^[^=]*=(mongodb(?:\+srv)?:\/\/[^\s]+)$/);
        if (m) return m[1];
      }
    }
  } catch (e) { /* /proc 讀不到就往下走 */ }
  return null;
}
function findUri() {
  if (process.env.MONGO_URL) return process.env.MONGO_URL;
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
  const fp = fromProcEnviron(); if (fp) return fp;
  for (const p of ['/opt/ptcg/api/.env', '/opt/ptcg/.env', '/opt/ptcg/api/.env.production', '/opt/ptcg/api/.env.local']) {
    const u = readEnvFile(p); if (u) return u;
  }
  for (const p of ['/opt/ptcg/api/server.js', '/opt/ptcg/server.js']) {
    try { const s = fs.readFileSync(p, 'utf8'); const m = s.match(/mongodb(\+srv)?:\/\/[^'"`\s)]+/); if (m) return m[0]; } catch (e) { /* 換下一個 */ }
  }
  return 'mongodb://127.0.0.1:27017';
}
function dbNameFromUri(u) {
  try { const m = u.match(/mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/); return m && m[1] ? decodeURIComponent(m[1]) : null; } catch (e) { return null; }
}
function maskUri(u) { return String(u).replace(/:\/\/[^@/]*@/, '://***@'); }

// ── 時間範圍參數 ────────────────────────────────────────────────────────
//   接受 7d / 168h / 168。上限 168 小時 —— 不是我們想省，是 TTL 只留 7 天。
function parseRange(arg) {
  const s = String(arg || '').trim().toLowerCase();
  if (!s) return { hours: 168, label: '7 天', raw: '(預設)' };
  const m = s.match(/^(\d+(?:\.\d+)?)\s*([dh]?)$/);
  if (!m) return { hours: 168, label: '7 天', raw: s, badArg: true };
  let h = Number(m[1]);
  if (m[2] === 'd') h = h * 24;
  if (!isFinite(h) || h <= 0) h = 168;
  const clamped = Math.max(1, Math.min(168, Math.round(h)));
  return {
    hours: clamped,
    label: clamped >= 24 && clamped % 24 === 0 ? (clamped / 24) + ' 天' : clamped + ' 小時',
    raw: s,
    clampedDown: Math.round(h) > 168,
  };
}

// ── 指紋中文標題（逐字對齊 admin.html 的 MON_REASON_INFO，站長兩邊看到同一個詞）──
const REASON_LABEL = {
  'slow-rtt': '動作往返太慢（p95 ≥ 3 秒）',
  'stale-version': '畫面版本卡住（對戰中盤面不再更新）',
  'invisible-hand': '手牌有卡卻一張都沒畫出來',
  'setup-watchdog-repeat': '開局同步連續卡住',
  'setup-stalled-both-done': '死角：雙方都完成準備卻推不動',
  'action-forbidden': '動作被伺服器拒絕（身分不被接受）',
  'manual-sync': '玩家自己按了「重新同步」',
  // ⭐⭐⭐v6.213 這一則**不是異常**，是健康對照組（見下面 isSampleReason 的說明）。
  'perf-sample': '⚖️ 低頻取樣（健康對照組，不是異常）',
  // ⭐⭐⭐v6.261 休閒批（reason 一律 `casual-` 前綴）。⚠⚠ 這三則與上面每一則**母體不同**，
  //   數字永遠不可以相加（休閒是 client-authoritative、每動作上傳整包盤面 40~48KB）。
  'casual-slow-push': '［休閒］盤面上傳太慢（p95 ≥ 5 秒）',
  'casual-perf-sample': '［休閒］⚖️ 低頻取樣（健康對照組，不是異常）',
  'casual-forfeit-claim': '［休閒］玩家宣告「對手棄權」',
};
// ⭐⭐⭐ v6.213【② 低頻無條件取樣】的指紋清單 —— 與 server_admin_patch.js 的
//   `SAMPLE_REASONS` 逐字相同（改一邊就要改另一邊，否則兩張表會兜不起來）。
//
// ⚠⚠⚠ 為什麼一定要分開統計（這一段是判讀的關鍵，不要跳過）：
//   v6.198 把 stale-version 的送出判準收緊之後，**網路正常的人不再送任何回報**
//   ⇒ tournamentClientDiag 裡只剩下「有問題的人」，母體只有病人。
//   v6.213 補上一條與異常完全無關的抽樣管道（每場對戰 1%），把健康對照組放回來，
//   這樣「這一版有沒有變慢」才答得出來。
//   但**正因為它是健康的**，只要把它混進既有的任何一個統計，那個統計就會失真：
//     ・byReason／合計筆數 ⇒ 憑空多出一種「指紋」，看起來像新出現的問題；
//     ・RTT 分佈／最慢的玩家 ⇒ 健康樣本會把中位數往下拉，「大家都很順」是假的；
//     ・版本／平台／裝置分佈 ⇒ 那是**回報者**的分佈，取樣者與異常回報者本來就不是同一群人；
//     ・截斷率 ⇒ 分母變大，比率整個變小。
//   ⇒ 本腳本的做法：**從第一步就把兩批資料拆開**（rawAnom / rawSample），
//     既有的每一個統計都只吃 rawAnom（語義與 v6.212 逐字相同、可以跟舊 dump 對得起來），
//     取樣走自己的一份 sampleSummary()。**兩邊的數字永遠不可以相加**。
//   ⭐v6.261 休閒批也有自己的健康對照組（casual-perf-sample），同樣不是異常。
const SAMPLE_REASONS = ['perf-sample', 'casual-perf-sample'];
function isSampleReason(r) { return SAMPLE_REASONS.indexOf(String(r || '')) >= 0; }
// ⭐⭐⭐v6.261 休閒批的判準 —— 與 server_admin_patch.js 的 isCasualReason 逐字相同。
//
// ⚠⚠⚠ 為什麼一定要「第三批」而不是併進上面兩批（判讀關鍵，不要跳過）：
//   v6.260 以前 client 端的 `_tSendClientDiag` 開頭就是
//   `if (!isTournament || isTournSpectator || !tActiveRoom) return;`
//   ⇒ 這張表裡的**每一個數字**（含 v6.213 的健康對照組）都只涵蓋錦標賽路徑，
//   而休閒對戰佔全站 94% 流量 ⇒「dump 裡沒有」從來就不等於「沒發生」。
//   v6.261 把休閒接上同一條管線，但兩者是**兩個母體**：
//     ・錦標賽：走 /action，伺服器權威推進，一次往返＝一個動作；
//     ・休閒：client-authoritative，一個動作＝把整包盤面（實測 40~48KB）PUT 上去，
//       而且 oracleTx 一發最多 5 輪 GET＋PUT。
//   ⇒ 「錦標賽 slow-rtt 12 筆 ＋ 休閒 slow-push 30 筆 ＝ 42 筆」這句話**沒有意義**。
//   ⇒ 本腳本一律三分流：rawAnom（錦標賽異常）／rawSample（錦標賽取樣）／rawCasual（休閒全部）。
const CASUAL_REASON_PREFIX = 'casual-';
function isCasualReason(r) { return String(r || '').indexOf(CASUAL_REASON_PREFIX) === 0; }
// 分流的**單一出口**（main() 只呼叫這一支，守衛也直接跑這一支 —— 兩邊跑的是同一段程式碼）。
function splitDiagRows(rows) {
  const sample = [], anomaly = [], casual = [];
  for (const r of (rows || [])) {
    // ⚠ 順序不可以顛倒：casual-perf-sample 同時滿足 isSampleReason 與 isCasualReason，
    //   先判 casual 才不會把休閒的健康樣本混進錦標賽的健康對照組。
    if (isCasualReason(r && r.reason)) { casual.push(r); continue; }
    (isSampleReason(r && r.reason) ? sample : anomaly).push(r);
  }
  return { anomaly: anomaly, sample: sample, casual: casual };
}
/**
 * ⭐⭐⭐v6.261 休閒批的彙總（**完全獨立**的一份，與 sampleSummary／既有統計零共用）。
 * ⚠⚠ 回傳的每一個數字都只算休閒列，**永遠不可以**跟錦標賽那幾塊相加。
 */
function casualSummary(rawCasual) {
  const out = {
    rows: (rawCasual || []).length, players: 0, parsed: 0, truncated: 0,
    byReason: [], byVersion: [], byPlatform: [],
    // 盤面推送（＝休閒對戰的「上行」）的 p50/p95/max 分佈與失敗次數
    push: { p50: [], p95: [], max: [], fail: 0, rowsWithPush: 0 },
    // 「宣告對手棄權」：granted=false ＝宣告者的畫面是舊的（對手其實動過了）
    forfeitClaim: { total: 0, granted: 0, rejected: 0, unknown: 0 },
    list: [],
  };
  const uids = {}, rMap = new Map(), verMap = new Map(), uaMap = new Map();
  for (const r of (rawCasual || [])) {
    const d = parseDiag((r && r.diag) || '');
    if (r && r.uid) uids[r.uid] = 1;
    if (d.parsed) out.parsed++; else out.truncated++;
    const rk = (r && r.reason) || '(未標)';
    rMap.set(rk, (rMap.get(rk) || 0) + 1);
    verMap.set(d.ver || '(未知)', (verMap.get(d.ver || '(未知)') || 0) + 1);
    uaMap.set(uaShort(d.ua), (uaMap.get(uaShort(d.ua)) || 0) + 1);
    const o = d.obj;
    const ph = o && o.push && typeof o.push === 'object' ? o.push : null;
    if (ph) {
      out.push.rowsWithPush++;
      if (num(ph.p50) !== null && ph.p50 >= 0) out.push.p50.push(ph.p50);
      if (num(ph.p95) !== null && ph.p95 >= 0) out.push.p95.push(ph.p95);
      if (num(ph.max) !== null && ph.max >= 0) out.push.max.push(ph.max);
      if (num(ph.fail) !== null) out.push.fail += ph.fail;
    }
    if (rk === 'casual-forfeit-claim') {
      out.forfeitClaim.total++;
      const c = o && o.claim && typeof o.claim === 'object' ? o.claim : null;
      if (!c || typeof c.granted !== 'boolean') out.forfeitClaim.unknown++;
      else if (c.granted) out.forfeitClaim.granted++;
      else out.forfeitClaim.rejected++;
    }
    out.list.push({
      ts: r && r.ts, tsLocal: tw(r && r.ts), email: (r && r.email) || null, uid: (r && r.uid) || null,
      room: (r && r.room) || '', reason: rk, label: reasonLabel(rk), ver: d.ver || null,
      push: ph, board: (o && o.board) || null, claim: (o && o.claim) || null,
      ua: d.ua || null, hc: d.hc, dm: d.dm, truncated: !d.parsed,
    });
  }
  out.players = Object.keys(uids).length;
  out.byReason = [...rMap.entries()].map(function (e) { return { reason: e[0], label: reasonLabel(e[0]), n: e[1] }; })
    .sort(function (a, b) { return b.n - a.n; });
  out.byVersion = [...verMap.entries()].map(function (e) { return { ver: e[0], n: e[1] }; })
    .sort(function (a, b) { return b.n - a.n; });
  out.byPlatform = [...uaMap.entries()].map(function (e) { return { platform: e[0], n: e[1] }; })
    .sort(function (a, b) { return b.n - a.n; });
  return out;
}
// ⚠ 不可以直接 REASON_LABEL[reason] —— reason 若是 'constructor'/'__proto__' 會拿到
//   原型鏈上的 truthy 非字串（admin.html 踩過同一顆地雷）。
function reasonLabel(r) {
  return Object.prototype.hasOwnProperty.call(REASON_LABEL, r) ? REASON_LABEL[r] : String(r || '(未標)');
}

// ── diag 解析（含截斷 fallback）──────────────────────────────────────────
function parseDiag(s) {
  const out = { parsed: false, truncated: false, obj: null, ver: null, ua: null, rtt: null, perf: null, hc: null, dm: null };
  if (!s) return out;
  try { out.obj = JSON.parse(s); out.parsed = true; } catch (e) { out.truncated = true; }
  const o = out.obj;
  if (o && typeof o === 'object') {
    out.ver = typeof o.ver === 'string' ? o.ver : null;
    const env = o.env && typeof o.env === 'object' ? o.env : null;
    out.ua = env && typeof env.ua === 'string' ? env.ua : null;
    out.hc = env && typeof env.hc === 'number' ? env.hc : null;
    out.dm = env && typeof env.dm === 'number' ? env.dm : null;
    const poll = o.poll && typeof o.poll === 'object' ? o.poll : null;
    out.rtt = poll && poll.rtt && typeof poll.rtt === 'object' ? poll.rtt : null;
    out.perf = o.perf && typeof o.perf === 'object' ? o.perf : null;
    return out;
  }
  // 截斷列：ver 排在 payload 第 4 個 key，幾乎一定還在；ua/perf 在尾端，多半已經被切掉。
  const mv = s.match(/"ver"\s*:\s*"([^"]{0,32})"/); if (mv) out.ver = mv[1];
  const mu = s.match(/"ua"\s*:\s*"([^"]{0,200})"/); if (mu) out.ua = mu[1];
  // _sampleStats 的 key 順序固定是 n,p50,p95,max（見 +page.svelte），所以這條 regex 是穩的。
  const mr = s.match(/"rtt"\s*:\s*\{\s*("n"\s*:\s*\d+\s*,\s*"p50"\s*:\s*\d+\s*,\s*"p95"\s*:\s*\d+\s*,\s*"max"\s*:\s*\d+)\s*\}/);
  if (mr) { try { out.rtt = JSON.parse('{' + mr[1] + '}'); } catch (e) { /* 抽不到就算了 */ } }
  return out;
}

// ── ⭐⭐⭐v6.184 截斷判定（單一判定點）──────────────────────────────────
//   v6.184 之前只能靠「JSON.parse 失敗」反推 —— 那是**推論**不是紀錄：伺服器切完就直接寫進去，
//   沒有留下任何痕跡，切了幾個字元、原本有多長全都不知道（上一輪就是靠其他人外推才敢下結論）。
//   v6.184 起伺服器寫入時就帶 `truncated`（布林）與 `rawLen`（截斷前字元數），兩者合判：
//     ・srvFlag   ＝伺服器**明確標記**被切（只有 v6.184 以後寫進去的列才有這個欄位）
//     ・parseFail ＝JSON.parse 失敗（v6.184 以前唯一的線索，仍保留當後援）
//     ・legacy    ＝parse 失敗但沒有伺服器旗標 ⇒ 舊列（或真的是壞資料）
//   ⚠ 欄位缺席**不可以**被當成「這列沒被切」：舊列一定沒有這個欄位，「沒旗標」只代表「不知道」。
//     這正是 legacy 要單獨算一欄的理由。
const DIAG_CAP = 8192;   // ⚠ 逐字對齊 server_admin_patch.js 的 `_cdiagPack()` 的 LIMIT
function classifyTrunc(row, d) {
  const srvFlag = !!(row && row.truncated === true);
  const parseFail = !!(d && d.truncated);
  const rawLen = (row && typeof row.rawLen === 'number' && isFinite(row.rawLen)) ? row.rawLen : null;
  return { truncated: srvFlag || parseFail, srvFlag: srvFlag, parseFail: parseFail, legacy: parseFail && !srvFlag, rawLen: rawLen };
}
// 整批的截斷統計（摘要 ⑥ 直接用這一份，不另外在迴圈裡數第二次 ⇒ 兩個數字不可能漂移）。
const LEGACY_DIAG_CAP = 2048;   // v6.184 之前的舊上限（舊列的長度會**剛好**卡在這個數字）
function truncSummary(rawRows) {
  let total = 0, srv = 0, legacy = 0, maxRawLen = 0, capped = 0, legacyCapped = 0;
  for (const r of (rawRows || [])) {
    const tc = classifyTrunc(r, parseDiag((r && r.diag) || ''));
    if (tc.truncated) total++;
    if (tc.srvFlag) srv++;
    if (tc.legacy) legacy++;
    if (tc.rawLen !== null && tc.rawLen > maxRawLen) maxRawLen = tc.rawLen;
    const _len = (((r && r.diag) || '').length);
    // ⚠⚠ Fable 5 審查抓到的語義陷阱：舊列卡的是 **2048**，永遠不可能 >= 8192 ⇒
    //   只數「>= 目前上限」的話，現有那 16 筆舊列會顯示成 0，跟上一行的「舊列 16 筆」自相矛盾。
    //   兩個上限各數一欄，標籤也各自寫清楚。
    if (_len >= DIAG_CAP) capped++;                 // 已經頂到**目前**的 8192 ⇒ 該再放大了
    if (_len === LEGACY_DIAG_CAP) legacyCapped++;   // 頂到**舊的** 2048 ⇒ v6.184 之前寫進去的
  }
  return { total: total, srv: srv, legacy: legacy, maxRawLen: maxRawLen, capped: capped, legacyCapped: legacyCapped };
}

// ── ⭐⭐⭐v6.213 取樣（健康對照組）的獨立彙總 ────────────────────────────
//   ⚠ 這支**只吃 rawSample**，而且自己算自己的分母 —— 刻意與上面那些函式沒有任何共用
//     的累加器，這樣「混進去」在結構上就不可能發生。
//   ⚠ 每一欄都標明「這是取樣的」；報表上也絕不與異常的數字並排相加。
function sampleSummary(rawSample) {
  const out = {
    rows: (rawSample || []).length,
    players: 0,
    parsed: 0, truncated: 0,
    byVersion: [], byPlatform: [],
    rtt: { p50: null, p95max: null, n: 0 },
    perf: { net: [], dl: [], tok: [], parse: [], adopt: [], paint: [], srv: [] },
    srvHdr: { withHeader: 0, without: 0 },
    ltUnsupported: 0,
    list: [],
  };
  const uids = {}, verMap = new Map(), uaMap = new Map();
  const p95s = [];
  for (const r of (rawSample || [])) {
    const d = parseDiag((r && r.diag) || '');
    if (r && r.uid) uids[r.uid] = 1;
    if (d.parsed) out.parsed++; else out.truncated++;
    const vk = d.ver || '(未知)';
    verMap.set(vk, (verMap.get(vk) || 0) + 1);
    const pk = uaShort(d.ua);
    uaMap.set(pk, (uaMap.get(pk) || 0) + 1);
    if (d.rtt && num(d.rtt.p95) !== null) { p95s.push(d.rtt.p95); out.rtt.n++; }
    const perf = d.perf;
    if (perf) {
      const api = perf.api || {};
      const g = function (o) { return o && num(o.p95) !== null ? o.p95 : null; };
      const push = function (arr, v) { if (v !== null) arr.push(v); };
      push(out.perf.net, g(api.net)); push(out.perf.dl, g(api.dl));
      push(out.perf.tok, g(api.tok)); push(out.perf.parse, g(api.parse));
      push(out.perf.adopt, g(perf.adopt)); push(out.perf.paint, g(perf.paint));
      // ⭐v6.213【③】伺服器端 per-request 處理時間。
      //   ⚠ `srv` 缺席有兩種完全不同的意思，一定要分開數：
      //     `srvHdr.n === 0 && srvHdr.miss > 0` ＝伺服器還沒部署 v6.213（**不知道**）；
      //     `srv` 有值但很小 ＝伺服器**真的**很快。混在一起看會把「還沒部署」讀成「很快」。
      push(out.perf.srv, g(perf.srv));
      const sh = perf.srvHdr;
      if (sh && typeof sh === 'object') {
        if (num(sh.n) !== null && sh.n > 0) out.srvHdr.withHeader++;
        else out.srvHdr.without++;
      }
      if (!(perf.lt && num(perf.lt.n) !== null)) out.ltUnsupported++;
    }
    out.list.push({
      ts: r.ts, tsLocal: tw(r.ts), uid: r.uid || null, email: r.email || null,
      room: r.room || '', reason: r.reason || '', ver: d.ver || null, ua: d.ua || null,
      hc: d.hc, dm: d.dm, rtt: d.rtt || null, perf: d.perf || null,
      diagParsed: d.obj, diag: (r && r.diag) || '',
    });
  }
  out.players = Object.keys(uids).length;
  out.byVersion = [...verMap.entries()].map(function (e) { return { ver: e[0], n: e[1] }; })
    .sort(function (a, b) { return verCmp(b.ver, a.ver); });
  out.byPlatform = [...uaMap.entries()].map(function (e) { return { platform: e[0], n: e[1] }; })
    .sort(function (a, b) { return b.n - a.n; });
  out.rtt.p50 = quant(p95s, 0.5);
  out.rtt.p95max = p95s.length ? Math.max.apply(null, p95s) : null;
  return out;
}

// ── ⭐⭐⭐v6.198 stale-version 的「新判準／舊判準」分類 ─────────────────
//   v6.198 把送出判準從「盤面 60 秒沒動」收緊成三取一（見 src/lib/tournament/stale-diag.ts）。
//   ⚠⚠ 但**已經發布出去的 bundle 改不了** —— 停在 v6.197 以前的玩家會永遠繼續用舊判準送，
//     所以同一份 dump 裡一定會新舊混雜。把兩邊的次數加在一起看是**沒有意義**的：
//     舊判準那批用 2026-08-16 的資料回放約 89% 是「有人在長考」的正常等待。
//   判定依據刻意**不是**版本號字串：截斷列抽不到 ver、玩家也可能裝到測試站的 build。
//   唯一可靠的訊號是 payload 裡**有沒有 `poll.staleWhy` 這個欄位**（v6.198 起一律寫入，
//   其他 reason 寫 null）。⚠ 欄位缺席只能代表「舊 bundle」，不可以讀成「新判準沒有理由」。
//   三種結果必須分得出來，不可以合併：
//     'new'     ＝新判準送的（why 帶 a/b/c，可能多條）
//     'legacy'  ＝v6.197 以前的舊 bundle
//     'unknown' ＝整包 parse 不起來（被截斷）⇒ **不知道**，不可以塞進 legacy 去數
function staleGateOf(reason, diagObj, parsed) {
  if (reason !== 'stale-version') return null;
  if (!parsed || !diagObj || typeof diagObj !== 'object') return { gate: 'unknown', why: null };
  const poll = (diagObj.poll && typeof diagObj.poll === 'object') ? diagObj.poll : null;
  if (!poll || !Object.prototype.hasOwnProperty.call(poll, 'staleWhy')) return { gate: 'legacy', why: null };
  const w = poll.staleWhy;
  return { gate: 'new', why: (typeof w === 'string' && w) ? w : null };
}
// 伺服器回報的「對手已經幾秒沒來要盤面」。>0 ＝**對手那邊**斷線（不是這位玩家的問題）。
//   ⚠ v6.197 以前的 payload 沒有這一欄 ⇒ 回 null（「不知道」），**不是** 0（「對手正常」）。
function oppQuietOf(diagObj) {
  const poll = (diagObj && typeof diagObj === 'object' && diagObj.poll && typeof diagObj.poll === 'object') ? diagObj.poll : null;
  if (!poll || !Object.prototype.hasOwnProperty.call(poll, 'oppQuiet')) return null;
  return (typeof poll.oppQuiet === 'number' && isFinite(poll.oppQuiet)) ? poll.oppQuiet : null;
}

// ── ⭐⭐⭐v6.227 Cloudflare 邊緣節點（colo）────────────────────────────────
//   payload 的 colo 欄位（v6.227 起才有）：{ last, seen:{SJC:18,...}, miss }。
//   三種結果必須分得出來、不可混：
//     物件      ＝新 client 有資料（main ＝ seen 裡次數最多的那個；平手取先出現者）
//     'none'    ＝新 client 但這筆沒收到任何 colo（colo:null 或 seen/last 全空）
//               ——多半是 Service Worker 快取或不經 CF 的路徑
//     null      ＝payload 沒有這一欄（v6.227 之前的舊 client，或被截斷 parse 不出來）
//               ＝「不知道」，顯示「—」，**不是** 0、也不屬於任何 colo
function coloOf(diagObj) {
  if (!diagObj || typeof diagObj !== 'object' || !Object.prototype.hasOwnProperty.call(diagObj, 'colo')) return null;
  const c = diagObj.colo;
  if (!c || typeof c !== 'object') return 'none';
  const seen = (c.seen && typeof c.seen === 'object') ? c.seen : {};
  let best = null, bestN = -1;
  for (const k of Object.keys(seen)) {
    const n = Number(seen[k]);
    if (isFinite(n) && n > bestN) { best = k; bestN = n; }
  }
  const last = (typeof c.last === 'string' && c.last) ? c.last : null;
  const main = best || last;
  if (!main) return 'none';
  return {
    main: main, last: last, seen: seen,
    miss: (typeof c.miss === 'number' && isFinite(c.miss)) ? c.miss : null,
    multi: Object.keys(seen).length >= 2,
  };
}
// ⭐⭐⭐依 colo 分組統計。⚠ 呼叫端必須把**異常批**與**健康取樣批**分開餵——
//   兩邊的母體不同（病人 vs 抽樣），數字永遠不可相加、也不可互比快慢（v6.213 同一條紀律）。
//   判讀（這一組數字就是為了分辨兩個假說）：
//     ・慢的人（slow-rtt 佔比高／net 尾巴大）**集中在特定 colo** ⇒ 那個邊緣節點（或它到
//       隧道那一段）劣化——重啟 cloudflared 只是碰巧換了節點，治標不治本。
//     ・慢的人**跨所有 colo** ⇒ 問題在更下游（cloudflared 本身／VM／共享路徑），與節點無關。
function coloSummary(rawRows) {
  const groups = new Map();
  const out = { withColo: 0, noneColo: 0, unknown: 0, multiTotal: 0, groups: [] };
  for (const r of (rawRows || [])) {
    const d = parseDiag((r && r.diag) || '');
    const c = coloOf(d.obj);
    if (c === null) { out.unknown++; continue; }     // 舊 client／截斷列：「不知道」
    if (c === 'none') { out.noneColo++; continue; }  // 新 client 但沒收到 cf-ray
    out.withColo++;
    const k = c.main;
    if (!groups.has(k)) groups.set(k, { colo: k, n: 0, uids: {}, netP50s: [], netP95s: [], rttP95s: [], slowN: 0, multiN: 0, missN: 0 });
    const g = groups.get(k);
    g.n++;
    if (r && r.uid) g.uids[r.uid] = 1;
    if (c.multi) { g.multiN++; out.multiTotal++; }
    if (c.miss) g.missN += c.miss;
    if (String((r && r.reason) || '') === 'slow-rtt') g.slowN++;
    const api = (d.perf && d.perf.api) || null;
    const net = api && api.net && typeof api.net === 'object' ? api.net : null;
    if (net && num(net.p50) !== null) g.netP50s.push(net.p50);
    if (net && num(net.p95) !== null) g.netP95s.push(net.p95);
    if (d.rtt && num(d.rtt.p95) !== null) g.rttP95s.push(d.rtt.p95);
  }
  out.groups = [...groups.values()].map(function (g) {
    return {
      colo: g.colo, n: g.n, players: Object.keys(g.uids).length,
      // netTyp ＝各筆 net **p50** 的中位數（「到這個節點平常要多久」＝物理距離的指紋）；
      // netTail ＝各筆 net **p95** 的中位數（「這個節點的尾巴有多重」＝劣化的指紋）。
      netTypP50: quant(g.netP50s, 0.5), netTailP50: quant(g.netP95s, 0.5),
      netN: g.netP95s.length,
      rttP50: quant(g.rttP95s, 0.5), rttN: g.rttP95s.length,
      slowN: g.slowN, slowPct: g.n > 0 ? Math.round(g.slowN * 1000 / g.n) / 10 : null,
      multiN: g.multiN, missN: g.missN,
    };
  }).sort(function (a, b) { return b.n - a.n; });
  return out;
}
// colo 分組的 TXT 表（異常批與取樣批各印一份；isSample 只影響 slow-rtt 欄要不要出現——
//   取樣批的 reason 恆為 perf-sample，印一欄恆 0% 的 slow-rtt 只會誤導）。
function coloTableLines(cs, isSample) {
  const R = [];
  if (!cs || (!cs.withColo && !cs.noneColo)) {
    R.push('    這批沒有任何帶 colo 的回報（沒有這一欄的舊列 ' + (cs ? cs.unknown : 0) + ' 筆）。');
    R.push('    等玩家更新到 v6.227 之後的畫面再跑一次。');
    return R;
  }
  R.push('    ' + pad('colo', 8) + padL('筆數', 6) + padL('人數', 6) + padL('net典型', 11) + padL('net尾巴', 11)
    + padL('RTT p95中位', 13) + (isSample ? '' : padL('slow-rtt佔比', 14)));
  for (const g of cs.groups) {
    R.push('    ' + pad(g.colo, 8) + padL(g.n, 6) + padL(g.players, 6)
      + padL(ms(g.netTypP50), 11) + padL(ms(g.netTailP50), 11) + padL(ms(g.rttP50), 13)
      + (isSample ? '' : padL(g.slowPct === null ? '—' : g.slowPct + '%', 14)));
  }
  if (cs.noneColo) R.push('    （無 cf-ray）' + padL(cs.noneColo, 4) + ' 筆　← 新 client 但回應沒有 cf-ray（SW 快取／不經 CF 的路徑）');
  if (cs.unknown) R.push('    （無此欄）　' + padL(cs.unknown, 4) + ' 筆　← v6.227 之前的舊 client（或 payload 被截斷）＝「不知道」，顯示「—」不是 0');
  if (cs.multiTotal) R.push('    ⚠ 其中 ' + cs.multiTotal + ' 筆在同一場看過 ≥2 個 colo（對局中換了節點；該筆歸在次數較多的那個）。');
  return R;
}

// ── 小工具 ──────────────────────────────────────────────────────────────
function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
function pct(a, b) { return b > 0 ? (a * 100 / b).toFixed(1) + '%' : '—'; }
function quant(arr, q) {
  if (!arr.length) return null;
  const a = arr.slice().sort(function (x, y) { return x - y; });
  return a[Math.min(a.length - 1, Math.floor(a.length * q))];
}
function ms(v) {
  if (typeof v !== 'number' || !isFinite(v)) return '—';
  return v >= 1000 ? (v / 1000).toFixed(1) + ' 秒' : Math.round(v) + ' ms';
}
function tw(ts) {
  try { return new Date(ts).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }); } catch (e) { return new Date(ts).toISOString(); }
}
// ⚠ 中日韓文字在等寬字型裡佔 **兩格**。用 String.length 補空白，摘要的表格在記事本
//   一定會歪掉（站長就是要看這份表）⇒ 補到「顯示寬度」而不是字元數。
function dispW(s) {
  let w = 0;
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    w += (c >= 0x1100 && (c <= 0x115f || c === 0x2329 || c === 0x232a
      || (c >= 0x2e80 && c <= 0xa4cf && c !== 0x303f)
      || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff)
      || (c >= 0xfe30 && c <= 0xfe6f) || (c >= 0xff00 && c <= 0xff60)
      || (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x20000 && c <= 0x3fffd))) ? 2 : 1;
  }
  return w;
}
function pad(s, n) { s = String(s); let w = dispW(s); while (w < n) { s += ' '; w++; } return s; }
function padL(s, n) { s = String(s); let w = dispW(s); while (w < n) { s = ' ' + s; w++; } return s; }
// 版本字串比大小：'6.159' > '6.144' > '6.99'（逐段數字比，不是字典序）。
function verCmp(a, b) {
  const pa = String(a || '').replace(/^v/, '').split('.').map(Number);
  const pb = String(b || '').replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = isFinite(pa[i]) ? pa[i] : -1, y = isFinite(pb[i]) ? pb[i] : -1;
    if (x !== y) return x - y;
  }
  return 0;
}
// 只留 UA 裡真正有辨識度的那一小段（整串 80 字塞進摘要會完全沒法讀）。
function uaShort(ua) {
  if (!ua) return '(未知)';
  const s = String(ua);
  if (/iPhone|iPad|iPod/.test(s)) return 'iOS / Safari 系';
  if (/Android/.test(s)) return 'Android';
  if (/Windows/.test(s)) return 'Windows';
  if (/Macintosh|Mac OS/.test(s)) return 'macOS';
  if (/Linux/.test(s)) return 'Linux';
  return s.slice(0, 30);
}

async function main() {
  const { MongoClient } = loadMongo();   // v6.184：改在這裡載（頂層載會讓守衛 require 不進來）
  const range = parseRange(process.argv[2]);
  const uri = findUri();
  console.log('mongo uri:', maskUri(uri));
  console.log('時間範圍:', range.label, '(' + range.hours + ' 小時)');
  if (range.badArg) console.log('⚠ 看不懂的範圍參數「' + range.raw + '」，已改用預設 7 天。');
  if (range.clampedDown) console.log('⚠ 資料只保留 7 天（mongo TTL），已自動收斂成 168 小時。');

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  // 找出含 tournamentClientDiag 的 db（沒有回報時該 collection 可能還不存在 → 退回
  // tournamentMatches，再退回 URI 內的 db 名）。
  let db = null;
  try {
    const { databases } = await client.db().admin().listDatabases();
    for (const want of ['tournamentClientDiag', 'tournamentMatches']) {
      for (const d of databases) {
        const cand = client.db(d.name);
        const cols = await cand.listCollections({ name: want }).toArray();
        if (cols.length) { db = cand; break; }
      }
      if (db) break;
    }
  } catch (e) { /* 認證使用者可能無 listDatabases 權限 → 用 URI 內 db 名 */ }
  if (!db) { const dn = dbNameFromUri(uri); db = dn ? client.db(dn) : client.db(); }

  const TCDIAG = db.collection('tournamentClientDiag');
  const TCONFIG = db.collection('tournamentConfig');

  // ── ① 連線設定 ────────────────────────────────────────────────────────
  //   正規化方式**逐項對齊** server_admin_patch.js 的 lpConfig()／redactEnabled()，
  //   否則 dump 出來的數字會跟伺服器實際用的值不一樣（例如 doc 裡寫了 999999 但伺服器 clamp 到 60000）。
  const TLP_DEFAULT = { enabled: false, maxWaitMs: 25000, pollMs: 1500, maxHold: 200 };
  let lpDoc = null, rdDoc = null;
  try { lpDoc = await TCONFIG.findOne({ _id: 'longPoll' }); } catch (e) { /* 讀不到就用預設 */ }
  try { rdDoc = await TCONFIG.findOne({ _id: 'redactState' }); } catch (e) { /* 讀不到就用預設 */ }
  const lpCfg = Object.assign({}, TLP_DEFAULT, lpDoc || {});
  lpCfg.enabled = lpCfg.enabled === true;
  lpCfg.maxWaitMs = Math.max(1000, Math.min(60000, Number(lpCfg.maxWaitMs) || TLP_DEFAULT.maxWaitMs));
  lpCfg.pollMs = Math.max(300, Math.min(10000, Number(lpCfg.pollMs) || TLP_DEFAULT.pollMs));
  lpCfg.maxHold = Math.max(1, Math.min(2000, Number(lpCfg.maxHold) || TLP_DEFAULT.maxHold));
  delete lpCfg._id;
  const redactEnabled = !!(rdDoc && rdDoc.enabled === true);

  // ── ② 明細：整個時間窗、**不設 limit** ────────────────────────────────
  const since = Date.now() - range.hours * 3600000;
  const rawAll = await TCDIAG.find({ ts: { $gte: since } }).sort({ ts: -1 }).toArray();
  // ⭐⭐⭐v6.213 **第一步就拆**。底下所有既有統計一律只吃 `raw`（＝異常），
  //   取樣列走 `rawSample`。⚠ 這一行是整份分帳的單一分流點：不要在下游再各自過濾一次。
  const _split = splitDiagRows(rawAll);
  const rawSample = _split.sample;
  const raw = _split.anomaly;
  // ⭐⭐⭐v6.261 第三批：休閒對戰。⚠ 底下既有的每一個統計都**不吃**這一批
  //   （語義與 v6.260 逐字相同、可以跟舊 dump 對帳），它只走自己的 casualSummary()。
  const rawCasual = _split.casual;

  // ── ③ 指紋彙總（與 /admin/clientdiag 同一段 aggregate）────────────────
  const agg = await TCDIAG.aggregate([
    { $match: { ts: { $gte: since } } },
    { $group: { _id: '$reason', n: { $sum: 1 }, uids: { $addToSet: '$uid' } } },
  ]).toArray();
  // ⭐v6.213 aggregate 是對整個時間窗算的，這裡同樣要把取樣列濾掉（否則 byReason 又混回去了）。
  const byReason = agg
    .filter(function (a) { return !isSampleReason(a._id); })
    .map(function (a) { return { reason: a._id || '(未標)', label: reasonLabel(a._id), n: a.n, players: (a.uids || []).length }; })
    .sort(function (x, y) { return y.n - x.n; });
  const sampleAgg = agg
    .filter(function (a) { return isSampleReason(a._id); })
    .map(function (a) { return { reason: a._id || '(未標)', label: reasonLabel(a._id), n: a.n, players: (a.uids || []).length }; });

  // ── ④ 逐列展開 ────────────────────────────────────────────────────────
  const rows = [];
  const rtt = [];
  const verMap = new Map();          // ver -> { n, uids:Set }
  const uidSet = new Set();
  const perfVals = { net: [], dl: [], tok: [], parse: [], adopt: [], paint: [] };
  const ltVals = { n: [], total: [], max: [] };
  let ltUnsupported = 0, perfRows = 0;
  // ⭐v6.184 截斷統計走同一支 truncSummary（迴圈裡不再自己數一份，避免兩個數字漂移）。
  const trunc = truncSummary(raw);
  const devMap = new Map();          // 'hc核/dmGB' -> count
  const uaMap = new Map();           // 平台 -> { n, uids:Set }
  // ⭐v6.198 stale-version 的新／舊判準分帳（合併數字沒有意義，見 staleGateOf 的註解）。
  const staleTally = { total: 0, new: 0, legacy: 0, unknown: 0, why: new Map(), uidsNew: new Set(), uidsLegacy: new Set() };
  let oppQuietRows = 0, oppQuietHit = 0, oppQuietMax = 0;

  for (const r of raw) {
    const d = parseDiag(r.diag || '');
    const tc = classifyTrunc(r, d);
    if (r.uid) uidSet.add(r.uid);
    const verKey = d.ver || '(未知)';
    if (!verMap.has(verKey)) verMap.set(verKey, { n: 0, uids: new Set() });
    const vm = verMap.get(verKey); vm.n++; if (r.uid) vm.uids.add(r.uid);

    const plat = uaShort(d.ua);
    if (!uaMap.has(plat)) uaMap.set(plat, { n: 0, uids: new Set() });
    const um = uaMap.get(plat); um.n++; if (r.uid) um.uids.add(r.uid);

    if (d.rtt && num(d.rtt.p95) !== null) {
      rtt.push({
        ts: r.ts, tsLocal: tw(r.ts), email: r.email || null, uid: r.uid || null, room: r.room || '',
        reason: r.reason || '', ver: d.ver || null,
        n: num(d.rtt.n), p50: num(d.rtt.p50), p95: num(d.rtt.p95), max: num(d.rtt.max),
        perf: d.perf || null, hc: d.hc, dm: d.dm, ua: d.ua || null,
        truncated: tc.truncated, srvTruncated: tc.srvFlag, rawLen: tc.rawLen,
      });
    }
    if (d.perf) {
      perfRows++;
      const api = d.perf.api || {};
      const g = function (o) { return o && num(o.p95) !== null ? o.p95 : null; };
      const push = function (arr, v) { if (v !== null) arr.push(v); };
      push(perfVals.net, g(api.net)); push(perfVals.dl, g(api.dl));
      push(perfVals.tok, g(api.tok)); push(perfVals.parse, g(api.parse));
      push(perfVals.adopt, g(d.perf.adopt)); push(perfVals.paint, g(d.perf.paint));
      const lt = d.perf.lt;
      if (lt && num(lt.n) !== null) { ltVals.n.push(lt.n); ltVals.total.push(lt.total); ltVals.max.push(lt.max); }
      else ltUnsupported++;   // ⚠ lt === null ＝ Safari/iOS 不提供，**不是**「這台很順」
    }
    if (d.hc !== null || d.dm !== null) {
      const k = (d.hc !== null ? d.hc + ' 核' : '?核') + ' / ' + (d.dm !== null ? d.dm + ' GB' : '?GB');
      devMap.set(k, (devMap.get(k) || 0) + 1);
    }

    const sg = staleGateOf(r.reason || '', d.obj, d.parsed);
    if (sg) {
      staleTally.total++;
      staleTally[sg.gate]++;
      if (sg.gate === 'new' && r.uid) staleTally.uidsNew.add(r.uid);
      if (sg.gate === 'legacy' && r.uid) staleTally.uidsLegacy.add(r.uid);
      if (sg.why) staleTally.why.set(sg.why, (staleTally.why.get(sg.why) || 0) + 1);
    }
    const oq = oppQuietOf(d.obj);
    if (oq !== null) { oppQuietRows++; if (oq > 0) { oppQuietHit++; if (oq > oppQuietMax) oppQuietMax = oq; } }

    rows.push({
      ts: r.ts, tsLocal: tw(r.ts), uid: r.uid || null, email: r.email || null,
      room: r.room || '', reason: r.reason || '', reasonLabel: reasonLabel(r.reason),
      // ⭐v6.198：null ＝不是 stale-version；'unknown' ＝資料殘缺（**不是**舊判準）。
      staleGate: sg ? sg.gate : null, staleWhy: sg ? sg.why : null, oppQuiet: oq,
      ver: d.ver || null, ua: d.ua || null, hc: d.hc, dm: d.dm,
      diagLen: (r.diag || '').length,
      // ⭐v6.184：`truncated` 是「伺服器旗標 or parse 失敗」的合判；另外兩欄讓人分得出來源。
      truncated: tc.truncated, srvTruncated: tc.srvFlag, rawLen: tc.rawLen,
      diagParsed: d.obj,     // 解析成功才有；失敗是 null（看 diag 原文）
      diag: r.diag || '',    // 原始字串永遠保留（ground truth）
    });
  }
  rtt.sort(function (a, b) { return (b.p95 || 0) - (a.p95 || 0); });
  // ⭐v6.213 取樣（健康對照組）的獨立彙總。⚠ 它與上面每一個統計**沒有共用任何累加器**。
  const sample = sampleSummary(rawSample);
  const casual = casualSummary(rawCasual);   // ⭐v6.261 休閒批（獨立母體）
  // ⭐⭐⭐v6.227 colo（Cloudflare 邊緣節點）分組：異常批與取樣批**分開餵、分開報**。
  //   沒有取樣批那份，就答不了「慢的人是不是集中在某些 colo」（分母只有病人）。
  const coloAnom = coloSummary(raw);
  const coloSamp = coloSummary(rawSample);

  const byVersion = [...verMap.entries()]
    .map(function (e) { return { ver: e[0], n: e[1].n, players: e[1].uids.size }; })
    .sort(function (a, b) { return verCmp(b.ver, a.ver); });
  const knownVers = byVersion.filter(function (v) { return v.ver !== '(未知)'; });
  const latestVer = knownVers.length ? knownVers[0].ver : null;

  const byPlatform = [...uaMap.entries()]
    .map(function (e) { return { platform: e[0], n: e[1].n, players: e[1].uids.size }; })
    .sort(function (a, b) { return b.n - a.n; });

  // 每位玩家的 RTT 概況（站長最常問的「是誰在卡」）
  const byPlayer = new Map();
  for (const r of rtt) {
    const k = r.email || r.uid || '(未知)';
    if (!byPlayer.has(k)) byPlayer.set(k, { who: k, reports: 0, worstP95: 0, p95s: [], vers: new Set() });
    const p = byPlayer.get(k);
    p.reports++; p.p95s.push(r.p95); if (r.p95 > p.worstP95) p.worstP95 = r.p95;
    if (r.ver) p.vers.add(r.ver);
  }
  const players = [...byPlayer.values()].map(function (p) {
    return { who: p.who, reports: p.reports, worstP95: p.worstP95, medianP95: quant(p.p95s, 0.5), vers: [...p.vers] };
  }).sort(function (a, b) { return b.worstP95 - a.worstP95; });

  // ── 輸出 JSON ─────────────────────────────────────────────────────────
  const out = {
    generatedAt: new Date().toISOString(),
    generatedAtLocal: tw(Date.now()),
    uri: maskUri(uri),
    db: db.databaseName,
    range: { hours: range.hours, label: range.label, since: since, sinceLocal: tw(since) },
    ttlNote: 'tournamentClientDiag 有 TTL index（604800 秒＝7 天），超過 7 天的紀錄已被 mongo 刪除，任何工具都撈不回來。',
    truncNote: 'v6.184 起伺服器寫入時就標記 truncated / rawLen（上限 ' + DIAG_CAP + ' 字元）。'
      + 'truncatedFlaggedByServer 是**紀錄**；truncatedLegacyGuess 是 v6.184 之前的舊列，只能從 JSON.parse 失敗推論。'
      + 'maxRawLen 是所有列裡「截斷前」最長的一筆 —— 它逼近上限就代表該再放大了。',
    sourceNote: '本檔直接讀 mongo（tournamentClientDiag / tournamentConfig），與 admin 📡 分頁同一批資料，'
      + '但不受該 API 的 rows .limit(120) 與 slowRtt .limit(200) 限制。',
    config: {
      longPoll: { enabled: lpCfg.enabled, maxWaitMs: lpCfg.maxWaitMs, pollMs: lpCfg.pollMs, maxHold: lpCfg.maxHold, rawDoc: lpDoc || null },
      redact: { enabled: redactEnabled, rawDoc: rdDoc || null },
      held: null,
      rooms: null,
      heldRoomsNote: 'held / rooms 是 server process 的記憶體變數（_lpHeld / _lpWaiters.size），沒有持久化 ⇒ '
        + '只能在 admin 📡 分頁看即時值，離線 dump 拿不到（賽後 dump 本來也會是 0）。',
    },
    totals: {
      // ⚠⚠ v6.213 起 `rows` / `players` **只算異常回報**（取樣另計，見 sample 區塊）。
      //   要跟 v6.212 以前的 dump 對帳時，這兩個數字的語義是**一樣的**（沒有被取樣稀釋）。
      rows: rows.length,
      players: uidSet.size,
      sampleRows: sample.rows,
      sampleNote: '取樣（perf-sample）與異常回報**分開統計**，rows / players / rtt / byVersion / '
        + 'byPlatform / deviceMix / 截斷率**全部不含**取樣列。兩邊的數字永遠不可以相加。',
      truncatedRows: trunc.total,
      // ⭐v6.184 拆開報：伺服器明確標記 vs 只能從 parse 失敗推論的舊列 vs 剛好卡在上限的長度。
      truncatedFlaggedByServer: trunc.srv,
      truncatedLegacyGuess: trunc.legacy,
      rowsAtCap: trunc.capped,
      rowsAtLegacyCap: trunc.legacyCapped,
      legacyDiagCap: LEGACY_DIAG_CAP,
      maxRawLen: trunc.maxRawLen || null,
      diagCap: DIAG_CAP,
      rowsWithRtt: rtt.length,
      rowsWithPerf: perfRows,
      latestClientVersion: latestVer,
    },
    byReason: byReason,
    // ⭐⭐⭐v6.198 stale-version 分帳。⚠ new / legacy / unknown 三者**不可以加總後當一個數字看**。
    staleVersion: {
      total: staleTally.total,
      newGate: staleTally.new, newPlayers: staleTally.uidsNew.size,
      legacyGate: staleTally.legacy, legacyPlayers: staleTally.uidsLegacy.size,
      unknownGate: staleTally.unknown,
      byWhy: [...staleTally.why.entries()].map(function (e) { return { why: e[0], n: e[1] }; })
        .sort(function (a, b) { return b.n - a.n; }),
      note: 'total ＝這段期間 stale-version 的總列數（＝三類之和），只是「有幾列」，不是「有幾個問題」。'
        + 'newGate ＝v6.198 以後的畫面用新判準（三取一）送的；legacyGate ＝v6.197 以前的 bundle '
        + '用舊判準（只要盤面 60 秒沒動）送的 —— 那批用 2026-08-16 的資料回放，長考類就佔 58%、'
        + '舊 client 20%、真漏接只有 1%，絕大多數不必追。unknownGate ＝payload 被截斷、判不出來，'
        + '**不可以**併進 legacy。⚠「89%」是收緊後的降幅（407→43），不是假陽性率，兩個數字別混用。',
    },
    // ⭐v6.198 對手掉線（伺服器權威）。⚠ rows ＝有這一欄的回報數（舊 client 沒有這一欄）。
    //   ⚠⚠ 這是**順帶**的判讀欄，不是「對手掉線指紋」：「我正常、對手斷線」時新判準三條都不成立
    //     ⇒ 那個情境根本不會有回報被送出。hits 只涵蓋「因為別的理由送出來、而當下對手剛好也掉線」。
    oppQuiet: { rows: oppQuietRows, hits: oppQuietHit, maxSec: oppQuietMax || null },
    // ⭐⭐⭐v6.227 Cloudflare 邊緣節點（colo）分組。判準：慢的人集中在特定 colo ⇒ 該節點
    //   （或它到隧道那段路）劣化，重啟 cloudflared 只是碰巧換節點；跨所有 colo 都慢 ⇒
    //   問題在 cloudflared／VM／共享路徑。⚠ anomaly（異常批）與 sample（健康取樣批）
    //   母體不同，不可相加。⚠ unknown ＝舊 client 沒這欄或 payload 被截斷 ＝「不知道」，不是 0。
    colo: { anomaly: coloAnom, sample: coloSamp },
    // ⭐⭐⭐v6.213【② 低頻無條件取樣＝健康對照組】。
    //   ⚠ 這一整塊與上面每一個統計**互斥**（同一列不可能同時出現在兩邊），
    //     所以「異常 N 筆 ＋ 取樣 M 筆」只有在講「資料庫總列數」時才有意義，
    //     拿來算比率一律是錯的（分母不同）。
    //   ⚠ `rows: 0` 有兩種完全不同的可能：①這段期間沒有人中籤（1% × 場次數，本來就很少）
    //     ②玩家的畫面還沒更新到 v6.213。看 byVersion（異常那份）就知道大家在哪個版本。
    sample: sample,
    // ⭐⭐⭐v6.261【休閒對戰批】。⚠⚠ 這一整塊與上面每一個統計**互斥且母體不同**：
    //   ・上面全部是錦標賽（/action，伺服器權威推進）；
    //   ・這裡是休閒（client-authoritative，一個動作＝PUT 整包盤面 40~48KB，oracleTx 最多 5 輪）。
    //   ⇒ 「錦標賽 N 筆 ＋ 休閒 M 筆」除了「資料庫總列數」以外沒有任何意義，
    //     算比率、比快慢、比版本分佈一律是錯的。
    //   ⚠ `rows: 0` 有三種完全不同的可能：①玩家的畫面還沒更新到 v6.261；
    //     ②真的沒有人中籤／沒有人慢（休閒取樣是每場 10%、slow-push 門檻是 p95≥5 秒）；
    //     ③**沒有 Firebase email 帳號的玩家一律不送**（伺服器 tournIdentity 會丟棄匿名身分）
    //     —— 所以這一批的母體是「已登入的休閒玩家」，不是全部休閒玩家。
    casual: casual,
    byVersion: byVersion,
    byPlatform: byPlatform,
    deviceMix: [...devMap.entries()].map(function (e) { return { device: e[0], n: e[1] }; }).sort(function (a, b) { return b.n - a.n; }),
    rttPlayers: players,
    rtt: rtt,      // ⭐ 全部，不是 20 筆也不是 200 筆
    rows: rows,    // ⭐ 全部，不是最近 120 筆
  };
  fs.writeFileSync('/tmp/ptcg_monitor_dump.json', JSON.stringify(out, null, 2), 'utf8');

  // ── 輸出 TXT 摘要（站長自己看的人話版）────────────────────────────────
  const L = [];
  L.push('⚠ 這份檔案含玩家 email（管理員本來就看得到），要分享出去之前請自行斟酌。');
  L.push('============================================================');
  L.push('📡 對戰連線監控 — 摘要');
  L.push('產生時間：' + tw(Date.now()) + '（台灣時間）');
  L.push('資料範圍：最近 ' + range.label + '（' + range.hours + ' 小時），自 ' + tw(since) + ' 起');
  L.push('⚠ 伺服器只保留 7 天，更早的資料已被自動刪除 —— 「7 天」就是全部。');
  L.push('資料來源：直接讀資料庫，沒有畫面上的 120 筆／20 筆截斷。');
  L.push('⚠⚠ v6.213 起本報表把資料分成**兩批**：');
  L.push('   ・【異常回報】玩家的畫面真的出問題才送 —— 下面②③④⑤⑥每一個數字都只算這一批。');
  L.push('   ・【低頻取樣】每場對戰 1% 機率無條件抽一筆（健康對照組）—— 只在②-d 出現。');
  L.push('   兩批的數字**永遠不可以相加**，也不可以互相比較「哪個比較慢」（母體不同）。');
  L.push('');
  L.push('【① 連線設定現況】');
  L.push('  🚀 長輪詢：' + (lpCfg.enabled ? '已啟用' : '關閉')
    + '　掛起上限 ' + Math.round(lpCfg.maxWaitMs / 1000) + ' 秒'
    + '（保險輪詢 ' + lpCfg.pollMs + ' ms、同時掛起上限 ' + lpCfg.maxHold + ' 條）');
  L.push('  🙈 玩家端盤面遮蔽：' + (redactEnabled ? '已啟用' : '關閉'));
  L.push('  📶 目前掛起連線數／房間數：拿不到。這兩個數字只活在「正在跑的伺服器記憶體」裡，');
  L.push('     沒有存進資料庫 ⇒ 要看即時值請開 admin 的「📡 監控」分頁。');
  L.push('');
  L.push('【② 玩家端異常指紋（整個時間窗，沒有截斷）】');
  if (!byReason.length) {
    L.push('  這段期間沒有任何異常回報 👍');
  } else {
    for (const r of byReason) {
      L.push('  ・' + pad(r.label, 30) + padL(r.n, 6) + ' 次 /' + padL(r.players, 4) + ' 人   [' + r.reason + ']');
    }
    L.push('  ── 合計 ' + rows.length + ' 筆回報，來自 ' + uidSet.size + ' 位玩家。');
    L.push('  （人數比次數重要：同一個人重複觸發，不代表全站有問題。）');
  }
  if (staleTally.total) {
    L.push('');
    L.push('【②-b ⭐「畫面版本卡住」要分兩批看（v6.198 起）】');
    L.push('  ⚠⚠ 這兩批的數字**不可以加在一起**：判準完全不同。');
    L.push('  ・新判準（v6.198 以後的畫面）：' + staleTally.new + ' 筆 / ' + staleTally.uidsNew.size + ' 人　←要追的是這一批');
    L.push('    三取一才送：a=前景卻 15 秒收不到輪詢回應／b=伺服器動過而我沒跟上 15 秒以上／');
    L.push('    c=伺服器與那台畫面對「該誰動作」認知不一致。');
    if (staleTally.why.size) {
      const _ws = [...staleTally.why.entries()].sort(function (a, b) { return b[1] - a[1]; });
      L.push('    觸發條件分佈：' + _ws.map(function (e) { return e[0] + ' ' + e[1] + ' 筆'; }).join('、'));
    } else if (staleTally.new) {
      L.push('    ⚠ 有新判準的列但一筆都沒帶條件字母 —— 不正常，回頭查 client 的 staleWhy 有沒有接上。');
    }
    L.push('  ・舊判準（v6.197 以前的畫面）：' + staleTally.legacy + ' 筆 / ' + staleTally.uidsLegacy.size + ' 人　←絕大多數不必追');
    L.push('    那批只要「盤面 60 秒沒動」就送。拿 2026-08-16 的 7 天資料逐筆回放：長考類就佔 58%');
    L.push('    （對手在想 38.6%、自己在想 19.4%）、舊 client 20%、真漏接只有 4 筆（1%），');
    L.push('    而且將近一半是同一間房雙方各報一次的鏡像重複。');
    L.push('    ⚠「新判準把 407 筆收成 43 筆、降幅 89%」—— 那個 89% 是**降幅**，不是假陽性率，別混用。');
    L.push('    ⚠ 已發布的 bundle 改不了 ⇒ 這一批會一直存在，直到那些人更新畫面為止。');
    if (staleTally.unknown) {
      L.push('  ・判不出來（payload 被截斷）：' + staleTally.unknown + ' 筆　←這是「不知道」，不是舊判準');
    }
  }
  if (oppQuietRows) {
    L.push('');
    L.push('【②-c 📶 對手掉線（伺服器權威，v6.198 起才有這一欄）】');
    L.push('  有這一欄的回報 ' + oppQuietRows + ' 筆，其中 ' + oppQuietHit + ' 筆回報時**對手正處於掉線狀態**'
      + (oppQuietMax ? '（最久 ' + oppQuietMax + ' 秒）' : '') + '。');
    L.push('  ⚠⚠ 這是**順帶**的判讀欄，不是「對手掉線指紋」：「我這邊正常、只有對手斷線」的情境');
    L.push('    新判準三條都不成立 ⇒ 那個情境**根本不會有回報被送出**，這裡也就看不到。');
    L.push('    它真正的用途是：**已經送出來**的每一筆，都能一眼看出「其實是對面掉線」，');
    L.push('    不必再靠「在線那一方也跟著報 stale-version」去反推（那正是鏡像重複的來源）。');
    L.push('    要系統性地統計對手掉線，得另開指紋或在伺服器端統計 —— 本版刻意沒做。');
    L.push('  ⚠ 舊 client 沒有這一欄，所以分母不是全部回報數。');
  }
  L.push('');
  L.push('【②-d ⚖️ 低頻取樣（健康對照組，v6.213 起）】← 回答「這一版有沒有變慢」看這裡');
  L.push('  ⚠⚠ 這一塊的數字**絕不可以**跟上面【②】的異常次數相加 —— 兩者的母體完全不同：');
  L.push('    上面是「出問題才回報」，這裡是「不管有沒有問題，每場對戰 1% 機率抽一筆」。');
  L.push('    v6.198 收緊判準之後，健康的人不再送任何回報 ⇒ 沒有這一塊就沒有對照組。');
  if (!sample.rows) {
    L.push('  這段期間沒有任何取樣。⚠ 這**不是**「大家都很順」——');
    L.push('    可能是①中籤數本來就少（1% × 這段期間的對戰場次）②玩家的畫面還沒更新到 v6.213。');
    L.push('    看【③ client 版本分佈】就知道大家停在哪一版。');
  } else {
    L.push('  取樣 ' + sample.rows + ' 筆 / ' + sample.players + ' 位玩家'
      + '（其中 ' + sample.truncated + ' 筆的診斷內容被切斷）。');
    if (sample.rtt.n) {
      L.push('  這批**健康樣本**的動作往返 p95：中位數 ' + ms(sample.rtt.p50)
        + '、最差 ' + ms(sample.rtt.p95max) + '（樣本 ' + sample.rtt.n + ' 筆）。');
      L.push('  ⚠ 拿它跟上面【④】的 RTT 比是**錯的**（那一份只收「已經很慢」的人）。');
      L.push('    這個數字要跟**上一版的同一個數字**比 —— 那才是「有沒有變慢」的答案。');
    }
    const _rowsOutS = [
      ['伺服器處理（Node 在 Express 裡待多久）', sample.perf.srv, '伺服器'],
      ['網路（送出→回第一個位元組）', sample.perf.net, '網路／隧道'],
      ['下載（收下整份盤面）', sample.perf.dl, '網路／隧道'],
      ['解析（JSON 轉物件）', sample.perf.parse, '那台裝置'],
      ['採納（吃進畫面狀態）', sample.perf.adopt, '那台裝置'],
      ['重繪（畫面真的更新）', sample.perf.paint, '那台裝置'],
    ];
    L.push('  ' + pad('項目', 38) + padL('中位數', 10) + padL('最大', 10) + '  歸屬');
    for (const rr of _rowsOutS) {
      const arr = rr[1];
      L.push('  ' + pad(rr[0], 38) + padL(arr.length ? ms(quant(arr, 0.5)) : '—', 10)
        + padL(arr.length ? ms(Math.max.apply(null, arr)) : '—', 10) + '  ' + rr[2]);
    }
    L.push('  ⭐ 判讀重點（v6.213 新增的「伺服器處理」那一欄）：');
    L.push('    ・「網路」大而「伺服器處理」小 ⇒ Node 早就處理完了，時間全花在 Cloudflare／隧道／線路。');
    L.push('    ・兩者都大 ⇒ 這次真的是伺服器自己慢（DB 查詢／序列化），修伺服器才有意義。');
    L.push('    ・「伺服器處理」是「—」⇒ 帶標頭的回報 ' + sample.srvHdr.withHeader + ' 筆、'
      + '沒帶的 ' + sample.srvHdr.without + ' 筆；沒帶＝伺服器還沒跑 redeploy-oracle.bat，'
      + '**不是**「伺服器很快」。');
    if (sample.byVersion.length) {
      L.push('  取樣者的版本分佈：' + sample.byVersion.map(function (v) { return 'v' + v.ver + ' ' + v.n + ' 筆'; }).join('、'));
    }
    if (sample.byPlatform.length) {
      L.push('  取樣者的平台分佈：' + sample.byPlatform.map(function (v) { return v.platform + ' ' + v.n + ' 筆'; }).join('、'));
    }
  }
  L.push('');
  L.push('【②-e 🌐 Cloudflare 邊緣節點（colo）分佈（v6.227 起）】←「慢的人集不集中在特定節點」看這裡');
  L.push('  v6.227 起玩家的回報帶「這場對戰經過哪個 CF 邊緣節點」（從既有回應的 cf-ray 標頭讀，零額外請求）。');
  L.push('  ⭐ 這一欄就是為了分辨兩個假說：');
  L.push('    ・慢的人（slow-rtt 佔比高／net 尾巴大）**集中在特定 colo** ⇒ 那個邊緣節點（或它到隧道');
  L.push('      那一段）劣化——重啟 cloudflared 只是碰巧換了節點，治標不治本。');
  L.push('    ・慢的人**跨所有 colo 都有** ⇒ 問題在更下游（cloudflared 本身／VM／共享路徑），與節點無關。');
  L.push('  ⚠⚠ 下面兩張表母體不同（異常批 vs 健康取樣批），數字**不可相加、也不可互比快慢**。');
  L.push('  ⚠ 「net典型」＝各筆 p50 的中位數（到節點的物理距離）；「net尾巴」＝各筆 p95 的中位數（劣化指紋）。');
  L.push('  ・異常批（出了問題才回報的人）：');
  for (const _cl of coloTableLines(coloAnom, false)) L.push(_cl);
  L.push('  ・健康取樣批（每場 10% 無條件抽樣）：');
  for (const _cl of coloTableLines(coloSamp, true)) L.push(_cl);
  L.push('');
  L.push('【③ ⭐ client 版本分佈】←「還有多少人停在舊版」看這裡');
  if (!byVersion.length) {
    L.push('  沒有資料。');
  } else {
    L.push('  ' + pad('版本', 12) + padL('筆數', 8) + padL('佔比', 9) + padL('人數', 8) + padL('人數佔比', 11));
    for (const v of byVersion) {
      L.push('  ' + pad('v' + v.ver, 12) + padL(v.n, 8) + padL(pct(v.n, rows.length), 9)
        + padL(v.players, 8) + padL(pct(v.players, uidSet.size), 11)
        + (latestVer && v.ver === latestVer ? '   ← 最新' : ''));
    }
    const oldRows = byVersion.filter(function (v) { return v.ver !== latestVer; }).reduce(function (a, v) { return a + v.n; }, 0);
    L.push('  ⚠ 非最新版本的回報共 ' + oldRows + ' 筆（' + pct(oldRows, rows.length) + '）。');
    L.push('    「最新」是以本次資料裡出現過的最高版本（v' + (latestVer || '?') + '）為準，不是寫死的。');
    L.push('    舊版畫面（v6.159 之前）不會回報 perf 欄位 ⇒ 那些人在 admin 表格右邊全部是「—」，');
    L.push('    不是他們很順，是他們的畫面還沒更新。');
  }
  L.push('');
  L.push('【④ 動作往返時間（RTT）分佈】');
  if (!rtt.length) {
    L.push('  這段期間沒有任何帶 RTT 數字的回報。');
  } else {
    const slowOnly = rtt.filter(function (r) { return r.reason === 'slow-rtt'; }).length;
    L.push('  有 RTT 數字的回報共 ' + rtt.length + ' 筆（其中 slow-rtt 指紋 ' + slowOnly + ' 筆；');
    L.push('  admin 畫面那張表只畫 slow-rtt 的前 20 筆，這裡是全部）。');
    const buckets = [
      ['< 1 秒（正常）', function (v) { return v < 1000; }],
      ['1 ~ 3 秒', function (v) { return v >= 1000 && v < 3000; }],
      ['3 ~ 5 秒', function (v) { return v >= 3000 && v < 5000; }],
      ['5 ~ 10 秒', function (v) { return v >= 5000 && v < 10000; }],
      ['≥ 10 秒（很嚴重）', function (v) { return v >= 10000; }],
    ];
    for (const b of buckets) {
      const c = rtt.filter(function (r) { return b[1](r.p95); }).length;
      L.push('    ' + pad(b[0], 20) + padL(c, 6) + ' 筆' + padL(pct(c, rtt.length), 9));
    }
    const all95 = rtt.map(function (r) { return r.p95; });
    L.push('  全體 p95 的中位數 ' + ms(quant(all95, 0.5)) + '，最差 ' + ms(Math.max.apply(null, all95)) + '。');
    L.push('');
    L.push('  最慢的玩家（依最差 p95 排序，最多列 15 位）：');
    L.push('    ' + pad('玩家', 34) + padL('最差p95', 10) + padL('中位p95', 10) + padL('回報數', 8) + '  版本');
    for (const p of players.slice(0, 15)) {
      L.push('    ' + pad(p.who, 34) + padL(ms(p.worstP95), 10) + padL(ms(p.medianP95), 10)
        + padL(p.reports, 8) + '  ' + (p.vers.length ? p.vers.map(function (v) { return 'v' + v; }).join(',') : '(未知)'));
    }
    if (players.length > 15) L.push('    …另有 ' + (players.length - 15) + ' 位，完整名單在 JSON 的 rttPlayers。');
  }
  L.push('');
  L.push('【⑤ 卡在網路，還是卡在那台裝置？（v6.159 起才有的分段數字）】');
  if (!perfRows) {
    L.push('  這段期間沒有任何 v6.159 之後的回報 ⇒ 分不出來。等玩家更新畫面後再跑一次。');
  } else {
    L.push('  有分段數字的回報：' + perfRows + ' 筆（' + pct(perfRows, rows.length) + '，＝已更新到 v6.159 以後的畫面）。');
    L.push('  以下每一欄都是「各筆 p95 的中位數 / 最大值」：');
    const rowsOut = [
      ['網路（送出→伺服器回第一個位元組）', perfVals.net, '網路／隧道'],
      ['下載（把整份盤面收下來）', perfVals.dl, '網路／隧道'],
      ['權杖（登入憑證換發，正常是 0）', perfVals.tok, '那台裝置'],
      ['解析（JSON 轉物件）', perfVals.parse, '那台裝置'],
      ['採納（把新盤面吃進畫面狀態）', perfVals.adopt, '那台裝置'],
      ['重繪（畫面真的更新）', perfVals.paint, '那台裝置'],
    ];
    L.push('    ' + pad('項目', 36) + padL('中位數', 10) + padL('最大', 10) + '  歸屬');
    for (const rr of rowsOut) {
      const arr = rr[1];
      L.push('    ' + pad(rr[0], 36) + padL(arr.length ? ms(quant(arr, 0.5)) : '—', 10)
        + padL(arr.length ? ms(Math.max.apply(null, arr)) : '—', 10) + '  ' + rr[2]);
    }
    if (ltVals.n.length) {
      L.push('    長任務（每分鐘卡住主執行緒）：' + ltVals.n.length + ' 筆有數字，'
        + '次數中位數 ' + quant(ltVals.n, 0.5) + ' 次、單次最長 ' + ms(Math.max.apply(null, ltVals.max)));
    }
    L.push('    ⚠ 有 ' + ltUnsupported + ' 筆長任務顯示「不支援」＝那台是 iPhone／Safari，瀏覽器不給這個數字，');
    L.push('      不是代表它很順（請改看「重繪」那一欄）。');
    L.push('  判讀：網路／下載小，但解析／採納／重繪／長任務大 ⇒ 瓶頸在玩家自己的裝置，');
    L.push('        再怎麼修伺服器都不會有效果。反過來才是伺服器／隧道要處理的。');
    L.push('        ⚠ 裝置忙不過來時，網路／下載也會跟著被灌水，不要只看一欄就下結論。');
  }
  if (byPlatform.length) {
    L.push('');
    L.push('  裝置平台分佈（從 User-Agent 推）：');
    for (const p of byPlatform) L.push('    ' + pad(p.platform, 18) + padL(p.n, 6) + ' 筆 /' + padL(p.players, 4) + ' 人');
  }
  L.push('');
  L.push('【⑥ 資料完整性】');
  L.push('  明細共 ' + rows.length + ' 筆，其中 ' + trunc.total + ' 筆（' + pct(trunc.total, rows.length) + '）的診斷內容被切斷，');
  L.push('  那幾筆的 perf／svelteWarn／User-Agent 沒能完整存下來。');
  L.push('  （被切斷的列在 admin 📡 分頁的 RTT 表上是**完全看不到**的，這裡已用文字比對盡量救回。）');
  L.push('    ・伺服器明確標記被切：' + trunc.srv + ' 筆　←v6.184 起才有，這是紀錄不是推論');
  L.push('    ・只能從解析失敗推論：' + trunc.legacy + ' 筆　←v6.184 之前寫進去的舊列');
  L.push('    ・長度已頂到目前上限 ' + DIAG_CAP + ' 字元：' + trunc.capped + ' 筆　←這欄不是 0 就代表該再放大');
  L.push('    ・長度卡在舊上限 ' + LEGACY_DIAG_CAP + ' 字元：' + trunc.legacyCapped + ' 筆　←v6.184 之前寫進去的');
  if (trunc.maxRawLen) {
    L.push('  截斷前最長的一筆是 ' + trunc.maxRawLen + ' 字元（上限 ' + DIAG_CAP + '，用掉 '
      + Math.round(trunc.maxRawLen * 100 / DIAG_CAP) + '%）。');
    L.push('  ⚠ 這個百分比逼近 100% 就代表上限又該放大了 —— 不要等到又有人的資料整組不見才發現。');
  } else {
    L.push('  ⚠ 沒有任何一筆帶 rawLen ⇒ 這批全是 v6.184 之前寫進去的舊列（那時候還沒有這個欄位）。');
  }
  L.push('');
  L.push('【②-e 🎮 休閒對戰批（v6.261 起才有）】← 佔全站 94% 流量，在此之前完全沒有指紋');
  L.push('  ⚠⚠⚠ 這一塊的數字**絕不可以**跟上面【②】【②-d】的任何數字相加或互相比較：');
  L.push('    錦標賽走 /action（伺服器權威，一次往返＝一個動作）；');
  L.push('    休閒是 client-authoritative（一個動作＝把整包盤面 40~48KB PUT 上去，最多 5 輪 GET+PUT）。');
  L.push('    「一次往返」在兩邊根本不是同一件事 ⇒ 母體不同，只能各看各的趨勢。');
  L.push('  ⚠ 母體再縮一層：**只有已登入 email 帳號的休閒玩家會送**（伺服器不收匿名身分）。');
  if (!casual.rows) {
    L.push('  這段期間沒有任何休閒回報。⚠ 這**不是**「休閒都很順」，有三種可能：');
    L.push('    ①玩家的畫面還沒更新到 v6.261（看上面【④】的版本分佈）；');
    L.push('    ②真的沒有人中籤也沒有人慢（取樣是每場 10%、slow-push 門檻是 p95 ≥ 5 秒）；');
    L.push('    ③那段期間的休閒玩家都沒有登入 email 帳號。');
  } else {
    L.push('  合計 ' + casual.rows + ' 筆 / ' + casual.players + ' 人（其中 ' + casual.truncated + ' 筆 payload 被截斷）。');
    for (const r of casual.byReason) {
      L.push('  ・' + pad(r.label, 32) + padL(r.n, 6) + ' 次   [' + r.reason + ']');
    }
    if (casual.push.rowsWithPush) {
      L.push('  ── 盤面上傳（＝玩家上行）耗時，' + casual.push.rowsWithPush + ' 筆有這一欄：');
      L.push('     p50 中位數 ' + ms(quant(casual.push.p50, 0.5)) + '　p95 中位數 ' + ms(quant(casual.push.p95, 0.5))
        + '　p95 最差 ' + ms(casual.push.p95.length ? Math.max.apply(null, casual.push.p95) : null)
        + '　單發最久 ' + ms(casual.push.max.length ? Math.max.apply(null, casual.push.max) : null));
      L.push('     推送失敗／逾時累計 ' + casual.push.fail + ' 次（⚠ 失敗那幾發**沒有**算進上面的 p50/p95）。');
      L.push('     ⚠ 這是 v6.245／v6.246「慢的是玩家上行」這個結論的**玩家端**實測值 ——');
      L.push('       在此之前只有 nginx 的 408／upstream=- 這種伺服器端的旁證。');
    }
    if (casual.forfeitClaim.total) {
      L.push('  ── 🏳 玩家宣告「對手棄權」' + casual.forfeitClaim.total + ' 次：');
      L.push('     伺服器同意 ' + casual.forfeitClaim.granted + ' 次（對手真的沒動作）／');
      L.push('     伺服器擋下 ' + casual.forfeitClaim.rejected + ' 次（**宣告者的畫面是舊的**，對手其實動過了）'
        + (casual.forfeitClaim.unknown ? '／判不出來 ' + casual.forfeitClaim.unknown + ' 次' : ''));
      L.push('     ⚠ 這是「對手誤拿棄權勝」的**頻率下界**，不是上界：被誤判掉的那一方本來就卡住、');
      L.push('       他的畫面送不出任何回報 ⇒ 這裡永遠只看得到宣告者那一側。');
    }
    if (casual.byVersion.length) {
      L.push('  ── 休閒回報者的版本分佈：' + casual.byVersion.slice(0, 6).map(function (v) { return v.ver + ' ' + v.n; }).join('、'));
    }
    if (casual.byPlatform.length) {
      L.push('  ── 休閒回報者的平台分佈：' + casual.byPlatform.slice(0, 6).map(function (v) { return v.platform + ' ' + v.n; }).join('、'));
    }
  }
  L.push('');
  L.push('【⑦ 接下來】');
  L.push('  完整資料在同一個資料夾、同名的 .json（每一筆 payload 的 poll.rtt / perf.* / env.ua 都在裡面）。');
  L.push('  ⚠ JSON 裡異常在 rows / rtt，取樣在 sample.list，休閒在 casual.list —— **是三個不同的陣列**，');
  L.push('    三者母體都不同，別合併起來算（相加只有在講「資料庫總列數」時才有意義）。');
  L.push('  把那個 .json 整包交給 AI，它才有辦法幫你定位「到底是誰卡、卡在哪一段」。');
  L.push('============================================================');
  // BOM：站長會直接用記事本／Excel 開，加了 BOM 才保證不會變亂碼。
  fs.writeFileSync('/tmp/ptcg_monitor_summary.txt', '﻿' + L.join('\r\n') + '\r\n', 'utf8');

  console.log('');
  console.log(L.join('\n').replace(/^﻿/, ''));
  console.log('');
  console.log('完整資料已寫出: /tmp/ptcg_monitor_dump.json (' + rows.length + ' 筆異常明細 / ' + rtt.length + ' 筆 RTT / ' + sample.rows + ' 筆取樣 / ' + casual.rows + ' 筆休閒 ⚠ 四個數字母體不同，不可相加)');
  console.log('摘要已寫出:     /tmp/ptcg_monitor_summary.txt');
  await client.close();
}

// ⭐v6.184 只有被**直接執行**時才跑（`node /tmp/dump-client-monitor.cjs 7d` 與以前完全相同）；
//   被 require 進來時只匯出純函式，讓守衛可以實跑判定邏輯而不需要任何資料庫。
module.exports = { DIAG_CAP: DIAG_CAP, LEGACY_DIAG_CAP: LEGACY_DIAG_CAP, parseDiag: parseDiag, classifyTrunc: classifyTrunc, truncSummary: truncSummary, reasonLabel: reasonLabel, parseRange: parseRange, verCmp: verCmp, staleGateOf: staleGateOf, oppQuietOf: oppQuietOf,
  // ⭐v6.213 守衛要**實跑**分帳邏輯（只驗字串存在擋不住「接線沒接上」）。
  SAMPLE_REASONS: SAMPLE_REASONS, isSampleReason: isSampleReason, splitDiagRows: splitDiagRows, sampleSummary: sampleSummary,
  // ⭐v6.261 休閒批的分帳述詞與彙總（守衛要**實跑**，只驗字串存在擋不住「接線沒接上」）。
  CASUAL_REASON_PREFIX: CASUAL_REASON_PREFIX, isCasualReason: isCasualReason, casualSummary: casualSummary,
  // ⭐v6.227 守衛要實跑 colo 分組（只驗字串存在擋不住「接線沒接上」）。
  coloOf: coloOf, coloSummary: coloSummary, coloTableLines: coloTableLines };
if (require.main === module) {
  main().catch(function (e) { console.error('ERROR:', e && e.message); process.exit(1); });
}
