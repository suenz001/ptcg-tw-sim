#!/usr/bin/env node
/**
 * server patch v1.60 守衛（站長 2026-10-11：「套牌戰績、玩家戰績」也要排除第一回合沒進場的場次）。
 *
 * 判準只有一份：休閒＝casualNoShowExcludeClause()（第一回合 turn 1 就以「無回應，被宣告棄權」結束的不算），
 *               錦標賽＝archTournMatchCounts(m)（未進場判勝 noShow 不算）。
 *
 * 【P】admin 玩家檔案 /api/admin/player-profile（實跑 handler）：休閒戰績與錦標賽戰績都排除
 * 【S】admin 玩家統計 /api/admin/stats/players 與 /api/admin/stats/players/:email：
 *      抓 handler 送出的 pipeline，把 $match 階段套到同一批對戰上（迷你 Mongo）⇒ 第一回合無回應那場被濾掉、turn 2 的留著；
 *      單一玩家統計的「最近對戰列表」照列（只排除統計）
 * 【D】套牌戰績 /api/deck-stats：休閒查詢（真的 buildCasualCleanFilter 組出來）濾掉第一回合無回應；錦標賽側走中央述詞
 * 【Z】零回歸：不帶 archNoShow 的 buildCasualCleanFilter 與 v1.59 逐位元相同；牌組原型那份（archNoShow）也逐位元相同
 * 【H】HEAD-FAIL：同樣的盤面餵 v1.59 逐條紅
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.524／server v1.59。
const BASE_SHA = '725e9118';
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
const constLine = (src, name) => { const m = new RegExp('\\n\\s*const ' + name + ' = [^\\n]*').exec(src); return m ? m[0] : ''; };
function helpers(PATCH) {
  return constLine(PATCH, 'CASUAL_LEAVE_RE') + '\n' + constLine(PATCH, 'CASUAL_NOSHOW_RE') + '\n'
    + ['buildCasualCleanFilter', 'casualNoShowExcludeClause', 'archTournMatchCounts'].map((n) => grabFn(PATCH, n)).filter(Boolean).join('\n');
}

// ── 迷你 Mongo（$or／$and／$not regex／$gte／$type／$in／$ne／$nin／點路徑）──
function getPath(d, p) { return p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), d); }
function matchCond(v, c) {
  if (c instanceof RegExp) return typeof v === 'string' && c.test(v);
  if (c && typeof c === 'object' && !Array.isArray(c)) {
    for (const op of Object.keys(c)) {
      const x = c[op];
      if (op === '$not') { if (matchCond(v, x)) return false; }
      else if (op === '$gte') { if (!(v != null && v >= x)) return false; }
      else if (op === '$type') { if (x !== 'string' || typeof v !== 'string') return false; }
      else if (op === '$in') { if (!x.some((y) => y === v)) return false; }
      else if (op === '$nin') { if (x.some((y) => y === v)) return false; }
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

// 一般對戰：me@x 的四場。m1 第一回合對手無回應（我勝）⇒ 不算；m2 turn 2 無回應（我勝）⇒ 算；m3 我輸；m4 我勝
const ME = 'me@x';
const MR = [
  { _id: 'm1', roomCode: 'R', p1: { name: '我', email: ME, cardCounts: { c1: 4 } }, p2: { name: '他', email: 'o@x', cardCounts: { c1: 4 } }, winner: 0, winReason: '他 3 分鐘無回應，被宣告棄權', finalTurn: 1, endedAt: 4 },
  { _id: 'm2', roomCode: 'R', p1: { name: '我', email: ME, cardCounts: { c1: 4 } }, p2: { name: '他', email: 'o@x', cardCounts: { c1: 4 } }, winner: 0, winReason: '他 長時間無回應，被宣告棄權', finalTurn: 2, endedAt: 3 },
  { _id: 'm3', roomCode: 'R', p1: { name: '他', email: 'o@x', cardCounts: { c1: 4 } }, p2: { name: '我', email: ME, cardCounts: { c1: 4 } }, winner: 0, winReason: '', finalTurn: 6, endedAt: 2 },
  { _id: 'm4', roomCode: 'R', p1: { name: '他', email: 'o@x', cardCounts: { c1: 4 } }, p2: { name: '我', email: ME, cardCounts: { c1: 4 } }, winner: 1, winReason: '', finalTurn: 7, endedAt: 1 },
  // m5（Fable P3-③）：第一回合正常結束（不是無回應）⇒ 必須保留；防「把子句改成排除所有 finalTurn<2」只靠 Z 才抓得到
  { _id: 'm5', roomCode: 'R', p1: { name: '我', email: ME, cardCounts: { c1: 4 } }, p2: { name: '他', email: 'o@x', cardCounts: { c1: 4 } }, winner: 0, winReason: '他 投降', finalTurn: 1, endedAt: 0 },
];
// 錦標賽：u1＝我。r1 我勝；r2 對手未進場、我判勝 ⇒ 不算；r3 我輸
const ARCH = [{ _id: 'arch_e1', eventName: 'E1', finishedAt: 5, startedAt: 5,
  players: [{ uid: 'u1', email: ME, name: '我', deckName: 'D' }, { uid: 'u2', email: 'o@x', name: '他' }],
  matches: [{ round: 1, p1uid: 'u1', p2uid: 'u2', winnerUid: 'u1' }, { round: 2, p1uid: 'u2', p2uid: 'u1', winnerUid: 'u1', noShow: true },
            { round: 3, p1uid: 'u1', p2uid: 'u2', winnerUid: 'u2' }] }];

/** 把 handler 送出的 pipeline 的 $match 階段（$facet 之前）套到對戰上 */
function applyMatches(pipeline, docs) {
  let rows = docs.slice();
  for (const st of pipeline) { if (st.$match) rows = rows.filter((d) => matchDoc(d, st.$match)); else break; }
  return rows.map((d) => d._id).join(',');
}
function fakeDb(cap) {
  const cur = (rows) => { const c = { sort: () => c, limit: () => c, skip: () => c, toArray: async () => rows }; return c; };
  return { collection: (n) => ({
    aggregate: (p) => { cap.push({ n, p }); return { toArray: async () => [] }; },
    find: (f) => { cap.push({ n, f }); return cur(n === 'tournamentArchives' ? JSON.parse(JSON.stringify(ARCH)) : n === 'matchRecords' ? MR.filter((d) => matchDoc(d, f)) : []); },
  }) };
}
function run(PATCH, head, req) {
  const blk = grabBlock(PATCH, head);
  if (!blk) return { missing: true };
  const cap = [];
  const routes = {};
  const app = { get: (p, ...hs) => { routes[p] = hs[hs.length - 1]; } };
  new Function('app', 'requireFirebaseAdmin', 'db', '_profileCache', 'tsToMillis', helpers(PATCH) + '\n' + blk)(
    app, () => {}, fakeDb(cap), new Map(), () => null);
  const h = Object.values(routes)[0];
  let out = null, code = 200;
  const res = { status: (c) => { code = c; return res; }, json: (x) => { out = x; return res; } };
  return h(req, res).then(() => ({ out, code, cap }));
}

