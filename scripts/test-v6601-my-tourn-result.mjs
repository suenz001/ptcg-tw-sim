#!/usr/bin/env node
/**
 * v6.601 守衛：「我的錦標賽對戰」清單標出自己的勝／敗（站長 2026-10-25：「我的錦標賽對戰也要標勝敗」）
 *
 * 伺服器 v1.74：GET /api/my-tourn-matches 每一場多回 result（win／loss／draw）——winnerUid 只在伺服器比對、不回傳 uid。
 *   判法與賽事戰績既有寫法相同：有勝者 ⇒ 是不是自己；沒有勝者（時限雙敗、雙方棄權）⇒ draw（畫面「雙敗」）。
 *   端點在錦標賽區塊（TAIL_ANCHOR）之前 ⇒ 28 把鎖不動。
 * 前端：parseMyTournMatches 只收三個合法值；清單用 v6.600 的 ReplayRowLabel（kind:'tournament' ⇒ draw 顯示「雙敗」）；
 *   舊伺服器沒有 result ⇒ 不標（不從名字猜：錦標賽清單沒有「我坐哪一側」）。
 *
 * 【S】伺服器哨兵區塊接假 Mongo（會套用 projection）實跑：P1／P2 各種組合的勝、敗、雙敗；不回 uid；沒拿 winnerUid 就算不出來
 * 【U】parseMyTournMatches：合法值保留、亂值丟掉、舊伺服器沒有欄位；ReplayRowLabel 的判準對錦標賽列給出 勝／敗／雙敗／不標
 * 【W】對戰頁清單接線
 * 【H】HEAD-FAIL：BASE（v6.600）上 S1、U1、W1 逐條紅
 */
import { readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { normEol } from './lib/eol-agnostic.mjs';
import { stripCommentsBlank } from './lib/strip-comments.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_SHA = 'ac3f40a4';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + String(x).slice(0, 700) : '')); } };
const R = (p) => normEol(readFileSync(join(ROOT, p), 'utf8'));

// ── 假 Mongo：$or／$ne／$in／$gt、sort 單欄、limit，⭐會套用 projection（沒列進 projection 的欄位拿不到）──
const clone = (o) => JSON.parse(JSON.stringify(o));
function matchOne(d, q) {
  for (const k of Object.keys(q || {})) {
    const c = q[k];
    if (k === '$or') { if (!c.some((x) => matchOne(d, x))) return false; continue; }
    const v = d[k];
    if (c && typeof c === 'object' && !Array.isArray(c)) {
      if ('$ne' in c && v === c.$ne) return false;
      if ('$in' in c && !c.$in.includes(v)) return false;
      if ('$gt' in c && !(v > c.$gt)) return false;
      continue;
    }
    if (v !== c) return false;
  }
  return true;
}
const project = (d, proj) => { if (!proj) return d; const o = { _id: d._id }; for (const k of Object.keys(proj)) if (proj[k] && k in d) o[k] = d[k]; return o; };
function Col(rows = []) {
  const calls = { find: 0, idx: [] };
  return {
    rows, calls,
    createIndexes: async (arr) => { for (const x of arr) calls.idx.push(JSON.stringify(x.key)); },
    indexes: async () => [{ key: { _id: 1 } }, ...calls.idx.map((k) => ({ key: JSON.parse(k) }))],
    find(q, opt) {
      calls.find++;
      let sel = rows.filter((d) => matchOne(d, q)).map(clone);
      const cur = {
        sort: (s) => { const [[k, dir]] = Object.entries(s); sel = sel.sort((a, b) => ((a[k] ?? 0) - (b[k] ?? 0)) * dir); return cur; },
        limit: (n) => { sel = sel.slice(0, n); return cur; },
        toArray: async () => sel.map((d) => project(d, opt && opt.projection)),
      };
      return cur;
    },
  };
}
function sentinel(src, tag) {
  const a = src.indexOf('// >>> ' + tag), b = src.indexOf('// <<< ' + tag);
  if (a < 0 || b < a) return null;
  return src.slice(src.lastIndexOf('\n', a) + 1, src.indexOf('\n', b) + 1);
}
async function call(h, req) {
  let status = 200, body = null;
  const res = { status(c) { status = c; return res; }, json(b) { body = b; return res; }, set() { return res; } };
  await h(req, res);
  return { status, body };
}

async function serverChecks(P) {
  const r = {};
  const blk = sentinel(P, 'v166-my-tourn-matches');
  if (!blk) return r;
  const M = (id, at, extra) => ({ _id: id, eventId: 'E1', round: 1, p1uid: 'me', p1name: '我', p2uid: 'x', p2name: '對手', status: 'done', gameStartedAt: at, endedAt: at + 50, ...extra });
  const rows = [
    M('WIN_P1', 6000, { winnerUid: 'me', winnerName: '我' }),
    M('LOSS_P1', 5000, { winnerUid: 'x', winnerName: '對手' }),
    M('WIN_P2', 4000, { p1uid: 'x', p2uid: 'me', p1name: '對手', p2name: '我', winnerUid: 'me', winnerName: '我' }),
    M('LOSS_P2', 3000, { p1uid: 'x', p2uid: 'me', p1name: '對手', p2name: '我', winnerUid: 'x', winnerName: '對手' }),
    M('DRAW', 2000, { winnerUid: null, winnerName: null, timeLimit: true, draw: true }),
    M('SAMENAME', 1000, { p2name: '我', winnerUid: 'x', winnerName: '我' }),   // 雙方同暱稱：只有 uid 分得出來 ⇒ 敗
    M('NAMEONLY', 900, { winnerUid: null, winnerName: '我' }),   // 審查 P3-2：只有勝者名稱、沒有 uid ⇒ 不標
  ];
  const cols = { tournamentMatches: Col(rows), tournamentEvents: Col([{ _id: 'E1', name: '網站賽' }]), tournamentArchives: Col() };
  const routes = {};
  await new Function('db', 'app', 'tournIdentity', 'return (async () => {\n' + blk + '\nreturn {};\n})();')(
    { collection: (n) => cols[n] || Col() }, { get: (p, h) => { routes['GET ' + p] = h; } }, async () => ({ uid: 'me', verified: true }));
  const g = await call(routes['GET /api/my-tourn-matches'], { query: {}, headers: {} });
  const by = Object.fromEntries((g.body?.matches || []).map((m) => [m.matchId, m.result]));   // 沒有 result 的列 ⇒ undefined
  r.S1 = g.status === 200 && by.WIN_P1 === 'win' && by.LOSS_P1 === 'loss' && by.WIN_P2 === 'win' && by.LOSS_P2 === 'loss' && by.DRAW === 'draw' && by.SAMENAME === 'loss' && 'NAMEONLY' in by && by.NAMEONLY === undefined
    && !JSON.stringify(g.body).includes('"me"') && !JSON.stringify(g.body).includes('"x"') && !JSON.stringify(g.body).includes('winnerUid');
  r.S1n = JSON.stringify(by);
  return r;
}

async function loadMods(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6601-'));
  const E = join(tmp, 'e.ts'), O = join(tmp, 'o.mjs');
  const p = (x) => join(srcRoot, x).replace(/\\/g, '/');
  const lbl = existsSync(join(srcRoot, 'src/lib/game/replay-label.ts')) ? `export * from '${p('src/lib/game/replay-label')}';\n` : '';
  writeFileSync(E, `export { parseMyTournMatches, myTournMatchLine } from '${p('src/lib/tournament/my-matches')}';\n` + lbl);
  try {
    await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', logLevel: 'silent' });
    return { ...(await import(pathToFileURL(O).href)) };
  } catch { return null; } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}
function unitChecks(Mo) {
  const r = {};
  if (!Mo) return r;
  const one = (extra) => Mo.parseMyTournMatches({ myTournApi: 1, matches: [{ matchId: 'm', p1name: 'A', p2name: 'B', winnerName: 'A', at: 1, ...extra }] })?.matches?.[0];
  const a = one({ result: 'win' }), b = one({ result: 'loss' }), c = one({ result: 'draw' }), d = one({ result: 'lose' }), e = one({});
  r.U1 = a?.result === 'win' && b?.result === 'loss' && c?.result === 'draw' && !!d && !('result' in d) && !!e && !('result' in e);
  // 清單用的判準（ReplayRowLabel 吃同一份）：錦標賽列 ⇒ 勝／敗／雙敗；沒有 result ⇒ 不標（不從名字猜）
  if (typeof Mo.replayResultLabel === 'function') {
    const L = (x) => Mo.replayResultLabel({ kind: 'tournament', p1name: x.p1name, p2name: x.p2name, result: x.result });
    const row = (res) => ({ p1name: 'A', p2name: 'B', ...(res ? { result: res } : {}) });   // 直接餵列資料（不經 parse，HEAD-FAIL 時才是獨立的正對照）
    // 說明行：有勝者寫 🏆；標籤已經是「雙敗」就不重複；舊伺服器沒有 result 照舊寫「雙敗」
    const line = (x) => (typeof Mo.myTournMatchLine === 'function' ? Mo.myTournMatchLine({ matchId: 'm', eventName: 'E', round: 1, p1name: 'A', p2name: 'B', at: 0, ...x }) : '');
    r.U3 = line({ winnerName: 'A', result: 'win' }).endsWith('🏆 A') && !/雙敗/.test(line({ winnerName: null, result: 'draw' })) && line({ winnerName: null }).endsWith('雙敗');
    r.U2 = L(row('win')) === '勝' && L(row('loss')) === '敗' && L(row('draw')) === '雙敗' && L(row(null)) === '';
  }
  return r;
}
function staticChecks(GAME) {
  const g = stripCommentsBlank(GAME);
  const i = g.indexOf('{#each myTournMatches.matches as tm (tm.matchId)}');
  const blk = i >= 0 ? g.slice(i, g.indexOf('{/each}', i)) : '';
  return { W1: blk.length > 100 && /<ReplayRowLabel meta=\{\{ kind: 'tournament', p1name: tm\.p1name, p2name: tm\.p2name, result: tm\.result \}\} \/>/.test(blk) && !/class="replay-names"/.test(blk) };
}

const S = await serverChecks(R('oracle-admin/server_admin_patch.js'));
ok('★★★ S1 伺服器：P1／P2 各種組合的勝、敗、雙敗都對（同暱稱也靠 uid 分得出來；只有勝者名稱沒有 uid 不標）；不回傳任何 uid', S.S1 === true, S.S1n);
{
  // 正對照：projection 拿掉 winnerUid ⇒ 全部變雙敗 ⇒ S1 紅（證明假 Mongo 真的套用 projection、判準真的在看結果）
  const P = R('oracle-admin/server_admin_patch.js');
  const m = P.replace("winnerName: 1, winnerUid: 1, gameStartedAt: 1", "winnerName: 1, gameStartedAt: 1");
  ok('★ 正對照：projection 沒拿 winnerUid ⇒ S1 紅', m !== P && (await serverChecks(m)).S1 === false);
}
const U = unitChecks(await loadMods(ROOT));
ok('★★★ U1 parseMyTournMatches：win／loss／draw 保留，亂值與舊伺服器沒有欄位 ⇒ 不帶', U.U1 === true);
ok('★★ U2 清單判準：錦標賽列 勝／敗／雙敗；沒有 result 不標', U.U2 === true);
ok('★★ U3 說明行：標籤已是「雙敗」不重複；舊伺服器照舊', U.U3 === true);
const W = staticChecks(R('src/routes/game/+page.svelte'));
ok('★★ W1 「我的錦標賽對戰」清單用 ReplayRowLabel 帶 result', W.W1 === true);

if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('HEAD-FAIL（缺 BASE ' + BASE_SHA + '）');
else {
  const tmp = mkdtempSync(join(tmpdir(), 'v6601h-'));
  try {
    const { execFileSync } = await import('node:child_process');
    execFileSync('bash', ['-c', `git -C "${ROOT}" archive ${BASE_SHA} src | tar -x -C "${tmp}"`]);
    const bS = await serverChecks(normEol(readBaseBlob(ROOT, BASE_SHA, 'oracle-admin/server_admin_patch.js').out));
    const bU = unitChecks(await loadMods(tmp));
    const bW = staticChecks(normEol(readBaseBlob(ROOT, BASE_SHA, 'src/routes/game/+page.svelte').out));
    const red = [bS.S1 !== true && 'S1', bU.U1 !== true && 'U1', bU.U3 !== true && 'U3', bW.W1 !== true && 'W1'].filter(Boolean);
    ok('★★★ HEAD-FAIL：BASE（v6.600）上 S1、U1、U3、W1 逐條紅', red.length === 4, red.join(','));
    ok('★ HEAD-FAIL 正對照：BASE 上 U2（v6.600 的判準）本來就成立', bU.U2 === true);
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}

console.log(`\n=== v6.601 我的錦標賽對戰標勝敗：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
