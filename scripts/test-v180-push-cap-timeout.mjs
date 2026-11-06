#!/usr/bin/env node
/**
 * server_admin_patch v1.80 守衛：全站推播上限 500 → 5000（只取需要的欄位）＋ 每筆推播 30 秒請求逾時
 *
 * 背景（主機檢查 2026-11-07，伺服器 AI 建議、站長「兩件合在一版做」）：
 *   ① broadcastPush 的 cap 預設 500：訂閱 3 個月內 25 → 427，超過 500 後會**悄悄**只推給其中 500 人（沒有排序、沒有錯誤）。
 *      v1.79 起推播已排隊送出（同時最多 16 筆），人數變多不會加重卡頓 ⇒ 上限調到 5000；
 *      順手只取用得到的欄位（_id／uid／sub），人數多時少解一點 BSON。
 *   ② web-push 預設沒有請求逾時：推播服務卡住時連線會一直掛著。v1.79 的「格子 5 秒讓出」只讓出排隊名額、不收連線
 *      ⇒ 每筆補 30 秒 timeout（呼叫端自己給了就照它的；很舊的 web-push 不認得 timeout 時自動退回不補）。
 *
 * 【A】排隊包裝的逾時（抽 v179 哨兵區塊、注入假 web-push 實跑）
 *   A1 沒給選項 ⇒ 送出時帶 timeout 30000
 *   A2 給了其他選項 ⇒ 保留原選項＋補 timeout；呼叫端的物件不被改動
 *   A3 呼叫端自己給 timeout ⇒ 照它的值
 *   A4 舊版 web-push（不認得 timeout，reject「'timeout' is an invalid option」）⇒ 這筆用原參數重送成功、之後不再補
 *   A5 其他錯誤（410）原封轉交、不重送
 * 【B】真的 broadcastPush（從錦標賽區塊抽出原樣執行；假 TPUSH 會照 projection 投影）
 *   B1 600 個訂閱全部送出（舊上限 500 只會送 500）；B2 只取 _id／uid／sub 三欄；B3 404／410 照樣用 _id 清除；
 *   B4 呼叫端傳 cap 仍有效；B5 關掉通知的端點照樣不推（去重邏輯在投影後仍正確）
 * 【D】錦標賽區塊 28 把鎖重釘（D1～D5）
 * 【H】HEAD-FAIL：BASE（v1.79）跑 A1 與 B1 ⇒ 必紅
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { NEW_TAIL_SHA_V180, NEW_TEV_SHA_V180, NEW_TEV_LEN_V180, revertV180, NEW_TAIL_SHA_V176, NEW_TEV_SHA_V176, NEW_TEV_LEN_V176 } from './lib/tourn-revert-v180.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = '146a1318';   // server v1.79（本版的上一版）
const P = 'oracle-admin/server_admin_patch.js';
const TAIL_ANCHOR = "app.get('/api/tournament";
const TEV_ANCHOR = "const TEVENTS = db.collection('tournamentEvents');";
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + String(x).slice(0, 700) : '')); } };
const sha = (s) => createHash('sha256').update(s).digest('hex');
const rd = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const SRC = rd(P).replace(/\r\n/g, '\n');

function block(src) {
  const a = src.indexOf('  // >>> v179-push-yield\n'), b = src.indexOf('  // <<< v179-push-yield\n');
  if (a < 0 || b < 0 || b < a) return null;
  const s = src.slice(a, b);
  if (s.length < 1500 || s.length > 9000) return null;   // 抽錯段落的護欄
  return s;
}
// 抽出某個 function 宣告（大括號配對，略過字串與註解）
function fnSrc(src, head) {
  const i = src.indexOf(head);
  if (i < 0) return null;
  let j = src.indexOf(') {', i) + 2, d = 0, q = null;
  for (let k = j; k < src.length; k++) {
    const c = src[k];
    if (q) { if (c === '\\') { k++; continue; } if (c === q) q = null; continue; }
    if (c === '/' && src[k + 1] === '/') { k = src.indexOf('\n', k); continue; }
    if (c === '/' && src[k + 1] === '*') { k = src.indexOf('*/', k) + 1; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '{') d++; else if (c === '}') { d--; if (d === 0) return src.slice(i, k + 1); }
  }
  return null;
}
const tick = () => new Promise((r) => setImmediate(r));
async function install(code, fake) {
  const req = (n) => { if (n !== 'web-push') throw new Error('no require'); return fake; };
  const f = new Function('require', '__imp', 'console', `return (async () => { ${code}\n })();`);
  await f(req, async () => { throw new Error('no import'); }, { log() {}, warn() {} });
  for (let i = 0; i < 5; i++) await tick();
}
// 假 web-push：記下每一次收到的參數；oldLib＝模擬 3.4.0 以前（不認得 timeout 選項，與真的 web-push 一樣用 reject 回報）
function fakeWebPush({ oldLib = false, failMap = new Map() } = {}) {
  const calls = [];
  return {
    calls,
    sendNotification(sub, body, options) {
      calls.push({ sub, body, options });
      if (oldLib && options && Object.prototype.hasOwnProperty.call(options, 'timeout')) {
        return Promise.reject(new Error("'timeout' is an invalid option. The valid options are ['headers', 'gcmAPIKey', 'vapidDetails', 'TTL']."));
      }
      const f = failMap.get(sub.endpoint);
      if (f) return Promise.reject(Object.assign(new Error('gone'), { statusCode: f }));
      return Promise.resolve({ statusCode: 201, ep: sub.endpoint });
    },
  };
}

