// server v1.82＋前端 v6.642 守衛：/bracket 內容簽章 bv（2026-11-14 擴容審查 P1-1）
//
// 【S】伺服器（抽出真的 handler＋v152／v182 哨兵區塊，餵假 DB 實跑；同一份資料也跑 BASE 的 handler 當對照）
//   S1 完整回應多一個 bv 字串，其餘內容與 BASE 逐欄位相同（單敗＋瑞士、兩位玩家）
//   S2 帶回同一個 bv ⇒ 只回 { unchanged, bv, viewers }；viewers 涵蓋所有進行中對戰（含 0 人）
//   S3 對戰結果改變（快取過期重建）⇒ bv 改變、回完整回應
//   S4 只有賽事欄位改變（冠軍、輪次狀態）⇒ bv 也改變
//   S5 帶錯的 bv、或空字串 ⇒ 照舊完整回應
//   S6 換帳號帶別人的 bv ⇒ 完整回應、mine 是自己的；S7 TTL 內仍 unchanged；S8 輪次推進 bv 變
//   F3 登出清賽程表
// 【F】前端
//   F1 tBracketApplyUnchanged：只更新進行中對戰的觀戰人數、回新物件、其他欄位沿用、bv 換成新的
//   F2 tBracketLoad：只有上一份有 bv 才帶 &bv=；unchanged 只有「bv 對得上且有上一份」才採用，否則當成這筆不可信
// 【H】HEAD-FAIL：BASE（725fbc37）上 S1～S4、F1、F2 紅
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';
import { normEol } from './lib/eol-agnostic.mjs';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = '725fbc37';
const SAP = 'oracle-admin/server_admin_patch.js', PAGE = 'src/routes/game/+page.svelte';
const rd = (r) => readFileSync(join(ROOT, r), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + String(x).slice(0, 400) : '')); } };

function handlerSrc(src, head) {
  const a = src.indexOf(head);
  if (a < 0 || src.indexOf(head, a + 1) >= 0) throw new Error('端點不是恰好一支：' + head);
  let depth = 0, i = src.indexOf('(', a);
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) break; }
    else if (c === "'" || c === '"' || c === '`') { const q = c; i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; } }
  }
  if (depth !== 0) throw new Error('括號配對失敗');
  const out = src.slice(a, i + 2);
  if (!out.endsWith(');')) throw new Error('端點結尾不是 );');
  return out;
}
function sentinel(src, tag) {
  const O = '    // >>> ' + tag + '\n', C = '    // <<< ' + tag + '\n';
  if (src.split(O).length !== 2 || src.split(C).length !== 2) throw new Error('哨兵不是恰好一對：' + tag);
  return src.slice(src.indexOf(O), src.indexOf(C) + C.length);
}

