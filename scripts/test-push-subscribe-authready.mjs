// v6.026：錦標賽 Web Push「訂閱沒登記到伺服器」真根因守衛。
//   症狀：iPhone 上「發送測試通知」有跳出（純本機 registration.showNotification，不經伺服器），
//         但賽事實際開放報到時收不到推播（需要伺服器上有這支裝置的訂閱）。
//   根因：補訂閱掛在對戰頁一次性 $effect 的 else-if 分支，該 effect 在 mount 後幾毫秒就跑完，
//         而 Firebase 登入狀態是**非同步**從 IndexedDB 還原 → 那一刻 firebaseUser 仍為 null
//         → tApi 不帶 Authorization → 伺服器 /push/subscribe 回 401 → subscribePush 整段 catch
//         吞掉回 false → 伺服器一筆訂閱都沒有。而瀏覽器端 pushManager.subscribe() 已經成功，
//         診斷面板顯示「推播訂閱 ✅」＝假綠燈。
//   本測試分兩層：①行為層（真的跑 subscribePush，mock 瀏覽器 API）②結構層（釘住修正不被改回去）。
import { build } from 'esbuild';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E = join(ROOT, '.pushsub-e.ts'), O = join(ROOT, '.pushsub-o.mjs');
process.on('exit', () => { for (const p of [E, O]) { try { unlinkSync(p); } catch { /* */ } } });

// ── mock 瀏覽器環境（必須在 import bundle 前就位）─────────────────────────────
function defineGlobal(name, value) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}
const store = new Map();
globalThis.window = { matchMedia: () => ({ matches: false }) };
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.Notification = function () {};
globalThis.Notification.permission = 'granted';
globalThis.document = { hidden: true };

const SERVER_KEY = 'BEiliuR_Lb4WqcllC0wSwjkNWgDnHL2zMTwl9Bi8zG1tYxKHBC2set50W6hqx7ff8xLAbl8P3wwDpOxxSRJfbfI';
function keyToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
function makeEnv({ existingKey = null, subscribeFails = false, serverRejects = false } = {}) {
  const calls = { subscribed: 0, unsubscribed: 0, posted: 0 };
  const mkSub = (keyBytes) => ({
    endpoint: 'https://web.push.apple.com/AAAA-token',
    options: { applicationServerKey: keyBytes ? keyBytes.buffer.slice(0) : null },
    toJSON: () => ({ endpoint: 'https://web.push.apple.com/AAAA-token', keys: { p256dh: 'x', auth: 'y' } }),
    unsubscribe: async () => { calls.unsubscribed++; return true; },
  });
  let current = existingKey ? mkSub(keyToBytes(existingKey)) : null;
  // Node 22 的 globalThis.navigator 是 getter-only，必須用 defineProperty 覆寫
  defineGlobal('navigator', {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
    serviceWorker: {
      getRegistration: async () => ({
        scope: 'https://www.ptcg-tw-sim.com/',
        showNotification: async () => {},
        pushManager: {
          getSubscription: async () => current,
          subscribe: async ({ applicationServerKey }) => {
            if (subscribeFails) throw new Error('AbortError: push service error');
            calls.subscribed++;
            current = mkSub(applicationServerKey);
            return current;
          },
        },
      }),
    },
  });
  const api = async (path, body) => {
    if (path === '/push/pubkey') return { enabled: true, publicKey: SERVER_KEY };
    if (path === '/push/subscribe') {
      // 真實情境：Firebase 登入尚未還原時 tApi 不帶 Authorization → 伺服器回 401
      if (serverRejects) throw new Error('401: {"error":"需要登入"}');
      calls.posted++;
      assert.ok(body && body.subscription && body.subscription.endpoint, 'subscribe 應帶 subscription');
      return { ok: true };
    }
    throw new Error('unexpected path ' + path);
  };
  return { api, calls };
}