async function runA(src) {
  const code = block(src);
  if (!code) return { err: '抽不到 v179 區塊' };
  const r = {};
  { const wp = fakeWebPush(); await install(code, wp);
    await wp.sendNotification({ endpoint: 'e0' }, 'x');
    r.a1 = wp.calls[0] && wp.calls[0].options; }
  { const wp = fakeWebPush(); await install(code, wp);
    const mine = { TTL: 60, urgency: 'high' };
    await wp.sendNotification({ endpoint: 'e0' }, 'x', mine);
    r.a2 = { sent: wp.calls[0] && wp.calls[0].options, mine }; }
  { const wp = fakeWebPush(); await install(code, wp);
    await wp.sendNotification({ endpoint: 'e0' }, 'x', { timeout: 5000 });
    r.a3 = wp.calls[0] && wp.calls[0].options; }
  { const wp = fakeWebPush({ oldLib: true }); await install(code, wp);
    const first = await wp.sendNotification({ endpoint: 'e0' }, 'x').then((v) => ({ ok: v }), (e) => ({ err: e.message }));
    const n1 = wp.calls.length;
    const second = await wp.sendNotification({ endpoint: 'e1' }, 'x', { TTL: 9 }).then((v) => ({ ok: v }), (e) => ({ err: e.message }));
    r.a4 = { first, n1, second, calls: wp.calls.map((c) => c.options), cfg: wp.__ptcgPushQueue && wp.__ptcgPushQueue.cfg.requestTimeoutMs }; }
  { const wp = fakeWebPush({ failMap: new Map([['g', 410]]) }); await install(code, wp);
    const out = await wp.sendNotification({ endpoint: 'g' }, 'x').then(() => null, (e) => e);
    r.a5 = { code: out && out.statusCode, n: wp.calls.length }; }
  return r;
}

async function runB(src, { n = 600, cap, offEp = null, gone = [] } = {}) {
  const bp = fnSrc(src, '    async function broadcastPush(');
  if (!bp) return { err: '抽不到 broadcastPush' };
  const wp = fakeWebPush({ failMap: new Map(gone.map((e) => [e, 410])) });
  const rows = Array.from({ length: n }, (_, i) => ({ _id: 'r' + i, uid: 'u' + i, sub: { endpoint: 'e' + i, keys: { p256dh: 'k', auth: 'a' } },
    notifyCommunity: !(offEp && 'e' + i === offEp), createdAt: new Date(0), ua: 'x'.repeat(50) }));
  // 同一個端點另掛一筆「關」在別的帳號（舊資料）⇒ 去重＋關閉判定要擋下
  if (offEp) rows.push({ _id: 'dup', uid: 'other', sub: { endpoint: offEp }, notifyCommunity: false });
  const finds = [], deleted = [];
  const match = (row, q) => Object.entries(q).every(([k, v]) => {
    if (v && typeof v === 'object' && '$ne' in v) return row[k] !== v.$ne;
    if (v && typeof v === 'object' && '$nin' in v) return !v.$nin.includes(row[k]);
    return row[k] === v;
  });
  const project = (row, pj) => {
    if (!pj) return { ...row };
    const o = {};
    for (const k of Object.keys(pj)) {
      if (k === 'sub.endpoint') { if (row.sub) o.sub = { endpoint: row.sub.endpoint }; continue; }
      if (k in row) o[k] = row[k];
    }
    return o;
  };
  const TPUSH = {
    find: (q, opt) => { const rec = { q, opt, limit: null }; finds.push(rec);
      return { limit: (L) => { rec.limit = L; return { toArray: async () => rows.filter((r) => match(r, q || {})).slice(0, L).map((r) => project(r, opt && opt.projection)) }; } }; },
    deleteOne: async (f) => { deleted.push(f._id); },
  };
  const fn = new Function('_webpush', 'TPUSH', 'console', `${bp}\nreturn broadcastPush;`)(wp, TPUSH, { warn() {}, log() {} });
  const res = await fn({ title: 't' }, cap === undefined ? { prefKey: 'notifyCommunity' } : { prefKey: 'notifyCommunity', cap });
  return { res, calls: wp.calls, finds, deleted };
}