// ── 假 DB：記錄每次 find 的 filter／projection，toArray 可延遲、可失敗 ─────────────
function fakeColl(name, docs, log, opts = {}) {
  return {
    find(filter, o) {
      const proj = o && o.projection ? o.projection : null;
      log.push({ name, filter, proj });
      let sortSpec = null;
      const cur = {
        sort(s) { sortSpec = s; return cur; },
        async toArray() {
          await new Promise((r) => setTimeout(r, opts.delay || 5));
          if (opts.fail && opts.fail()) throw new Error('fake db down');
          let out = docs.filter((d) => Object.entries(filter).every(([k, v]) => d[k] === v));
          if (sortSpec) out = out.slice().sort((x, y) => (x.round - y.round) || (x.idx - y.idx));
          // 模擬 Mongo 投影：只留投影鍵＋_id
          if (proj) out = out.map((d) => { const r = { _id: d._id }; for (const k of Object.keys(proj)) if (k in d) r[k] = d[k]; return r; });
          return JSON.parse(JSON.stringify(out));   // 每次給新物件（真 driver 也是）
        },
      };
      return cur;
    },
  };
}
const BIG = { players: [{ hand: Array.from({ length: 50 }, (_, i) => ({ iid: 'x' + i, cardId: '123' })) }] };
function makeData(format) {
  const ev = { _id: 'evt_1', name: '網站賽-99', status: 'running', currentRound: 2, rounds: 3, format, phase: format === 'swiss-then-cut' ? 'swiss' : null, swissRounds: 3, topCut: 4 };
  const matches = [];
  const uids = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'];
  for (let r = 1; r <= 2; r++) for (let k = 0; k < 3; k++) {
    const p1 = uids[(k * 2 + r) % 6], p2 = uids[(k * 2 + r + 1) % 6];
    const done = r === 1;
    matches.push({ _id: 'm' + r + k, eventId: 'evt_1', round: r, idx: k, phase: format === 'swiss-then-cut' ? 'swiss' : undefined,
      p1uid: p1, p2uid: p2, p1name: 'N' + p1, p2name: 'N' + p2, status: done ? 'done' : 'playing', bye: false,
      winnerUid: done ? p1 : undefined, winnerName: done ? 'N' + p1 : undefined, roomId: done ? 'R' + r + k : 'RP' + k,
      finalState: done ? BIG : undefined, finalLog: done ? Array.from({ length: 200 }, (_, i) => 'log ' + i) : undefined });
  }
  const regs = uids.map((u, i) => ({ _id: 'r' + i, eventId: 'evt_1', uid: u, name: 'N' + u, checkedIn: true, dropped: i === 5, deckEntries: Array.from({ length: 20 }, () => ({ cardId: '1', count: 3 })) }));
  return { ev, matches, regs };
}
const TENG = {
  buildSwissPlayersFromMatches: (ms, regs) => regs.map((r) => ({ uid: r.uid, name: r.name, dropped: r.dropped,
    results: ms.filter((m) => m.p1uid === r.uid || m.p2uid === r.uid).map((m) => (m.winnerUid === r.uid ? 'W' : m.status === 'done' ? 'L' : 'P')) })),
  computeStandings: (ps) => ps.map((p, i) => ({ ...p, rank: i + 1, matchPoints: p.results.filter((x) => x === 'W').length * 3, owp: 0.5, oowp: 0.5 })),
};


function optSentinel(src, tag) { try { return sentinel(src, tag); } catch { return ''; } }
function buildEndpoint(src, data, clock) {
  const block = optSentinel(src, 'v152-bracket-light') + optSentinel(src, 'v182-bracket-version');
  const ep = handlerSrc(src, "app.get('/api/tournament/bracket',");
  const routes = {}; const app = { get: (p, h) => { routes[p] = h; } };
  const log = [];
  const fn = new Function('app', 'TMATCH', 'TREGS', 'TENG', 'tournIdentity', 'resolveEventFromReq', 'countSpectators', 'Date',
    'const _bracketCache = new Map();\n' + block + '    const BRACKET_TTL_MS = 3000;\n' + ep);
  fn(app, fakeColl('TMATCH', data.matches, log), fakeColl('TREGS', data.regs, log), TENG, async (req) => ({ uid: req.uid }), async () => data.ev,
    (room) => (room === 'RP1' ? 2 : 0), { now: () => clock.t });
  const h = routes['/api/tournament/bracket'];
  const call = (uid, query = {}) => new Promise((resolve) => {
    const res = { _s: 200, status(c) { this._s = c; return this; }, json(b) { resolve({ status: this._s, body: JSON.parse(JSON.stringify(b)) }); } };
    h({ uid, query, body: {} }, res);
  });
  return { call, log };
}
const strip = (b) => { const o = { ...b }; delete o.bv; return o; };

