// v6.270 休閒 PUT 上行增量【階段 2：client 端】的量測腳本（診斷用，不進 CI —— CI 內的
// 斷言版在 test-v6270-delta-put-client.mjs 的【G】節）。
//
// 量三件事，全部用「真引擎跑出來的對局序列」（不是合成 doc）：
//   ① BASE（全量 PUT）vs 修後（patch/全量自動決策）的**上行位元組數**（UTF-8，
//      與 nginx request_length 同單位）——p50/p90/p99/合計省多少；
//   ② 每一發 push 的 client 端**新增 CPU**（基底快照＋stringify＋diff＋canonical hash）p50/p99；
//   ③ 端到端 round-trip：client 的 patch 丟進 v6.268 的**真 middleware**（extractBlock 實跑）
//      → 核心 PUT $set 模擬 → 落庫 doc 必須與「BASE 全量路徑」逐位元同形（差一個字就 throw）。
//
// 用法：node scripts/perf-v6270-delta-put-savings.mjs [每組場數=1] [配對索引(0~3)]
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x-dp-s.js'), E = join(ROOT, '.x-dp-e.ts'), O = join(ROOT, '.x-dp-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { createGame, applyAction } from './src/lib/game/engine';\n"
  + "export { getAIAction } from './src/lib/game/ai';\n"
  + "import './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction, getAIAction } = await import(pathToFileURL(O).href);

const esbuild = await import('esbuild');
const OC = readFileSync(join(ROOT, 'src/lib/game/oracle-client.ts'), 'utf8');
const PATCH = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');
function extractBlock(src, s, e, label) {
  const i = src.indexOf(s), j = src.indexOf(e);
  if (i < 0 || j <= i) throw new Error('抽不到 ' + label);
  return src.slice(src.indexOf('\n', i) + 1, j);
}
// ── client 端 v6270 區塊（實跑；stub 掉它引用的外部識別字）──
const CB = extractBlock(OC, '// >>> v6270-delta-put-client-core', '// <<< v6270-delta-put-client-core', 'client 區塊');
const cjs = esbuild.transformSync(CB.replace(/^export /gm, ''), { loader: 'ts' }).code;
const CL = new Function('oracleUpsertRoom', 'oracleApi', 'oracleErrorStatus', '_noteRoomServerTime',
  '"use strict";' + cjs
  + ';return { deltaPutBase, buildRoomPatch, deltaPutCanonHash, _noteDeltaPutSentinel, _dpUtf8Len, DELTA_PUT_FULL_RATIO, DELTA_PUT_MAX_HASH_CHARS };')(0, 0, 0, 0);
// ── 伺服器 middleware（v6.268 的真程式碼）──
const DPBLOCK = extractBlock(PATCH, '// >>> PTCG-DELTA-PUT-BLOCK-START', '// <<< PTCG-DELTA-PUT-BLOCK-END', '伺服器區塊');
const DB = { doc: null };
async function makeMw() {
  const stack = [{ handle: function q() {} }, { route: { path: '/api/rooms/:code' } }];
  const app = { use(f) { stack.push({ handle: f }); } };
  app._router = { stack };
  const before = new Set(stack.map((l) => l.handle));
  const db = { collection: () => ({ findOne: async () => structuredClone(DB.doc) }) };
  await new Function('app', 'db', 'console', '"use strict"; return (async () => {\n' + DPBLOCK + '\n})();')(app, db, { log() {}, warn() {} });
  return stack.filter((l) => l && l.handle && !l.route && !before.has(l.handle)).map((l) => l.handle)[0];
}
const mw = await makeMw();
async function serverPut(body) {   // middleware → 核心 PUT（$set 語義）模擬
  const req = { method: 'PUT', originalUrl: '/api/rooms/ROOM', url: '/api/rooms/ROOM', body: JSON.parse(JSON.stringify(body)) };
  const res = { statusCode: 200, body: undefined, jsonCalled: false, headersSent: false,
    status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; this.jsonCalled = true; this.headersSent = true; return this; } };
  let nexted = false;
  await mw(req, res, () => { nexted = true; });
  if (!nexted) throw new Error('middleware 拒收：' + res.statusCode + ' ' + JSON.stringify(res.body).slice(0, 200));
  const data = req.body.data;
  const out = { ...DB.doc };
  for (const k of Object.keys(data)) out[k] = data[k];
  out._version = DB.doc._version + 1; out.updatedAt = DB.doc.updatedAt + 1;
  DB.doc = out;
}
const stripEmails = (room) => (!room || !Array.isArray(room.seats)) ? room
  : { ...room, seats: room.seats.map((s) => (s && s.email != null) ? { ...s, email: null } : s) };
