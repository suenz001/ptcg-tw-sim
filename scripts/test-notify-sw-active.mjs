// v6.033 守衛：發通知前必須確認 Service Worker 有 **active worker**。
//
// 真實事故（Windows 桌機回報）：按「發送測試通知」得到
//   ⚠️ 透過背景服務發送失敗：Failed to execute 'showNotification' on
//      'ServiceWorkerRegistration': No active registration available on the
//      ServiceWorkerRegistration.
//
// 兩個 bug：
//   ① `navigator.serviceWorker.getRegistration()` 只要「有註冊記錄」就回傳物件，
//      但它可能還停在 installing / waiting、`.active` 是 null；
//      此時呼叫 `reg.showNotification()` 會直接拋上面那個錯。
//      最容易踩到：首次載入本站／剛清過快取／版本更新後新 SW 尚未接手。
//   ② sendTestNotification 的 catch **直接 return 失敗**，根本不會落到下面的
//      頁面層 `new Notification()` fallback —— Windows 桌機明明完全支援它。
//
// 這兩件事都無法用單元測試跑真實瀏覽器行為驗證，所以用靜態結構檢查釘住。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const src = readFileSync(join(ROOT, 'src/lib/notify.ts'), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

T('前提：notify.ts 有中央的 getActiveRegistration()', () => {
  assert.ok(/async function getActiveRegistration\(/.test(src), '應有 getActiveRegistration()');
});

T('⭐⭐取得 registration 一律走 getActiveRegistration()，不可直接用 getRegistration()', () => {
  // ⚠先剝掉註解 —— helper 上方的 JSDoc 會引用 getRegistration() 來解釋為什麼不能直接用它，
  //   不剝的話那段說明文字會被當成違規呼叫（第一版就中招）。用等長空白替換以保留位移。
  const src2 = src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));
  const raw = [...src2.matchAll(/navigator\.serviceWorker\??\.getRegistration/g)];
  // 只允許出現在 helper 內部（快路徑）
  const helperStart = src.indexOf('async function getActiveRegistration(');
  const helperEnd = src.indexOf('\n}', helperStart);
  const outside = raw.filter((m) => m.index < helperStart || m.index > helperEnd);
  assert.equal(outside.length, 0,
    'helper 之外還有 ' + outside.length + ' 處直接呼叫 getRegistration() —— '
    + 'registration 可能沒有 active worker，showNotification 會拋 "No active registration available"');
});

T('⭐getActiveRegistration 必須檢查 .active（有註冊 ≠ 能發通知）', () => {
  const i = src.indexOf('async function getActiveRegistration(');
  const body = src.slice(i, src.indexOf('\n}', i));
  assert.ok(/\.active/.test(body), '必須檢查 reg.active');
  assert.ok(body.includes('serviceWorker.ready'), '應用 navigator.serviceWorker.ready 等待 activate');
});

T('⭐serviceWorker.ready 必須有逾時保護（從未註冊 SW 時它會永遠 pending）', () => {
  const i = src.indexOf('async function getActiveRegistration(');
  const body = src.slice(i, src.indexOf('\n}', i));
  assert.ok(/Promise\.race/.test(body), '應以 Promise.race 加上逾時');
  assert.ok(/setTimeout/.test(body), '應有 setTimeout 作為逾時來源');
  assert.ok(/timeoutMs/.test(body), '逾時值應可調整（具名參數）');
});

T('⭐⭐測試通知：SW 這條路失敗時必須落到頁面層 fallback，不可提早 return', () => {
  const i = src.indexOf('export async function sendTestNotification');
  const body = src.slice(i, src.indexOf('\nexport ', i + 10));
  // 找 SW try/catch 之後是否還有頁面層 new Notification
  const swCatch = body.indexOf('} catch (e) {');
  assert.ok(swCatch > 0, '應有 SW 的 try/catch');
  const after = body.slice(swCatch);
  assert.ok(after.includes('new Notification('),
    'SW 失敗後必須還有頁面層 new Notification() 的路徑');
  // catch 內不可直接 return 失敗（那樣就永遠走不到 fallback）
  const catchBlock = body.slice(swCatch, body.indexOf('\n  }', swCatch));
  assert.ok(!/return\s*\{\s*ok:\s*false/.test(catchBlock),
    'SW 的 catch 內不可直接 return 失敗 —— 會讓 Windows 桌機完全收不到通知（它支援頁面層通知）');
});

T('⭐診斷的「背景服務」要判 active，不能只判有沒有註冊記錄（否則是假綠燈）', () => {
  const i = src.indexOf('out.swRegistered');
  assert.ok(i > 0, '應有 swRegistered 診斷欄位');
  const line = src.slice(i, src.indexOf('\n', i));
  assert.ok(line.includes('active'),
    'swRegistered 應判 reg.active —— 只判 !!reg 會在「已註冊但未啟用」時顯示 ✅ 假綠燈');
});

T('推播訂閱／取消訂閱也走同一個 helper（pushManager 在無 active 時同樣不可靠）', () => {
  for (const fn of ['export async function subscribePush', 'export async function unsubscribePush']) {
    const i = src.indexOf(fn);
    assert.ok(i > 0, '應有 ' + fn);
    const body = src.slice(i, i + 1200);
    assert.ok(body.includes('getActiveRegistration('), fn + ' 應走 getActiveRegistration()');
  }
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