console.log('【A】每筆推播 30 秒逾時（v179 排隊區塊）');
const A = await runA(SRC);
ok('★ A0 抽得到 v179 哨兵區塊', !A.err, A.err);
if (!A.err) {
  ok('★★★ A1 沒給選項 ⇒ 送出時帶 timeout 30000', A.a1 && A.a1.timeout === 30000 && Object.keys(A.a1).length === 1, JSON.stringify(A.a1));
  ok('★★ A2 給了其他選項 ⇒ 原選項保留＋補 timeout；呼叫端的物件沒被改動', A.a2.sent && A.a2.sent.TTL === 60 && A.a2.sent.urgency === 'high' && A.a2.sent.timeout === 30000
    && A.a2.sent !== A.a2.mine && JSON.stringify(A.a2.mine) === JSON.stringify({ TTL: 60, urgency: 'high' }), JSON.stringify(A.a2));
  ok('★★ A3 呼叫端自己給 timeout 5000 ⇒ 照它的', A.a3 && A.a3.timeout === 5000, JSON.stringify(A.a3));
  ok('★★★ A4 舊版 web-push 不認得 timeout ⇒ 第一筆用原參數重送成功；之後不再補（第二筆只呼叫一次、原選項原封）',
    A.a4.first.ok && A.a4.first.ok.statusCode === 201 && A.a4.n1 === 2 && A.a4.calls[0] && A.a4.calls[0].timeout === 30000 && A.a4.calls[1] === undefined
    && A.a4.second.ok && A.a4.calls.length === 3 && JSON.stringify(A.a4.calls[2]) === JSON.stringify({ TTL: 9 }) && A.a4.cfg === 0, JSON.stringify(A.a4));
  ok('★★ A5 其他錯誤（410）原封轉交、不重送', A.a5.code === 410 && A.a5.n === 1, JSON.stringify(A.a5));
}

console.log('【B】broadcastPush 上限與投影');
{
  const b1 = await runB(SRC, { n: 600, gone: ['e5'] });
  ok('★ B0 抽得到 broadcastPush', !b1.err, b1.err);
  if (!b1.err) {
    const main = b1.finds[0];
    ok('★★★ B1 600 個訂閱全部送出（舊上限 500）', b1.res.sent === 600 && b1.calls.length === 600 && main && main.limit === 5000, JSON.stringify({ res: b1.res, n: b1.calls.length, limit: main && main.limit }));
    ok('★★ B2 主查詢只取 _id／uid／sub 三欄', main && main.opt && JSON.stringify(main.opt.projection) === JSON.stringify({ _id: 1, uid: 1, sub: 1 }), JSON.stringify(main && main.opt));
    ok('★★ B3 送出的是完整 sub（含金鑰）；410 的訂閱照樣用 _id 清除', b1.calls.every((c) => c.sub && c.sub.keys && c.sub.keys.auth === 'a') && JSON.stringify(b1.deleted) === JSON.stringify(['r5']), JSON.stringify(b1.deleted));
  }
  const b4 = await runB(SRC, { n: 50, cap: 10 });
  ok('★ B4 呼叫端傳 cap: 10 仍有效', !b4.err && b4.res.sent === 10 && b4.finds[0].limit === 10, JSON.stringify(b4.res));
  const b5 = await runB(SRC, { n: 30, offEp: 'e3' });
  ok('★★ B5 同一端點在別的帳號標「關」⇒ 照樣不推（投影後去重仍正確）', !b5.err && b5.res.sent === 29 && !b5.calls.some((c) => c.sub.endpoint === 'e3'), JSON.stringify(b5.res));
}

