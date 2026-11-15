// v6.645 守衛：休閒線上對戰「⚡ 自動配對」前端（搭配 server v1.85）
//
// 【E】端到端（最重要）：把 +page.svelte 的 v6645-casual-automatch 腳本區塊抽出來（esbuild 去掉型別、runes 換成一般變數），
//   開兩個玩家 A、B，各自接上**真的**伺服器區塊（server_admin_patch.js 的 v185-casual-automatch，同一份佇列），用假時鐘推進：
//   E1 A、B 開始配對 ⇒ 雙方看到「找到對手」；E2 雙方接受 ⇒ 先排隊的 A 用既有 createRoom 開房（autoMatch 旗標、公開＝可觀戰、房名含雙方暱稱）
//   並回報房號；B 用既有 joinRoom 進同一間；E3 雙方進房後自動帶入配對用的牌組（handleSetDeck）並按準備（setSeatReady true）
//   E4 B 拒絕 ⇒ B 收掉配對、A 回到搜尋（附原因）；E5 取消配對 ⇒ 送 leave、停止輪詢；E6 匿名／沒選牌組 ⇒ 一發請求都不送
//   E7 房主開好房但對手 45 秒沒進房 ⇒ 自動離房並提示；E8 開始配對前先過版本閘（casualVerGate）
// 【A】match-api.ts 單元：輪詢間隔（搜尋 3 秒、找到後 1 秒、其餘不輪詢）、房名、沒有伺服器的 build 不顯示入口；
//   post()：匿名不發請求、沒有哨兵 ⇒「伺服器尚未支援」、帶 Bearer token
// 【R】房間模組：兩套（Oracle／Firestore）createRoom 都收 autoMatch 旗標；大廳列表把「等待中的自動配對房」藏起來、開打後照常列出
// 【U】畫面接線（剝註解後）：入口只在 cmAvailable 時出現、找到對手的接受視窗、手動開房／進房會先取消配對、onDestroy 收尾
// 【H】HEAD-FAIL：BASE（b3fa288d）上 E／A／R／U 逐條紅
import { build, transform } from 'esbuild';
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';
import { normEol } from './lib/eol-agnostic.mjs';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = 'b3fa288d';
const PAGE = 'src/routes/game/+page.svelte', SAP = 'oracle-admin/server_admin_patch.js';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + String(x).slice(0, 400) : '')); } };
const blockOf = (src, tag) => { const i = src.indexOf('// >>> ' + tag), j = src.indexOf('// <<< ' + tag); return i >= 0 && j > i ? src.slice(i, j) : ''; };
const tmpFiles = [];
process.on('exit', () => { for (const p of tmpFiles) { try { unlinkSync(p); } catch { /* noop */ } } });

// ── 假時鐘＋計時器（兩個玩家與伺服器共用）
function makeClock() {
  const c = { t: 1_800_000_000_000, q: [], seq: 0 };
  c.setTimeout = (fn, ms) => { const id = ++c.seq; c.q.push({ id, at: c.t + (ms || 0), fn }); return id; };
  c.clearTimeout = (id) => { c.q = c.q.filter((x) => x.id !== id); };
  c.advance = async (ms) => {
    const end = c.t + ms;
    for (;;) {
      c.q.sort((a, b) => a.at - b.at);
      const nx = c.q[0];
      if (!nx || nx.at > end) break;
      c.q.shift(); c.t = nx.at;
      await nx.fn();
      for (let k = 0; k < 20; k++) await Promise.resolve();
    }
    c.t = end;
    for (let k = 0; k < 20; k++) await Promise.resolve();
  };
  return c;
}