async function checkS(src, base, tag) {
  for (const format of ['single-elim', 'swiss-then-cut']) {
    const clock = { t: 1000 };
    const d = makeData(format);
    let ep; try { ep = buildEndpoint(src, d, clock); } catch (e) { ok(`S1${tag} [${format}] 端點組得起來`, false, e.message); continue; }
    const a = await ep.call('u1'), b = await ep.call('u4');
    let same = true;
    if (base) { const c2 = { t: 1000 }; const old = buildEndpoint(base, makeData(format), c2); const a0 = await old.call('u1'), b0 = await old.call('u4'); same = JSON.stringify(strip(a.body)) === JSON.stringify(strip(a0.body)) && JSON.stringify(strip(b.body)) === JSON.stringify(strip(b0.body)); }
    ok(`★★★ S1${tag} [${format}] 完整回應帶 bv（不同玩家不同，因為 mine 依帳號），其餘內容與 BASE 逐欄位相同`, typeof a.body.bv === 'string' && a.body.bv.length > 8 && a.body.bv !== b.body.bv && same && a.body.matches.length === 6);
    const u = await ep.call('u1', { bv: a.body.bv });
    ok(`★★★ S2${tag} [${format}] 帶回同一個 bv ⇒ 只回 unchanged＋bv＋viewers（三場進行中都有，RP1 有 2 人）`,
      u.body.unchanged === true && u.body.bv === a.body.bv && !('matches' in u.body) && !('standings' in u.body)
      && JSON.stringify(u.body.viewers) === JSON.stringify({ ['2:0:' + (format === 'swiss-then-cut' ? 'swiss' : '')]: 0, ['2:1:' + (format === 'swiss-then-cut' ? 'swiss' : '')]: 2, ['2:2:' + (format === 'swiss-then-cut' ? 'swiss' : '')]: 0 }), JSON.stringify(u.body));
    const sw = await ep.call('u4', { bv: a.body.bv });
    const u4m = sw.body.matches ? sw.body.matches.filter((m) => m.mine).length : -1, u1m = a.body.matches.filter((m) => m.mine).length;
    ok(`★★★ S6${tag} [${format}] 換帳號（u4 帶 u1 的 bv）⇒ 完整回應，mine 是 u4 自己的（不會沿用別人的「我的對局」）`, !sw.body.unchanged && Array.isArray(sw.body.matches) && JSON.stringify(sw.body.matches.map((m) => m.mine)) === JSON.stringify(b.body.matches.map((m) => m.mine)) && u4m > 0 && u1m > 0, JSON.stringify({ u4m, u1m, un: sw.body.unchanged }));
    d.matches[3].status = 'done'; d.matches[3].winnerUid = d.matches[3].p1uid; d.matches[3].winnerName = d.matches[3].p1name;
    const inTtl = await ep.call('u1', { bv: a.body.bv });
    ok(`★★ S7${tag} [${format}] 快取 TTL（3 秒）內對局結束 ⇒ 完整回應也還是同一份快取 ⇒ 仍回 unchanged（兩條路徑一致）`, inTtl.body.unchanged === true && inTtl.body.bv === a.body.bv);
    clock.t += 3001;
    const c = await ep.call('u1', { bv: a.body.bv });
    ok(`★★★ S3${tag} [${format}] 對戰結果改變（快取過期重建）⇒ bv 改變、回完整回應`, !c.body.unchanged && Array.isArray(c.body.matches) && typeof c.body.bv === 'string' && c.body.bv !== a.body.bv, JSON.stringify(c.body).slice(0, 200));
    d.ev.championName = '冠軍';
    const e = await ep.call('u1', { bv: c.body.bv });
    ok(`★★ S4${tag} [${format}] 只有賽事欄位改變（冠軍）⇒ bv 也改變`, !e.body.unchanged && e.body.bv && e.body.bv !== c.body.bv && e.body.event.championName === '冠軍');
    const r0 = e.body.bv; d.ev.currentRound = 3;
    const rr = await ep.call('u1', { bv: r0 });
    ok(`★★ S8${tag} [${format}] 輪次推進（TTL 內也會讓快取失效）⇒ bv 改變、回完整回應`, !rr.body.unchanged && rr.body.bv !== r0 && rr.body.event.currentRound === 3);
    const w = await ep.call('u1', { bv: 'x' }), z = await ep.call('u1', { bv: '' });
    ok(`★★ S5${tag} [${format}] 錯的 bv／空字串 ⇒ 完整回應`, Array.isArray(w.body.matches) && !w.body.unchanged && Array.isArray(z.body.matches) && !z.body.unchanged);
  }
}

