// 休閒「⚡ 自動配對」守衛共用的 harness（v6.645 起；v6.646 抽出成共用 lib，test-v6645／test-v6646 都用這一份，Rule 38）
//   makeClock：假時鐘＋計時器；makeServer：接上 server_admin_patch.js 真的 v185-casual-automatch 區塊；
//   pageBlockJs：把 +page.svelte 的 v6645-casual-automatch 腳本區塊轉成可執行 JS（esbuild 去型別、runes 換成一般變數）；
//   makePlayer：一位玩家（假的房間模組與座位操作，記錄呼叫）。
import { transform } from 'esbuild';
export const blockOf = (src, tag) => { const i = src.indexOf('// >>> ' + tag), j = src.indexOf('// <<< ' + tag); return i >= 0 && j > i ? src.slice(i, j) : ''; };

// ── 假時鐘＋計時器（兩個玩家與伺服器共用）
export function makeClock() {
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
export function makeServer(sapSrc, clock) {
  const blk = blockOf(sapSrc, 'v185-casual-automatch');
  const routes = {};
  const app = { post: (p, f) => { routes[p] = f; }, get: () => {} };
  const ids = { tA: { uid: 'fA', email: 'a@x.com', verified: true }, tB: { uid: 'fB', email: 'b@x.com', verified: true } };
  const dbRooms = {};
  const db = { collection: (name) => ({ find: () => ({ limit: () => ({ toArray: async () => [] }) }), findOne: async (q) => (name === 'rooms' ? dbRooms[q._id] ?? null : null) }) };
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
  return { call, calls, ok: !!blk && !err, err, dbRooms };
}

// ── 把頁面腳本區塊變成可執行的「一個玩家」
export async function pageBlockJs(pageSrc) {
  const blk = blockOf(pageSrc, 'v6645-casual-automatch');
  if (!blk) return null;
  let code = blk
    .replace(/\$state<[^>]*?>\(/g, '(').replace(/\$state\(/g, '(')
    .replace(/const cmActive = \$derived\(([\s\S]*?)\);\n/, 'const __cmActive = () => ($1);\n')
    .replace(/onDestroy\(\(\) => cmStop\(true\)\);/, '__onDestroy(() => cmStop(true));')
    .replace(/\$effect\(/g, '__effect(');
  code = code.replace(/\bcmActive\b/g, '__cmActive()');
  const r = await transform(code, { loader: 'ts' });
  return r.code;
}
export async function makePlayer(js, server, clock, me, shared) {
  const st = { effects: [], vis: null, calls: [], seat: null, ready: false, deckSet: null, rooms: shared.rooms, onlineError: '', onlineStep: 'join', roomCode: '', amIHost: false, destroy: null, left: [] };
  const DECKS = [{ id: 'd1', name: '我的牌組', entries: [{ cardId: '1', count: 60 }], coinPref: 'first' }, { id: 'bad', name: '59張', entries: [{ cardId: '1', count: 59 }] }, { id: 'd2', name: '沒設先後攻', entries: [{ cardId: '1', count: 60 }] }, { id: 'd3', name: '偏好後攻', entries: [{ cardId: '1', count: 60 }], coinPref: 'second' }];
  const env = {
    casualMatchAvailable: () => true,
    casualMatchPollMs: shared.pollMs,
    casualMatchJoin: (en, dn, name) => server.call('join', me.token, { deckEntries: en, deckName: dn, name }),
    casualMatchPoll: () => server.call('poll', me.token),
    casualMatchAccept: (mid, a) => server.call('accept', me.token, { matchId: mid, accept: a }),
    casualMatchReportRoom: async (mid, code) => { const r = await server.call('room', me.token, { matchId: mid, roomCode: code }); if (shared.onReport) await shared.onReport(me); return r; },
    casualMatchLeave: (o) => server.call('leave', me.token),
    casualMatchRoomName: shared.roomName,
    countDeckCards: (en) => en.reduce((s, e) => s + e.count, 0),
    normalizeDeckCoinPref: (x) => x,
    casualVerGate: async (k, act) => { st.calls.push('gate:' + k); return false; },
    createRoom: async (name, host, undo, visible, extra) => { const code = 'R' + (++shared.seq) + 'XY'; shared.rooms[code] = { name, host, undo, visible, extra, seats: [{ uid: me.token }, { uid: null }], status: 'lobby' }; server.dbRooms[code] = { status: 'lobby', seats: [{ email: me.email }] }; st.calls.push('createRoom'); if (shared.onCreate) await shared.onCreate(me); return code; },
    joinRoom: async (code, name) => { const r = shared.rooms[code]; if (!r) throw new Error('找不到房間'); const idx = r.seats[1].uid ? 2 : 1; r.seats[idx] = { uid: me.token }; st.calls.push('joinRoom:' + code); return r; },
    findMySeatIdx: (seats, uid) => seats.findIndex((x) => x && x.uid === uid),
    oracleAuth: async () => ({ uid: me.token }),
    __effect: (f) => { st.effects.push(f); },
    leaveRoom: async (code) => { st.left.push(code); },
    releaseOldLobbyRooms: () => {},
    startRoomSubscription: () => { st.calls.push('subscribe'); },
    setIdleTimeout: async () => {},
    _readLastIdle: () => 60,
    _readLastFirstPref: () => (shared.lastPref ?? 'random'),
    _saveFirstPref: (p) => { st.calls.push('save:' + p); },
    setSeatFirstChoice: async (code, cp) => { st.calls.push('first:' + cp); },
    setSeatReady: async (code, v) => { if (shared.readyFail) throw new Error('寫入失敗'); st.ready = v; st.calls.push('ready:' + code); },
    leaveOnlineGame: async () => { st.calls.push('leaveOnlineGame'); st.onlineStep = 'join'; },
    __onDestroy: (f) => { st.destroy = f; },
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    window: { addEventListener: (ev, f) => { if (ev === 'pagehide') st.pagehide = f; }, removeEventListener: () => {} },
    document: { title: 'PTCG', visibilityState: 'visible', addEventListener: (ev, f) => { st.vis = f; }, removeEventListener: () => {} },
  };
  const names = Object.keys(env);
  const body = `
    let isAnonymous = __anon, myName = __name, myDeckId = '', myOldRooms = [], myUid = null, mode = 'online';
    const allDecks = __decks;
    const __st = __S;
    let roomData = null, game = null;
    Object.defineProperty(__st, 'roomCodeLive', { get: () => roomCode });
    let roomCode = '', onlineError = '', amIHost = false, onlineStep = 'join';
    async function handleSetDeck() { __st.deckSet = myDeckId; return true; }
    ${js}
    return {
      api: { cmStart, cmStop, cmAnswer, setDeck: (id) => { if (typeof cmPickDeck === 'function') cmPickDeck(id); else cmDeckId = id; }, setGame: (g) => { game = g; }, setFirstPref: (v) => { cmFirstPref = v; }, setOnlineStep: (v) => { onlineStep = v; }, setAnon: (v) => { isAnonymous = v; }, setRoomData: (r) => { roomData = r; }, setMode: (m) => { mode = m; }, runEffects: () => { for (const f of __st.effects) f(); } },
      peek: () => ({ view: cmView, err: cmError, notice: cmNotice, roomCode, amIHost, onlineStep, onlineError, active: __cmActive(), overlay: typeof cmRoomOverlay === 'undefined' ? undefined : cmRoomOverlay, firstPref: typeof cmFirstPref === 'undefined' ? undefined : cmFirstPref }),
    };`;
  let inst;
  try { inst = new Function(...names, '__anon', '__name', '__decks', '__S', body)(...names.map((k) => env[k]), !!me.anon, me.name, DECKS, st); }
  catch (e) { return { err: e.message, st }; }
  return { ...inst, st, env };
}