// ── 真的伺服器區塊
function makeServer(sapSrc, clock) {
  const blk = blockOf(sapSrc, 'v185-casual-automatch');
  const routes = {};
  const app = { post: (p, f) => { routes[p] = f; }, get: () => {} };
  const ids = { tA: { uid: 'fA', email: 'a@x.com', verified: true }, tB: { uid: 'fB', email: 'b@x.com', verified: true } };
  const db = { collection: () => ({ find: () => ({ limit: () => ({ toArray: async () => [] }) }) }) };
  let err = null;
  try { new Function('app', 'tournIdentity', 'tournDeckIssue', 'db', 'FR_COLL', 'Date', blk)(app, async (r) => ids[r.headers.authorization] || { error: 'x', code: 401 }, () => null, db, 'friendships', { now: () => clock.t }); } catch (e) { err = e.message; }
  const calls = [];
  async function call(path, token, body) {
    calls.push({ path, token });
    const f = routes['/api/casual-match/' + path];
    if (!f) return { ok: false, message: '伺服器尚未支援自動配對', code: 'unsupported', status: 404 };
    let status = 200, out = null;
    const res = { status: (c) => { status = c; return res; }, json: (o) => { out = o; return res; } };
    await f({ headers: { authorization: token }, body: body || {} }, res);
    if (!out || out.casualMatchApi !== 1) return { ok: false, message: '伺服器尚未支援自動配對', code: 'unsupported', status };
    if (status >= 400) return { ok: false, message: out.error, code: out.code, status };
    return { ok: true, view: out };
  }
  return { call, calls, ok: !!blk && !err, err };
}

// ── 把頁面腳本區塊變成可執行的「一個玩家」
async function pageBlockJs(pageSrc) {
  const blk = blockOf(pageSrc, 'v6645-casual-automatch');
  if (!blk) return null;
  let code = blk
    .replace(/\$state<[^>]*?>\(/g, '(').replace(/\$state\(/g, '(')
    .replace(/const cmActive = \$derived\(([\s\S]*?)\);\n/, 'const __cmActive = () => ($1);\n')
    .replace(/onDestroy\(\(\) => cmStop\(true\)\);/, '__onDestroy(() => cmStop(true));');
  code = code.replace(/\bcmActive\b/g, '__cmActive()');
  const r = await transform(code, { loader: 'ts' });
  return r.code;
}
async function makePlayer(js, server, clock, me, shared) {
  const st = { calls: [], seat: null, ready: false, deckSet: null, rooms: shared.rooms, onlineError: '', onlineStep: 'join', roomCode: '', amIHost: false, destroy: null, left: [] };
  const DECKS = [{ id: 'd1', name: '我的牌組', entries: [{ cardId: '1', count: 60 }], coinPref: 'first' }, { id: 'bad', name: '59張', entries: [{ cardId: '1', count: 59 }] }];
  const env = {
    casualMatchAvailable: () => true,
    casualMatchPollMs: shared.pollMs,
    casualMatchJoin: (en, dn, name) => server.call('join', me.token, { deckEntries: en, deckName: dn, name }),
    casualMatchPoll: () => server.call('poll', me.token),
    casualMatchAccept: (mid, a) => server.call('accept', me.token, { matchId: mid, accept: a }),
    casualMatchReportRoom: (mid, code) => server.call('room', me.token, { matchId: mid, roomCode: code }),
    casualMatchLeave: (o) => server.call('leave', me.token),
    casualMatchRoomName: shared.roomName,
    countDeckCards: (en) => en.reduce((s, e) => s + e.count, 0),
    normalizeDeckCoinPref: (x) => x,
    casualVerGate: async (k, act) => { st.calls.push('gate:' + k); return false; },
    createRoom: async (name, host, undo, visible, extra) => { const code = 'R' + (++shared.seq) + 'XY'; shared.rooms[code] = { name, host, undo, visible, extra, seats: [{ uid: me.token }, { uid: null }], status: 'lobby' }; st.calls.push('createRoom'); return code; },
    joinRoom: async (code, name) => { const r = shared.rooms[code]; if (!r) throw new Error('找不到房間'); r.seats[1] = { uid: me.token }; st.calls.push('joinRoom:' + code); return r; },
    leaveRoom: async (code) => { st.left.push(code); },
    releaseOldLobbyRooms: () => {},
    startRoomSubscription: () => { st.calls.push('subscribe'); },
    setIdleTimeout: async () => {},
    _readLastIdle: () => 60,
    setSeatFirstChoice: async (code, cp) => { st.calls.push('first:' + cp); },
    setSeatReady: async (code, v) => { st.ready = v; st.calls.push('ready:' + code); },
    leaveOnlineGame: async () => { st.calls.push('leaveOnlineGame'); st.onlineStep = 'join'; },
    __onDestroy: (f) => { st.destroy = f; },
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    document: { title: 'PTCG' },
  };
  const names = Object.keys(env);
  const body = `
    let isAnonymous = __anon, myName = __name, myDeckId = '', myOldRooms = [];
    const allDecks = __decks;
    const __st = __S;
    let roomData = null;
    Object.defineProperty(__st, 'roomCodeLive', { get: () => roomCode });
    let roomCode = '', onlineError = '', amIHost = false, onlineStep = 'join';
    async function handleSetDeck() { __st.deckSet = myDeckId; return true; }
    ${js}
    return {
      api: { cmStart, cmStop, cmAnswer, setDeck: (id) => { cmDeckId = id; }, setAnon: (v) => { isAnonymous = v; }, setRoomData: (r) => { roomData = r; } },
      peek: () => ({ view: cmView, err: cmError, notice: cmNotice, roomCode, amIHost, onlineStep, onlineError, active: __cmActive() }),
    };`;
  let inst;
  try { inst = new Function(...names, '__anon', '__name', '__decks', '__S', body)(...names.map((k) => env[k]), !!me.anon, me.name, DECKS, st); }
  catch (e) { return { err: e.message, st }; }
  return { ...inst, st, env };
}

async function loadMatchApi(srcRoot, tag) {
  const F = join(srcRoot, `.v6645-${tag}-fb.ts`), E = join(srcRoot, `.v6645-${tag}-e.ts`), O = join(ROOT, `.v6645-${tag}-o.mjs`);
  tmpFiles.push(F, E, O);
  writeFileSync(F, `export const auth = { get currentUser() { return (globalThis).__fakeUser; } };`);
  writeFileSync(E, "export * from './src/lib/casual-match/match-api';\n");
  try {
    await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', logLevel: 'silent',
      alias: { '$lib/firebase': F, '$lib': join(srcRoot, 'src/lib') }, define: { 'import.meta.env.VITE_ORACLE_API_URL': '"https://api.example"' } });
    return await import(pathToFileURL(O).href + '?t=' + tag + Date.now());
  } catch { return null; }
}