function sliceFn(src, head) {
  const i = src.indexOf(head); if (i < 0) return '';
  let d = 0; for (let k = src.indexOf('{', i); k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (d === 0) return src.slice(i, k + 1); } }
  return '';
}
function checkF(pageRaw, tag) {
  const page = stripCommentsBlankChecked(normEol(pageRaw), 'svelte');
  const fnSrc = sliceFn(page, 'function tBracketApplyUnchanged(prev: any, r: any): any').replace(/: any/g, '');
  let f = null; try { f = fnSrc ? new Function(fnSrc.replace('function tBracketApplyUnchanged(prev, r)', 'return function (prev, r)')) () : null; } catch (e) { f = null; }
  const prev = { event: { _id: 'E' }, bv: 'old', standings: [{ rank: 1 }], matches: [
    { round: 2, idx: 0, phase: 'swiss', status: 'playing', viewers: 5, mine: true },
    { round: 2, idx: 1, phase: 'swiss', status: 'done', viewers: 0 },
    { round: 2, idx: 2, phase: null, status: 'playing', viewers: 1 } ] };
  const out = f ? f(prev, { unchanged: true, bv: 'new', viewers: { '2:0:swiss': 0, '2:1:swiss': 9, '2:2:': 3 } }) : null;
  ok(`★★★ F1${tag} 沿用上一份、只更新進行中對戰的觀戰人數、回新物件、bv 換新`, !!out && out !== prev && out.matches !== prev.matches && out.bv === 'new'
    && out.matches[0].viewers === 0 && out.matches[0].mine === true && out.matches[1].viewers === 0 && out.matches[2].viewers === 3 && out.standings === prev.standings && prev.matches[0].viewers === 5, JSON.stringify(out));
  const ld = sliceFn(page, 'async function tBracketLoad()');
  const sendOk = /\(_sentBv\[i\] \? '&bv=' \+ encodeURIComponent\(_sentBv\[i\]\) : ''\)/.test(ld) && /typeof p\.bv === 'string' && p\.bv\) \? p\.bv : ''/.test(ld);
  const recvOk = /if \(r && r\.unchanged === true\) \{[\s\S]{0,200}r = \(p && _sentBv\[i\] && r\.bv === _sentBv\[i\]\) \? tBracketApplyUnchanged\(p, r\) : null;/.test(ld);
  const order = ld.indexOf('r.unchanged === true') > 0 && ld.indexOf('r.unchanged === true') < ld.indexOf('const ok = !!(r && r.event && Array.isArray(r.matches));');
  const lo = sliceFn(page, 'async function tournLogout()');
  ok(`★★★ F3${tag} 登出時清掉賽程表（mine 依帳號）並讓路上的回應失效`, /tBrackets = \[\];[^\n]*tBracketsEverOk = false;[^\n]*_tBracketSeq\+\+;/.test(lo) && lo.indexOf('tBrackets = []') < lo.indexOf('signOut(auth)'), lo.slice(0, 200));
  ok(`★★★ F2${tag} 只有上一份有 bv 才帶 &bv=；unchanged 要 bv 對得上且有上一份才採用，否則交給「沿用舊的＋stale」`, ld.length > 500 && sendOk && recvOk && order, JSON.stringify({ sendOk, recvOk, order }));
}

const CUR = rd(SAP);
let BASE = null, BPAGE = null;
if (hasBaseCommit(ROOT, BASE_SHA)) { const r = readBaseBlob(ROOT, BASE_SHA, SAP); BASE = r.ok ? r.out.replace(/\r\n/g, '\n') : null; const q = readBaseBlob(ROOT, BASE_SHA, PAGE); BPAGE = q.ok ? q.out : null; }
console.log('【S】伺服器'); await checkS(CUR, BASE, '');
console.log('【F】前端'); checkF(rd(PAGE), '');
console.log('【H】HEAD-FAIL');
if (!BASE || !BPAGE) shallowSkip('H（缺 BASE ' + BASE_SHA + '）');
else {
  const before = pass, fb = fail; const log = console.log; const lines = []; console.log = (s) => lines.push(String(s));
  await checkS(BASE, null, '@BASE'); checkF(BPAGE, '@BASE');
  console.log = log;
  const reds = lines.filter((l) => /FAIL/.test(l)).map((l) => l.trim().slice(5, 40));
  pass = before; fail = fb;
  console.log('    BASE 紅：' + reds.join('｜'));
  const needFmt = ['S1', 'S2', 'S3', 'S4'].flatMap((k) => ['single-elim', 'swiss-then-cut'].map((f) => [k + '@BASE', f]));
  const fmtOk = needFmt.every(([k, f]) => lines.some((l) => /FAIL/.test(l) && l.includes(k) && l.includes('[' + f + ']')));
  ok('★★★ H1 BASE 上 S1～S4 兩種賽制都紅，F1、F2、F3 紅', fmtOk && ['F1@BASE', 'F2@BASE', 'F3@BASE'].every((k) => reds.some((r) => r.includes(k))), reds.join(','));
  ok('★★ H2 BASE 上 S5 照樣綠（正對照：BASE 本來就只回完整回應）', !reds.some((r) => r.includes('S5@BASE')), reds.join(','));
}
console.log(`=== server v1.82／v6.642 /bracket 內容簽章：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
