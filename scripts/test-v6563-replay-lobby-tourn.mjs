#!/usr/bin/env node
/**
 * v6.563 守衛（站長 2026-10-13 18:21）：
 *   「本機雙人和 vs AI，我覺得沒有必要放入復盤的紀錄裏面，復盤只要放一般對戰就好」
 *   「把錦標賽的對戰也讓玩家可以在這邊找到自己最近的錦標賽復盤紀錄」
 *   「可以拿掉復盤的那個按鈕，改成直接顯示最近10場的對戰，然後按鈕保持只有本機對戰和線上對戰2個按鈕」
 *
 *   S：伺服器 v1.66 哨兵 v166-my-tourn-matches 抽出來接假 Mongo **實跑**（只回自己的、最近 10 場、排除輪空／未結束、
 *      不回 uid、賽事名稱含歸檔備援、未登入 needLogin、30 秒快取、建兩個索引）。
 *   L：前端 leaf my-matches.ts 實跑。
 *   W：對戰頁接線（記錄條件只剩線上由 test-v6560 W1／W6 守；這裡守清單與錦標賽回放入口／離開路徑）。
 *   E：真瀏覽器（build/）：開始對戰頁只有兩張卡、清單直接顯示；錦標賽對戰（攔截 API 回假資料）按 ▶ 觀看 ⇒ 回放 ⇒ 離開回清單；未登入顯示提示。
 * 【H】BASE（v6.562）：S／L／W／E 紅。
 */
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';
import { build } from 'esbuild';
import { normEol } from './lib/eol-agnostic.mjs';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { buildAiBundle, loadLivePool, presetById, playGame, firstPlayerOf } from './lib/ai-sim-harness.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.562。
const BASE_SHA = 'c534cdd3';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

