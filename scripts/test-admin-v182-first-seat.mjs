#!/usr/bin/env node
/**
 * admin v1.82／server patch v1.61 守衛（站長 2026-10-11：「1 要改」「3 一起排出」）。
 *
 * ① 總覽 1.2 先攻後攻勝率原本把 p1（建房者）當先攻 ⇒ 錯。改讀 matchRecords.firstSeat（0＝p1 先攻、1＝p2 先攻；v6.524 起才有），
 *    只算知道誰先攻的場，回應欄位改名 firstWin／secondWin（舊伺服器只有 p1Win／p2Win ⇒ admin 不顯示那份錯的數字）。
 *    admin 對戰列表、對戰牌組視窗、玩家視窗的「先攻／後攻」標籤同樣改由中央 mrSeatLabel／mrSeatTag 決定；不知道就標玩家 1／玩家 2。
 * ③ 卡片勝率 /api/admin/stats/cards/winrate 也排除第一回合就無回應判負的場（中央 casualNoShowExcludeClause）。
 *
 * 【O】實跑 overview handler，假 DB 把它送出的 pipeline 真的套到同一批對戰上（迷你聚合：$match／$group／$project）
 * 【W】實跑 cards/winrate handler，抓 $match 套到對戰上：第一回合無回應那場被濾掉、turn 2 無回應與第一回合投降留著
 * 【A】admin 端：中央函式行為、對戰列表那一列、1.2 區塊（新舊伺服器）、牌組視窗與玩家視窗都走中央函式、版本號
 * 【Z】零回歸：overview 其他 facet 與 BASE 逐字相同；winrate 除了多一條子句之外與 BASE 相同
 * 【H1】BASE（server v1.60／admin v1.81）：O、W、A1～A3 逐條紅（而且不是例外）
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：server v1.60（admin v1.81）。
const BASE_SHA = '0dd13ba5';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

// ── 原始碼抽取 ──
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
function sentinel(src, tag) {
  const a = src.indexOf('// >>> ' + tag), b = src.indexOf('// <<< ' + tag);
  return a >= 0 && b > a ? src.slice(a, b) : '';
}
const constLine = (src, name) => { const m = new RegExp('\\n\\s*const ' + name + ' = [^\\n]*').exec(src); return m ? m[0] : ''; };
function helpers(PATCH) {
  return constLine(PATCH, 'CASUAL_LEAVE_RE') + '\n' + constLine(PATCH, 'CASUAL_NOSHOW_RE') + '\n'
    + ['buildCasualCleanFilter', 'casualNoShowExcludeClause'].map((n) => grabFn(PATCH, n)).filter(Boolean).join('\n');
}

// ── 迷你 Mongo 查詢（$or／$and／$not regex／$gte／$type／$in／$ne／點路徑）──
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
// ── 迷你聚合運算式（$cond／$and／$eq／$ne／$in、欄位參照）與 $group／$project ──
function ev(e, d) {
  if (typeof e === 'string' && e.startsWith('$')) return getPath(d, e.slice(1));
  if (Array.isArray(e) || e === null || typeof e !== 'object') return e;
  const op = Object.keys(e)[0], a = e[op];
  if (op === '$cond') return ev(a[0], d) ? ev(a[1], d) : ev(a[2], d);
  if (op === '$and') return a.every((x) => ev(x, d));
  if (op === '$eq') return ev(a[0], d) === ev(a[1], d);
  if (op === '$ne') return ev(a[0], d) !== ev(a[1], d);
  if (op === '$in') { const arr = ev(a[1], d); return Array.isArray(arr) && arr.includes(ev(a[0], d)); }
  throw new Error('迷你聚合不支援 ' + op);
}
function runStages(stages, docs) {
  let cur = docs.slice();
  for (const st of stages) {
    const op = Object.keys(st)[0], a = st[op];
    if (op === '$match') cur = cur.filter((d) => matchDoc(d, a));
    else if (op === '$group') {
      if (a._id !== null) throw new Error('迷你聚合只支援 _id:null');
      const o = { _id: null };
      for (const k of Object.keys(a)) if (k !== '_id') o[k] = cur.reduce((s, d) => s + ev(a[k].$sum, d), 0);
      cur = cur.length ? [o] : [];
    } else if (op === '$project') cur = cur.map((d) => { const x = { ...d }; delete x._id; return x; });
    else throw new Error('迷你聚合不支援 stage ' + op);
  }
  return cur;
}

// 對戰（休閒）：firstSeat 0＝p1 先攻、1＝p2 先攻；沒有＝不知道
const MR = [
  { _id: 'a', roomCode: 'R', firstSeat: 1, winner: 1, vsAI: false, winReason: '', finalTurn: 6 },   // p2 先攻且勝 ⇒ 先攻勝（舊版會算成「後攻勝」）
  { _id: 'b', roomCode: 'R', firstSeat: 1, winner: 0, vsAI: false, winReason: '', finalTurn: 7 },   // p2 先攻、p1 勝 ⇒ 後攻勝
  { _id: 'c', roomCode: 'R', firstSeat: 0, winner: 0, vsAI: false, winReason: '', finalTurn: 5 },   // p1 先攻且勝 ⇒ 先攻勝
  { _id: 'd', roomCode: 'R', winner: 0, vsAI: false, winReason: '', finalTurn: 5 },                 // 不知道誰先攻 ⇒ 不算
  { _id: 'e', roomCode: 'R', firstSeat: 0, winner: null, vsAI: false, winReason: '', finalTurn: 9 }, // 平手
  { _id: 'f', roomCode: null, firstSeat: 1, winner: 1, vsAI: true, winReason: '', finalTurn: 4 },    // 打 AI（只進「全部」）
  // g（Fable 審查 P2）：本機真人、知道先攻 ⇒ 進「全部」與「真人」，不進「線上真人」；讓 humanOnly 與 onlineHumanOnly 的預期分開
  { _id: 'g', roomCode: null, firstSeat: 0, winner: 0, vsAI: false, winReason: '', finalTurn: 6 },
];
const EXP_FM = { all: { firstWin: 4, secondWin: 1, draws: 1 }, humanOnly: { firstWin: 3, secondWin: 1, draws: 1 }, onlineHumanOnly: { firstWin: 2, secondWin: 1, draws: 1 } };

// 卡片勝率用：w1 第一回合無回應 ⇒ 不算；w2 turn 2 無回應 ⇒ 算；w3 第一回合投降（不是無回應）⇒ 算；w4 一般
const WR = [
  { _id: 'w1', roomCode: 'R', winner: 0, winReason: '他 3 分鐘無回應，被宣告棄權', finalTurn: 1, endedAt: 4 },
  { _id: 'w2', roomCode: 'R', winner: 0, winReason: '他 長時間無回應，被宣告棄權', finalTurn: 2, endedAt: 3 },
  { _id: 'w3', roomCode: 'R', winner: 1, winReason: '他 投降', finalTurn: 1, endedAt: 2 },
  { _id: 'w4', roomCode: 'R', winner: 1, winReason: '', finalTurn: 8, endedAt: 1 },
];

function run(PATCH, head, req, aggregate) {
  const blk = grabBlock(PATCH, head);
  if (!blk) return Promise.resolve({ missing: true });
  const routes = {};
  const app = { get: (p, ...hs) => { routes[p] = hs[hs.length - 1]; } };
  const cap = [];
  const db = { collection: () => ({ aggregate: (p) => { cap.push(p); return { toArray: async () => aggregate(p) }; } }) };
  new Function('app', 'requireFirebaseAdmin', 'db', helpers(PATCH) + '\n' + sentinel(PATCH, 'v161-first-seat') + '\n' + blk)(app, () => {}, db);
  const h = Object.values(routes)[0];
  // 凍結時鐘：overview 的「近 24h／7 天」facet 以 Date.now() 為界，不凍結則 Z1 的新舊比對必然不同（假紅）
  const _now = Date.now; Date.now = () => 1790000000000;
  let out = null, code = 200;
  const res = { status: (c) => { code = c; return res; }, json: (x) => { out = x; return res; } };
  return h(req, res).finally(() => { Date.now = _now; }).then(() => ({ out, code, cap }));
}
const FM_KEYS = ['firstMover', 'firstMoverHumanOnly', 'firstMoverOnlineOnly'];

async function judgeServer(PATCH) {
  const r = {};
  try {
    // O：overview —— $facet 裡 firstMover* 三組真的套到 MR；其他 facet 回空
    const o = await run(PATCH, "app.get('/api/admin/stats/overview'", { query: {} }, (p) => {
      const pre = p.filter((st) => !st.$facet);
      const docs = runStages(pre, MR);
      const facet = p.find((st) => st.$facet).$facet;
      const out = {};
      for (const k of Object.keys(facet)) out[k] = FM_KEYS.includes(k) ? runStages(facet[k], docs) : [];
      return [out];
    });
    r.O = o.out && o.out.firstMover ? o.out.firstMover : { code: o.code, err: o.out && o.out.error };
    const facet = o.cap[0] && o.cap[0].find((st) => st.$facet);
    r.otherFacets = facet ? JSON.stringify(Object.fromEntries(Object.entries(facet.$facet).filter(([k]) => !FM_KEYS.includes(k))), (k, v) => (v instanceof RegExp ? String(v) : v)) : null;
    // W：cards/winrate —— 抓第一個 $match 套到 WR
    const w = await run(PATCH, "app.get('/api/admin/stats/cards/winrate'", { query: {} }, () => [{}]);
    const m = w.cap[0] && w.cap[0][0] && w.cap[0][0].$match;
    r.W = m ? WR.filter((d) => matchDoc(d, m)).map((d) => d._id).join(',') : null;
    const js = (x) => JSON.stringify(x, (k, v) => (v instanceof RegExp ? String(v) : v));
    r.Wrest = m ? js(Object.fromEntries(Object.entries(m).filter(([k]) => k !== '$and'))) : null;
  } catch (e) { r.err = e.message; }
  return r;
}
const JS = (r) => ({
  O: !!r.O && JSON.stringify(r.O) === JSON.stringify(EXP_FM),
  W: r.W === 'w2,w3,w4',
});

// ── admin 端 ──
const fakeEsc = (x) => String(x);
function adminFn(HTML, name) {
  const pats = ['window.' + name + ' = async function', 'function ' + name + '('];
  for (const p of pats) {
    const i = HTML.indexOf(p);
    if (i < 0) continue;
    let d = 0, j = HTML.indexOf('{', HTML.indexOf(')', i));
    for (; j < HTML.length; j++) { if (HTML[j] === '{') d++; else if (HTML[j] === '}') { d--; if (d === 0) break; } }
    return HTML.slice(i, j + 1);
  }
  return null;
}
function judgeAdmin(HTML) {
  const r = {};
  try {
    const seat = (adminFn(HTML, 'mrSeatLabel') || '') + '\n' + (adminFn(HTML, 'mrSeatTag') || '');
    const S = new Function(seat + '\nreturn { L: typeof mrSeatLabel === "function" ? mrSeatLabel : null, T: typeof mrSeatTag === "function" ? mrSeatTag : null };')();
    r.A1 = !!S.L && !!S.T
      && S.L({ firstSeat: 0 }, 0) === '先攻' && S.L({ firstSeat: 0 }, 1) === '後攻'
      && S.L({ firstSeat: 1 }, 0) === '後攻' && S.L({ firstSeat: 1 }, 1) === '先攻'
      && S.L({}, 0) === '玩家 1' && S.L({ firstSeat: null }, 1) === '玩家 2' && S.L({ firstSeat: 2 }, 0) === '玩家 1'
      && S.T({ firstSeat: 1 }, 1).includes('先攻') && S.T({ firstSeat: 1 }, 0).includes('後攻') && S.T({}, 0) === '' && S.T({ firstSeat: 'x' }, 1) === '';
    // A2：對戰列表的一列（p2 先攻）：p2 那格標先攻、p1 那格標後攻；不知道的列不標；名字缺席退回「玩家 1／2」
    const row = adminFn(HTML, 'renderMatchRow');
    const R = new Function('escapeHtml', 'playerLink', 'detectMainFromCardCounts', 'fmtMatchTime', 'fmtMatchDuration',
      seat + '\n' + row + '\nreturn renderMatchRow;')(fakeEsc, (e) => e, () => '', () => 't', () => 'd');
    const cells = (h) => h.split('<td').slice(1);
    const h1 = R({ _id: 'x', roomCode: 'R', firstSeat: 1, winner: 1, p1: { name: '甲' }, p2: { name: '乙' } });
    const h2 = R({ _id: 'y', roomCode: 'R', winner: 0, p1: {}, p2: {} });
    const c1 = cells(h1), c2 = cells(h2);
    r.A2 = c1[2].includes('後攻') && !c1[2].includes('先攻') && c1[3].includes('先攻') && !c1[3].includes('後攻')
      && !/先攻|後攻/.test(h2) && c2[2].includes('玩家 1') && c2[3].includes('玩家 2');
    // A3：1.2 區塊 —— 新伺服器顯示 firstWin／secondWin；舊伺服器（只有 p1Win）不顯示那份錯的數字
    const FMr = new Function(adminFn(HTML, 'renderFirstMover') + '\nreturn renderFirstMover;')();
    const nw = FMr({ firstMover: { all: { firstWin: 3, secondWin: 1, draws: 1 } } });
    const old = FMr({ firstMover: { all: { p1Win: 7, p2Win: 2, draws: 0 } } });
    r.A3 = nw.includes('先攻 3 / 後攻 1 / 平 1') && nw.includes('5 場') && !old.includes('先攻 7') && !old.includes('%') && old.includes('v1.61');
    // A4：牌組視窗、玩家視窗、表頭都走中央函式（行為端由 A1／A2 驗，這裡只驗接線）
    const deck = adminFn(HTML, 'showMatchDeck') || '';
    r.A4 = /renderSide\(mrSeatLabel\(record, 0\)/.test(deck) && /renderSide\(mrSeatLabel\(record, 1\)/.test(deck)
      && /formatSide\(mrSeatLabel\(record, 0\)/.test(deck) && !/renderSide\('先攻'/.test(HTML)
      && /const sideTag = mrSeatTag\(m, isP1 \? 0 : 1\)/.test(HTML) && !HTML.includes('<th>先攻 (email)</th>');
  } catch (e) { r.err = e.message; }
  return r;
}

const PATCH = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8').replace(/\r\n/g, '\n');
const HTML = readFileSync(join(ROOT, 'oracle-admin/admin.html'), 'utf8').replace(/\r\n/g, '\n');
const HS = await judgeServer(PATCH), HSJ = JS(HS);
const HA = judgeAdmin(HTML);
if (HS.err) console.log('伺服器實跑錯誤：' + HS.err);
if (HA.err) console.log('admin 實跑錯誤：' + HA.err);

console.log('【O／W】伺服器');
ok('★★★[O] 總覽 1.2：只算有 firstSeat 的對戰，先攻勝＝勝方座位等於先攻座位（p2 先攻也對）；回應是 firstWin／secondWin', HSJ.O, JSON.stringify(HS.O));
ok('★★★[W] 卡片勝率：第一回合無回應那場不算；turn 2 無回應、第一回合投降照算', HSJ.W, HS.W);
console.log('【A】admin');
ok('★★★[A1] mrSeatLabel／mrSeatTag：知道誰先攻 ⇒ 先攻／後攻；不知道 ⇒ 玩家 1／玩家 2、不標小標籤', !!HA.A1);
ok('★★★[A2] 對戰列表：p2 先攻的那場，p2 標先攻、p1 標後攻；不知道的場不標；名字缺席顯示玩家 1／2', !!HA.A2);
ok('★★★[A3] 1.2 區塊：新伺服器顯示先攻／後攻勝場；舊伺服器（p1Win）不顯示錯的數字並提示更新', !!HA.A3);
ok('★★[A4] 牌組視窗（含複製文字）、玩家視窗、列表表頭都走中央函式，沒有寫死「先攻＝p1」', !!HA.A4);
// ⚠ 不可釘死某一版（下一版合法升號就假紅，IRON_RULES 安慰劑型態 9）⇒ 驗「≥ v1.82 且 title 與 h1 一致」
const _tv = /<title>PTCG Oracle Admin v1\.(\d+)<\/title>/.exec(HTML), _hv = /PTCG Oracle Admin <span class="small">v1\.(\d+)<\/span>/.exec(HTML);
ok('★[A5] admin 版本號 ≥ v1.82（title 與 h1 一致）', !!_tv && !!_hv && _tv[1] === _hv[1] && Number(_tv[1]) >= 82, JSON.stringify([_tv && _tv[1], _hv && _hv[1]]));

console.log('\n【Z／H】與 BASE 比對');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const bs = readBaseBlob(ROOT, BASE_SHA, 'oracle-admin/server_admin_patch.js');
  const ba = readBaseBlob(ROOT, BASE_SHA, 'oracle-admin/admin.html');
  if (bs.ok && ba.ok) {
    const BS = await judgeServer(bs.out.replace(/\r\n/g, '\n')), BSJ = JS(BS);
    const BA = judgeAdmin(ba.out.replace(/\r\n/g, '\n'));
    ok('★★★[Z1] 零回歸：總覽其他 facet（總場次、時長、回合、勝因…）與 v1.60 逐字相同', !!HS.otherFacets && HS.otherFacets === BS.otherFacets);
    ok('★★★[Z2] 零回歸：卡片勝率的 $match 除了新增的 $and 之外與 v1.60 相同', !!HS.Wrest && HS.Wrest === BS.Wrest, JSON.stringify({ H: HS.Wrest, B: BS.Wrest }));
    ok('★★★[H1] v1.60／admin v1.81：O、W、A1、A2、A3 逐條紅（而且伺服器端不是例外）',
      !BS.err && !BSJ.O && !BSJ.W && !BA.A1 && !BA.A2 && !BA.A3, JSON.stringify({ BS, BA }));
  } else shallowSkip('admin-v182 H', '讀不到 BASE blob');
} else shallowSkip('admin-v182 H', '需要 server v1.60 commit');

console.log(`\n=== admin v1.82／server v1.61 先攻座位＋卡片勝率未進場不計：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