async function checkE(pageSrc, sapSrc, tag) {
  const js = await pageBlockJs(pageSrc).catch((e) => null);
  ok(`前提${tag} 抽得到頁面的自動配對腳本區塊並能轉成可執行的 JS`, !!js && js.length > 2000, js ? js.length : 'null');
  const pollMs = (s) => (s === 'found' || s === 'host' || s === 'wait-host') ? 1000 : s === 'searching' ? 3000 : 0;
  const roomName = (a, b) => `⚡ 自動配對：${a} vs ${b}`;
  const run = async (fn) => { try { return await fn(); } catch (e) { return 'ERR:' + e.message; } };
  async function scenario() {
    const clock = makeClock();
    const server = makeServer(sapSrc, clock);
    const shared = { rooms: {}, seq: 0, pollMs, roomName };
    const A = await makePlayer(js || '', server, clock, { token: 'tA', name: '小明' }, shared);
    const B = await makePlayer(js || '', server, clock, { token: 'tB', name: '小華' }, shared);
    return { clock, server, shared, A, B };
  }
  if (!js) { for (const k of ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8']) ok(`${k}${tag} （腳本區塊不存在）`, false); return; }
  // E1～E3
  {
    const { clock, server, shared, A, B } = await scenario();
    if (A.err || B.err) { ok(`E1${tag} 建立玩家`, false, A.err || B.err); return; }
    A.api.setDeck('d1'); B.api.setDeck('d1');
    await A.api.cmStart(); await clock.advance(1000); await B.api.cmStart();
    await clock.advance(3100);   // A 搜尋中每 3 秒查一次 ⇒ 最晚 3 秒內看到「找到對手」
    const a1 = A.peek(), b1 = B.peek();
    ok(`★★★ E1${tag} A、B 開始配對 ⇒ 雙方看到「找到對手」與對方暱稱`, a1.view?.state === 'found' && b1.view?.state === 'found' && a1.view.opponentNick === '小華' && b1.view.opponentNick === '小明', JSON.stringify([a1.view, b1.view]));
    await A.api.cmAnswer(true); await B.api.cmAnswer(true);
    await clock.advance(5000);
    const codes = Object.keys(shared.rooms);
    const room = shared.rooms[codes[0]];
    const a2 = A.peek(), b2 = B.peek();
    ok(`★★★ E2${tag} 雙方接受 ⇒ 先排隊的 A 開房（autoMatch、公開可觀戰、非練習房、房名含雙方暱稱）、B 進同一間`,
      codes.length === 1 && room.extra?.autoMatch === true && room.visible === true && room.undo === false && /小明/.test(room.name) && /小華/.test(room.name)
        && a2.roomCode === codes[0] && a2.amIHost === true && a2.onlineStep === 'room' && b2.roomCode === codes[0] && b2.amIHost === false && b2.onlineStep === 'room'
        && B.st.calls.includes('joinRoom:' + codes[0]) && !A.st.calls.some((c) => c.startsWith('joinRoom')) && !B.st.calls.includes('createRoom'),
      JSON.stringify({ codes, room, a2, b2, A: A.st.calls, B: B.st.calls }));
    ok(`★★★ E3${tag} 進房後雙方自動帶入配對用的牌組（含先後攻偏好）並按準備`, A.st.deckSet === 'd1' && B.st.deckSet === 'd1' && A.st.ready === true && B.st.ready === true && A.st.calls.includes('first:first'),
      JSON.stringify([A.st, B.st].map((s) => ({ deck: s.deckSet, ready: s.ready, calls: s.calls }))));
    const nPoll = server.calls.filter((c) => c.path === 'poll').length;
    await clock.advance(30000);
    ok(`★★ E3b${tag} 進房之後雙方都不再輪詢配對伺服器（零負擔）`, server.calls.filter((c) => c.path === 'poll').length === nPoll, `${nPoll} → ${server.calls.filter((c) => c.path === 'poll').length}`);
  }
  // E4 拒絕
  {
    const { clock, A, B, server: E4server } = await scenario();
    A.api.setDeck('d1'); B.api.setDeck('d1');
    await A.api.cmStart(); await B.api.cmStart(); await clock.advance(3100);
    // E1b 找到對手之後每秒查一次（接受視窗的倒數與對方接受要即時）；搜尋中則是 3 秒一次
    {
      const cnt = () => E4server.calls.filter((c) => c.path === 'poll' && c.token === 'tA').length;
      const n0 = cnt(); await clock.advance(4000); const nFound = cnt() - n0;
      ok(`★★ E1b${tag} 找到對手後每秒查一次（4 秒內 ≥ 3 次）`, A.peek().view?.state === 'found' && nFound >= 3, nFound);
    }
    await B.api.cmAnswer(false);
    await clock.advance(3100);
    const a = A.peek(), b = B.peek();
    ok(`★★★ E4${tag} B 拒絕 ⇒ B 收掉配對（附提示）、A 回到搜尋並看到原因`, b.view === null && /拒絕/.test(b.notice) && a.view?.state === 'searching' && /沒有接受/.test(a.notice), JSON.stringify([a, b]));
  }
  // E5 取消
  {
    const { clock, server, A } = await scenario();
    A.api.setDeck('d1');
    await A.api.cmStart(); await clock.advance(3100);
    A.api.cmStop();
    await clock.advance(10);
    const n = server.calls.filter((c) => c.path === 'poll').length;
    await clock.advance(20000);
    ok(`★★★ E5${tag} 取消配對 ⇒ 送 leave、之後不再輪詢`, server.calls.some((c) => c.path === 'leave') && server.calls.filter((c) => c.path === 'poll').length === n && A.peek().view === null, JSON.stringify(server.calls.slice(-4)));
    // 離開頁面（onDestroy）也一樣
    const s2 = await scenario();
    s2.A.api.setDeck('d1'); await s2.A.api.cmStart(); await s2.clock.advance(100);
    s2.A.st.destroy && s2.A.st.destroy();
    await s2.clock.advance(10);
    ok(`★★ E5b${tag} 離開頁面（onDestroy）⇒ 送 leave`, typeof s2.A.st.destroy === 'function' && s2.server.calls.some((c) => c.path === 'leave'), JSON.stringify(s2.server.calls));
  }
  // E6 匿名／沒選牌組／張數
  {
    const { clock, server, A } = await scenario();
    A.api.setAnon(true); A.api.setDeck('d1');
    await A.api.cmStart();
    const e1 = A.peek().err;
    A.api.setAnon(false); A.api.setDeck('');
    await A.api.cmStart();
    const e2 = A.peek().err;
    A.api.setDeck('bad');
    await A.api.cmStart();
    const e3 = A.peek().err;
    ok(`★★ E6${tag} 匿名／沒選牌組／不是 60 張 ⇒ 顯示原因、一發請求都不送`, /登入/.test(e1) && /選擇牌組/.test(e2) && /60/.test(e3) && server.calls.length === 0, JSON.stringify({ e1, e2, e3, n: server.calls.length }));
  }
  // E7 對手沒進房
  {
    const { clock, shared, A, B } = await scenario();
    A.api.setDeck('d1'); B.api.setDeck('d1');
    await A.api.cmStart(); await B.api.cmStart(); await clock.advance(3100);
    // B 接受之後就關掉頁面（不再輪詢、不會進房）
    await A.api.cmAnswer(true); await B.api.cmAnswer(true);
    B.env.casualMatchPoll = async () => ({ ok: false, message: 'gone', code: 'x', status: 0 });
    await clock.advance(3000);
    const code = Object.keys(shared.rooms)[0];
    A.api.setRoomData({ status: 'lobby', seats: [{ uid: 'tA' }, { uid: null }] });
    await clock.advance(46000);
    const a = A.peek();
    ok(`★★ E7${tag} 房主開好房、對手 45 秒沒進房 ⇒ 自動離房並提示可以重新配對`, !!code && A.st.calls.includes('leaveOnlineGame') && /沒有進房/.test(a.onlineError), JSON.stringify({ code, calls: A.st.calls, a }));
  }
  // E8 版本閘
  {
    const { clock, A } = await scenario();
    A.api.setDeck('d1'); await A.api.cmStart();
    ok(`★ E8${tag} 開始配對前先過版本閘（casualVerGate 'automatch'）`, A.st.calls.includes('gate:automatch'), JSON.stringify(A.st.calls));
  }
}

async function checkA(srcRoot, key, tag) {
  let sent = [];
  globalThis.fetch = async (u, init) => { sent.push({ u, init }); return { ok: true, status: 200, json: async () => ({ casualMatchApi: 1, state: 'searching', waitingCount: 1 }) }; };
  globalThis.__fakeUser = { isAnonymous: false, getIdToken: async () => 'TOKEN123' };
  const M = await loadMatchApi(srcRoot, key);
  const f = (n) => (M && typeof M[n] === 'function' ? M[n] : null);
  const pm = f('casualMatchPollMs');
  ok(`★★ A1${tag} 輪詢間隔：搜尋中 3 秒、找到對手／等開房 1 秒、其餘（idle／hosting／join）不輪詢`, !!pm && pm('searching') === 3000 && pm('found') === 1000 && pm('host') === 1000 && pm('wait-host') === 1000 && pm('idle') === 0 && pm('hosting') === 0 && pm('join') === 0);
  ok(`★ A2${tag} 房名：「⚡ 自動配對：A vs B」、暱稱各截 12 字`, f('casualMatchRoomName')?.('小明', '小華') === '⚡ 自動配對：小明 vs 小華' && f('casualMatchRoomName')?.('x'.repeat(30), 'y').includes('x'.repeat(12) + ' vs'));
  ok(`★ A3${tag} 有伺服器的 build ⇒ casualMatchAvailable() true`, f('casualMatchAvailable')?.() === true);
  let r = M ? await M.casualMatchPoll() : null;
  ok(`★★ A4${tag} 帶 Bearer token、打 /api/casual-match/poll、回 ok`, r?.ok === true && sent[0]?.u === 'https://api.example/api/casual-match/poll' && sent[0]?.init?.headers?.Authorization === 'Bearer TOKEN123', JSON.stringify({ r, sent: sent[0] }));
  sent = []; globalThis.__fakeUser = { isAnonymous: true, getIdToken: async () => 'T' };
  r = M ? await M.casualMatchJoin([{ cardId: '1', count: 60 }], 'x', 'n') : null;
  ok(`★★★ A5${tag} 匿名玩家 ⇒ 一發請求都不送、回登入錯誤`, r && r.ok === false && r.code === 'casual-match-auth' && sent.length === 0, JSON.stringify(r));
  globalThis.__fakeUser = { isAnonymous: false, getIdToken: async () => 'T' };
  globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({ error: 'Not Found' }) });
  r = M ? await M.casualMatchPoll() : null;
  ok(`★★ A6${tag} 回應沒有 casualMatchApi 哨兵（伺服器還沒更新）⇒「伺服器尚未支援自動配對」`, r && r.ok === false && r.code === 'unsupported' && /尚未支援/.test(r.message), JSON.stringify(r));
}