console.log('【D】錦標賽區塊 28 把鎖');
{
  const tail = SRC.slice(SRC.indexOf(TAIL_ANCHOR)), tev = SRC.slice(SRC.indexOf(TEV_ANCHOR));
  ok('★★ D1 現行區塊指紋 ＝ NEW_*_V180（tail／tev／len）', sha(tail) === NEW_TAIL_SHA_V180 && sha(tev) === NEW_TEV_SHA_V180 && tev.length === NEW_TEV_LEN_V180, JSON.stringify([sha(tail), sha(tev), tev.length]));
  const rt = revertV180(tail), rv = revertV180(tev);
  ok('★★ D2 revertV180 之後逐位元回到 v1.76～v1.79 的值', sha(rt) === NEW_TAIL_SHA_V176 && sha(rv) === NEW_TEV_SHA_V176 && rv.length === NEW_TEV_LEN_V176);
  const mut = tail.replace('cap = 5000 }', 'cap = 5001 }');
  ok('★ D3 自驗：本版區塊改一個字元 ⇒ 指紋對不上（D1 不是恆真式）', mut !== tail && sha(mut) !== NEW_TAIL_SHA_V180);
  // D4 v1.76 的指紋只准出現在還原鏈的宣告端（lib）
  const EXEMPT = new Set(['scripts/lib/tourn-revert-v176.mjs', 'scripts/test-v180-push-cap-timeout.mjs']);
  const stale = [];
  const walk = (dir) => { for (const n of readdirSync(dir)) { const fp = join(dir, n);
    if (statSync(fp).isDirectory()) { walk(fp); continue; }
    if (!n.endsWith('.mjs')) continue;
    const rel = fp.slice(ROOT.length).replace(/\\/g, '/').replace(/^\//, '');
    if (EXEMPT.has(rel)) continue;
    const s = readFileSync(fp, 'utf8');
    if (s.includes(NEW_TAIL_SHA_V176) || s.includes(NEW_TEV_SHA_V176)) stale.push(rel);
  } };
  walk(join(ROOT, 'scripts'));
  ok('★★ D4 v1.76 的舊指紋零殘留（還原鏈宣告端除外）', NEW_TAIL_SHA_V176 !== NEW_TAIL_SHA_V180 && stale.length === 0, stale.join(', '));
  const CONSUMERS = ['scripts/test-v6276-deck-tournament-stats.mjs', 'scripts/test-v6291-tourn-verified-gate.mjs', 'scripts/test-v6292-tourn-verified-gate2.mjs',
    'scripts/test-v6381-archive-gamedraw-and-swiss-note.mjs'];
  const bad = CONSUMERS.filter((f) => !rd(f).includes("from './lib/tourn-revert-v180.mjs'"));
  ok('★★ D5 錦標賽區塊的還原鏈消費者都改接 tourn-revert-v180', bad.length === 0, bad.join(', '));
  ok('★ D5b 整份補丁的還原入口（sap-revert-admin-v177）先退 v1.80 再剝 v1.79', /stripAdminV179IfPresent\(revertAdminV180IfPresent\(/.test(rd('scripts/lib/sap-revert-admin-v177.mjs')));
}

console.log('【H】HEAD-FAIL');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('H（缺 BASE ' + BASE_SHA + '）');
else {
  const base = readBaseBlob(ROOT, BASE_SHA, P).out.replace(/\r\n/g, '\n');
  const HA = await runA(base);
  ok('★★★ H1 BASE（v1.79）送出時沒有 timeout ⇒ A1 必紅', !HA.err && (HA.a1 === undefined || !(HA.a1.timeout > 0)), JSON.stringify(HA.a1));
  const HB = await runB(base, { n: 600 });
  ok('★★★ H2 BASE 的 600 個訂閱只送 500（悄悄漏推）⇒ B1 必紅', !HB.err && HB.res.sent === 500 && HB.calls.length === 500, JSON.stringify(HB.res));
}

console.log(`=== server v1.80 推播上限與逾時：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
