// v6.282 好友功能 P0 的測試/量測共用 harness：把出貨碼的 PTCG-FRIENDS 區塊抽出來、
// 用假 db / 假 app / 假 tournIdentity 真的跑起來（守衛 test-v6282-friends-p0.mjs 與
// benchmark scripts/perf-v6282-friends-eventloop.mjs 共用同一份，避免兩邊各寫一套假 db 而漂移）。
//
// ⚠ 這裡的假 db 只實作出貨碼真的用到的 Mongo 子集（findOne/find().limit()/countDocuments/
//   updateOne/replaceOne/deleteOne/createIndex），查詢比對器也只認出貨碼用到的形狀
//   （等值、$or、$in）。多了就 throw —— 寧可測試紅，不要假 db 靜默放行。
import { readFileSync } from 'node:fs';
import assert from 'node:assert';

export const FR_START = '// >>> PTCG-FRIENDS-BLOCK-START';
export const FR_END = '// <<< PTCG-FRIENDS-BLOCK-END';
export const ID_START = '// >>> PTCG-PLAYER-IDENTITY-START';
export const ID_END = '// <<< PTCG-PLAYER-IDENTITY-END';
export const EN_START = '// >>> PTCG-MATCH-EMAIL-ENRICH-START';
export const EN_END = '// <<< PTCG-MATCH-EMAIL-ENRICH-END';

export function readPatch(path) { return readFileSync(path, 'utf8').replace(/\r\n/g, '\n'); }

export function extractBlock(src, sentS, sentE, minLen) {
  const si = src.indexOf(sentS), ei = src.indexOf(sentE);
  if (!(si >= 0 && ei > si)) throw new assert.AssertionError({ message: 'HEAD-FAIL：抽不到區塊 ' + sentS });
  const txt = src.slice(src.indexOf('\n', si) + 1, ei);
  if (minLen && txt.length < minLen) throw new assert.AssertionError({ message: '區塊 ' + sentS + ' 抽太短（抽取器壞了？）：' + txt.length });
  return txt;
}