// ── 假 Mongo（只做用到的：$or、$in、$ne、$gt、sort 單欄、limit、projection 略過）──
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
function Col(rows = []) {
  const calls = { find: 0, idx: [] };
  return {
    rows, calls,
    createIndex: async (spec) => { calls.idx.push(JSON.stringify(spec)); },
    createIndexes: async (arr) => { calls.batches = (calls.batches || 0) + 1; for (const x of arr) calls.idx.push(JSON.stringify(x.key)); },
    indexes: async () => (calls.noIdx ? [{ key: { _id: 1 } }] : calls.onlyIdx ? [{ key: { _id: 1 } }, ...calls.onlyIdx.map((k) => ({ key: k }))] : [{ key: { _id: 1 } }, ...calls.idx.map((k) => ({ key: JSON.parse(k) }))]),
    find(q) {
      calls.find++;
      let sel = rows.filter((d) => matchOne(d, q)).map(clone);
      const cur = { sort: (s) => { const [[k, dir]] = Object.entries(s); sel = sel.sort((a, b) => ((a[k] ?? 0) - (b[k] ?? 0)) * dir); return cur; }, limit: (n) => { sel = sel.slice(0, n); return cur; }, toArray: async () => sel };
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

// ═══ S：伺服器 ══════════════════════════════════════════════════════════
async function serverScenarios(P) {
  const r = {};
  const blk = sentinel(P, 'v166-my-tourn-matches');
  if (!blk) return r;
  const M = (id, extra) => ({ _id: id, eventId: 'E1', round: 1, idx: 0, p1uid: 'me', p1name: '我', p2uid: 'x', p2name: '對手', winnerName: '我', status: 'done', gameStartedAt: 1000, endedAt: 2000, finalState: { big: 1 }, ...extra });
  const rows = [];
  for (let i = 0; i < 12; i++) rows.push(M('E1_r' + (i + 1) + '_m0', { round: i + 1, gameStartedAt: 10000 + i * 100, endedAt: 10050 + i * 100, ...(i % 2 ? { p1uid: 'x', p2uid: 'me', p1name: '對手', p2name: '我' } : {}) }));
  rows.push(M('NOSHOWWIN', { noShow: true, gameStartedAt: 99996 }), M('DBLNOSHOW', { doubleNoShow: true, gameStartedAt: 99995 }),
    M('BYE', { bye: true, gameStartedAt: 99999 }), M('PLAYING', { status: 'playing', gameStartedAt: 99998 }), M('NOSHOW', { gameStartedAt: undefined }),
    M('OTHER', { p1uid: 'a', p2uid: 'b', gameStartedAt: 99997 }), M('E9_r1_m0', { eventId: 'E9', gameStartedAt: 20000, winnerName: null }));
  const cols = {
    tournamentMatches: Col(rows),
    tournamentEvents: Col([{ _id: 'E1', name: '網站賽-150【21:00 瑞士制】' }]),
    tournamentArchives: Col([{ _id: 'arch_E9', eventName: '已刪除的賽事' }]),
  };
  const db = { collection: (n) => cols[n] || Col() };
  const routes = {};
  let ident = { uid: 'me', verified: true };
  await new Function('db', 'app', 'tournIdentity', 'return (async () => {\n' + blk + '\nreturn {};\n})();')(db, { get: (p, h) => { routes['GET ' + p] = h; } }, async () => ident);
  const realNow = Date.now; let clock = 1_000_000; Date.now = () => clock;
  try {
    const G = () => call(routes['GET /api/my-tourn-matches'], { query: {}, headers: {} });
    const g = await G();
    const ms = g.body && g.body.matches || [];
    // S1：自己的、已結束、非輪空、有開打；依開打時間新→舊；最多 10 場；賽事名稱（被刪的用歸檔名）；不回 uid、不回盤面
    r.S1 = g.status === 200 && g.body.myTournApi === 1 && ms.length === 10 && ms[0].matchId === 'E9_r1_m0' && ms[0].eventName === '已刪除的賽事' && ms[0].winnerName === null
      && ms[1].matchId === 'E1_r12_m0' && ms[1].eventName === '網站賽-150【21:00 瑞士制】' && ms[1].at === 10050 + 11 * 100
      && ms.every((m) => !['BYE', 'PLAYING', 'NOSHOW', 'OTHER', 'NOSHOWWIN', 'DBLNOSHOW'].includes(m.matchId)) && !JSON.stringify(g.body).includes('"me"') && !JSON.stringify(g.body).includes('finalState');
    r.S1n = JSON.stringify(ms.map((m) => m.matchId));
    // S2：建了兩個索引（p1uid／p2uid ＋ 開打時間）——沒有索引就是全表掃描
    r.S2 = cols.tournamentMatches.calls.idx.includes(JSON.stringify({ p1uid: 1, gameStartedAt: -1 })) && cols.tournamentMatches.calls.idx.includes(JSON.stringify({ p2uid: 1, gameStartedAt: -1 }))
      && cols.tournamentMatches.calls.batches === 1;   // 一次 createIndexes（只掃一次全表）
    // S3：未登入／匿名（身分錯誤）、只有 playerId（未驗證）⇒ needLogin、空清單（不可以拿 playerId 查別人）
    ident = { error: '需要登入', code: 401 }; const a = await G();
    ident = { uid: 'me', verified: false }; const b = await G();
    r.S3 = a.body.needLogin === true && a.body.matches.length === 0 && b.body.needLogin === true && b.body.matches.length === 0;
    // S4：同一位玩家 30 秒內不重查；過了才重查
    ident = { uid: 'me', verified: true };
    const n0 = cols.tournamentMatches.calls.find;
    await G(); await G();
    const n1 = cols.tournamentMatches.calls.find;
    clock += 31000; await G();
    r.S4 = n1 === n0 && cols.tournamentMatches.calls.find === n0 + 1;
    r.S4n = JSON.stringify({ n0, n1, n2: cols.tournamentMatches.calls.find });
    // S5（Opus 審查 P3-4）：兩個玩家同時查 ⇒ 各自只拿到自己的（在途合併／快取不可以跨玩家）
    for (let i = 0; i < 3; i++) rows.push(M('YOU' + i, { p1uid: 'you', p2uid: 'z', p1name: '你', gameStartedAt: 30000 + i }));
    clock += 31000;
    let who = 'me'; const idents = { me: { uid: 'me', verified: true }, you: { uid: 'you', verified: true } };
    ident = null;
    const GG = (u) => call(routes['GET /api/my-tourn-matches'], { query: {}, headers: {}, _u: u });
    const routesU = {};
    await new Function('db', 'app', 'tournIdentity', 'return (async () => {\n' + blk + '\nreturn {};\n})();')(db, { get: (p, h) => { routesU['GET ' + p] = h; } }, async (req) => idents[req._u]);
    const [x1, x2] = await Promise.all([call(routesU['GET /api/my-tourn-matches'], { _u: 'me' }), call(routesU['GET /api/my-tourn-matches'], { _u: 'you' })]);
    r.S5 = x1.body.matches.length === 10 && !x1.body.matches.some((m) => /^YOU/.test(m.matchId)) && x2.body.matches.length === 3 && x2.body.matches.every((m) => /^YOU/.test(m.matchId));
    r.S5n = JSON.stringify([x1.body.matches.length, x2.body.matches.map((m) => m.matchId)]);
    void who; void GG;
    // S6（Opus 審查 P2-3）：索引不在 ⇒ 不查（不全表掃描），回空清單
    const colsN = { tournamentMatches: Col(rows), tournamentEvents: Col(), tournamentArchives: Col() };
    colsN.tournamentMatches.calls.noIdx = true;
    const routesN = {};
    await new Function('db', 'app', 'tournIdentity', 'return (async () => {\n' + blk + '\nreturn {};\n})();')({ collection: (n) => colsN[n] || Col() }, { get: (p, h) => { routesN['GET ' + p] = h; } }, async () => ({ uid: 'me', verified: true }));
    const xn = await call(routesN['GET /api/my-tourn-matches'], {});
    // S6b（Opus 複審 P3-a）：只有其中一個索引在（另一個建失敗）⇒ 照樣不查（.every 不可以變成 .some）
    const colsP = { tournamentMatches: Col(rows), tournamentEvents: Col(), tournamentArchives: Col() };
    colsP.tournamentMatches.calls.onlyIdx = [{ p1uid: 1, gameStartedAt: -1 }];
    const routesP = {};
    await new Function('db', 'app', 'tournIdentity', 'return (async () => {\n' + blk + '\nreturn {};\n})();')({ collection: (n) => colsP[n] || Col() }, { get: (p, h) => { routesP['GET ' + p] = h; } }, async () => ({ uid: 'me', verified: true }));
    const xp = await call(routesP['GET /api/my-tourn-matches'], {});
    r.S6 = xn.status === 200 && xn.body.matches.length === 0 && colsN.tournamentMatches.calls.find === 0
      && xp.status === 200 && xp.body.matches.length === 0 && colsP.tournamentMatches.calls.find === 0;
    r.S6n = JSON.stringify({ n: xn.body.matches.length, finds: colsN.tournamentMatches.calls.find });
  } finally { Date.now = realNow; }
  return r;
}

// ═══ L：leaf ═════════════════════════════════════════════════════════════
async function loadLeaf(srcRoot) {
  if (!existsSync(join(srcRoot, 'src/lib/tournament/my-matches.ts'))) return null;
  const tmp = mkdtempSync(join(tmpdir(), 'v6563-'));
  const E = join(tmp, 'e.ts'), O = join(tmp, 'o.mjs');
  writeFileSync(E, `export * from '${join(srcRoot, 'src/lib/tournament/my-matches').replace(/\\/g, '/')}';`);
  try { await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', logLevel: 'silent' }); return await import(pathToFileURL(O).href); }
  catch { return null; } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}
function leafScenarios(L) {
  const r = {};
  if (!L) return r;
  const p = L.parseMyTournMatches({ myTournApi: 1, matches: [{ matchId: 'm1', eventName: 'E', round: 3, p1name: 'A', p2name: 'B', winnerName: 'A', at: 1 }, { matchId: '' }, null, { eventName: 'x' }] });
  r.L1 = !!p && p.needLogin === false && p.matches.length === 1 && p.matches[0].round === 3
    && L.parseMyTournMatches({ matches: [] }) === null && L.parseMyTournMatches({ myTournApi: 1, needLogin: true }).needLogin === true;
  const line = L.myTournMatchLine({ matchId: 'm', eventName: '網站賽-1', round: 2, p1name: 'A', p2name: 'B', winnerName: 'A', at: new Date(2026, 9, 13, 21, 5).getTime() });
  const draw = L.myTournMatchLine({ matchId: 'm', eventName: '', round: null, p1name: 'A', p2name: 'B', winnerName: null, at: 0 });
  r.L2 = line === '10/13 21:05・網站賽-1・第 2 輪・🏆 A' && draw === '雙敗';
  r.L2n = JSON.stringify([line, draw]);
  return r;
}

// ═══ W：對戰頁接線 ═══════════════════════════════════════════════════════
function pageScenarios(pg) {
  const r = {};
  const lobby = pg.slice(pg.indexOf('  {#if mode === null}'), pg.indexOf("  {:else if mode === 'local'}"));
  r.W1 = (lobby.match(/<button class="mode-card/g) || []).length === 2 && !/mode-title">復盤</.test(lobby) && /<section class="replay-lobby">/.test(lobby)
    && /\{#each myTournMatches\.matches as tm \(tm\.matchId\)\}/.test(lobby) && /onclick=\{\(\) => playMyTournReplay\(tm\.matchId\)\}/.test(lobby);
  r.W1n = JSON.stringify({ cards: (lobby.match(/<button class="mode-card/g) || []).length });
  // W2：從清單打開錦標賽回放 ⇒ 標記從清單來；載入失敗 ⇒ 標記清掉、錯誤顯示在清單；離開時走回清單那條路
  const fn = pg.match(/async function playMyTournReplay\(matchId: string\) \{[\s\S]*?\n  \}/);
  let ran = null;
  if (fn) {
    try {
      const body = fn[0].replace('async function playMyTournReplay(matchId: string)', 'return async function (matchId)');
      const st = { replayLobbyMsg: 'x', tError: '', replayFromCasualLobby: false, isTReplay: false, called: null };
      const mk = (okLoad) => new Function('S', 'with (S) { ' + body + ' }')(new Proxy(st, { has: () => true, get: (t, k) => (k === 'tStartReplay' ? async (id) => { t.called = id; if (okLoad) t.isTReplay = true; else t.tError = '回放載入失敗（404）'; } : t[k]), set: (t, k, v) => { t[k] = v; return true; } }));
      ran = {};
      return (async () => {
        await mk(false)('M1'); ran.fail = { ...st };
        Object.assign(st, { replayLobbyMsg: '', tError: '', isTReplay: false, replayFromCasualLobby: false });
        await mk(true)('M2'); ran.ok = { ...st };
        r.W2 = ran.fail.called === 'M1' && ran.fail.replayFromCasualLobby === false && /404/.test(ran.fail.replayLobbyMsg) && ran.fail.tError === ''
          && ran.ok.called === 'M2' && ran.ok.replayFromCasualLobby === true
          && /if \(replayKind === 'casual' \|\| replayFromCasualLobby \|\| !isTournament\) \{\s*replayFromCasualLobby = false;/.test(pg);   // 一般對戰頁（含 ?treplay= 分享連結）一律回開始對戰頁（Opus P3-6）
        r.W2n = JSON.stringify(ran);
        // W4（Opus 審查 P3-3／P3-4）：loadMyTournMatches 實跑 —— 登入時帶 Authorization；匿名不打 API；晚到的舊回應不蓋新的；憑證拿不到不顯示「請登入」
        const lf = pg.match(/  async function loadMyTournMatches\(\) \{[\s\S]*?\n  \}/);
        if (lf) {
          const st2 = { _myTournAt: 0, _myTournSeq: 0, myTournMatches: null, firebaseUser: null, MY_TOURN_MATCHES_URL: '/api/my-tourn-matches', parseMyTournMatches: (j) => j, fetchCalls: [] };
          const resolvers = [];
          st2.fetch = (u, o) => { st2.fetchCalls.push(o && o.headers); if (o && o.headers && o.headers.Authorization === 'Bearer ANON') return Promise.resolve({ ok: false, json: async () => ({}) }); return new Promise((res) => resolvers.push(res)); };   // 匿名誤打的那一發立刻回（不佔 resolvers 順序、只由次數判紅）
          const body2 = lf[0].replace('async function loadMyTournMatches()', 'return async function ()').replace(/const tok: any = /, 'const tok = ').replace(/Promise\.race<any>/, 'Promise.race').replace(/const headers: Record<string, string> = \{\};/, 'const headers = {};');
          const fn2 = new Function('S', 'with (S) { ' + body2 + ' }')(new Proxy(st2, { has: () => true, get: (t, k) => (k in t ? t[k] : globalThis[k]), set: (t, k, v) => { t[k] = v; return true; } }));
          await fn2();
          // ⭐Opus 複審 P3-b：Firebase 匿名使用者（物件存在、isAnonymous:true）也不可以打 API
          st2._myTournAt = 0; st2.firebaseUser = { isAnonymous: true, getIdToken: async () => 'ANON' };
          await Promise.race([fn2(), new Promise((rr) => setTimeout(rr, 50))]);   // 若誤打 API，假 fetch 永不回應 ⇒ 用逾時收尾、交給 calls 次數判紅（不卡死）
          st2.firebaseUser = null;
          const anon = { calls: st2.fetchCalls.length, mt: st2.myTournMatches };
          st2._myTournAt = 0; st2.firebaseUser = { isAnonymous: false, getIdToken: async () => 'TOK1' };
          const p1 = fn2();
          await new Promise((rr) => setTimeout(rr, 10));
          st2._myTournAt = 0; st2.firebaseUser = { isAnonymous: false, getIdToken: async () => 'TOK2' };
          const p2 = fn2();
          await new Promise((rr) => setTimeout(rr, 10));
          resolvers[1]({ ok: true, json: async () => ({ who: 'new' }) }); await p2;
          resolvers[0]({ ok: true, json: async () => ({ who: 'old' }) }); await p1;
          const after = st2.myTournMatches;
          st2._myTournAt = 0; st2.firebaseUser = { isAnonymous: false, getIdToken: () => new Promise(() => {}) };
          const t0 = Date.now(); const realST = globalThis.setTimeout;
          globalThis.setTimeout = (f2) => realST(f2, 0);
          try { await fn2(); } finally { globalThis.setTimeout = realST; }
          r.W4 = anon.calls === 0 && anon.mt && anon.mt.needLogin === true && st2.fetchCalls[0].Authorization === 'Bearer TOK1' && st2.fetchCalls[1].Authorization === 'Bearer TOK2'
            && after && after.who === 'new' && st2.myTournMatches.who === 'new' && st2._myTournAt === 0;
          r.W4n = JSON.stringify({ anon, heads: st2.fetchCalls, after, at: st2._myTournAt, ms: Date.now() - t0 });
        }
        // W5：回放載入中鎖住（連點只打一次；兩張卡與觀看鈕 disabled）
        r.W5 = /async function playMyTournReplay\(matchId: string\) \{\s*if \(replayLoading\) return;/.test(pg) && /try \{ await tStartReplay\(matchId\); \} finally \{ replayLoading = false; \}/.test(pg)
          && (pg.match(/disabled=\{!poolReady \|\| replayLoading\}/g) || []).length === 2 && /onclick=\{\(\) => playMyTournReplay\(tm\.matchId\)\} disabled=\{replayLoading\}/.test(pg);
        // W3：回到開始對戰畫面就刷新清單（含錦標賽那一區，登入狀態改變也重抓）；錦標賽頁不跑
        r.W3 = /\$effect\(\(\) => \{\s*\/\/[^\n]*\n\s*if \(mode !== null \|\| isTournament\) return;\s*const _u = firebaseUser\?\.uid \?\? '';\s*untrack\(\(\) => \{ replayLobbyOpen = true; void refreshReplayList\(\); _myTournAt = 0; void loadMyTournMatches\(\); \}\);/.test(pg)
          && /const res = await fetch\(MY_TOURN_MATCHES_URL, \{ headers \}\);/.test(pg);
        return r;
      })();
    } catch { return r; }
  }
  return r;
}

const LABEL = {
  S1: '★★★ S1 伺服器：只回自己最近 10 場已結束對戰（排除輪空／未結束／沒開打／別人），新→舊、賽事名稱（被刪的用歸檔名），不回 uid 與盤面',
  S2: '★★ S2 建 p1uid／p2uid＋開打時間兩個索引（避免全表掃描）', S3: '★★★ S3 未登入或只有 playerId（未驗證）⇒ needLogin、空清單（不能拿別人的 uid 查）',
  S4: '★★ S4 每位玩家 30 秒快取', S5: '★★★ S5 兩個玩家同時查 ⇒ 各自只拿到自己的（快取／在途合併不跨玩家）', S6: '★★★ S6 索引不在 ⇒ 不查、回空清單（不全表掃描）', L1: '★★ L1 parseMyTournMatches：要哨兵、過濾壞資料', L2: '★★ L2 清單說明：時間・賽事・輪次・勝方（沒勝方＝雙敗）',
  W1: '★★★ W1 開始對戰頁只有兩張卡（拿掉「復盤」）、清單直接顯示、有錦標賽對戰區與觀看按鈕', W2: '★★★ W2 從清單打開錦標賽回放：成功記住來源、失敗把錯誤顯示在清單；離開走回清單',
  W3: '★★ W3 回到開始對戰就刷新兩份清單（登入狀態改變也重抓）；錦標賽頁不跑',
  W4: '★★★ W4 loadMyTournMatches 實跑：登入帶 Authorization、匿名不打 API、晚到的舊回應不蓋新的、憑證拿不到不顯示請登入', W5: '★★ W5 回放載入中鎖住（只打一次，兩張卡與觀看鈕停用）',
};

const P = normEol(readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8'));
const PAGE = normEol(readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8'));
const g = async (fn) => { try { const x = await fn(); return x && typeof x === 'object' ? x : {}; } catch { return {}; } };
async function all(P0, PG0, L0) { return { ...(await g(() => serverScenarios(P0))), ...(await g(() => leafScenarios(L0))), ...(await g(() => pageScenarios(PG0))) }; }
const L = await loadLeaf(ROOT);
const R = await all(P, PAGE, L);
for (const k of Object.keys(LABEL)) ok(LABEL[k], R[k] === true, R[k + 'n']);

// ═══ E：真瀏覽器 ═════════════════════════════════════════════════════════
console.log('【E】真瀏覽器（build/）');
const BUILD = join(ROOT, 'build');
const chromium = existsSync(join(BUILD, '404.html')) ? pwChromium('v6.563 復盤清單') : null;
if (!existsSync(join(BUILD, '404.html'))) console.log('  ENV-SKIP E（沒有 build/）');
else if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.563 復盤清單');
  if (browser) {
    // 錦標賽回放的假資料：AI 對打一場，照 /api/tournament/replay 的形狀組（每半回合一格＋終局）
    const mod = await buildAiBundle(ROOT, {}), pool = loadLivePool(ROOT);
    const states = []; let last = null;
    playGame({ mod, pool, decks: [presetById(mod, '__preset_cynthia_garchomp__'), presetById(mod, '__preset_mbg__')], agents: [(st, i) => mod.aiNew(st, pool, i), (st, i) => mod.aiNew(st, pool, i)], seed: 7, firstPlayer: firstPlayerOf(7),
      onStep: (st, act, next) => { if (next && next !== last) { states.push(next); last = next; } } });
    const fin = states[states.length - 1];
    const snaps = []; let prev = null;
    for (const s of states) { if (s.phase === 'playing' && (!prev || prev.phase !== 'playing' || prev.activePlayerIndex !== s.activePlayerIndex)) snaps.push({ turn: s.turn, activePlayerIndex: s.activePlayerIndex, logLen: s.log.length, state: { ...s, log: [] } }); prev = s; }
    const replayData = { meta: { matchId: 'EV_r1_m0', eventId: 'EV', p1name: 'A', p2name: 'B', winnerName: 'A', round: 1 }, finalLog: fin.log, finalState: { ...fin, log: [] }, snapshots: snaps };
    const { createReadStream, statSync } = await import('node:fs');
    const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x'); let p = join(BUILD, decodeURIComponent(u.pathname));
      if (existsSync(p + '.html')) p += '.html'; else if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
      if (!existsSync(p)) p = join(BUILD, '404.html');
      res.writeHead(200, { 'content-type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' }); createReadStream(p).pipe(res);
    });
    await new Promise((rr) => srv.listen(0, rr));
    const port = srv.address().port;
    try {
      // ⚠ 測試環境沒有登入（Firebase 匿名或未登入）⇒ 前端不打 /api/my-tourn-matches、直接顯示登入提示（v6.563 審查 P3-3）。
      //   「已登入時清單長什麼樣、按 ▶ 觀看」的行為由 W1（模板）、W2（playMyTournReplay 實跑）、W4（loadMyTournMatches 實跑帶 Authorization）守；
      //   回放「離開回開始對戰頁」這條路，用一般對戰頁的分享連結（?treplay=）在真瀏覽器裡走同一個 tExitReplay 分支。
      const mkCtx = async () => {
        const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1400, height: 950 } });
        await ctx.route(/pokemon-card\.com|ptcg-tw-sim-img/, (rt) => rt.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="63" height="88"/>' }));
        const hits = { my: 0, replay: 0 };
        await ctx.route(/\/api\/my-tourn-matches/, (rt) => { hits.my++; rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ myTournApi: 1, matches: [] }) }); });
        await ctx.route(/\/api\/tournament\/replay\?/, (rt) => { hits.replay++; rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(replayData) }); });
        await ctx.route(/\/api\/replay\/tourn-steps/, (rt) => rt.fulfill({ status: 404, body: '' }));
        const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
        return { ctx, pg, errs, hits };
      };
      const lobbyInfo = (pg) => pg.evaluate(() => ({ cards: document.querySelectorAll('.mode-card').length, titles: [...document.querySelectorAll('.mode-title')].map((x) => x.textContent), text: document.querySelector('.replay-lobby')?.textContent || '', boxedHints: [...document.querySelectorAll('.replay-lobby .small')].filter((e) => e.tagName !== 'BUTTON' && e.tagName !== 'LABEL').length }));
      const A = await mkCtx();
      await A.pg.goto(`http://localhost:${port}/game`, { waitUntil: 'load' });
      await A.pg.waitForSelector('.mode-card:not([disabled])', { timeout: 60000 });
      await A.pg.waitForSelector('.replay-lobby', { timeout: 20000 }); await A.pg.waitForTimeout(1200);
      const la = await lobbyInfo(A.pg);
      ok('★★★[E1] 開始對戰頁只有「本機雙人」「線上連線」兩張卡，清單直接顯示（兩區標題），說明文字不是按鈕樣式（.small）', la.cards === 2 && la.titles.join() === '本機雙人對戰,線上連線對戰'
        && /最近的對戰復盤/.test(la.text) && /線上連線對戰/.test(la.text) && /我的錦標賽對戰/.test(la.text) && la.boxedHints === 0, JSON.stringify(la));
      ok('★★[E4] 未登入 ⇒ 錦標賽區顯示登入提示，而且沒有打 /api/my-tourn-matches', /登入後/.test(la.text) && A.hits.my === 0, JSON.stringify({ hits: A.hits }));
      // E2：一般對戰頁用分享連結打開錦標賽回放 ⇒ 離開 ⇒ 回到開始對戰頁（不是線上大廳／錦標賽大廳），網址的 treplay 清掉
      await A.pg.goto(`http://localhost:${port}/game?treplay=EV_r1_m0`, { waitUntil: 'load' });
      await A.pg.waitForSelector('.treplay-bar', { timeout: 60000 });
      const inReplay = await A.pg.evaluate(() => document.querySelector('.treplay-step')?.textContent || '');
      await A.pg.locator('.treplay-btn', { hasText: '離開' }).click(); await A.pg.waitForTimeout(800);
      const back = await A.pg.evaluate(() => ({ lobby: !!document.querySelector('.replay-lobby'), bar: !!document.querySelector('.treplay-bar'), cards: document.querySelectorAll('.mode-card').length, url: location.search, online: !!document.querySelector('.online-lobby, .room-list') }));
      ok('★★★[E2] 回放（打 /api/tournament/replay）⇒ 離開回到開始對戰頁的清單、網址不再帶 treplay', A.hits.replay === 1 && /（\d+\/\d+）/.test(inReplay) && back.lobby && !back.bar && back.cards === 2 && !/treplay/.test(back.url), JSON.stringify({ hits: A.hits, inReplay, back }));
      ok('★[E3] 沒有 JS 例外', A.errs.length === 0, A.errs.slice(0, 3).join(' ｜ '));
      await A.ctx.close();
    } finally { srv.close(); await browser.close(); }
  }
}

console.log('【H】HEAD-FAIL（BASE v6.562）');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('v6563 HEAD-FAIL', '需要歷史 commit');
else {
  const rd = (p) => { const x = readBaseBlob(ROOT, BASE_SHA, p); return x.ok ? normEol(x.out) : ''; };
  const B = await all(rd('oracle-admin/server_admin_patch.js'), rd('src/routes/game/+page.svelte'), null);
  for (const k of Object.keys(LABEL)) ok(`★★★[H] v6.562：${k} 紅`, B[k] !== true, String(B[k]));
}
console.log(`\n=== v6.563 復盤清單＋錦標賽對戰：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
