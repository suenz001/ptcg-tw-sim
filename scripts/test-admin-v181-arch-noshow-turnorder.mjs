#!/usr/bin/env node
/**
 * admin v1.81／server patch v1.59／v6.524 守衛（站長 2026-10-10）：
 *   「牌組原型算勝負的方式，如果第一回合有玩家沒進場，不應該將勝負納入計算」
 *   「在類似算對戰矩陣的部分，再幫我增加一個先攻後攻的勝率計算（另外算）」
 *
 * 【N】未進場不計（伺服器實跑；假 DB 真的套用 Mongo 查詢條件）
 *   N1 一般對戰：第一回合（finalTurn 1；engine 的 turn 只在後攻方結束回合時 +1）以「無回應，被宣告棄權」結束 ⇒
 *      環境報告圖、原型明細、對戰矩陣都不算；finalTurn 2（雙方都打完第一回合）照算
 *   N2 錦標賽：未進場判勝（noShow）⇒ 不算；一般勝負照算
 *   N3 零回歸：沒帶 archNoShow 的呼叫端（玩家戰績、套牌戰績）拿到的查詢與 v1.58 逐位元相同
 * 【T】先攻／後攻（伺服器實跑）
 *   T1 一般對戰：firstSeat 0／1 各記在雙方原型的 first／second；沒有 firstSeat 的不記；casualTurnKnown
 *   T2 錦標賽：從 tournamentMatches 的 finalState.firstPlayerIdx 讀；讀過寫進 archTurnOrder，第二次不再讀大表；
 *      多局制（bestOf>1）不記；一次最多順手補 3 個賽事、回報還缺幾個
 *   T3 /api/match-result：firstPlayerIdx 為 0／1 才寫 firstSeat；沒送或不合法 ⇒ 不寫（doc 與 v1.58 相同）
 * 【A】admin 純函式：mxMergeBuckets 合併 turnOrder；mxTurnOrder 全體／前 N 名／指定原型；舊伺服器 ⇒ supported:false
 * 【C】玩家端：對戰結束送出的戰績帶 firstPlayerIdx
 * 【H】HEAD-FAIL：同樣的盤面餵 v1.58／admin v1.80／v6.523 逐條紅
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：IRON_RULES Rule 81 那一顆（v6.523 之後）。
const BASE_SHA = '7118d189';
const rd = (r) => readFileSync(join(ROOT, r), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

function grabFn(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) return null;
  const indent = ' '.repeat(src.slice(0, i).length - src.lastIndexOf('\n', i) - 1);
  const end = src.indexOf('\n' + indent + '}', i);
  return end > i ? src.slice(i, end + indent.length + 2) : null;
}
function grabBlock(src, head) {
  const i = src.indexOf(head);
  if (i < 0) return null;
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (d === 0) break; } }
  let k = j + 1;
  while (src[k] === ')' || src[k] === ';') k++;
  return src.slice(i, k);
}
const sentinel = (src, tag) => {
  const a = src.indexOf('// >>> ' + tag), b = src.indexOf('// <<< ' + tag);
  return a >= 0 && b > a ? src.slice(a, b) : null;
};
const constLine = (src, name) => { const m = new RegExp('\\n\\s*const ' + name + ' = [^\\n]*').exec(src); return m ? m[0] : ''; };

// ── 卡名 ──
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const nameMap = new Map(), idByName = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    if (c?.id == null || !c.name) continue;
    nameMap.set(String(c.id), c.name);
    if (!idByName.has(c.name)) idByName.set(c.name, String(c.id));
  }
}
const KANGA = '超級袋獸ex', BOSS = '老大的指令', NEST = '巢穴球';
const cc = (names) => Object.fromEntries(names.map((n) => [idByName.get(n), 4]));
const de = (names) => names.map((n) => ({ cardId: idByName.get(n), count: 4 }));
const RULES = [
  { _id: 'k1', name: '袋獸型', includes: [KANGA], priority: 1, enabled: true },
  { _id: 'k2', name: '老大型', includes: [BOSS], excludes: [KANGA], priority: 2, enabled: true },
];
const A = () => cc([KANGA, NEST]), B = () => cc([BOSS, NEST]);
const ROOM = 'R1';
// 一般對戰（都有房號＝非 AI）
//   c1 A(p1) 勝 B，A 先攻；c2 B(p1) 勝 A，B 先攻（p1）；c3 A 勝 B，沒有 firstSeat
//   c4 第一回合 B 無回應棄權（A 勝）⇒ 不算；c5 第 5 回合無回應棄權（A 勝）⇒ 照算，A 後攻（firstSeat 1＝p2＝B 先攻）
const CASUAL = [
  { _id: 'c1', roomCode: ROOM, p1: { cardCounts: A() }, p2: { cardCounts: B() }, winner: 0, winReason: 'P2 沒有可上場的寶可夢', finalTurn: 9, firstSeat: 0 },
  { _id: 'c2', roomCode: ROOM, p1: { cardCounts: B() }, p2: { cardCounts: A() }, winner: 0, winReason: '', finalTurn: 7, firstSeat: 0 },
  { _id: 'c3', roomCode: ROOM, p1: { cardCounts: A() }, p2: { cardCounts: B() }, winner: 0, winReason: '', finalTurn: 8 },
  { _id: 'c4', roomCode: ROOM, p1: { cardCounts: A() }, p2: { cardCounts: B() }, winner: 0, winReason: '玩家B 3 分鐘無回應，被宣告棄權', finalTurn: 1, firstSeat: 0 },
  { _id: 'c6', roomCode: ROOM, p1: { cardCounts: A() }, p2: { cardCounts: B() }, winner: 0, winReason: '玩家B 長時間無回應，被宣告棄權', finalTurn: 2, firstSeat: 0 },   // turn 2＝雙方都已打完第一回合 ⇒ 照算（engine 的 turn 只在後攻方結束時 +1）
  { _id: 'c5', roomCode: ROOM, p1: { cardCounts: A() }, p2: { cardCounts: B() }, winner: 0, winReason: '玩家B 長時間無回應，被宣告棄權', finalTurn: 5, firstSeat: 1 },
];
// 錦標賽：e1（單局）m0 u1(A) 勝 u2(B)；m1 u2 未進場 u1 判勝 ⇒ 不算；m2 u2(B) 勝 u1(A)
//         e2（bestOf 3）m0 u1 勝 u2 —— 多局制不記先後攻
const TOURN = [
  { _id: 'arch_e1', eventId: 'e1', finishedAt: 5, bestOf: 1,
    players: [{ uid: 'u1', deckEntries: de([KANGA, NEST]) }, { uid: 'u2', deckEntries: de([BOSS, NEST]) }],
    matches: [{ round: 1, idx: 0, p1uid: 'u1', p2uid: 'u2', winnerUid: 'u1' },
              { round: 2, idx: 0, p1uid: 'u2', p2uid: 'u1', winnerUid: 'u1', noShow: true },
              { round: 3, idx: 0, p1uid: 'u2', p2uid: 'u1', winnerUid: 'u2' }] },
  { _id: 'arch_e2', eventId: 'e2', finishedAt: 6, bestOf: 3,
    players: [{ uid: 'u1', deckEntries: de([KANGA, NEST]) }, { uid: 'u2', deckEntries: de([BOSS, NEST]) }],
    matches: [{ round: 1, idx: 0, p1uid: 'u1', p2uid: 'u2', winnerUid: 'u1' }] },
];
// 對局紀錄：e1 r1 p1（u1）先攻；r3 p2（u1）先攻；r2 沒有 finalState；e2 有但多局制
const TMATCH = [
  { _id: 'e1_r1_m0', eventId: 'e1', round: 1, idx: 0, status: 'done', finalState: { firstPlayerIdx: 0, big: 'x' } },
  { _id: 'e1_r2_m0', eventId: 'e1', round: 2, idx: 0, status: 'done' },
  { _id: 'e1_r3_m0', eventId: 'e1', round: 3, idx: 0, status: 'done', finalState: { firstPlayerIdx: 1 } },
  { _id: 'e2_r1_m0', eventId: 'e2', round: 1, idx: 0, status: 'done', finalState: { firstPlayerIdx: 0 } },
];

// ── 迷你 Mongo：投影＋查詢條件（$or／$and／$not regex／$gte／$type／$in／點路徑）──
function getPath(d, p) { return p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), d); }
function matchCond(v, c) {
  if (c instanceof RegExp) return typeof v === 'string' && c.test(v);
  if (c && typeof c === 'object' && !Array.isArray(c)) {
    for (const op of Object.keys(c)) {
      const x = c[op];
      if (op === '$not') { if (matchCond(v, x)) return false; }
      else if (op === '$gte') { if (!(v != null && v >= x)) return false; }
      else if (op === '$type') { if (x === 'string' ? typeof v !== 'string' : true) return false; }
      else if (op === '$in') { if (!x.some((y) => y === v)) return false; }
      else if (op === '$ne') { if (v === x) return false; }
      else throw new Error('迷你 Mongo 不支援 ' + op);
    }
    return true;
  }
  return v === c;
}
function matchDoc(d, f) {
  for (const k of Object.keys(f || {})) {
    if (k === '$or') { if (!f.$or.some((g) => matchDoc(d, g))) return false; }
    else if (k === '$and') { if (!f.$and.every((g) => matchDoc(d, g))) return false; }
    else if (!matchCond(getPath(d, k), f[k])) return false;
  }
  return true;
}
function project(doc, proj) {
  if (!proj || !Object.keys(proj).length) return doc;
  const out = {};
  const put = (src, dst, parts) => {
    if (src == null || typeof src !== 'object') return;
    const [h, ...rest] = parts;
    if (!(h in src)) return;
    if (!rest.length) { dst[h] = src[h]; return; }
    const v = src[h];
    if (Array.isArray(v)) { const arr = Array.isArray(dst[h]) ? dst[h] : (dst[h] = v.map(() => ({}))); v.forEach((el, i) => put(el, arr[i], rest)); }
    else if (v && typeof v === 'object') put(v, dst[h] || (dst[h] = {}), rest);
  };
  for (const k of Object.keys(proj)) if (proj[k]) put(doc, out, k.split('.'));
  if ('_id' in doc) out._id = doc._id;
  return out;
}
function fakeDb(log) {
  const store = { matchRecords: CASUAL, tournamentArchives: TOURN, tournamentMatches: TMATCH, archTurnOrder: [] };
  const coll = (name) => ({
    find(filter, opts) {
      log.push({ name, filter, opts });
      const rows = store[name].filter((d) => matchDoc(d, filter)).map((d) => project(JSON.parse(JSON.stringify(d)), opts && opts.projection));
      const cur = { sort: () => cur, limit: () => cur, toArray: async () => rows, async *[Symbol.asyncIterator]() { for (const r of rows) yield r; } };
      return cur;
    },
    async updateOne(f, u, o) {
      log.push({ name, update: f });
      const i = store[name].findIndex((d) => d._id === f._id);
      const doc = Object.assign(i >= 0 ? store[name][i] : { _id: f._id }, u.$set || {});
      if (i < 0 && o && o.upsert) store[name].push(doc);
      return {};
    },
  });
  return { collection: (n) => coll(n), store };
}
const TRULES_FAKE = { find: () => { const cur = { sort: () => cur, toArray: async () => RULES }; return cur; } };

function buildServer(PATCH) {
  const fns = ['deckToSets', 'deckMatchesRule', 'ruleStrictness', 'ruleRank', 'classifyDeck', 'casualSideResult',
    'tournSideResult', 'buildCasualCleanFilter', 'archTournMatchCounts', 'casualNoShowExcludeClause'].map((n) => grabFn(PATCH, n)).filter(Boolean).join('\n');
  const stats = grabBlock(PATCH, "app.get('/api/admin/deck-archetype-stats'") || '';
  const detail = grabBlock(PATCH, "app.get('/api/admin/deck-archetype-detail'") || '';
  const norm = grabFn(PATCH, 'normCardName') || 'function normCardName(n) { return String(n || \'\').trim(); }';
  const mu = sentinel(PATCH, 'v158-arch-matchups') || '';
  const handlers = {};
  const app = { get: (p, _mw, h) => { handlers['GET ' + p] = h; }, post: (p, _mw, h) => { handlers['POST ' + p] = h; }, locals: {} };
  const log = [];
  const db = fakeDb(log);
  const leave = constLine(PATCH, 'CASUAL_LEAVE_RE'), noshow = constLine(PATCH, 'CASUAL_NOSHOW_RE');
  new Function('app', 'requireFirebaseAdmin', 'db', 'TRULES', 'getCardNameMap', 'adminScanYield', '_archStatsCache',
    'getPokemonNameSet', 'getSupportPokemonNames', '_archDetailCache', 'getCardAttrMap',
    leave + '\n' + noshow + '\n' + fns + '\n' + norm + '\n' + stats + '\n' + detail + '\n' + mu)(
    app, () => {}, db, TRULES_FAKE, async () => nameMap, () => null, new Map(), async () => new Set(), async () => new Set(),
    new Map(), async () => new Map());
  const call = async (key, query, body) => {
    const h = handlers[key];
    if (!h) return { code: 404, out: null };
    let out = null, code = 200;
    const res = { status: (c) => { code = c; return res; }, json: (x) => { out = x; return res; } };
    await h({ query: query || {}, body: body || {} }, res);
    return { code, out };
  };
  const cleanFilter = (() => { try { return new Function(leave + '\n' + noshow + '\n' + fns + '\nreturn buildCasualCleanFilter;')(); } catch { return null; } })();
  return { call, log, db, cleanFilter };
}
const eq3 = (t, w, l, d) => !!t && t[0] === w && t[1] === l && t[2] === d;
const row = (out, bk, id) => ((out && out[bk] && out[bk].rows) || []).find((r) => r.ruleId === id) || null;

async function judgeServer(PATCH) {
  const r = {};
  try {
    const S = buildServer(PATCH);
    const st = (await S.call('GET /api/admin/deck-archetype-stats', { source: 'all' })).out;
    const mu = (await S.call('GET /api/admin/deck-archetype-matchups', { source: 'all' })).out;
    if (!st || !mu) { r.err = 'endpoint missing'; return r; }
    // N1：一般對戰 A（k1）：c1 勝、c2 負、c3 勝、c5 勝、c6 勝 ＝ 4 勝 1 負（c4 第一回合無回應不算）
    const aS = row(st, 'casual', 'k1');
    const dC = (await S.call('GET /api/admin/deck-archetype-detail', { ruleId: 'k1', source: 'casual' })).out;
    const dT = (await S.call('GET /api/admin/deck-archetype-detail', { ruleId: 'k1', source: 'tourn' })).out;
    r.N1 = !!aS && aS.wins === 4 && aS.losses === 1 && eq3(mu.casual.usage.k1, 4, 1, 0) && mu.scanned.casualMatches === 5
      && !!dC && dC.sample && dC.sample.wins === 4 && dC.sample.losses === 1;
    r.N1d = JSON.stringify({ aS, mu: mu.casual.usage, sc: mu.scanned, detail: dC && (dC.sample || dC.error) });
    // N2：錦標賽 A：m0 勝、m2 負（m1 未進場不算）＋ e2 勝 ＝ 2 勝 1 負
    const aT = row(st, 'tourn', 'k1');
    r.N2 = !!aT && aT.wins === 2 && aT.losses === 1 && eq3(mu.tourn.usage.k1, 2, 1, 0) && eq3(mu.tourn.pairs.k1.k2, 2, 1, 0)
      && !!dT && dT.sample && dT.sample.wins === 2 && dT.sample.losses === 1;
    r.N2d = JSON.stringify({ aT, mu: mu.tourn.usage, detail: dT && (dT.sample || dT.error) });
    // T1：一般對戰先後攻。c1、c6 A 先攻勝；c2 B 先攻勝（A 後攻負）；c5 B 先攻（A 後攻勝）；c3 沒 firstSeat
    const to = mu.casual.turnOrder || {};
    r.T1 = !!to.k1 && eq3(to.k1.first, 2, 0, 0) && eq3(to.k1.second, 1, 1, 0)
      && eq3(to.k2.first, 1, 1, 0) && eq3(to.k2.second, 0, 2, 0) && mu.scanned.casualTurnKnown === 4;
    r.T1d = JSON.stringify({ to, sc: mu.scanned });
    // T2：錦標賽先後攻。e1 r1 u1(A) 先攻勝；r3 u1(A) 先攻（seat1＝p2＝u1）負；e2 多局制不記
    const tt = mu.tourn.turnOrder || {};
    const tmReads1 = S.log.filter((x) => x.name === 'tournamentMatches' && x.filter).length;
    const cached = S.db.store.archTurnOrder.map((d) => d._id).sort().join(',');
    // 第二次（不同 since ⇒ 不吃 60 秒快取）：不再讀 tournamentMatches
    await S.call('GET /api/admin/deck-archetype-matchups', { source: 'tourn', since: '1' });
    const tmReads2 = S.log.filter((x) => x.name === 'tournamentMatches' && x.filter).length;
    const tmProj = (S.log.find((x) => x.name === 'tournamentMatches' && x.filter) || {}).opts;
    r.T2 = !!tt.k1 && eq3(tt.k1.first, 1, 1, 0) && eq3(tt.k1.second, 0, 0, 0) && eq3(tt.k2.second, 1, 1, 0) && eq3(tt.k2.first, 0, 0, 0)
      && mu.scanned.tournTurnKnown === 2
      && tmReads1 === 2 && tmReads2 === 2 && cached === 'e1,e2' && mu.scanned.tournTurnEventsMissing === 0
      && !!tmProj && JSON.stringify(Object.keys(tmProj.projection).sort()) === JSON.stringify(['finalState.firstPlayerIdx', 'idx', 'round'])
      && S.log.filter((x) => x.name === 'tournamentMatches' && x.filter).every((x) => x.filter.status === 'done');
    r.T2d = JSON.stringify({ tt, sc: mu.scanned, tmReads1, tmReads2, cached, tmProj });
    // 補齊端點：一次 max 個、回報剩幾個
    const S2 = buildServer(PATCH);
    const m1 = (await S2.call('GET /api/admin/deck-archetype-matchups', { source: 'casual' })).out;
    const bf = await S2.call('POST /api/admin/arch-turn-backfill', {}, { max: 1 });
    const m2 = (await S2.call('GET /api/admin/deck-archetype-matchups', { source: 'casual' })).out;
    r.T2b = !!bf.out && bf.out.total === 2 && bf.out.remaining === 1 && !!m1 && !m1.cached && !!m2 && !m2.cached;   // 補完要清掉對戰矩陣快取
    r.T2bd = JSON.stringify(bf);
    // N3：沒帶 archNoShow 的查詢與 v1.58 相同（由呼叫端拿 BASE 比）
    r.cleanPlain = S.cleanFilter ? JSON.stringify(S.cleanFilter({ excludeAI: true, since: 7 }), (k, v) => (v instanceof RegExp ? String(v) : v)) : null;
  } catch (e) { r.err = e.message; }
  return r;
}
function judgeMatchResult(PATCH) {
  const blk = sentinel(PATCH, 'v159-first-seat');
  const run = (body) => { const doc = { _id: 'x' }; try { new Function('body', 'doc', blk || '')(body, doc); } catch (e) { return 'err:' + e.message; } return doc; };
  const a = run({ firstPlayerIdx: 0 }), b = run({ firstPlayerIdx: 1 }), c = run({}), d = run({ firstPlayerIdx: 2 }), e = run({ firstPlayerIdx: '0' });
  return { T3: !!blk && a.firstSeat === 0 && b.firstSeat === 1 && !('firstSeat' in c) && !('firstSeat' in d) && !('firstSeat' in e),
           d: JSON.stringify({ a, b, c, d, e }) };
}
function loadPure(HTML) {
  const a = HTML.indexOf('// ══ MX-PURE-BEGIN'), b = HTML.indexOf('// ══ MX-PURE-END');
  if (a < 0 || b < 0) return null;
  try { return new Function(HTML.slice(a, b) + '\nreturn { mxBuild, mxMergeBuckets, mxTurnOrder: typeof mxTurnOrder === "function" ? mxTurnOrder : null };')(); }
  catch { return null; }
}
function judgePure(HTML) {
  const P = loadPure(HTML);
  if (!P || !P.mxTurnOrder) return { A1: false, A2: false, A3: false };
  const data = {
    names: { k1: '袋獸型', k2: '老大型' }, unclassifiedKey: '_u',
    casual: { usage: { k1: [6, 5, 0], k2: [4, 6, 0] }, pairs: {}, turnOrder: { k1: { first: [4, 1, 0], second: [2, 3, 0] }, k2: { first: [3, 2, 0], second: [1, 4, 0] } } },
    tourn: { usage: { k1: [1, 0, 0] }, pairs: {}, turnOrder: { k1: { first: [1, 0, 0], second: [0, 0, 0] } } },
  };
  const t = P.mxTurnOrder(data, 'casual', { topN: 20, minGames: 1 });
  const all = P.mxTurnOrder(data, 'all', { topN: 20, minGames: 1, focusKey: 'k1' });
  const old = P.mxTurnOrder({ names: {}, casual: { usage: { k1: [1, 0, 0] }, pairs: {} } }, 'casual', {});
  const A1 = !!t && t.supported && t.rows.length === 2 && t.rows[0].key === 'k1'
    && Math.abs(t.rows[0].first.winRate - 0.8) < 1e-9 && Math.abs(t.rows[0].second.winRate - 0.4) < 1e-9 && Math.abs(t.rows[0].diff - 0.4) < 1e-9
    && t.overall.first.w === 7 && t.overall.first.l === 3 && t.overall.second.w === 3 && t.overall.second.l === 7;
  const A2 = !!all && all.focus && all.focus.first.w === 5 && all.focus.first.l === 1 && all.focus.second.w === 2;   // 合併：一般＋錦標賽
  const A3 = !!old && old.supported === false;
  return { A1, A2, A3, d: JSON.stringify({ t, all, old }) };
}
function judgeClient(SV) {
  return { C1: /firstPlayerIdx:\s*\(g\.firstPlayerIdx === 0 \|\| g\.firstPlayerIdx === 1\) \? g\.firstPlayerIdx : null/.test(SV) };
}

const PATCH = rd('oracle-admin/server_admin_patch.js'), HTML = rd('oracle-admin/admin.html'), SV = rd('src/routes/game/+page.svelte');
const H = await judgeServer(PATCH), HM = judgeMatchResult(PATCH), HP = judgePure(HTML), HC = judgeClient(SV);
if (H.err) console.log('伺服器實跑錯誤：' + H.err);
console.log('【N】未進場不計');
ok('★★★[N1] 一般對戰：第一回合（turn 1）無回應棄權不算（環境報告圖、原型明細、對戰矩陣都是 4 勝 1 負）；turn 2、5 的照算', H.N1, H.N1d);
ok('★★★[N2] 錦標賽：未進場判勝（noShow）不算（環境報告圖、原型明細、對戰矩陣都是 2 勝 1 負）', H.N2, H.N2d);
console.log('\n【T】先攻／後攻');
ok('★★★[T1] 一般對戰：firstSeat 記到雙方原型的先攻／後攻；沒有 firstSeat 的不記', H.T1, H.T1d);
ok('★★★[T2] 錦標賽：從對局紀錄讀先攻座位、只投影 firstPlayerIdx、讀過就快取不再讀；多局制與沒有最後盤面的不記', H.T2, H.T2d);
ok('★★[T2b] 補齊端點：一次最多 max 個賽事、回報還剩幾個', H.T2b, H.T2bd);
ok('★★[T3] 戰績寫入：firstPlayerIdx 是 0／1 才寫 firstSeat；沒送、2、字串都不寫', HM.T3, HM.d);
console.log('\n【A】admin 純函式');
ok('★★★[A1] mxTurnOrder：前 N 名的先攻／後攻勝率與差、全體加總', HP.A1, HP.d);
ok('★★[A2] 合併資料源（一般＋錦標賽）也合併先後攻；指定原型那一列', HP.A2);
ok('★[A3] 舊伺服器（沒有 turnOrder）⇒ supported:false（畫面提示先部署）', HP.A3);
console.log('\n【C】玩家端');
ok('★★[C1] 對戰結束送出的戰績帶 firstPlayerIdx（只送 0／1，其他送 null）', HC.C1);

console.log('\n【N3／H】與 BASE 比對');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const bp = readBaseBlob(ROOT, BASE_SHA, 'oracle-admin/server_admin_patch.js');
  const bh = readBaseBlob(ROOT, BASE_SHA, 'oracle-admin/admin.html');
  const bs = readBaseBlob(ROOT, BASE_SHA, 'src/routes/game/+page.svelte');
  if (bp.ok && bh.ok && bs.ok) {
    const BP = bp.out.replace(/\r\n/g, '\n');
    const B = await judgeServer(BP), BM = judgeMatchResult(BP), BPu = judgePure(bh.out.replace(/\r\n/g, '\n')), BC = judgeClient(bs.out.replace(/\r\n/g, '\n'));
    ok('★★★[N3] 零回歸：沒帶 archNoShow 的 buildCasualCleanFilter 與 v1.58 逐位元相同（玩家戰績、套牌戰績口徑不變）',
      !!H.cleanPlain && H.cleanPlain === B.cleanPlain, H.cleanPlain + ' vs ' + B.cleanPlain);
    ok('★★★[H1] v1.58／admin v1.80／v6.523：N1、N2、T1、T2、T3、A1、C1 逐條紅（而且伺服器端不是例外）',
      !B.err && !B.N1 && !B.N2 && !B.T1 && !B.T2 && !BM.T3 && !BPu.A1 && !BC.C1, JSON.stringify({ B, BM: BM.T3, BPu: BPu.A1, BC }));
  } else shallowSkip('admin-v181 H', '讀不到 BASE blob');
} else shallowSkip('admin-v181 H', '需要 BASE commit');

console.log(`\n=== admin v1.81／server v1.59 牌組原型未進場不計＋先攻後攻：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
