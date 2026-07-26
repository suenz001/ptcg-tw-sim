// v6.035 守衛：社群賽開辦通知（廣播型推播 + 可勾選偏好）。
//
// 這個功能有一個很容易做錯、而且**做錯了完全不會報錯**的地方：
//   推播是**伺服器主動發**的，所以「要不要收」的偏好**必須存在伺服器**。
//   如果只寫 localStorage，玩家把開關關掉後伺服器根本不知道，照樣推給他——
//   畫面顯示「已關閉」但通知繼續來，而且沒有任何錯誤訊息可查。
// 另一個陷阱是預設值方向：Wilson 裁定「預設開」，所以伺服器端判定必須是
//   `$ne: false`（欄位缺席＝開啟）。若寫成 `=== true`，所有既有訂閱者都收不到，
//   功能等於沒上線，而且一樣不會報錯。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const pat = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');
const notify = readFileSync(join(ROOT, 'src/lib/notify.ts'), 'utf8').replace(/\r\n/g, '\n');
const page = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

// ── 後端 ──
T('前提：有 broadcastPush（推給所有訂閱者）與 /push/prefs 端點', () => {
  assert.ok(/async function broadcastPush\(/.test(pat), '應有 broadcastPush');
  assert.ok(pat.includes("app.post('/api/tournament/push/prefs'"), '應有 push/prefs 端點');
});

T('⭐⭐預設開：伺服器用 $ne:false 判定（欄位缺席＝開啟）', () => {
  const i = pat.indexOf('async function broadcastPush(');
  const body = pat.slice(i, pat.indexOf('\n    }', i));
  assert.ok(/\$ne:\s*false/.test(body),
    '必須用 { $ne: false } —— 寫成 === true 會讓所有既有訂閱者（沒有這個欄位）全部收不到，功能等於沒上線');
});

T('⭐發起者自己不會收到自己開的賽事通知', () => {
  const i = pat.indexOf('void broadcastPush(');
  assert.ok(i > 0, 'propose 端點應呼叫 broadcastPush');
  const call = pat.slice(i, pat.indexOf(');', i) + 2);
  assert.ok(/excludeUid:\s*id\.uid/.test(call), '應以 excludeUid 排除發起者本人');
  assert.ok(/prefKey:\s*'notifyCommunity'/.test(call), '應帶 prefKey 讓關閉此類通知的人不被推');
});

T('⭐推播失敗不可影響賽事建立（fire-and-forget）', () => {
  // 全檔任何 broadcastPush 的呼叫點都不可被 await —— 推播服務逾時會拖著整個
  // 「發起社群賽」的請求，玩家會看到轉圈圈甚至逾時，而賽事其實已經建好了。
  const calls = [...pat.matchAll(/(\w+\s+)?broadcastPush\(/g)]
    .filter((m) => !/async function/.test(pat.slice(Math.max(0, m.index - 20), m.index)));
  assert.ok(calls.length >= 1, '應至少有一處呼叫 broadcastPush');
  for (const c of calls) {
    const prefix = pat.slice(Math.max(0, c.index - 10), c.index + 'broadcastPush('.length);
    assert.ok(!/await\s+broadcastPush\($/.test(prefix), 'broadcastPush 不可被 await：' + prefix.trim());
  }
  assert.ok(pat.includes('void broadcastPush('), '應以 void 明示 fire-and-forget');
});

T('⭐偏好是「人」層級：同一玩家多裝置要一起更新', () => {
  const i = pat.indexOf("app.post('/api/tournament/push/prefs'");
  const body = pat.slice(i, pat.indexOf('\n    });', i));
  assert.ok(/updateMany\(\{\s*uid:/.test(body),
    '必須用 updateMany 依 uid 更新全部訂閱 —— 用 updateOne 只會改到其中一台裝置');
});

T('廣播有筆數上限（防訂閱數暴增時一次送爆）', () => {
  const i = pat.indexOf('async function broadcastPush(');
  const body = pat.slice(i, pat.indexOf('\n    }', i));
  assert.ok(/\.limit\(cap\)/.test(body), '應以 cap 限制單次推播筆數');
});

// ── 前端 ──
T('⭐⭐偏好必須同時寫伺服器，只寫 localStorage 完全無效', () => {
  const i = notify.indexOf('export async function saveNotifyCommunity');
  assert.ok(i > 0, '應有 saveNotifyCommunity');
  const body = notify.slice(i, notify.indexOf('\n}', i));
  assert.ok(body.includes('localStorage.setItem'), '應寫 localStorage（UI 狀態）');
  assert.ok(body.includes("'/push/prefs'"),
    '必須呼叫 /push/prefs —— 推播由伺服器發送，只存本機的話關掉開關伺服器仍會照推');
});

T('前端預設值與伺服器一致（都是「開」）', () => {
  const i = notify.indexOf('export function getNotifyCommunity');
  const body = notify.slice(i, notify.indexOf('\n}', i));
  assert.ok(/!==\s*'0'/.test(body), '應為「不等於 0 就是開」，與伺服器 $ne:false 對齊');
});

T('訂閱成功後會補送一次偏好（涵蓋上次送失敗／換裝置）', () => {
  const i = notify.indexOf("savePushServerState({ ok: true, stage: 'ok', host });");
  const after = notify.slice(i, i + 500);
  assert.ok(after.includes("'/push/prefs'"), 'subscribePush 成功後應補送偏好');
});

T('UI：勾選框存在，且從屬於通知總開關（總開關關掉時不可用）', () => {
  assert.ok(page.includes('tourn-nt-sub'), '應有子項樣式');
  const i = page.indexOf('tourn-nt-sub');
  const block = page.slice(i, i + 600);
  assert.ok(block.includes('saveNotifyCommunity('), '勾選要呼叫 saveNotifyCommunity');
  assert.ok(/disabled=\{!notifyEnabled/.test(block),
    '總開關關閉時應 disabled —— 沒有推播訂閱時這個勾選沒有意義，開著會誤導');
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
