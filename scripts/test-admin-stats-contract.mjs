// v1.61 守衛：admin 賽事統計的「前端用到的欄位」必須真的由端點回傳（資料契約）。
//
// 真實事故：v1.60 在前端加了「官方賽／社群自辦賽」篩選，判斷依據是 archive.communityEvent。
//   歸檔資料本身有存這個欄位（recordTournamentArchive 寫 communityEvent: !!ev.createdByPlayer），
//   但 `/api/tournament/admin/stats` 的 archives.map **沒有把它挑出來回傳** →
//   前端拿到的永遠是 undefined → 每一場都被判成官方賽，篩選看起來完全沒作用。
//
//   ⚠這種錯誤不會 throw、不會有紅字：少一個欄位就只是變成 undefined，
//     而 undefined 在布林判斷下是個「合理」的值，於是靜默地全部歸到同一邊。
//   → 用靜態方式比對「端點回傳的欄位」vs「前端讀取的欄位」。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const pat = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');
const adm = readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8');

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

/** 取出 `/api/tournament/admin/stats` 端點裡 archives.map 回傳物件的欄位名。 */
function archiveFieldsFromEndpoint() {
  const i = pat.indexOf("app.get('/api/tournament/admin/stats'");
  assert.ok(i > 0, '找不到賽事統計端點');
  const j = pat.indexOf('archives: archives.map((a) => ({', i);
  assert.ok(j > i, '找不到 archives.map');
  // 用大括號深度追蹤，只收「archive 物件這一層」的 key。
  //   （正則行不通：players/matches 的 .map((p) => ({...})) 巢狀在同一段裡，
  //    無論用第一個 '})),' 當結尾或非貪婪比對都會截錯。）
  const open = pat.indexOf('({', j) + 1;   // 指向 archive 物件字面的 '{'
  let depth = 0, end = open;
  for (let i = open; i < pat.length; i++) {
    if (pat[i] === '{') depth++;
    else if (pat[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  const body = pat.slice(open + 1, end);   // +1 跳過最外層的 '{'，否則整段深度都 >=1、一個欄位都收不到
  const fields = new Set();
  depth = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '{' || c === '(') depth++;
    else if (c === '}' || c === ')') depth--;
    else if (depth === 0) {
      const m = /^(\w+)\s*:/.exec(body.slice(i));
      if (m && !/[\w$.]/.test(body[i - 1] || '')) { fields.add(m[1]); i += m[0].length - 1; }
    }
  }
  return fields;
}

const epFields = archiveFieldsFromEndpoint();

T('前提：抓得到端點回傳的 archive 欄位清單', () => {
  assert.ok(epFields.size >= 8, '欄位數異常，實得 ' + epFields.size);
  console.log('   端點回傳欄位：' + [...epFields].sort().join('、'));
});

T('⭐⭐事故回歸鎖：communityEvent 必須由端點回傳（否則官方/社群篩選會靜默失效）', () => {
  assert.ok(epFields.has('communityEvent'),
    'archives.map 少了 communityEvent —— 前端的官方/社群篩選會拿到 undefined，把每一場都判成官方賽');
});

T('⭐前端讀取的 archive 欄位，端點都要有回傳', () => {
  // 明確列出前端確實從「賽事歸檔物件」上讀的欄位。
  //   刻意用白名單而非全域掃描 —— renderTournamentStats 裡的排序比較函式也叫 (a, b)，
  //   但那個 a 是聚合後的玩家物件，全掃會把 titles/wins/losses 之類誤判成 archive 欄位。
  //   新增前端篩選/顯示欄位時，請把欄位名加到這裡，這條就會替你檢查端點有沒有跟著回傳。
  const FRONTEND_USES = [
    'eventId', 'eventName', 'createdAt', 'startedAt', 'finishedAt',
    'playerCount', 'championUid', 'championName', 'players', 'matches',
    'communityEvent',   // v1.60 官方/社群篩選（v1.61 補回傳）
  ];
  const missing = FRONTEND_USES.filter((f) => !epFields.has(f));
  assert.deepEqual(missing, [],
    '前端讀了這些欄位但端點沒回傳（會靜默變成 undefined）：' + missing.join('、'));
});

// ── 賽程視窗的白底（與全站其他 modal 一致）──
T('⭐賽程視窗用全站共用的 .modal 樣式，不可自己刻深色底', () => {
  const i = adm.indexOf('function _tsModal(');
  const body = adm.slice(i, adm.indexOf('\n}', i));
  assert.ok(body.includes("ov.className = 'modal-bg'"), '遮罩應套用共用的 .modal-bg');
  assert.ok(body.includes('class="modal"'), '內容盒應套用共用的 .modal（白底）');
  assert.ok(!/background:\s*#(13201a|0f1a12|1a2a1a)/.test(body), '不該再有自刻的墨綠底');
});

T('賽程內容不再殘留深色系配色（白底上會看不清楚）', () => {
  const i = adm.indexOf('window.tevShowBracket = function');
  const body = adm.slice(i, adm.indexOf('\n};', i));
  const dark = [...body.matchAll(/#(?:16241a|101810|1e2e1e|4a6a4a|3a5a3a|24322a|9ab\b|ccc\b|dfe\b|bfe0ff)/g)].map((m) => m[0]);
  assert.deepEqual(dark, [], '賽程視窗仍有深色配色：' + dark.join('、'));
});

T('⭐全站不得殘留深色底／亮色字（admin 是白底頁面，深色元件會格格不入或看不清楚）', () => {
  // 亮度公式（人眼感知加權）。深色底 <90、亮色字 >200 在白底頁面上都是問題。
  const lum = (hex) => {
    let x = hex.slice(1);
    if (x.length === 3) x = [...x].map((c) => c + c).join('');
    if (x.length !== 6) return null;
    return 0.299 * parseInt(x.slice(0, 2), 16) + 0.587 * parseInt(x.slice(2, 4), 16) + 0.114 * parseInt(x.slice(4, 6), 16);
  };
  // 刻意保留的語意色（不是「深色底」，是有意義的彩色按鈕）
  const INTENTIONAL = new Set(['#c62828', '#7a1fa2', '#7b1fa2', '#c00', '#fff', '#ffffff']);
  const bad = [];
  adm.split('\n').forEach((line, i) => {
    // ⚠只比對 `background:` 與 `color:`，不可用寬鬆比對 —— `border-color:` 也含 "color"，
    //   會把「淺橘底配淺橘邊」這種正常搭配誤判成亮色字。
    for (const m of line.matchAll(/(?:^|[;"\s])(background|color)\s*:\s*(#[0-9a-fA-F]{3,6})/g)) {
      const [, prop, hex] = m;
      if (INTENTIONAL.has(hex.toLowerCase())) continue;
      const L = lum(hex);
      if (L === null) continue;
      if (prop === 'background' && L < 90) bad.push(`第 ${i + 1} 行 深色底 ${hex}`);
      else if (prop === 'color' && L > 200) bad.push(`第 ${i + 1} 行 亮色字 ${hex}`);
    }
  });
  assert.deepEqual(bad, [], '這些顏色在白底的 admin 頁面上會有問題：\n  ' + bad.join('\n  '));
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