// ── 假 Mongo ───────────────────────────────────────────────────────────────
function matchVal(docVal, cond) {
  if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
    for (const k of Object.keys(cond)) {
      if (k === '$in') { if (!cond.$in.includes(docVal)) return false; }
      else if (k === '$exists') { if ((docVal !== undefined) !== !!cond.$exists) return false; }
      // ⭐v6.287 私聊守衛需要的範圍／正則／不等（出貨碼的 dm list 用 ts:{$gt}/{$lt}、admin 總覽用 room:{$regex:'^dm:'}）
      else if (k === '$gt') { if (!(docVal > cond.$gt)) return false; }
      else if (k === '$gte') { if (!(docVal >= cond.$gte)) return false; }
      else if (k === '$lt') { if (!(docVal < cond.$lt)) return false; }
      else if (k === '$lte') { if (!(docVal <= cond.$lte)) return false; }
      else if (k === '$ne') { if (docVal === cond.$ne) return false; }
      else if (k === '$regex') { const re = cond.$regex instanceof RegExp ? cond.$regex : new RegExp(cond.$regex, cond.$options || ''); if (typeof docVal !== 'string' || !re.test(docVal)) return false; }
      else throw new Error('fake-db: 不支援的運算子 ' + k);
    }
    return true;
  }
  return docVal === cond;
}
export function matchDoc(doc, q) {
  for (const k of Object.keys(q || {})) {
    if (k === '$or') { if (!q.$or.some((sub) => matchDoc(doc, sub))) return false; }
    else if (k === '$and') { if (!q.$and.every((sub) => matchDoc(doc, sub))) return false; }
    else if (!matchVal(doc[k], q[k])) return false;
  }
  return true;
}
function project(doc, projection) {
  if (!projection) return structuredClone(doc);
  const out = {};
  const keys = Object.keys(projection).filter((k) => projection[k]);
  if (!keys.length) return structuredClone(doc);
  for (const k of keys) {
    const parts = k.split('.');
    if (parts.length === 1) { if (doc[k] !== undefined) out[k] = structuredClone(doc[k]); continue; }
    // 只支援 'seats.uid' / 'players.email' 這種「陣列.欄位」一層
    const [arr, f] = parts;
    if (Array.isArray(doc[arr])) {
      if (!out[arr]) out[arr] = doc[arr].map(() => ({}));
      doc[arr].forEach((el, i) => { if (el && el[f] !== undefined) out[arr][i][f] = structuredClone(el[f]); });
    }
  }
  if (doc._id !== undefined && projection._id !== 0) out._id = doc._id;
  return out;
}
function applyUpdate(doc, upd, isInsert) {
  for (const op of Object.keys(upd)) {
    if (op === '$set') Object.assign(doc, structuredClone(upd.$set));
    else if (op === '$setOnInsert') { if (isInsert) Object.assign(doc, structuredClone(upd.$setOnInsert)); }
    // ⭐v6.295：$unset（出貨碼的 /api/friends/alias 清除備註名用）—— 只刪指定欄位，其餘一個字都不動
    else if (op === '$unset') { for (const f of Object.keys(upd.$unset)) delete doc[f]; }
    else if (op === '$push') {
      for (const f of Object.keys(upd.$push)) {
        const spec = upd.$push[f];
        const arr = Array.isArray(doc[f]) ? doc[f] : (doc[f] = []);
        const items = spec && spec.$each ? spec.$each : [spec];
        arr.push(...structuredClone(items));
        if (spec && typeof spec.$slice === 'number' && spec.$slice < 0) doc[f] = arr.slice(spec.$slice);
      }
    } else throw new Error('fake-db: 不支援的更新運算子 ' + op);
  }
}
export function makeFakeDb(seed, opts) {
  const o = opts || {};
  const store = new Map();          // name -> Map(_id -> doc)
  // ⭐v6.295：索引清單（出貨碼的 _frRegIndexReady 會呼叫 collection.indexes() 做索引自驗）。
  //   o.indexes ＝ 預先就存在的索引；o.noAutoIndex ＝ createIndex 只記 log **不**登錄（模擬「索引沒建起來」）。
  const idxs = new Map();           // name -> [{ key }]
  const idxOf = (n) => { if (!idxs.has(n)) idxs.set(n, [{ key: { _id: 1 } }]); return idxs.get(n); };
  for (const [n, keys] of Object.entries((o && o.indexes) || {})) for (const k of keys) idxOf(n).push({ key: k });
  const log = [];                    // 每一次操作
  let insCounter = 0;                // ⭐v6.287 insertOne 自動 _id
  const col = (name) => { if (!store.has(name)) store.set(name, new Map()); return store.get(name); };
  for (const [name, docs] of Object.entries(seed || {})) for (const d of docs) col(name).set(d._id, structuredClone(d));
  const maybeThrow = (name, op) => { if (o.throwOn && o.throwOn(name, op)) throw new Error('db down (' + name + '.' + op + ')'); };
  const io = () => (o.ioDelay ? new Promise((r) => setImmediate(r)) : Promise.resolve());
  const db = {
    _store: store, _log: log,
    snapshot(name) { return [...col(name).values()].map((d) => structuredClone(d)).sort((x, y) => String(x._id).localeCompare(String(y._id))); },
    collection(name) {
      const c = col(name);
      return {
        createIndex: async (keys) => { log.push({ name, op: 'createIndex', keys }); if (!o.noAutoIndex) idxOf(name).push({ key: structuredClone(keys) }); return 'ok'; },
        indexes: async () => { log.push({ name, op: 'indexes' }); maybeThrow(name, 'indexes'); await io(); return idxOf(name).map((i) => structuredClone(i)); },
        findOne: async (q, opt) => { log.push({ name, op: 'findOne', q, opt }); maybeThrow(name, 'findOne'); await io();
          for (const d of c.values()) if (matchDoc(d, q)) return project(d, opt && opt.projection); return null; },
        find: (q, opt) => {
          log.push({ name, op: 'find', q, opt }); maybeThrow(name, 'find');
          let lim = Infinity, skp = 0, srt = null;
          const cursor = {
            limit(n) { lim = n; return cursor; },
            // ⭐v6.287：sort／skip（出貨碼的 dm list／pruneLobbyChat 用到）—— 穩定排序，與 Mongo 同款 {k:1|-1} 多鍵語義
            sort(spec) { srt = spec; return cursor; },
            skip(n) { skp = n; return cursor; },
            async toArray() { const out = []; for await (const d of cursor) out.push(d); return out; },
            async *[Symbol.asyncIterator]() {
              let rows = [...c.values()].filter((d) => matchDoc(d, q));
              if (srt) { const ks = Object.keys(srt); rows = rows.map((d, i) => [d, i]).sort((x, y) => { for (const k of ks) { const a = x[0][k], b = y[0][k]; if (a === b) continue; return (a < b ? -1 : 1) * (srt[k] < 0 ? -1 : 1); } return x[1] - y[1]; }).map((p) => p[0]); }
              rows = rows.slice(skp);
              let n = 0;
              for (const d of rows) { if (n >= lim) return; n++; await io(); yield project(d, opt && opt.projection); }
            },
          };
          return cursor;
        },
        countDocuments: async (q, opt) => { log.push({ name, op: 'countDocuments', q, opt }); maybeThrow(name, 'countDocuments'); await io();
          let n = 0; const lim = opt && opt.limit; for (const d of c.values()) { if (matchDoc(d, q)) { n++; if (lim && n >= lim) break; } } return n; },
        updateOne: async (f, upd, opt) => { log.push({ name, op: 'updateOne', f, upd, opt }); maybeThrow(name, 'updateOne'); await io();
          for (const d of c.values()) if (matchDoc(d, f)) { applyUpdate(d, upd, false); return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 }; }
          if (opt && opt.upsert) { const d = {}; for (const k of Object.keys(f)) if (!k.startsWith('$') && (typeof f[k] !== 'object' || f[k] === null)) d[k] = f[k]; applyUpdate(d, upd, true); if (d._id === undefined) d._id = 'gen_' + c.size; c.set(d._id, d); return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 }; }
          return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 }; },
        replaceOne: async (f, doc, opt) => { log.push({ name, op: 'replaceOne', f, doc: structuredClone(doc), opt }); maybeThrow(name, 'replaceOne'); await io();
          for (const [k, d] of c) if (matchDoc(d, f)) { c.set(k, structuredClone(doc)); return { matchedCount: 1, modifiedCount: 1 }; }
          if (opt && opt.upsert) { c.set(doc._id, structuredClone(doc)); return { matchedCount: 0, upsertedCount: 1 }; } return { matchedCount: 0 }; },
        deleteOne: async (f) => { log.push({ name, op: 'deleteOne', f }); maybeThrow(name, 'deleteOne'); await io();
          for (const [k, d] of c) if (matchDoc(d, f)) { c.delete(k); return { deletedCount: 1 }; } return { deletedCount: 0 }; },
        // ⭐v6.287：insertOne／deleteMany／aggregate（出貨碼的 dm send、pruneLobbyChat、admin chat/clear、admin dm 總覽用到）
        insertOne: async (doc) => { log.push({ name, op: 'insertOne', doc: structuredClone(doc) }); maybeThrow(name, 'insertOne'); await io();
          const d = structuredClone(doc); if (d._id === undefined) d._id = 'oid_' + name + '_' + (++insCounter); if (c.has(d._id)) throw new Error('E11000 duplicate key'); c.set(d._id, d); return { insertedId: d._id, acknowledged: true }; },
        deleteMany: async (f) => { log.push({ name, op: 'deleteMany', f }); maybeThrow(name, 'deleteMany'); await io();
          let n = 0; for (const [k, d] of c) if (matchDoc(d, f)) { c.delete(k); n++; } return { deletedCount: n }; },
        aggregate: (pipeline) => {
          log.push({ name, op: 'aggregate', pipeline: structuredClone(pipeline) }); maybeThrow(name, 'aggregate');
          return { async toArray() {
            await io();
            let rows = [...c.values()].map((d) => structuredClone(d));
            for (const st of pipeline) {
              const k = Object.keys(st)[0];
              if (k === '$match') rows = rows.filter((d) => matchDoc(d, st.$match));
              else if (k === '$group') {
                const g = st.$group; const idExpr = g._id; const out = new Map();
                const val = (d, e) => (typeof e === 'string' && e.startsWith('$')) ? d[e.slice(1)] : e;
                for (const d of rows) {
                  const key = val(d, idExpr); const ks = JSON.stringify(key);
                  if (!out.has(ks)) { const o = { _id: key }; for (const f of Object.keys(g)) if (f !== '_id') o[f] = undefined; out.set(ks, o); }
                  const o = out.get(ks);
                  for (const f of Object.keys(g)) {
                    if (f === '_id') continue; const spec = g[f]; const op = Object.keys(spec)[0]; const v = val(d, spec[op]);
                    if (op === '$sum') o[f] = (o[f] || 0) + (typeof v === 'number' ? v : 0);
                    else if (op === '$min') o[f] = (o[f] === undefined || v < o[f]) ? v : o[f];
                    else if (op === '$max') o[f] = (o[f] === undefined || v > o[f]) ? v : o[f];
                    else if (op === '$first') { if (o[f] === undefined) o[f] = v; }
                    else throw new Error('fake-db: 不支援的 $group 累積器 ' + op);
                  }
                }
                rows = [...out.values()];
              }
              else if (k === '$sort') { const ks = Object.keys(st.$sort); rows = rows.map((d, i) => [d, i]).sort((x, y) => { for (const kk of ks) { const a = x[0][kk], b = y[0][kk]; if (a === b) continue; return (a < b ? -1 : 1) * (st.$sort[kk] < 0 ? -1 : 1); } return x[1] - y[1]; }).map((p) => p[0]); }
              else if (k === '$limit') rows = rows.slice(0, st.$limit);
              else throw new Error('fake-db: 不支援的 pipeline 階段 ' + k);
            }
            return rows;
          } };
        },
      };
    },
  };
  return db;
}