const clientView = (doc) => JSON.parse(JSON.stringify(stripEmails(doc)));
const canon = (v) => CL.deltaPutCanonHash(v);

// ── 卡池與預組（與 eval-ai-selfplay 同款）──
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const PRESET_SRC = readFileSync(join(ROOT, 'src/lib/decks/presets.ts'), 'utf8');
function presetEntries(id) {
  const i = PRESET_SRC.indexOf(`id: '${id}'`);
  if (i < 0) throw new Error('找不到預組 ' + id);
  const j = PRESET_SRC.indexOf('entries: [', i);
  const k = PRESET_SRC.indexOf('\n  ],', j);
  return [...PRESET_SRC.slice(j, k).matchAll(/cardId:\s*'(\d+)',\s*count:\s*(\d+)/g)]
    .map((m) => ({ cardId: m[1], count: Number(m[2]) }));
}
const MATCHUPS = [
  ['N的索羅亞克', '__preset_n_zoroark__'],
  ['魔靈多龍', '__preset_marrune_dragapult__'],
  ['超級耿鬼ex', '__preset_mbg__'],
  ['竹蘭的烈咬陸鯊EX', '__preset_cynthia_garchomp__'],
];
function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ── 主迴圈：每一個成功 applyAction ＝ 一發 pushGameState（線上休閒的實際節奏）──
const utf8 = (s) => CL._dpUtf8Len(s);
const q = (arr, p) => { const s = arr.slice().sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0; };
const baseBytesArr = [], newBytesArr = [], cpuMs = [];
let patchN = 0, fullN = 0, pushes = 0, rtChecks = 0;

