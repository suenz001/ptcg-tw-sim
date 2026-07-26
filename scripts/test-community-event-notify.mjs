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

/** propose 端點內那段推播程式碼（v0.99 起包在 void (async () => {...})() 內）。 */
function proposeBroadcastBlock() {
  const i = pat.indexOf("title: '📣 有人發起社群賽'");
  assert.ok(i > 0, 'propose 端點應有社群賽推播');
  return pat.slice(Math.max(0, i - 600), i + 800);
}

T('⭐發起者自己不會收到自己開的賽事通知', () => {
  const block = proposeBroadcastBlock();
  assert.ok(/excludeUid:\s*id\.uid/.test(block), '應以 excludeUid 排除發起者本人');
  assert.ok(/prefKey:\s*'notifyCommunity'/.test(block), '應帶 prefKey 讓關閉此類通知的人不被推');
});

T('⭐推播失敗不可影響賽事建立（fire-and-forget）', () => {
  // 推播服務逾時不可拖著整個「發起社群賽」的請求（玩家會看到轉圈圈，但賽事其實已建好）。
  // v0.99 起要先 await getBusyUids()，所以整段包在 void (async () => {...})() 內：
  //   內層的 await 在 IIFE 裡不影響主流程，外層的 void 才是「不阻塞」的保證。
  const i = pat.indexOf("title: '📣 有人發起社群賽'");
  const before = pat.slice(Math.max(0, i - 600), i);
  // ⚠IIFE **內部**的 await 是必要且正確的（要先 await getBusyUids()）——
  //   要防的是「沒有 void 包、直接寫在 handler 主流程」的 await。
  //   判準：await broadcastPush 之前必須先出現 void (async () => {。
  const voidAt = before.lastIndexOf('void (async () =>');
  const awaitAt = before.lastIndexOf('await broadcastPush(');
  if (awaitAt >= 0) {
    assert.ok(voidAt >= 0 && voidAt < awaitAt,
      'await broadcastPush 必須包在 void (async () => {…})() 內，否則會阻塞發起社群賽的請求');
  } else {
    assert.ok(/void\s+broadcastPush\(/.test(before), '推播必須是 fire-and-forget');
  }
});

T('⭐⭐跳過正在對戰中的玩家（Wilson v0.99 更正：不打擾比賽中的人）', () => {
  assert.ok(/async function getBusyUids\(/.test(pat), '應有 getBusyUids()');
  const i = pat.indexOf('async function getBusyUids(');
  const body = pat.slice(i, pat.indexOf('\n    }', i));
  assert.ok(/TMATCH\.find\(\s*\{\s*status:\s*'playing'/.test(body), '應查錦標賽進行中的對戰');
  assert.ok(/collection\('rooms'\)[\s\S]{0,120}status:\s*'playing'/.test(body), '應查休閒進行中的房間');
  assert.ok(/memberUids/.test(body) && /p1uid/.test(body), '兩邊的玩家 uid 都要收集');
  // 呼叫端必須真的把它帶進 broadcastPush
  const call = pat.slice(pat.indexOf('void (async () => {'), pat.indexOf('})();', pat.indexOf('void (async () => {')));
  assert.ok(call.includes('getBusyUids()') && /excludeUids:\s*busy/.test(call),
    'propose 的廣播必須帶 excludeUids: busy');
});

T('⭐休閒房必須加 updatedAt 時間窗（否則殭屍房會讓玩家永遠收不到通知）', () => {
  const i = pat.indexOf('async function getBusyUids(');
  const body = pat.slice(i, pat.indexOf('\n    }', i));
  assert.ok(/updatedAt:\s*\{\s*\$gte:\s*since\s*\}/.test(body),
    "rooms 查詢必須有 updatedAt 時間窗 —— status:'playing' 會有殭屍殘留，"
    + '一個卡住的舊房間會讓那兩位玩家從此再也收不到通知');
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
