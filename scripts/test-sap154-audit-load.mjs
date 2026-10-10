#!/usr/bin/env node
/**
 * server patch v1.54 守衛：全站 audit（2026-10-03）伺服器端降載六項 —— 輸出逐位元不變、只少做事
 *
 *   R  大廳列表 GET /api/rooms?status=lobby,playing：同時抵達的請求共用一次 DB 查詢（in-flight，不加 TTL）
 *   L  休閒 GET 的 log 增量：鏈雜湊從中間狀態接著算（前段不再 JSON.stringify 兩遍）
 *   E  /api/tournament/event：只用主鍵取開放中賽事的那幾筆報名＋資料庫取最新暱稱（不再整批讀歷屆報名）；
 *      getEventShared 過期時同時抵達的共用一次重填、重填內部並行
 *   C  /api/tournament/chat：chatMeta 改記憶體值（清除時同步更新、60 秒保險回 DB）
 *   B  /api/tournament/bracket：查詢＋排名計算＋寫快取整段合併（v1.52 只合併了查詢）
 *
 * 做法：把 v1.54 與 v1.53（BASE）的同一段程式抽出來，接同一份假 DB 實跑 ⇒
 *   ① 回應逐欄位相同（零行為變化）② v1.54 的 DB 查詢／計算次數確實變少（BASE 是正對照：它必須多）。
 *   D 組：錦標賽區塊 28 把鎖重釘。
 * Run: node scripts/test-sap154-audit-load.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import {
  TAIL_ANCHOR, TEV_ANCHOR, revertV154,
  NEW_TAIL_SHA_V154, NEW_TEV_SHA_V154, NEW_TEV_LEN_V154, OLD_TAIL_SHA_V153, OLD_TEV_SHA_V153, OLD_TEV_LEN_V153,
} from './lib/tourn-revert-v154.mjs';
import { revertAdminV154 } from './lib/sap-revert-admin-v154.mjs';
import { revertAdminV155 } from './lib/sap-revert-admin-v155.mjs';   // ⭐server v1.55：較新的版本先還原（Rule 54）
import { revertAdminV156 } from './lib/sap-revert-admin-v156.mjs';   // ⭐server v1.56（牌組原型序位）：先剝較新的（Rule 54）
import { revertAdminV159 } from './lib/sap-revert-admin-v159.mjs';   // ⭐server v1.59（原型未進場不計＋先攻後攻）：先剝較新的（Rule 54）
import { revertAdminV158 } from './lib/sap-revert-admin-v158.mjs';   // ⭐server v1.58（常用牌組對戰矩陣端點）：先剝較新的（Rule 54）
import { revertAdminV157 } from './lib/sap-revert-admin-v157.mjs';   // ⭐server v1.57（序位預設 50＋用最新規則重新判定）：先剝較新的（Rule 54）

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.468（server patch 仍是 v1.53）。
const BASE_SHA = '53491588';
const SAP = 'oracle-admin/server_admin_patch.js';
const rd = (r) => readFileSync(join(ROOT, r), 'utf8').replace(/\r\n/g, '\n');
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const CUR = rd(SAP);
let BASE = null;
if (hasBaseCommit(ROOT, BASE_SHA)) { const r = readBaseBlob(ROOT, BASE_SHA, SAP); BASE = r.ok ? r.out.replace(/\r\n/g, '\n') : null; }
if (!BASE) shallowSkip('sap154 行為對照（v1.53 正對照）', '需要 v6.468 commit');

function handlerSrc(src, head) {
  const a = src.indexOf(head);
  if (a < 0 || src.indexOf(head, a + 1) >= 0) throw new Error('端點不是恰好一支：' + head);
  let depth = 0, i = src.indexOf('(', a);
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) break; }
    else if (c === "'" || c === '"' || c === '`') { const q = c; i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; } }
    else if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; }
  }
  return src.slice(a, i + 2);
}
const between = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('區段抽不到：' + a); return src.slice(i, j); };
const fakeRes = () => { const r = { code: 200, body: undefined, ended: false }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = JSON.parse(JSON.stringify(b)); return r; }; r.end = () => { r.ended = true; return r; }; return r; };

// ══════════════════════════════════════════════════════════════════════════
console.log('【R】大廳列表：同時抵達的請求共用一次查詢');
const ROOMS = [
  { _id: 'AAAA', _version: 3, status: 'lobby', roomName: '練習房', hostUid: 'u1', hostName: '甲', schemaVersion: 2, createdAt: 1000, updatedAt: 2000, visible: true, heartbeats: { 0: 1500 }, seats: [{ role: 'p1', uid: 'u1', name: '甲', email: 'a@x.tw' }] },
  { _id: 'BBBB', _version: 9, status: 'playing', roomName: '對戰房', hostUid: 'u2', hostName: '乙', schemaVersion: 2, createdAt: 900, updatedAt: 5000, visible: true, heartbeats: { 0: 4900, 1: 4800 }, seats: [{ role: 'p1', uid: 'u2', name: '乙' }, { role: 'p2', uid: 'u3', name: '丙', email: 'c@x.tw' }] },
];
async function runRooms(src) {
  const blk = between(src, '    // >>> PTCG-ROOMS-COMBINED-BLOCK-START', '    // <<< PTCG-ROOMS-COMBINED-BLOCK-END');
  let finds = 0;
  const db = { collection: () => ({ find: () => { finds++; return { limit: () => ({ sort: () => ({ toArray: async () => { await sleep(20); return JSON.parse(JSON.stringify(ROOMS)); } }) }) }; } }) };
  const stack = [{ handle: function jsonParser() {} }, { route: { path: '/api/rooms' } }];
  const app = { use(fn) { stack.push({ handle: fn }); }, _router: { stack } };
  await new Function('app', 'db', 'console', '"use strict"; return (async () => {\n' + blk + '\n})();')(app, db, { log() {}, warn() {} });
  const mw = stack.find((l) => l.handle && !l.route && l.handle.name !== 'jsonParser').handle;
  const call = async (h) => { const res = fakeRes(); const url = '/api/rooms?status=lobby%2Cplaying' + (h ? '&h=' + h : ''); await mw({ method: 'GET', originalUrl: url, url, headers: { authorization: 'Bearer t' } }, res, () => { res.nexted = true; }); return res; };
  const burst = await Promise.all([1, 2, 3, 4, 5].map(() => call(null)));
  const findsBurst = finds;
  const h = burst[0].body && burst[0].body.h;
  const r204 = await call(h);
  return { burst: burst.map((r) => [r.code, r.body]), findsBurst, finds, r204: [r204.code, r204.ended] };
}
{
  const c = await runRooms(CUR);
  ok('★★★[R1] v1.54：同時 5 發只查 1 次 DB', c.findsBurst === 1, String(c.findsBurst));
  ok('★★[R2] 查完就丟（沒有 TTL 快取）：下一發重新查；內容沒變照樣回 204', c.finds === 2 && c.r204[0] === 204 && c.r204[1], JSON.stringify([c.finds, c.r204]));
  ok('[R3] email 照樣剝除', c.burst.every(([, b]) => b.rooms.every((r) => r.seats.every((s) => s.email == null))));
  if (BASE) {
    const b = await runRooms(BASE);
    ok('★★[R4] 正對照：v1.53 同時 5 發各查一次（共 5 次）', b.findsBurst === 5, String(b.findsBurst));
    ok('★★★[R5] 回應逐欄位與 v1.53 相同', same(c.burst, b.burst) && same(c.r204, b.r204));
  }
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n【L】休閒 log 增量：鏈雜湊接著算');
const OC = rd('src/lib/game/oracle-client.ts');
const ccBlk = between(OC, '// >>> v6220-log-delta-client-core', '// <<< v6220-log-delta-client-core');
const esbuild = await import('esbuild');
const cc = new Function('"use strict";\n' + esbuild.transformSync(ccBlk.replace(/^export /gm, ''), { loader: 'ts' }).code + '\nreturn { logChainHash };')();
function mkLog(n, seed) { const out = []; for (let i = 0; i < n; i++) out.push({ turn: (i >> 2) + 1, playerIndex: (i + seed) % 2, message: `第${i}步 使用「範例招式」造成 ${(i * 7 + seed) % 90} 點傷害`, timestamp: 1756e9 + i * 1500 }); return out; }
async function runOut(src) {
  const blk = between(src, '    // >>> PTCG-ROOMS-OUT-BLOCK-START', '    // <<< PTCG-ROOMS-OUT-BLOCK-END');
  const stack = [{ handle: function jsonParser() {} }, { route: { path: '/api/rooms/:code' } }];
  const app = { use(fn) { stack.push({ handle: fn }); }, _router: { stack } };
  let strCalls = 0;
  const J = { stringify: (...a) => { strCalls++; return JSON.stringify(...a); }, parse: JSON.parse };
  const db = { collection: () => ({ findOne: async () => null }) };
  await new Function('app', 'db', 'console', 'JSON', '"use strict"; return (async () => {\n' + blk + '\n})();')(app, db, { log() {}, warn() {} }, J);
  const mws = stack.filter((l) => l.handle && !l.route && l.handle.name !== 'jsonParser').map((l) => l.handle);
  let outMw = null;
  for (const h of mws) { const res = fakeRes(); const orig = res.json; await h({ method: 'GET', originalUrl: '/api/rooms/P', url: '/api/rooms/P', headers: {} }, res, () => {}); if (res.json !== orig) outMw = h; }
  const serve = async (doc, params) => {
    const url = '/api/rooms/' + doc._id + (params ? '?' + params : '');
    const res = fakeRes(); await outMw({ method: 'GET', originalUrl: url, url, headers: {} }, res, () => {});
    strCalls = 0; res.json({ room: JSON.parse(JSON.stringify(doc)) }); return { body: res.body, strCalls };
  };
  return { serve };
}
{
  const C = await runOut(CUR);
  const cases = [];
  for (const [n, since, good] of [[40, 30, true], [40, 40, true], [40, 1, true], [40, 30, false], [5, 6, true], [60, 0, true]]) {
    const log = mkLog(n, n + since);
    const doc = { _id: 'R' + n, status: 'playing', seats: [{ uid: 'u', email: 'e@x' }], gameState: { phase: 'playing', log } };
    const h = good ? cc.logChainHash(log, Math.min(since, n)) : 'deadbeef-0-' + since;
    cases.push({ doc, params: 'logSince=' + since + '&logh=' + encodeURIComponent(h) });
  }
  const outC = []; for (const k of cases) outC.push(await C.serve(k.doc, k.params));
  ok('[L1] 增量照常成立（相符的 logh ⇒ 回 logDelta、只帶新的那幾則）', !!outC[0].body.logDelta && outC[0].body.room.gameState.log.length === 10 && outC[0].body.logDelta.fh === cc.logChainHash(cases[0].doc.gameState.log, 40));
  if (BASE) {
    const B = await runOut(BASE);
    const outB = []; for (const k of cases) outB.push(await B.serve(k.doc, k.params));
    ok('★★★[L2] 6 種情境（相符／全部已有／只差 1 則／雜湊不符／超出長度／since=0）回應與 v1.53 逐位元相同', outC.every((o, i) => same(o.body, outB[i].body)));
    ok('★★[L3] 相符時少 stringify 一遍前段（40 則、since=30：v1.54 < v1.53）', outC[0].strCalls < outB[0].strCalls, `${outC[0].strCalls} vs ${outB[0].strCalls}`);
  }
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n【E】/api/tournament/event：報名只取需要的那幾筆、共用快取合併重填');
function mkTregs(docs, log) {
  const match = (d, q) => Object.entries(q).every(([k, v]) => {
    if (v && typeof v === 'object' && '$in' in v) return v.$in.includes(d[k]);
    if (v && typeof v === 'object' && '$nin' in v) return !v.$nin.includes(d[k] == null ? null : d[k]);
    return d[k] === v;
  });
  const proj = (d, p) => { if (!p) return { ...d }; const inc = Object.entries(p).filter(([, v]) => v === 1).map(([k]) => k); const exc = Object.entries(p).filter(([, v]) => v === 0).map(([k]) => k);
    if (inc.length) { const o = { _id: d._id }; for (const k of inc) if (k in d) o[k] = d[k]; return o; } const o = { ...d }; for (const k of exc) delete o[k]; return o; };
  return {
    find(q, o) { let rows = docs.filter((d) => match(d, q)); const p = o && o.projection; let lim = Infinity; const cur = {
      sort(s) { const [k, dir] = Object.entries(s)[0]; rows = [...rows].sort((a, b) => ((a[k] || 0) - (b[k] || 0)) * dir); return cur; },
      limit(n) { lim = n; return cur; },
      async toArray() { const out = rows.slice(0, lim).map((d) => proj(d, p)); log.docs += out.length; log.deckDocs += out.filter((x) => x.deckEntries).length; log.q++; return out; } }; return cur; },
    async findOne(q, o) { const d = docs.find((x) => match(x, q)); log.q++; if (d) { log.docs++; if ((o && o.projection && o.projection.deckEntries) || !o) log.deckDocs++; } return d ? proj(d, o && o.projection) : null; },
    async countDocuments(q) { log.q++; return docs.filter((d) => match(d, q)).length; },
  };
}
const OPEN = [{ _id: 'evA', name: 'A 賽', status: 'registration', maxPlayers: 32 }, { _id: 'evB', name: 'B 賽', status: 'checkin', maxPlayers: null }];
function mkRegs() {
  const regs = [];
  const deck = (n) => [{ cardId: '1', count: n }, { cardId: '2', count: 60 - n }];
  for (let i = 0; i < 40; i++) regs.push({ _id: 'old' + i + '__u1', eventId: 'old' + i, uid: 'u1', name: i % 7 === 0 ? '' : '舊名' + i, deckName: 'D' + i, deckEntries: deck(4), registeredAt: 1000 + i, checkedIn: true });
  regs.push({ _id: 'evA__u1', eventId: 'evA', uid: 'u1', name: '小明', deckName: '噴火龍', deckEntries: deck(4), registeredAt: 9000, checkedIn: false });
  regs.push({ _id: 'evB__u2', eventId: 'evB', uid: 'u2', name: '小華', deckName: '沙奈朵', deckEntries: deck(3), registeredAt: 9100, checkedIn: true, lateJoin: true });
  for (let i = 0; i < 5; i++) regs.push({ _id: 'evA__x' + i, eventId: 'evA', uid: 'x' + i, name: 'x' + i, deckEntries: deck(4), registeredAt: 500 + i });
  return regs;
}
async function runEvent(src) {
  const region = src.slice(src.indexOf('    let _eventShared = '), src.indexOf("app.get('/api/tournament/event',")) + handlerSrc(src, "app.get('/api/tournament/event',");
  const log = { q: 0, docs: 0, deckDocs: 0, lists: 0 };
  const routes = {};
  const env = {
    app: { get: (p, h) => { routes[p] = h; } },
    TREGS: mkTregs(mkRegs(), log),
    TEVENTS: { find: () => ({ toArray: async () => { await sleep(5); return []; } }) },
    TMATCH: { find: () => ({ toArray: async () => [] }) },
    listOpenEvents: async () => { log.lists++; await sleep(15); return OPEN.map((e) => ({ ...e })); },
    pickActiveFromList: (l) => l[0] || null,
    getEventById: async (id) => ({ _id: id, name: '舊賽', status: 'finished' }),
    deckCount: (entries) => { if (!Array.isArray(entries)) return -1; let n = 0; for (const e of entries) n += (e && e.count) || 0; return n; },
    noShowConfig: async () => null, noShowGraceMin: () => 5, minVerConfig: async () => null, isTournAdmin: () => false,
    tournIdentity: async (req) => ({ uid: req.uid, email: req.uid + '@x.tw', name: '帳號名' + req.uid }),
  };
  new Function(...Object.keys(env), '"use strict";\n' + region)(...Object.values(env));
  const h = routes['/api/tournament/event'];
  const call = async (uid, q) => { const res = fakeRes(); await h({ uid, query: q || {}, body: {} }, res); const b = res.body; if (b) delete b.serverNow; return [res.code, b]; };
  const burst = await Promise.all(['u1', 'u2', 'u3', 'u1', 'u2'].map((u) => call(u)));
  const listsBurst = log.lists;
  log.docs = 0; log.deckDocs = 0;
  const single = await call('u1');
  const docsU1 = log.docs, deckU1 = log.deckDocs;
  const old = await call('u1', { eventId: 'old3' });
  const none = await call('u9');
  return { burst, single, old, none, listsBurst, docsU1, deckU1 };
}
{
  const c = await runEvent(CUR);
  ok('★★[E1] getEventShared：快取過期時同時抵達的 5 發只重填 1 次', c.listsBurst === 1, String(c.listsBurst));
  ok('★★★[E2] 老玩家（41 筆歷屆報名）一次 /event 只讀到 2 筆報名文件（開放賽事那 1 筆＋最新暱稱 1 筆）', c.docsU1 <= 2, String(c.docsU1));
  ok('[E3] 報名者的張數照樣算得出來（deckCount 60）、暱稱取最近一次有名字的報名', c.single[1].me.deckCount === 60 && c.single[1].me.lastName === '小明', JSON.stringify(c.single[1].me));
  if (BASE) {
    const b = await runEvent(BASE);
    ok('★★[E4] 正對照：v1.53 同時 5 發重填 5 次、一次 /event 讀回 40 筆以上報名', b.listsBurst === 5 && b.docsU1 >= 40, JSON.stringify([b.listsBurst, b.docsU1]));
    ok('★★★[E5] 回應逐欄位與 v1.53 相同（報名者／他人／帶 eventId 查已結束賽事／從沒報名過）',
      same(c.burst, b.burst) && same(c.single, b.single) && same(c.old, b.old) && same(c.none, b.none),
      JSON.stringify(c.single).slice(0, 200) + ' vs ' + JSON.stringify(b.single).slice(0, 200));
  }
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n【C】/api/tournament/chat：chatMeta 改記憶體值');
async function runChat(src) {
  const hasCache = src.includes('// >>> v154-chat-meta-cache');
  const region = (hasCache ? between(src, '    // >>> v154-chat-meta-cache', "    app.get('/api/tournament/chat',") : '')
    + handlerSrc(src, "app.get('/api/tournament/chat',") + '\n' + handlerSrc(src, "app.post('/api/tournament/admin/chat/clear',");
  let cfgReads = 0; let cfgDoc = { _id: 'chatMeta', clearedAt: 111 };
  const msgs = [{ _id: 'm1', room: 'lobby', name: 'a', text: 'hi', ts: 200, uid: 'u' }, { _id: 'm2', room: 'lobby', name: 'b', text: 'yo', ts: 300, uid: 'v' }];
  const routes = {};
  const env = {
    app: { get: (p, h) => { routes['GET ' + p] = h; }, post: (p, h) => { routes['POST ' + p] = h; } },
    TCONFIG: { findOne: async () => { cfgReads++; return cfgDoc ? { ...cfgDoc } : null; }, updateOne: async (q, u) => { cfgDoc = { _id: 'chatMeta', ...u.$set }; } },
    TCHAT: { find: (q) => { let rows = msgs.filter((m) => !q.ts || ((q.ts.$gt == null || m.ts > q.ts.$gt) && (q.ts.$lt == null || m.ts < q.ts.$lt))); const cur = { sort(s) { rows = [...rows].sort((a, b) => (a.ts - b.ts) * s.ts); return cur; }, limit() { return cur; }, async toArray() { return rows.map((r) => ({ ...r })); } }; return cur; },
      countDocuments: async () => 0, deleteMany: async () => { msgs.length = 0; } },
    tournIdentity: async () => ({ uid: 'admin' }), isTournAdmin: () => true,
  };
  new Function(...Object.keys(env), '"use strict";\n' + region)(...Object.values(env));
  const get = async (q) => { const res = fakeRes(); await routes['GET /api/tournament/chat']({ query: q }, res); const b = res.body; delete b.serverNow; return b; };
  const outs = []; for (let i = 0; i < 5; i++) outs.push(await get(i % 2 ? { since: '150' } : {}));
  const readsBefore = cfgReads;
  const rr = fakeRes(); await routes['POST /api/tournament/admin/chat/clear']({ body: {} }, rr);
  const after = await get({});
  return { outs, readsBefore, readsAfter: cfgReads, after, cleared: cfgDoc.clearedAt };
}
{
  const c = await runChat(CUR);
  ok('★★[C1] v1.54：連續 5 發 /chat 只讀 1 次 chatMeta', c.readsBefore === 1, String(c.readsBefore));
  ok('★★★[C2] 管理員清除後，下一發立刻拿到新的 clearedAt（不用等 60 秒、也不必回 DB）', c.after.clearedAt === c.cleared && c.readsAfter === c.readsBefore, JSON.stringify([c.after.clearedAt, c.cleared, c.readsAfter]));
  if (BASE) {
    const b = await runChat(BASE);
    ok('★[C3] 正對照：v1.53 每發都讀一次 chatMeta', b.readsBefore === 5, String(b.readsBefore));
    ok('★★★[C4] 5 發回應（初始／增量）與 v1.53 逐欄位相同', same(c.outs, b.outs));
  }
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n【B】/api/tournament/bracket：查詢＋排名計算整段合併');
async function runBracket(src) {
  const region = src.slice(src.indexOf('    const _bracketCache = new Map();'), src.indexOf("app.get('/api/tournament/bracket',")) + handlerSrc(src, "app.get('/api/tournament/bracket',");
  let computes = 0, mFinds = 0;
  const ev = { _id: 'evS', name: '瑞士賽', status: 'running', currentRound: 2, rounds: 4, format: 'swiss-then-cut', phase: 'swiss', swissRounds: 3, topCut: 4 };
  const matches = [];
  for (let r = 1; r <= 2; r++) for (let i = 0; i < 4; i++) matches.push({ round: r, idx: i, phase: 'swiss', p1uid: 'p' + (2 * i), p2uid: 'p' + (2 * i + 1), p1name: 'P' + (2 * i), p2name: 'P' + (2 * i + 1), winnerUid: r === 1 ? 'p' + (2 * i) : null, winnerName: r === 1 ? 'P' + (2 * i) : null, status: r === 1 ? 'done' : 'playing', bye: false, roomId: r === 2 ? 'room' + i : null });
  const regs = Array.from({ length: 8 }, (_, i) => ({ uid: 'p' + i, name: 'P' + i, dropped: false }));
  const routes = {};
  const env = {
    app: { get: (p, h) => { routes[p] = h; } },
    tournIdentity: async (req) => ({ uid: req.uid }),
    resolveEventFromReq: async () => ({ ...ev }),
    TMATCH: { find: () => ({ sort() { return this; }, async toArray() { mFinds++; await sleep(20); return matches.map((m) => ({ ...m })); } }) },
    TREGS: { find: () => ({ async toArray() { await sleep(5); return regs.map((r) => ({ ...r })); } }) },
    TENG: {
      buildSwissPlayersFromMatches: (ms, rs) => rs.map((r) => ({ uid: r.uid, name: r.name, dropped: r.dropped, results: ms.filter((m) => m.p1uid === r.uid || m.p2uid === r.uid).map((m) => (m.winnerUid === r.uid ? 'W' : m.winnerUid ? 'L' : 'P')) })),
      computeStandings: (ps) => { computes++; return ps.map((p, i) => ({ ...p, rank: i + 1, matchPoints: p.results.filter((x) => x === 'W').length * 3, owp: 0.5, oowp: 0.5 })); },
    },
    countSpectators: () => 0,
  };
  new Function(...Object.keys(env), '"use strict";\n' + region)(...Object.values(env));
  const h = routes['/api/tournament/bracket'];
  const outs = await Promise.all(['p0', 'p1', 'p2', 'p3', 'x'].map(async (uid) => { const res = fakeRes(); await h({ uid, query: {}, body: {} }, res); return res.body; }));
  return { outs, computes, mFinds };
}
{
  const c = await runBracket(CUR);
  ok('★★★[B1] v1.54：快取過期時同時 5 發，排名只算 1 次、查詢只 1 次', c.computes === 1 && c.mFinds === 1, JSON.stringify([c.computes, c.mFinds]));
  if (BASE) {
    const b = await runBracket(BASE);
    ok('★★[B2] 正對照：v1.53 查詢 1 次（v1.52 已合併）但排名算 5 次', b.mFinds === 1 && b.computes === 5, JSON.stringify([b.computes, b.mFinds]));
    ok('★★★[B3] 5 位不同玩家（含非參賽者）的回應與 v1.53 逐欄位相同（mine 標記各自正確）', same(c.outs, b.outs) && c.outs[0].matches.some((m) => m.mine) && !c.outs[4].matches.some((m) => m.mine));
  }
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n【D】錦標賽區塊 28 把鎖重釘');
{
  const tail = CUR.slice(CUR.indexOf(TAIL_ANCHOR)), tev = CUR.slice(CUR.indexOf(TEV_ANCHOR));
  ok('★★[D1] 現行區塊指紋 ＝ NEW_*_V154', sha(tail) === NEW_TAIL_SHA_V154 && sha(tev) === NEW_TEV_SHA_V154 && tev.length === NEW_TEV_LEN_V154);
  const rt = revertV154(tail), rv = revertV154(tev);
  ok('★★★[D2] revertV154 之後逐位元回到 v1.53 的值', sha(rt) === OLD_TAIL_SHA_V153 && sha(rv) === OLD_TEV_SHA_V153 && rv.length === OLD_TEV_LEN_V153);
  const mut = tail.replace('const CHAT_META_TTL_MS = 60 * 1000;', 'const CHAT_META_TTL_MS = 61 * 1000;');
  ok('[D3] 自驗：本版區塊改一個字元 ⇒ 指紋對不上', mut !== tail && sha(mut) !== NEW_TAIL_SHA_V154);
  const EXEMPT = new Set(['scripts/lib/tourn-revert-v153.mjs', 'scripts/lib/tourn-revert-v154.mjs']);
  const stale = [];
  const walk = (dir) => { for (const n of readdirSync(dir)) { const fp = join(dir, n);
    if (statSync(fp).isDirectory()) { walk(fp); continue; }
    if (!n.endsWith('.mjs')) continue;
    const rel = fp.slice(ROOT.length).replace(/\\/g, '/').replace(/^\//, '');
    if (EXEMPT.has(rel)) continue;
    const s = readFileSync(fp, 'utf8');
    if (s.includes(OLD_TAIL_SHA_V153) || s.includes(OLD_TEV_SHA_V153)) stale.push(rel);
  } };
  walk(join(ROOT, 'scripts'));
  ok('★★[D4] v1.53 的舊指紋零殘留（28 把鎖全部重釘）', stale.length === 0, stale.join(', '));
  const CONSUMERS = ['scripts/test-v6276-deck-tournament-stats.mjs', 'scripts/test-v6291-tourn-verified-gate.mjs', 'scripts/test-v6292-tourn-verified-gate2.mjs',
    'scripts/test-v6303-ui-batch.mjs', 'scripts/test-v6381-archive-gamedraw-and-swiss-note.mjs'];
  const bad = CONSUMERS.filter((f) => { const s = rd(f); return !(s.includes("from './lib/tourn-revert-v154.mjs'") && /revert(?:Admin)?V154\(/.test(s)); });
  ok('★★[D5] 五支消費者都 import 新 lib 且呼叫 v1.54 的還原器', bad.length === 0, bad.join(', '));
  ok('★[D5b] test-v6303 的 SAP 還原鏈：revertAdminV154 緊接在 revertAdminV153 內側（v1.55 起內側還有更新的還原器，Rule 54 由新到舊）', /revertAdminV153\(revertAdminV154\((?:revertAdminV1\d\d\()*SAP_RAW\)/.test(rd('scripts/test-v6303-ui-batch.mjs')));
  if (BASE) ok('★★[D6] 整份檔案：revertAdminV154 之後與 v1.53 逐位元相同（沒有夾帶宣告以外的改動）', revertAdminV154(revertAdminV155(revertAdminV156(revertAdminV157(revertAdminV158(revertAdminV159(CUR)))))) === BASE);   // ⭐v1.55 先剝掉較新一版
}

console.log(`\n=== server patch v1.54 全站 audit 降載: ${pass} PASS / ${fail} FAIL ===`);
console.log('=== SCRIPT-END sap154-audit-load ===');
process.exit(fail ? 1 : 0);