const N = Number(process.argv[2] ?? 1);
const only = process.argv[3] != null ? Number(process.argv[3]) : null;
const list = only != null ? [MATCHUPS[only]] : MATCHUPS;
for (const [name, id] of list) {
  const entries = presetEntries(id);
  for (let s = 0; s < N; s++) {
    const orig = Math.random;
    Math.random = seeded(9241 + s * 104729);
    try {
      let st = createGame({ name: '甲', entries }, { name: '乙', entries }, pool);
      DB.doc = {
        _id: 'ROOM',
        seats: [
          { role: 'p1', uid: 'u1', email: 'p1@example.com', name: '甲', deckEntries: entries, deckId: 'd1', ready: true, firstChoicePreference: 'random' },
          { role: 'p2', uid: 'u2', email: 'p2@example.com', name: '乙', deckEntries: entries, deckId: 'd2', ready: true, firstChoicePreference: 'random' },
        ],
        status: 'playing', gameState: JSON.parse(JSON.stringify(st)),
        heartbeats: { p1: 1, p2: 1 }, createdAt: 100, updatedAt: 1000, _version: 3,
      };
      let rejected = 0;
      for (let i = 0; i < 20000 && st.phase !== 'game-over'; i++) {
        let actor;
        if (st.phase === 'setup') {
          const mul = st.pendingMulliganDraw ?? [0, 0];
          actor = mul[0] > 0 ? 0 : (mul[1] > 0 ? 1 : (!st.setupDone[0] ? 0 : (!st.setupDone[1] ? 1 : 0)));
        } else if (st.pendingSelection) actor = st.pendingSelection.actorIdx;
        else if (st.players[0].active === null && st.players[0].bench.length > 0) actor = 0;
        else if (st.players[1].active === null && st.players[1].bench.length > 0) actor = 1;
        else actor = st.activePlayerIndex;
        const act = getAIAction(st, pool, actor);
        if (!act) break;
        const next = applyAction(st, act, pool);
        if (next === st) { if (++rejected > 8) break; continue; }
        rejected = 0; st = next;

        // ═══ 一發 pushGameState：oracleTx 的 GET(client 視角) → fn → 差分決策 ═══
        pushes++;
        const room = clientView(DB.doc);          // GET 回應（email 已被伺服器剝除）
        const ev = room._version;
        // —— client 端新增 CPU（基底快照＋round-trip＋diff＋hash＋patch 序列化）——
        const t0 = process.hrtime.bigint();
        const base = JSON.parse(JSON.stringify(room));                       // deltaPutBase
        const data = { ...room, gameState: JSON.parse(JSON.stringify(st)),   // pushGameState 的 fn
          status: st.phase === 'game-over' ? 'ended' : 'playing' };
        const fullStr = JSON.stringify(data);
        const nextJson = JSON.parse(fullStr);
        let body = null;
        if (fullStr.length <= CL.DELTA_PUT_MAX_HASH_CHARS) {
          const patch = CL.buildRoomPatch(base, nextJson);
          if (patch) {
            const b = { patchProto: 1, patch, fullHash: canon(nextJson), expectedVersion: ev };
            const bs = JSON.stringify(b);
            if (bs.length <= (fullStr.length + 28 + String(ev).length) * CL.DELTA_PUT_FULL_RATIO) body = { obj: b, str: bs };
          }
        }
        cpuMs.push(Number(process.hrtime.bigint() - t0) / 1e6);
        const fullBodyStr = JSON.stringify({ data, expectedVersion: ev });
        const bBase = utf8(fullBodyStr);
        baseBytesArr.push(bBase);
        // —— 端到端：真 middleware 套 patch 落庫，與全量路徑逐位元比對 ——
        const refDoc = (() => {   // BASE 全量路徑落庫結果（email 回填規則同 v1.20）
          const d = JSON.parse(JSON.stringify(data));
          if (Array.isArray(d.seats)) for (let k = 0; k < d.seats.length; k++) {
            const a = d.seats[k], o = DB.doc.seats[k];
            if (a && a.uid && a.email == null && o && o.uid === a.uid && o.email != null) a.email = o.email;
          }
          const out = { ...DB.doc };
          for (const k of Object.keys(d)) out[k] = d[k];
          out._version = DB.doc._version + 1; out.updatedAt = DB.doc.updatedAt + 1;
          return out;
        })();
        if (body) {
          patchN++; newBytesArr.push(utf8(body.str));
          await serverPut(body.obj);
        } else {
          fullN++; newBytesArr.push(bBase);
          const d = JSON.parse(fullBodyStr).data;   // 全量路徑（JSON 過網路）＋ email 回填
          if (Array.isArray(d.seats)) for (let k = 0; k < d.seats.length; k++) {
            const a = d.seats[k], o = DB.doc.seats[k];
            if (a && a.uid && a.email == null && o && o.uid === a.uid && o.email != null) a.email = o.email;
          }
          const out = { ...DB.doc };
          for (const k of Object.keys(d)) out[k] = d[k];
          out._version = DB.doc._version + 1; out.updatedAt = DB.doc.updatedAt + 1;
          DB.doc = out;
        }
        if (canon(DB.doc) !== canon(refDoc)) throw new Error('端到端不一致@push ' + pushes);
        rtChecks++;
      }
      console.log(`  ${name} 第 ${s + 1} 場：phase=${st.phase} pushes 累計 ${pushes}`);
    } finally { Math.random = orig; }
  }
}
const sum = (a) => a.reduce((x, y) => x + y, 0);
console.log('\n═══ 真實對局序列（真引擎 + 真 middleware round-trip）═══');
console.log(`推送 ${pushes} 發（patch ${patchN} / 全量 ${fullN}）；端到端逐位元比對 ${rtChecks}/${pushes} 全過`);
console.log(`BASE 上行位元組：p50=${q(baseBytesArr, .5)} p90=${q(baseBytesArr, .9)} p99=${q(baseBytesArr, .99)} 合計=${(sum(baseBytesArr) / 1024).toFixed(1)}KB`);
console.log(`修後 上行位元組：p50=${q(newBytesArr, .5)} p90=${q(newBytesArr, .9)} p99=${q(newBytesArr, .99)} 合計=${(sum(newBytesArr) / 1024).toFixed(1)}KB`);
console.log(`省下 ${(100 - sum(newBytesArr) / sum(baseBytesArr) * 100).toFixed(1)}%（p50 ${q(baseBytesArr, .5)}→${q(newBytesArr, .5)}、p90 ${q(baseBytesArr, .9)}→${q(newBytesArr, .9)}）`);
console.log(`client 新增 CPU（快照+diff+hash）：p50=${q(cpuMs, .5).toFixed(2)}ms p99=${q(cpuMs, .99).toFixed(2)}ms max=${Math.max(...cpuMs).toFixed(2)}ms（沙盒；玩家裝置各異，量級為準）`);