async function judge(PATCH) {
  const r = {};
  try {
    // P：玩家檔案
    const p = await run(PATCH, "app.get('/api/admin/player-profile'", { query: { email: ME } });
    const agg = p.cap.find((x) => x.n === 'matchRecords' && x.p);
    r.P = { casual: agg ? applyMatches(agg.p, MR) : null, tw: p.out && p.out.tournament && p.out.tournament.wins, tl: p.out && p.out.tournament && p.out.tournament.losses, err: p.out && p.out.error };
    // S：玩家統計（排行）與單一玩家統計
    const s1 = await run(PATCH, "app.get('/api/admin/stats/players'", { query: {} });
    const a1 = s1.cap.find((x) => x.p);
    const s2 = await run(PATCH, "app.get('/api/admin/stats/players/:email'", { params: { email: ME }, query: {} });
    const sp = s2.cap.filter((x) => x.p);
    const recent = s2.cap.find((x) => x.f);
    r.S = { rank: a1 ? applyMatches(a1.p, MR) : null, sum: sp[0] ? applyMatches(sp[0].p, MR) : null, top: sp[1] ? applyMatches(sp[1].p, MR) : null,
            recent: recent ? MR.filter((d) => matchDoc(d, recent.f)).map((d) => d._id).join(',') : null };
    // D：套牌戰績 —— 把休閒查詢那一行用真的 buildCasualCleanFilter 求值（deckId 條件換成恆真）
    const m = /const q = \{ \$and: \[buildCasualCleanFilter\(([^)]*)\), \{ \$or: \[\{ 'p1\.deckId': deckId \}, \{ 'p2\.deckId': deckId \}\] \}\] \};/.exec(PATCH);
    const bcf = new Function(helpers(PATCH) + '\nreturn buildCasualCleanFilter;')();
    const opts = m ? new Function('return (' + m[1] + ');')() : null;
    r.D = { casual: opts ? MR.filter((d) => matchDoc(d, bcf(opts))).map((d) => d._id).join(',') : null };
    const sec = PATCH.slice(PATCH.indexOf("app.get('/api/deck-stats'"), PATCH.indexOf("app.get('/api/rooms-archetypes'"));
    const atm = grabFn(PATCH, 'archTournMatchCounts') ? new Function(helpers(PATCH) + '\nreturn archTournMatchCounts;')() : null;
    r.D.tournCentral = /if \(!archTournMatchCounts\(_tm\)\) continue;/.test(sec) && !!atm && atm(ARCH[0].matches[1]) === false && atm(ARCH[0].matches[0]) === true;
    // Z：buildCasualCleanFilter 兩種呼叫的輸出（與 BASE 比）
    const js = (x) => JSON.stringify(x, (k, v) => (v instanceof RegExp ? String(v) : v));
    r.Z = { plain: js(bcf({ excludeAI: true, since: 7 })), arch: js(bcf({ excludeAI: true, since: 7, archNoShow: true })) };
  } catch (e) { r.err = e.message; }
  return r;
}
const J = (r) => ({
  P: !!r.P && r.P.casual === 'm2,m3,m4,m5' && r.P.tw === 1 && r.P.tl === 1,
  S: !!r.S && r.S.rank === 'm2,m3,m4,m5' && r.S.sum === 'm2,m3,m4,m5' && r.S.top === 'm2,m3,m4,m5' && r.S.recent === 'm1,m2,m3,m4,m5',
  D: !!r.D && r.D.casual === 'm2,m3,m4,m5' && r.D.tournCentral,
});