// ── 假 Express app / req / res / 身分 ────────────────────────────────────────
export function makeFakeApp(locals) {
  const routes = { get: {}, post: {} };
  return {
    locals: locals === undefined ? {} : locals,
    routes,
    get(p, h) { routes.get[p] = h; },
    post(p, h) { routes.post[p] = h; },
    use() { /* 本區塊不掛 middleware */ },
  };
}
export function mkRes() {
  const r = { code: 200, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  // ⭐v6.287：204 零 body 走 res.status(204).end()（v6.216 手法）；ended=true 且 body 仍為 null 才算「零 body」
  r.ended = false;
  r.end = (b) => { if (b !== undefined && b !== null && b !== '') r.body = b; r.ended = true; return r; };
  r.send = (b) => { r.body = b; r.ended = true; return r; };
  return r;
}
/** 身分：Authorization: 'Bearer <JSON>' ⇒ 直接當 tournIdentity 的回傳（模擬驗過的 Firebase token）；沒帶 ⇒ 401。 */
export async function fakeTournIdentity(req) {
  const h = (req.headers && req.headers.authorization) || '';
  const m = /^Bearer\s+(.+)$/.exec(h);
  if (!m) {
    const pid = req.body && req.body.playerId;
    if (pid) return { uid: String(pid), email: null, name: '玩家', verified: false };
    return { error: '需要登入', code: 401 };
  }
  try { return JSON.parse(m[1]); } catch (e) { return { error: '登入憑證無效或過期，請重新登入', code: 401 }; }
}
export const asUser = (u) => ({ authorization: 'Bearer ' + JSON.stringify({ uid: u.uid, email: u.email, name: u.name || null, verified: true }) });
export const ADMIN_EMAILS = ['admin@example.com'];
export function fakeIsTournAdmin(id) { return !!(id && id.verified && id.email && ADMIN_EMAILS.includes(String(id.email).toLowerCase())); }

/** 中央讓路節拍（與出貨碼同款：每 200 筆 setImmediate 一次；回 null 表示不用讓）。 */
export function makeYield(every, counter) {
  return (n) => { if (n % (every || 200) !== 0) return null; if (counter) counter.ticks++; return new Promise((r) => setImmediate(r)); };
}

/** 把 FRIENDS 區塊真的跑起來，回 { routes, call, db, app }。 */
export function buildFriends(blockSrc, o) {
  const opts = o || {};
  const db = opts.db || makeFakeDb(opts.seed, opts.dbOpts);
  const app = makeFakeApp(opts.locals === undefined ? { _adminScanYield: makeYield(200, opts.yieldCounter) } : opts.locals);
  const TADMIN = opts.TADMIN === undefined ? null : opts.TADMIN;
  const logs = [];
  const fakeConsole = { log: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push('WARN ' + a.join(' ')), error: (...a) => logs.push('ERR ' + a.join(' ')) };
  new Function('app', 'db', 'tournIdentity', 'isTournAdmin', 'TADMIN', 'console', '"use strict";\n' + blockSrc + '\n')(
    app, db, opts.tournIdentity || fakeTournIdentity, opts.isTournAdmin || fakeIsTournAdmin, TADMIN, fakeConsole);
  const call = async (method, path, headers, body, query) => {
    const h = app.routes[method][path];
    if (!h) throw new Error('沒有註冊 ' + method.toUpperCase() + ' ' + path);
    const res = mkRes();
    await h({ headers: headers || {}, body: body || {}, query: query || {}, method: method.toUpperCase(), originalUrl: path }, res);
    return res;
  };
  return { routes: app.routes, call, db, app, logs };
}

/** 掃 JSON 序列化後有沒有任何 email 形狀的字串（隱私守衛的核心判準）。 */
export function findEmails(obj) {
  const s = JSON.stringify(obj);
  return (s.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g) || []);
}