function checkR(oracleSrc, fsSrc, tag) {
  const o = stripCommentsBlankChecked(normEol(oracleSrc), 'ts'), f = stripCommentsBlankChecked(normEol(fsSrc), 'ts');
  const sig = /visible: boolean = true,[^\n]*\n\s*extra\?: \{ autoMatch\?: true \},[^\n]*\n\): Promise<string> \{/;   // ⚠ 剝除器只剝整行註解，行尾註解保留
  const spread = /\.\.\.\(extra\?\.autoMatch === true \? \{ autoMatch: true \} : \{\}\),/;
  ok(`★★ R1${tag} 兩套 createRoom（Oracle／Firestore）都收 autoMatch 旗標並寫進房間`, sig.test(o) && sig.test(f) && spread.test(o) && spread.test(f));
  ok(`★★ R2${tag} 兩套大廳列表都把「等待中的自動配對房」藏起來（開打後照常列出可觀戰）`,
    /if \(r\.status === 'lobby' && \(r as \{ autoMatch\?: boolean \}\)\.autoMatch === true\) return false;/.test(o) && /if \(data\.status === 'lobby' && \(data as \{ autoMatch\?: boolean \}\)\.autoMatch === true\) return;/.test(f));
}
async function checkR2(srcRoot, key, tag) {
  // 行為端：filterAndSortOpenRooms
  const E = join(srcRoot, `.v6645-${key}-r.ts`), O = join(ROOT, `.v6645-${key}-r.mjs`), S = join(srcRoot, `.v6645-${key}-s.js`);
  tmpFiles.push(E, O, S);
  writeFileSync(S, 'export const base="";export const assets="";');
  writeFileSync(E, "export { filterAndSortOpenRooms } from './src/lib/game/room-oracle';\n");
  let M = null;
  try {
    await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', logLevel: 'silent', alias: { '$lib': join(srcRoot, 'src/lib'), '$app/paths': S, '$app/environment': S },
      external: ['firebase', 'firebase/*'] });
    M = await import(pathToFileURL(O).href + '?' + key + Date.now());
  } catch (e) { M = null; }
  const now = Date.now();
  const mk = (id, status, extra = {}) => ({ _id: id, schemaVersion: 99, status, createdAt: now, seats: [{ uid: 'a', lastSeenAt: now }, { uid: 'b' }], ...extra });
  let out = null;
  try { out = M ? M.filterAndSortOpenRooms([mk('L1', 'lobby', { autoMatch: true }), mk('P1', 'playing', { autoMatch: true }), mk('L2', 'lobby')]).map((r) => r.roomId) : null; } catch (e) { out = 'ERR ' + e.message; }
  ok(`★★★ R3${tag} 行為：等待中的自動配對房不列出；開打後（playing）照常列出供觀戰；一般房不受影響`, Array.isArray(out) && !out.includes('L1') && out.includes('P1') && out.includes('L2'), JSON.stringify(out));
}