writeFileSync(E, "export * from './src/lib/notify';\n");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib') }, logLevel: 'error' });
const N = await import(pathToFileURL(O).href);

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };
const TA = async (n, fn) => { try { await fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

// ── ① 行為層 ────────────────────────────────────────────────────────────────
await TA('登入尚未就緒→伺服器回 401：回傳 ok=false / stage=server-reject（HEAD 只回 boolean）', async () => {
  store.clear(); store.set('ptcg.notify.enabled', '1');
  const { api, calls } = makeEnv({ serverRejects: true });
  const r = await N.subscribePush(api);
  assert.equal(typeof r, 'object', 'subscribePush 應回傳結果物件而非 boolean');
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'server-reject', '應標記卡在「登記到伺服器」這一關，實際=' + r.stage);
  assert.equal(calls.subscribed, 1, '瀏覽器端訂閱其實已建立（這正是假綠燈的來源）');
});

await TA('假綠燈可見：本機已訂閱但伺服器未登記時，診斷要分別回報', async () => {
  const d = await N.getNotifyDiagnostics();
  assert.equal(d.pushSubscribed, true, '本機訂閱存在');
  assert.equal(d.serverRegistered, false, '伺服器登記應為 false（HEAD 沒有這個欄位＝看不出問題）');
  assert.equal(d.pushHost, 'web.push.apple.com', '應回報推播通道 host');
  assert.ok(N.describePushStage(d.serverStage).length > 0, 'stage 應有中文說明');
});

await TA('一切正常：回 ok=true 並記錄伺服器登記成功', async () => {
  store.clear(); store.set('ptcg.notify.enabled', '1');
  const { api, calls } = makeEnv({});
  const r = await N.subscribePush(api);
  assert.equal(r.ok, true);
  assert.equal(r.stage, 'ok');
  assert.equal(calls.posted, 1, '應把訂閱送到伺服器');
  const d = await N.getNotifyDiagnostics();
  assert.equal(d.serverRegistered, true);
});

await TA('既有訂閱綁的是舊 VAPID 公鑰 → 退訂重訂（否則推播被 403 擋且永不自癒）', async () => {
  store.clear(); store.set('ptcg.notify.enabled', '1');
  const OLD = 'BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const { api, calls } = makeEnv({ existingKey: OLD });
  const r = await N.subscribePush(api);
  assert.equal(r.ok, true);
  assert.equal(calls.unsubscribed, 1, '公鑰不符應先退訂');
  assert.equal(calls.subscribed, 1, '再以伺服器現行公鑰重新訂閱');
});

await TA('公鑰相同的既有訂閱不重訂（避免每次進頁都換 endpoint）', async () => {
  store.clear(); store.set('ptcg.notify.enabled', '1');
  const { api, calls } = makeEnv({ existingKey: SERVER_KEY });
  const r = await N.subscribePush(api);
  assert.equal(r.ok, true);
  assert.equal(calls.unsubscribed, 0);
  assert.equal(calls.subscribed, 0);
  assert.equal(calls.posted, 1, '仍要重新登記到伺服器（upsert，涵蓋伺服器端遺失的情形）');
});

// ── ② 結構層：釘住修正，防被改回一次性 effect ────────────────────────────────
const page = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
T('對戰頁：補訂閱不得再掛在一次性 _notifyPromptChecked 分支（HEAD 就是這樣壞的）', () => {
  const idx = page.indexOf('_notifyPromptChecked = true;');
  assert.ok(idx > 0, '應仍有首次詢問的一次性 guard');
  const block = page.slice(idx, idx + 900);
  assert.ok(!/else if[^\n]*subscribePush/.test(block),
    '補訂閱不可掛在該一次性 $effect 的 else-if（登入還沒還原就跑掉→401→伺服器沒有訂閱）');
});
T('對戰頁：訂閱改由依賴 firebaseUser 的 $effect 觸發，且只有成功才設 guard', () => {
  assert.ok(/const u = firebaseUser;[\s\S]{0,400}subscribePush\(tApi\)/.test(page),
    '應有依賴 firebaseUser 的訂閱 $effect');
  assert.ok(/if \(r\.ok\) _pushSubDone = true/.test(page), '失敗不可設 guard，否則沒有第二次機會');
});
T('對戰頁：診斷面板要分開顯示「本機訂閱」與「伺服器登記」+ 提供伺服器推播自測', () => {
  assert.ok(page.includes('伺服器登記'), '診斷需顯示伺服器登記狀態');
  assert.ok(page.includes('測試伺服器推播'), '需有由伺服器實際推一則的自測按鈕');
  assert.ok(page.includes("tApi('/push/selftest'"), '自測需呼叫伺服器 selftest 端點');
});

const srv = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');
T('伺服器：新增 push/status 與 push/selftest 診斷端點', () => {
  assert.ok(srv.includes("'/api/tournament/push/status'"), '需要 push/status');
  assert.ok(srv.includes("'/api/tournament/push/selftest'"), '需要 push/selftest');
});
T('伺服器：admin 手動切到報到/進行中要補齊 checkInDeadline / roundStartedAt 與報到推播', () => {
  const i = srv.indexOf("'/api/tournament/admin/event/status'");
  assert.ok(i > 0);
  const block = srv.slice(i, i + 3000);
  assert.ok(block.includes('checkInDeadline'), '手動轉 checkin 未設 deadline → 報到階段永不結束');
  assert.ok(block.includes('roundStartedAt'), '手動轉 running 未設 roundStartedAt → 可進場推播與未進場判負失效');
  assert.ok(block.includes('sendPushToUids'), '手動轉 checkin 也要推播「開放報到」');
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