const PATCH = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8').replace(/\r\n/g, '\n');
const H = await judge(PATCH), HJ = J(H);
if (H.err) console.log('實跑錯誤：' + H.err);
ok('★★★[P] 玩家檔案：休閒戰績濾掉第一回合無回應（turn 2 照算）、錦標賽戰績不算未進場判勝（1 勝 1 負）', HJ.P, JSON.stringify(H.P));
ok('★★★[S] 玩家統計（排行、單一玩家統計與常用卡）濾掉第一回合無回應；單一玩家的最近對戰列表照列', HJ.S, JSON.stringify(H.S));
ok('★★★[D] 套牌戰績：休閒查詢濾掉第一回合無回應；錦標賽側走中央述詞（未進場不算）', HJ.D, JSON.stringify(H.D));

console.log('\n【Z／H】與 BASE 比對');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const b = readBaseBlob(ROOT, BASE_SHA, 'oracle-admin/server_admin_patch.js');
  if (b.ok) {
    const B = await judge(b.out.replace(/\r\n/g, '\n')), BJ = J(B);
    ok('★★★[Z] 零回歸：buildCasualCleanFilter 不帶／帶 archNoShow 的輸出都與 v1.59 逐位元相同（牌組原型口徑不變）',
      !!H.Z && !!B.Z && H.Z.plain === B.Z.plain && H.Z.arch === B.Z.arch, JSON.stringify({ H: H.Z, B: B.Z }));
    ok('★★★[H1] v1.59：P、S、D 逐條紅（而且不是例外）', !B.err && !BJ.P && !BJ.S && !BJ.D, JSON.stringify(B));
  } else shallowSkip('sap160 H', '讀不到 BASE blob');
} else shallowSkip('sap160 H', '需要 v1.59 commit');

console.log(`\n=== server v1.60 套牌戰績／玩家戰績排除第一回合沒進場：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