function checkU(pageRaw, tag) {
  const page = stripCommentsBlankChecked(normEol(pageRaw), 'svelte');
  ok(`★★ U1${tag} 入口只在 cmAvailable（有連線對戰伺服器）時出現，且標明標準賽與限登入`, /\{#if cmAvailable\}\s*<div class="cm-block"/.test(page) && /自動配對（標準賽）/.test(page) && /限登入玩家|限定登入/.test(page) && /const cmAvailable = casualMatchAvailable\(\);/.test(page));
  ok(`★★ U2${tag} 找到對手 ⇒ 接受／拒絕視窗（顯示對手暱稱與剩餘秒數；已接受就顯示等待）`, /\{#if cmView\?\.state === 'found'\}\s*<div class="cm-found-backdrop"/.test(page) && /onclick=\{\(\) => cmAnswer\(true\)\}/.test(page) && /onclick=\{\(\) => cmAnswer\(false\)\}/.test(page) && /\{cmView\.opponentNick\}/.test(page));
  const cr = page.slice(page.indexOf('async function handleCreateRoomCommit()'), page.indexOf('async function handleCreateRoomCommit()') + 600);
  const jr = page.slice(page.indexOf('async function handleJoinRoomCommit()'), page.indexOf('async function handleJoinRoomCommit()') + 600);
  ok(`★★ U3${tag} 手動開房／進房會先取消自動配對`, /cmActive\) cmStop\(\);/.test(cr) && /cmActive\) cmStop\(\);/.test(jr));
  ok(`★ U4${tag} 離開頁面 onDestroy 收尾（不帶大括號的箭頭函式，不影響以大括號 onDestroy 當錨點的舊守衛）`, /onDestroy\(\(\) => cmStop\(true\)\);/.test(page));
}

// ═══ 現行版
const pageSrc = readFileSync(join(ROOT, PAGE), 'utf8'), sapSrc = readFileSync(join(ROOT, SAP), 'utf8').replace(/\r\n/g, '\n');
console.log('【E】端到端（兩位玩家＋真的伺服器區塊）'); await checkE(normEol(pageSrc), sapSrc, '');
console.log('【A】match-api.ts'); await checkA(ROOT, 'head', '');
console.log('【R】房間模組'); checkR(readFileSync(join(ROOT, 'src/lib/game/room-oracle.ts'), 'utf8'), readFileSync(join(ROOT, 'src/lib/game/room.ts'), 'utf8'), ''); await checkR2(ROOT, 'head', '');
console.log('【U】畫面接線'); checkU(pageSrc, '');

console.log('【H】HEAD-FAIL');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('H（缺 BASE ' + BASE_SHA + '）');
else {
  const tmp = mkdtempSync(join(tmpdir(), 'v6645-'));
  try {
    execSync(`git -C "${ROOT}" archive ${BASE_SHA} src | tar -x -C "${tmp}"`, { stdio: 'ignore', shell: '/bin/bash' });
    const bp = readFileSync(join(tmp, PAGE), 'utf8'), bs = readBaseBlob(ROOT, BASE_SHA, SAP);
    const before = pass, fb = fail; const log = console.log; const lines = []; console.log = (s) => lines.push(String(s));
    await checkE(normEol(bp), bs.ok ? bs.out.replace(/\r\n/g, '\n') : '', '@BASE');
    await checkA(tmp, 'base', '@BASE');
    checkR(readFileSync(join(tmp, 'src/lib/game/room-oracle.ts'), 'utf8'), readFileSync(join(tmp, 'src/lib/game/room.ts'), 'utf8'), '@BASE'); await checkR2(tmp, 'base', '@BASE');
    checkU(bp, '@BASE');
    console.log = log;
    const reds = lines.filter((l) => /FAIL/.test(l)).map((l) => l.trim().slice(5, 30));
    pass = before; fail = fb;
    console.log('    BASE 紅：' + reds.length + ' 條');
    ok('★★★ H1 BASE 上 E1～E8（含 E1b）、A1～A6（模組不存在）、R1～R3、U1～U4 逐條紅', ['E1@', 'E2@', 'E3@', 'E4@', 'E5@', 'E6@', 'E7@', 'E8@', 'A1@', 'A4@', 'A5@', 'A6@', 'R1@', 'R2@', 'R3@', 'U1@', 'U2@', 'U3@', 'U4@'].every((k) => reds.some((r) => r.includes(k))), reds.join(','));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
console.log(`=== v6.645 休閒自動配對（前端）：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
