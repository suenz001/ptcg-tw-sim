#!/usr/bin/env node
/**
 * v6.583／server v1.70 守衛：牌組公布欄的投稿附加「這副牌的對戰紀錄」（站長 2026-10-17）
 *   站長裁定：①錦標賽回放＋一般對戰復盤一起做 ②一般對戰復盤裡對手名字一律改成「對手」 ③不限場次
 *   ④vs AI（與本機雙人）不開放 ⑤admin 要能個別移除。
 *
 *   V：伺服器區塊 v170-deck-post-replays 原文抽出、接假 Mongo 實跑六支端點（清單／候選／附加錦標賽／上傳復盤／檔案／移除）
 *      ⭐ 復盤用真引擎＋AI 打一整局、真的 replay-record 產生遮蔽版檔案；上傳後解壓逐字檢查「對手名字一個都不剩、自己的名字還在」
 *   P：前端純函式（src/lib/deck-posts/replays.ts）
 *   S：接線（不走 api()、換篇重置、回放頁 ?dpreplay=／?dpfrom=）＋區塊在 TAIL_ANCHOR 之前（28 把鎖不動）
 *   H：HEAD-FAIL（BASE v6.582：伺服器沒有區塊、前端沒有模組 ⇒ 逐條紅）
 *   E：真瀏覽器（build/，API 用假伺服器）：公布欄明細顯示對戰紀錄與觀看連結；?dpreplay= 打開回放、對手顯示「對手」、離開回到投稿
 *
 * Run: node scripts/test-v6583-deck-post-replays.mjs
 */
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import http from 'node:http';
import { build } from 'esbuild';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';
import { buildAiBundle, loadLivePool, presetById, playGame, firstPlayerOf } from './lib/ai-sim-harness.mjs';
import { normEol } from './lib/eol-agnostic.mjs';
import { stripCommentsBlank } from './lib/strip-comments.mjs';   // 註解裡提到的字不算（中央剝除器）

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠ BASE_SHA 必須留在 main 上（IRON_RULES Rule 45）：v6.582
const BASE_SHA = '5f47708578333f5c6cf65707865ecd92d87cfd2a';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + String(x).slice(0, 600) : '')); } };
const R = (p) => normEol(readFileSync(join(ROOT, p), 'utf8'));
const SAP_REL = 'oracle-admin/server_admin_patch.js';
const TAIL_ANCHOR = "app.get('/api/tournament";

// ── 假 Mongo（只做用到的）──
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
  const calls = { idx: [], find: [] };
  return {
    rows, calls,
    createIndexes: async (arr) => { for (const x of arr) calls.idx.push(JSON.stringify(x.key)); },
    find(q) {
      calls.find.push(q);
      let sel = rows.filter((d) => matchOne(d, q)).map(clone);
      const cur = { sort: (s) => { const [[k, dir]] = Object.entries(s); sel = sel.sort((a, b) => ((a[k] ?? 0) - (b[k] ?? 0)) * dir); return cur; }, limit: (n) => { sel = sel.slice(0, n); return cur; }, toArray: async () => sel };
      return cur;
    },
    async findOne(q) { const d = rows.find((x) => matchOne(x, q)); return d ? clone(d) : null; },
    async insertOne(doc) { if (rows.some((x) => x._id === doc._id)) throw new Error('dup _id'); rows.push(clone(doc)); return { insertedId: doc._id }; },
    async updateOne(q, u) {
      const d = rows.find((x) => matchOne(x, q)); if (!d) return { matchedCount: 0 };
      Object.assign(d, clone(u.$set || {})); for (const k of Object.keys(u.$unset || {})) delete d[k];
      return { matchedCount: 1 };
    },
  };
}
function sentinel(src, tag) {
  const a = src.indexOf('// >>> ' + tag), b = src.indexOf('// <<< ' + tag);
  if (a < 0 || b < a) return null;
  return src.slice(src.lastIndexOf('\n', a) + 1, src.indexOf('\n', b) + 1);
}
async function call(h, req) {
  let status = 200, body = null, sent = null; const hdr = {};
  const res = { status(c) { status = c; return res; }, json(b) { body = b; return res; }, set(k, v) { hdr[k] = v; return res; }, send(b) { sent = b; return res; } };
  await h(req, res);
  return { status, body, sent, hdr };
}

// ── 復盤檔：真引擎 AI 對打一整局，用真的 replay-record 產生「線上、遮蔽、記錄者坐 0」版本 ──
const mod = await buildAiBundle(ROOT, {});
const pool = loadLivePool(ROOT);
async function loadRR() {
  const tmp = mkdtempSync(join(tmpdir(), 'v6583-'));
  const E = join(tmp, 'e.ts'), S = join(tmp, 's.js'), O = join(tmp, 'o.mjs');
  writeFileSync(S, 'export const base="";export const browser=false;');
  writeFileSync(E, `export * as RR from '${join(ROOT, 'src/lib/game/replay-record').replace(/\\/g, '/')}';`);
  try {
    await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
      alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S, '$app/environment': S }, logLevel: 'silent', nodePaths: [join(ROOT, 'node_modules')] });
    return (await import(pathToFileURL(O).href)).RR;
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}
const RR = await loadRR();
/** 伺服器引擎 bundle 匯出的 share*（與 scripts/build-server-engine.mjs 同一個來源檔）；srcRoot 沒有那支檔 ⇒ null */
async function loadShare(srcRoot) {
  if (!existsSync(join(srcRoot, 'src/lib/deck-posts/replay-share.ts'))) return null;
  const tmp = mkdtempSync(join(tmpdir(), 'v6583s-'));
  const E = join(tmp, 'e.ts'), S = join(tmp, 's.js'), O = join(tmp, 'o.mjs');
  writeFileSync(S, 'export const base="";export const browser=false;');
  writeFileSync(E, `export * from '${join(srcRoot, 'src/lib/deck-posts/replay-share').replace(/\\/g, '/')}';`);
  try {
    await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
      alias: { '$lib': join(srcRoot, 'src/lib'), '$app/paths': S, '$app/environment': S }, logLevel: 'silent', nodePaths: [join(ROOT, 'node_modules')] });
    return { ...(await import(pathToFileURL(O).href)) };
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}
const SHARE = await loadShare(ROOT);
const MY = '阿明訓練家', OPP = '小強強隊長';
const renameDeep = (o) => JSON.parse(JSON.stringify(o).replace(/"name":"A"/g, `"name":"${MY}"`).replace(/"name":"B"/g, `"name":"${OPP}"`));
const renameMsg = (s) => typeof s === 'string' ? s.replace(/(^|[^A-Za-z])A(?![A-Za-z])/g, '$1' + MY).replace(/(^|[^A-Za-z])B(?![A-Za-z])/g, '$1' + OPP) : s;
const DECKS = [presetById(mod, '__preset_cynthia_garchomp__'), presetById(mod, '__preset_mbg__')];
const entriesOf = (d) => (d.entries ?? d.cards ?? d).map((e) => ({ cardId: String(e.cardId), count: e.count }));
function makeReplay(kind = 'online', revealed = false) {
  let rec = null, final = null;
  const agents = [(st, i) => mod.aiNew(st, pool, i), (st, i) => mod.aiNew(st, pool, i)];
  playGame({ mod, pool, decks: DECKS, agents, seed: 3, firstPlayer: firstPlayerOf(3),
    onStep: (st, a, n) => { for (const g0 of [st, n]) { if (!g0?.id) continue; const g = renameDeep(g0); g.log = (g.log || []).map((e) => ({ ...e, message: renameMsg(e.message), privateMessage: renameMsg(e.privateMessage) })); if (g.winReason) g.winReason = renameMsg(g.winReason); if (!rec) rec = RR.createReplayRecorder(g.id); RR.recordStep(rec, g); if (g.phase === 'game-over') final = g; } } });
  const online = kind === 'online';
  const d = RR.finalizeReplay({ rec, finalState: final, online, seat: online ? 0 : null, ai: kind === 'ai', revealOpp: revealed, appVersion: 'T', now: 1760000000000 });
  return d;
}
const REP = makeReplay('online', false);
const REP_AI = makeReplay('ai', false);
const REP_REVEALED = makeReplay('online', true);

/** 每一格與終局：對手手牌、對手未翻開的獎賞卡、雙方牌庫都是卡背；對戰紀錄沒有對手的私有訊息 */
function hiddenOk(d) {
  const H = RR.HIDDEN_CARD_ID;
  const states = [...d.snapshots.map((s) => s.state), d.finalState];
  return states.every((st) => st.players[1].hand.every((c) => c.cardId === H) && st.players[1].prizes.every((c) => c.faceUp || c.cardId === H)
      && st.players[0].deck.every((c) => c.cardId === H) && st.players[1].deck.every((c) => c.cardId === H) && st.pendingSelection == null && !('deckTopKnown' in st))
    && d.finalLog.every((e) => !(e.playerIndex === 1 && e.privateMessage != null)) && d.meta.revealed === false;
}
// ── 伺服器情境 ──
async function serverScenarios(SAP, TENG = SHARE) {
  const r = {};
  const blk = sentinel(SAP, 'v170-deck-post-replays');
  if (!blk) return r;
  const myDeck = entriesOf(DECKS[0]), oppDeck = entriesOf(DECKS[1]);
  const posts = Col([
    { _id: 'dp_me', uid: 'me', status: 'published', entries: myDeck },
    { _id: 'dp_hid', uid: 'me', status: 'hidden', entries: myDeck },
    { _id: 'dp_other', uid: 'x', status: 'published', entries: oppDeck },
    { _id: 'dp_del', uid: 'me', status: 'deleted', entries: myDeck },
    // 另外三位投稿者（同一副牌）：伺服器每人每分鐘限 10 份上傳，分開才不會互相吃掉額度
    { _id: 'dp_me2', uid: 'me2', status: 'published', entries: myDeck },
    { _id: 'dp_me3', uid: 'me3', status: 'published', entries: myDeck },
    { _id: 'dp_me4', uid: 'me4', status: 'published', entries: myDeck },
  ]);
  const M = (id, extra) => ({ _id: id, eventId: 'E1', round: 2, p1uid: 'me', p2uid: 'x', p1name: '我', p2name: '別人', winnerUid: 'me', finalTurn: 9, status: 'done', gameStartedAt: 1000, endedAt: 2000, ...extra });
  const matches = Col([M('E1_r2_m0'), M('E1_r3_m0', { round: 3, winnerUid: 'x', gameStartedAt: 1200 }), M('E2_r1_m0', { eventId: 'E2', gameStartedAt: 1300 }),
    M('BYE', { bye: true, gameStartedAt: 1400 }), M('PLAYING', { status: 'playing', gameStartedAt: 1500 }), M('NOSHOW', { noShow: true, gameStartedAt: 1600 }), M('OTHERS', { p1uid: 'a', p2uid: 'b', gameStartedAt: 1700 })]);
  const regs = Col([{ _id: 'E1__me', deckEntries: myDeck.map((e) => ({ ...e, role: 'x' })) }, { _id: 'E2__me', deckEntries: oppDeck }]);
  const cols = { deckPostReplays: Col(), deckPosts: posts, tournamentMatches: matches, tournamentRegistrations: regs,
    tournamentEvents: Col([{ _id: 'E1', name: '網站賽-200' }]), tournamentArchives: Col([{ _id: 'arch_E2', eventName: '已刪除的賽事', players: [] }]) };
  const db = { collection: (n) => cols[n] || (cols[n] = Col()) };
  const routes = {};
  const app = { get: (p, h) => { routes['GET ' + p] = h; }, post: (p, h) => { routes['POST ' + p] = h; } };
  const IDS = { me: { uid: 'me', verified: true, email: 'me@x' }, x: { uid: 'x', verified: true, email: 'x@x' }, admin: { uid: 'adm', verified: true, email: 'admin@x' }, anon: null,
    me2: { uid: 'me2', verified: true }, me3: { uid: 'me3', verified: true }, me4: { uid: 'me4', verified: true } };
  const teng = { share: TENG };
  await new Function('db', 'app', 'tournIdentity', 'isTournAdmin', 'mtmIndexesReady', '__T', 'const TENG = new Proxy({}, { get: (_t, k) => (__T.share ? __T.share[k] : undefined) });\nreturn (async () => {\n' + blk + '\nreturn {};\n})();')(
    db, app, async (req) => (IDS[req._u] ? IDS[req._u] : { error: '需要登入', code: 401 }), (id) => !!(id && id.uid === 'adm'), async () => true, teng);
  r.routes = Object.keys(routes).sort().join(',');
  r.R0 = r.routes === 'GET /api/deck-posts-replays,GET /api/deck-posts-replays/candidates,GET /api/deck-posts-replays/file,POST /api/deck-posts-replays/remove,POST /api/deck-posts-replays/tournament,POST /api/deck-posts-replays/upload'
    && cols.deckPostReplays.calls.idx.includes(JSON.stringify({ postId: 1, status: 1, createdAt: 1 }));
  const G = (p, u, q) => call(routes['GET ' + p], { _u: u, query: q || {}, headers: {} });
  const P = (p, u, body, q) => call(routes['POST ' + p], { _u: u, body, query: q || {}, headers: {} });
  const upload = (u, postId, bytes) => { const req = { _u: u, query: { postId }, headers: {}, body: {} }; req.on = (ev, cb) => { if (ev === 'data') setTimeout(() => cb(Buffer.from(bytes)), 0); if (ev === 'end') setTimeout(cb, 1); }; req.destroy = () => {}; return call(routes['POST /api/deck-posts-replays/upload'], req); };
  // V1 候選：只有投稿者；只列已結束、有開打、自己的；牌組相同與否
  const c1 = await G('/api/deck-posts-replays/candidates', 'me', { postId: 'dp_me' });
  const c2 = await G('/api/deck-posts-replays/candidates', 'x', { postId: 'dp_me' });
  const ids = (c1.body?.matches || []).map((m) => m.matchId + ':' + m.sameDeck);
  r.V1 = c1.status === 200 && ids.join(',') === 'E2_r1_m0:false,E1_r3_m0:true,E1_r2_m0:true' && c2.status === 403 && c1.body.matches.find((m) => m.matchId === 'E1_r3_m0').result === 'lose';
  r.V1n = JSON.stringify({ ids, s2: c2.status });
  // V2 附加錦標賽：別人 403、牌組不同 400、沒開打 400、不是自己的 403；成功一次、重複 409
  const t403 = await P('/api/deck-posts-replays/tournament', 'x', { postId: 'dp_me', matchId: 'E1_r2_m0' });
  const tDeck = await P('/api/deck-posts-replays/tournament', 'me', { postId: 'dp_me', matchId: 'E2_r1_m0' });
  const tPlay = await P('/api/deck-posts-replays/tournament', 'me', { postId: 'dp_me', matchId: 'PLAYING' });
  const tNot = await P('/api/deck-posts-replays/tournament', 'me', { postId: 'dp_me', matchId: 'OTHERS' });
  const tOk = await P('/api/deck-posts-replays/tournament', 'me', { postId: 'dp_me', matchId: 'E1_r2_m0' });
  const tDup = await P('/api/deck-posts-replays/tournament', 'me', { postId: 'dp_me', matchId: 'E1_r2_m0' });
  const tAnon = await P('/api/deck-posts-replays/tournament', 'anon', { postId: 'dp_me', matchId: 'E1_r3_m0' });
  r.V2 = t403.status === 403 && tDeck.status === 400 && tPlay.status === 400 && tNot.status === 403 && tOk.status === 200 && tDup.status === 409 && tAnon.status === 401
    && tOk.body.item.label === '網站賽-200・第 2 輪' && tOk.body.item.result === 'win' && tOk.body.item.matchId === 'E1_r2_m0' && tOk.body.item.kind === 'tournament';
  r.V2n = JSON.stringify([t403.status, tDeck.status, tPlay.status, tNot.status, tOk.status, tDup.status, tAnon.status, tOk.body?.item]);
  // V3 上傳一般對戰復盤：成功；解壓後對手名字一個都不剩、自己的名字還在、meta 的對手名字是「對手」
  const gz = gzipSync(Buffer.from(JSON.stringify(REP)));
  const u1 = await upload('me', 'dp_me', gz);
  const stored = cols.deckPostReplays.rows.find((d) => d.kind === 'casual');
  const txt = stored ? gunzipSync(Buffer.from(stored.gz, 'base64')).toString('utf8') : '';
  const orig = JSON.stringify(REP);
  r.V3 = u1.status === 200 && !!stored && orig.includes(OPP) && !txt.includes(OPP) && txt.includes(MY) && JSON.parse(txt).meta.p2name === '對手' && JSON.parse(txt).meta.p1name === MY
    && (JSON.parse(txt).finalState.players[1].name === '對手') && txt.split('對手').length > 20 && !/"email"|"uid"/.test(txt)
    && JSON.parse(txt).snapshots.length === REP.snapshots.length && u1.body.item.kind === 'casual' && ['win', 'lose', 'draw'].includes(u1.body.item.result)
    && hiddenOk(JSON.parse(txt));
  r.V3n = JSON.stringify({ st: u1.status, err: u1.body?.error, oppLeft: txt.includes(OPP), myKept: txt.includes(MY), n: txt.split('對手').length });
  // V4 不收：vs AI、攤開版、牌組不同、壞檔、重複同一局、別人的投稿
  const bad = [];
  bad.push((await upload('me', 'dp_me', gzipSync(Buffer.from(JSON.stringify(REP_AI))))).status);
  // 另外造「遮蔽版、但 kind 是 ai／local」的檔，逼 kind 判準自己擋（v6.583 第一版的突變實證：攤開版的 ai 檔會被別的判準先擋掉）。
  bad.push((await upload('me', 'dp_me', gzipSync(Buffer.from(JSON.stringify({ ...REP, meta: { ...REP.meta, kind: 'ai' } }))))).status);
  bad.push((await upload('me', 'dp_me', gzipSync(Buffer.from(JSON.stringify({ ...REP, meta: { ...REP.meta, kind: 'local' } }))))).status);
  const wrongDeck = await upload('me', 'dp_me', gzipSync(Buffer.from(JSON.stringify({ ...REP, meta: { ...REP.meta, viewerSeat: 1 } }))));   // 改坐對面 ⇒ 看得到的是另一副牌（而且那一側本來就被遮）
  bad.push(wrongDeck.status);
  bad.push((await upload('me', 'dp_me', Buffer.from('not a replay'))).status);
  bad.push((await upload('me', 'dp_me', gz)).status);   // 同一局再傳一次
  bad.push((await upload('x', 'dp_me', gz)).status);
  const bomb = gzipSync(Buffer.alloc(20 * 1024 * 1024, 0x20));   // 解壓 20MB 的空白（壓縮炸彈）
  bad.push((await upload('me', 'dp_me', bomb)).status);
  // 看得到的卡太少（投稿者那一側全空）⇒ 無法確認牌組
  const emptySide = JSON.parse(JSON.stringify(REP)); emptySide.snapshots = [];
  Object.assign(emptySide.finalState.players[0], { hand: [], discard: [], lostZone: [], prizes: [], active: null, bench: [] });
  bad.push((await upload('me3', 'dp_me3', gzipSync(Buffer.from(JSON.stringify(emptySide))))).status);
  r.V4 = bad.join(',') === '400,400,400,400,400,409,403,400,400';
  r.V4n = bad.join(',') + ' ' + (wrongDeck.body?.error || '');
  // V5 清單：公開看得到兩份；可移除只給投稿者／admin；下架的投稿只有本人／admin 看得到
  const l1 = await G('/api/deck-posts-replays', 'anon', { postId: 'dp_me' });
  const l2 = await G('/api/deck-posts-replays', 'me', { postId: 'dp_me' });
  const l3 = await G('/api/deck-posts-replays', 'admin', { postId: 'dp_me' });
  const hidAnon = await G('/api/deck-posts-replays', 'anon', { postId: 'dp_hid' });
  const hidMe = await G('/api/deck-posts-replays', 'me', { postId: 'dp_hid' });
  const del = await G('/api/deck-posts-replays', 'me', { postId: 'dp_del' });
  r.V5 = l1.status === 200 && l1.body.dprApi === 1 && l1.body.items.length === 2 && l1.body.items.every((x) => !x.canRemove) && !l1.body.canAttach
    && l2.body.canAttach && l2.body.items.every((x) => x.canRemove) && !l3.body.canAttach && l3.body.items.every((x) => x.canRemove) && l3.body.isAdmin
    && hidAnon.status === 404 && hidMe.status === 200 && del.status === 404 && !JSON.stringify(l1.body).includes('"uid"') && !JSON.stringify(l1.body).includes('gz');
  r.V5n = JSON.stringify({ l1: l1.body, hidAnon: hidAnon.status, hidMe: hidMe.status, del: del.status });
  // V6 檔案：公開拿得到（就是改過名字的那份）；移除後 404；admin 能移除別人的、路人不能
  const cid = stored?._id;
  const f1 = await G('/api/deck-posts-replays/file', 'anon', { id: cid });
  const rmX = await P('/api/deck-posts-replays/remove', 'x', { id: cid });
  const rmA = await P('/api/deck-posts-replays/remove', 'admin', { id: cid });
  const f2 = await G('/api/deck-posts-replays/file', 'anon', { id: cid });
  const l4 = await G('/api/deck-posts-replays', 'anon', { postId: 'dp_me' });
  const tid = cols.deckPostReplays.rows.find((d) => d.kind === 'tournament')?._id;
  const rmMe = await P('/api/deck-posts-replays/remove', 'me', { id: tid });
  const rmAgain = await P('/api/deck-posts-replays/remove', 'me', { id: tid });
  const rowC = cols.deckPostReplays.rows.find((d) => d._id === cid), rowT = cols.deckPostReplays.rows.find((d) => d._id === tid);
  r.V6 = f1.status === 200 && Buffer.isBuffer(f1.sent) && !gunzipSync(f1.sent).toString('utf8').includes(OPP) && rmX.status === 403 && rmA.status === 200 && f2.status === 404
    && l4.body.items.length === 1 && rmMe.status === 200 && rmAgain.status === 404 && rowC.status === 'removed' && rowC.removedBy === 'admin' && !rowC.gz && rowT.removedBy === 'owner'
    && (await G('/api/deck-posts-replays', 'anon', { postId: 'dp_me' })).body.items.length === 0;
  r.V6n = JSON.stringify({ f1: f1.status, rmX: rmX.status, rmA: rmA.status, f2: f2.status, l4: l4.body?.items?.length, rmMe: rmMe.status, rmAgain: rmAgain.status, rowC });
  // V7 再附加一次：移除過的可以重新附加（不限場次；重複只看「還在的」）
  const again = await P('/api/deck-posts-replays/tournament', 'me', { postId: 'dp_me', matchId: 'E1_r2_m0' });
  const again2 = await upload('me', 'dp_me', gz);
  r.V7 = again.status === 200 && again2.status === 200 && (await G('/api/deck-posts-replays', 'anon', { postId: 'dp_me' })).body.items.length === 2;
  // V3b（審查 P2-1）攤開版的線上復盤、而且把自報旗標改成「已遮蔽」⇒ 伺服器照樣重新遮：存下來的檔看不到對手手牌／牌庫
  const forged = JSON.parse(JSON.stringify(REP_REVEALED)); forged.meta.revealed = false;
  const fOrig = forged.finalState.players[1].hand.some((c) => c.cardId !== RR.HIDDEN_CARD_ID);
  const u3 = await upload('me2', 'dp_me2', gzipSync(Buffer.from(JSON.stringify(forged))));
  const st3 = cols.deckPostReplays.rows.find((d) => d.postId === 'dp_me2' && d.status === 'active');
  const d3 = st3 ? JSON.parse(gunzipSync(Buffer.from(st3.gz, 'base64')).toString('utf8')) : null;
  r.V3b = fOrig && u3.status === 200 && !!d3 && hiddenOk(d3) && !JSON.stringify(d3).includes(OPP);
  r.V3bn = JSON.stringify({ fOrig, st: u3.status, err: u3.body?.error });
  // V8（審查 P3-2）終局那一格的對手名字被改掉 ⇒ 其他格的真名一樣要換掉（名字取所有格的聯集）
  const tam = JSON.parse(JSON.stringify(REP)); tam.finalState.players[1].name = 'Zzz'; tam.meta.p2name = 'Zzz';
  const u4 = await upload('me4', 'dp_me4', gzipSync(Buffer.from(JSON.stringify(tam))));
  const st4 = cols.deckPostReplays.rows.find((d) => d.postId === 'dp_me4' && d.status === 'active');
  const t4 = st4 ? gunzipSync(Buffer.from(st4.gz, 'base64')).toString('utf8') : '';
  r.V8 = u4.status === 200 && !!t4 && !t4.includes(OPP) && !t4.includes('Zzz');
  r.V8n = JSON.stringify({ st: u4.status, err: u4.body?.error, opp: t4.includes(OPP), z: t4.includes('Zzz') });
  // V9 穩定性：同時兩份上傳 ⇒ 第二份 429；body 已被讀走（送成 JSON）⇒ 415 不掛住；舊 bundle（沒有 share*）⇒ 503 fail-closed
  const slowReq = { _u: 'me3', query: { postId: 'dp_me3' }, headers: {}, body: {} }; let feed = null;
  slowReq.on = (ev, cb) => { if (ev === 'data') feed = cb; if (ev === 'end') slowReq._end = cb; }; slowReq.destroy = () => {};
  const p1 = call(routes['POST /api/deck-posts-replays/upload'], slowReq);
  await new Promise((r2) => setTimeout(r2, 20));
  const busy = await upload('me3', 'dp_me3', gz);
  if (feed) feed(Buffer.from('x')); if (slowReq._end) slowReq._end();
  const p1r = await p1;
  const consumed = await call(routes['POST /api/deck-posts-replays/upload'], { _u: 'me3', query: { postId: 'dp_me3' }, headers: {}, body: { a: 1 }, readableEnded: true, on() {}, destroy() {} });
  const savedShare = teng.share; teng.share = null;
  const oldB = await upload('me3', 'dp_me3', gz);
  teng.share = savedShare;
  r.V9 = busy.status === 429 && p1r.status === 400 && consumed.status === 415 && oldB.status === 503;
  r.V9n = JSON.stringify({ busy: busy.status, p1: p1r.status, consumed: consumed.status, old: oldB.status });
  return r;
}
const SAP = normEol(readFileSync(join(ROOT, SAP_REL), 'utf8'));
const V = await serverScenarios(SAP);
const VL = {
  R0: '★★ R0 六支端點都註冊、deckPostReplays 建了 (postId,status,createdAt) 索引',
  V1: '★★★ V1 候選：只有投稿者看得到；只列自己已結束、有開打的錦標賽對局；標出牌組相同與否、勝敗',
  V2: '★★★ V2 附加錦標賽回放：別人 403／牌組不同 400／沒開打 400／不是自己的 403／未登入 401；成功一次、重複 409；標籤含賽事名稱與輪次',
  V3: '★★★ V3 上傳一般對戰復盤（真引擎整局、遮蔽版）：存下來的檔案裡對手名字一個都不剩（名字、訊息、勝因），自己的名字還在',
  V4: '★★★ V4 不收：vs AI（含遮蔽版的 ai／local）、牌組不同、壞檔、同一局重複、別人的投稿、壓縮炸彈、看得到的卡太少',
  V5: '★★★ V5 清單：公開看得到、只有投稿者／admin 能移除、只有投稿者能附加；下架的投稿只有本人看得到；不洩漏 uid／檔案內容',
  V6: '★★★ V6 檔案端點給的就是改過名字的那份；admin 能移除別人的、路人不能；移除後檔案與清單都消失（檔案內容一併清掉）',
  V7: '★★ V7 不限場次：移除後可以重新附加，同一場只擋「還在的」重複',
  V3b: '★★★ V3b 不信檔案自報的遮蔽旗標：攤開版改成「已遮蔽」上傳 ⇒ 伺服器照樣重新遮（對手手牌、蓋著的獎賞卡、牌庫、私有訊息都不見）',
  V8: '★★★ V8 對手名字取所有格子的聯集：終局那一格被改名，其他格的真名也一樣換掉',
  V9: '★★★ V9 穩定性：同時只處理一份（第二份 429）、body 被讀走 415 不掛住、舊 bundle 沒有淨化規則 ⇒ 503（不收沒淨化的檔）',
};
for (const k of Object.keys(VL)) ok(VL[k], V[k] === true, V[k + 'n'] ?? V.routes);

// ── P：前端純函式 ──
async function loadClient(srcRoot) {
  if (!existsSync(join(srcRoot, 'src/lib/deck-posts/replays.ts'))) return null;
  const tmp = mkdtempSync(join(tmpdir(), 'v6583c-'));
  const E = join(tmp, 'e.ts'), O = join(tmp, 'o.mjs');
  writeFileSync(E, `export * from '${join(srcRoot, 'src/lib/deck-posts/replays').replace(/\\/g, '/')}';`);
  try { await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' }); return await import(pathToFileURL(O).href); }
  finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}
function clientChecks(C) {
  const r = {};
  if (!C) return r;
  const L = C.parseDprList({ dprApi: 1, canAttach: true, items: [{ id: 'dpr_1', kind: 'tournament', matchId: 'E1_r2_m0', label: 'x', result: 'win', turns: 9, createdAt: 5, canRemove: true },
    { id: 'dpr_2', kind: 'casual', matchId: 'zz', result: 'weird' }, { id: 'bad id!', kind: 'casual' }, { id: 'dpr_3', kind: 'tournament' }, { id: 'dpr_4', kind: 'other' }] });
  r.P1 = !!L && L.items.length === 2 && L.items[1].matchId === null && L.items[1].result === 'draw' && L.canAttach && C.parseDprList({ items: [] }) === null && C.parseDprList(null) === null;
  r.P2 = C.dprWatchUrl('/b', { id: 'dpr_1', kind: 'tournament', matchId: 'E1_r2_m0' }, 'dp_me') === '/b/game?treplay=E1_r2_m0&dpfrom=dp_me'
    && C.dprWatchUrl('/b', { id: 'dpr_2', kind: 'casual', matchId: null }, 'dp_me') === '/b/game?dpreplay=dpr_2&dpfrom=dp_me'
    && C.dprWatchUrl('', { id: 'x"><script>', kind: 'casual', matchId: null }, 'dp') === null && C.dprFileUrl('dpr_2') === '/api/deck-posts-replays/file?id=dpr_2';
  // ⭐審查 P2-1 之後伺服器會重新遮蔽 ⇒ 攤開版的線上復盤也可以附加；vs AI／本機雙人／沒有座位的一律不列
  r.P3 = C.isAttachableLocalReplay({ kind: 'online', revealed: false, viewerSeat: 0 }) && C.isAttachableLocalReplay({ kind: 'online', revealed: true, viewerSeat: 1 })
    && !C.isAttachableLocalReplay({ kind: 'ai', revealed: false, viewerSeat: 0 }) && !C.isAttachableLocalReplay({ kind: 'local', revealed: true, viewerSeat: null })
    && !C.isAttachableLocalReplay({ kind: 'online', revealed: false, viewerSeat: null });
  r.P4 = C.dpFromOfSearch('?treplay=a&dpfrom=dp_x') === 'dp_x' && C.dpReplayIdOfSearch('?dpreplay=dpr_9') === 'dpr_9' && C.dpFromOfSearch('?dpfrom=<x>') === null;
  return r;
}
const CL = await loadClient(ROOT);
// U（審查 P3-1）名字替換只換「前後是邊界」的地方
{
  const f = SHARE && SHARE.replaceNameInText;
  const u = !!f && f('寶可夢 抽了 1 張', ['寶可夢']) === '對手 抽了 1 張' && f('選擇了出場寶可夢', ['寶可夢']) === '選擇了出場寶可夢'
    && f('超級耿鬼ex 使出招式', ['ex']) === '超級耿鬼ex 使出招式' && f('【ex】的回合', ['ex']) === '【ex】的回合' && f('基本【超】能量', ['能量']) === '基本【超】能量' && f('玩家：寶可夢，換下', ['寶可夢']) === '玩家：對手，換下' && f('硬岩【鬥】能量', ['能量']) === '硬岩【鬥】能量'
    && f('小強強隊長 將 能量 附加', ['小強強隊長', '能量']) === '對手 將 對手 附加' && f('a', []) === 'a';
  ok('★★★ U1 名字替換只換前後是邊界的地方（名字是「寶可夢」「ex」「能量」時不會把卡名換掉）', u);
}
const P = clientChecks(CL);
ok('★★ P1 清單正規化：沒有哨兵 ⇒ null（整區不顯示）；不合法的 id／種類丟掉；結果只有勝／敗／平手', P.P1 === true);
ok('★★★ P2 觀看網址：錦標賽 ?treplay=、一般對戰 ?dpreplay=，都帶 dpfrom；不合法的 id 不組網址', P.P2 === true);
ok('★★★ P3 本機復盤只列線上對戰（vs AI、本機雙人、沒有座位的不列；攤開版也可以，伺服器會重新遮）', P.P3 === true);
ok('★ P4 回放頁讀 dpfrom／dpreplay（不合法回 null）', P.P4 === true);

// ── S：接線 ──
function staticChecks(SAPsrc, DP, GP, BSE = '') {
  const s = {};
  const blk0 = sentinel(SAPsrc, 'v170-deck-post-replays') || '';
  const blk = blk0 ? stripCommentsBlank(blk0) : '';
  s.S1 = !!blk && SAPsrc.indexOf('// >>> v170-deck-post-replays') < SAPsrc.indexOf(TAIL_ANCHOR) && !blk.includes(TAIL_ANCHOR) && !/\bTMATCH\b|\bDPOSTS\b|\bTREGS\b/.test(blk)
    && /TENG\.shareSanitizeState\(sn\.state, seat, names, deck\)/.test(blk) && /TENG\.shareSanitizeLog\(obj\.finalLog, seat, names\)/.test(blk) && /if \(!dprShareReady\(\)\) return res\.status\(503\)/.test(blk)
    && !/split\(name\)|dprAnonymize|meta\.revealed/.test(blk) && /isTournAdmin\(id\)/.test(blk) && !blk.includes('官方賽') && /if \(i % 20 === 19\) await dprYield\(\);/.test(blk)
    && /shareSanitizeState, shareSanitizeLog, shareSanitizeMeta, shareDeckCounts \} from '\$lib\/deck-posts\/replay-share'/.test(BSE);
  const d0 = (DP.match(/\/\/ >>> v6583-deck-post-replays\n[\s\S]*?\/\/ <<< v6583-deck-post-replays/) || [''])[0];
  const d = d0 ? stripCommentsBlank(d0) : '';
  s.S2 = !!d && !/\bapi\(/.test(d) && /\bapi\(/.test(d0) && /await fetch\(DPR_API \+ path, init\)/.test(d) && /dprReset\(\);   \/\/ ⭐v6\.583 上一篇的對戰紀錄不可以畫在這一篇/.test(DP)
    && /void fetchReplays\(post\.id\);/.test(DP) && /if \(seq !== dprSeq \|\| openPost\?\.id !== postId\) return;/.test(d) && (d.match(/if \(!dprSamePost\(post\.id\)\) return;/g) || []).length === 3 && /\{#if it\.canRemove\}/.test(DP) && /isAttachableLocalReplay\(r\.meta\)/.test(DP) && /'Content-Type': 'application\/octet-stream'/.test(d);
  s.S3 = /const _dpr = dpReplayIdOfSearch\(window\.location\.search\);/.test(GP) && /function tExitReplay\(\) \{\n    if \(dpReturnIfAny\(\)\) return;/.test(GP)
    && /await openReplayData\(r\.data, 'casual'\);\n    \} catch \(e: any\) \{ dpReturnPost = null; tError = '對戰紀錄載入失敗：'/.test(GP)
    && (GP.match(/dpReturnPost = null;   \/\/ ⭐v6\.583（審查 P3-6）/g) || []).length === 3;
  return s;
}
const S = staticChecks(SAP, R('src/routes/deck-posts/+page.svelte'), R('src/routes/game/+page.svelte'), R('scripts/build-server-engine.mjs'));
ok('★★★ S1 伺服器區塊在錦標賽區塊（TAIL_ANCHOR）之前、不碰錦標賽區塊的 const；對手改名、只收線上遮蔽版、admin 可移除都在', S.S1 === true);
ok('★★★ S2 公布欄：這一區不走 api()（舊伺服器沒有端點時不會把整頁藏掉）、換篇重置、移除鈕只給 canRemove、本機清單先篩', S.S2 === true);
ok('★★ S3 回放頁：?dpreplay= 打開復盤、離開回放先回到投稿', S.S3 === true);

// ── H：HEAD-FAIL ──
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('HEAD-FAIL（缺 BASE ' + BASE_SHA.slice(0, 8) + '）');
else {
  const bS = normEol(readBaseBlob(ROOT, BASE_SHA, SAP_REL).out);
  const bV = await serverScenarios(bS, null);
  const tmp = mkdtempSync(join(tmpdir(), 'v6583b-'));
  try {
    const { execFileSync } = await import('node:child_process');
    execFileSync('bash', ['-c', `git -C "${ROOT}" archive ${BASE_SHA} src | tar -x -C "${tmp}"`]);
    const bP = clientChecks(await loadClient(tmp));
    const bSt = staticChecks(bS, normEol(readFileSync(join(tmp, 'src/routes/deck-posts/+page.svelte'), 'utf8')), normEol(readFileSync(join(tmp, 'src/routes/game/+page.svelte'), 'utf8')), normEol(readBaseBlob(ROOT, BASE_SHA, 'scripts/build-server-engine.mjs').out || ''));
    const red = [...['R0', 'V1', 'V2', 'V3', 'V3b', 'V4', 'V5', 'V6', 'V7', 'V8', 'V9'].filter((k) => bV[k] !== true), ...['P1', 'P2', 'P3', 'P4'].filter((k) => bP[k] !== true), ...['S1', 'S2', 'S3'].filter((k) => bSt[k] !== true)];
    ok('★★★ HEAD-FAIL：BASE（v6.582／server v1.69）上 R0、V1-9、P1-4、S1-3 全紅（逐條）', red.length === 18, red.join(','));
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
  ok('★★ 錦標賽區塊逐位元未動（28 把鎖不必重釘）：TAIL_ANCHOR 之後與 BASE 相同', SAP.slice(SAP.indexOf(TAIL_ANCHOR)) === bS.slice(bS.indexOf(TAIL_ANCHOR)));
}

// ── E：真瀏覽器（API 用假伺服器）──
const BUILD = process.env.V6583_BUILD || join(ROOT, 'build');
const chromium = existsSync(join(BUILD, '404.html')) ? pwChromium('v6.583') : null;
if (!existsSync(join(BUILD, '404.html'))) console.log('  ENV-SKIP E（沒有 build/）');
else if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.583');
  if (browser) {
    const { createReadStream, statSync } = await import('node:fs');
    const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
    // 假的公布欄 API：一篇投稿、一則錦標賽回放＋一份一般對戰復盤（伺服器區塊真的改過名字的那份）
    const anonGz = (() => {   // 跑一次真的伺服器淨化，拿它的輸出
      const d = JSON.parse(JSON.stringify(REP)); return d;
    })();
    let fileBytes = null;
    {
      const blk = sentinel(SAP, 'v170-deck-post-replays');
      const cols = { deckPostReplays: Col(), deckPosts: Col([{ _id: 'dp_me', uid: 'me', status: 'published', entries: entriesOf(DECKS[0]) }]) };
      const routes = {};
      await new Function('db', 'app', 'tournIdentity', 'isTournAdmin', 'mtmIndexesReady', 'TENG', 'return (async () => {\n' + blk + '\nreturn {};\n})();')(
        { collection: (n) => cols[n] || (cols[n] = Col()) }, { get: (p, h) => { routes['GET ' + p] = h; }, post: (p, h) => { routes['POST ' + p] = h; } }, async () => ({ uid: 'me', verified: true }), () => false, async () => true, SHARE);
      const req = { query: { postId: 'dp_me' }, headers: {}, body: {} };
      const gz = gzipSync(Buffer.from(JSON.stringify(anonGz)));
      req.on = (ev, cb) => { if (ev === 'data') setTimeout(() => cb(gz), 0); if (ev === 'end') setTimeout(cb, 1); }; req.destroy = () => {};
      await call(routes['POST /api/deck-posts-replays/upload'], req);
      const row = cols.deckPostReplays.rows[0];
      fileBytes = row ? Buffer.from(row.gz, 'base64') : null;
    }
    const POST = { id: 'dp_me', authorName: '阿明', deckName: '測試牌組', notes: '', archetype: '', cardTotal: 60, likeCount: 0, downloadCount: 0, commentCount: 0, createdAt: 1760000000000, tournament: null, entries: entriesOf(DECKS[0]) };
    const LIST = { dprApi: 1, canAttach: false, isAdmin: false, items: [
      { id: 'dpr_t1', kind: 'tournament', matchId: 'E1_r2_m0', label: '網站賽-200・第 2 輪', result: 'win', turns: 9, createdAt: 1, canRemove: false },
      { id: 'dpr_c1', kind: 'casual', matchId: null, label: '一般對戰', result: 'lose', turns: 12, createdAt: 2, canRemove: false }] };
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      const j = (o, st = 200) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (u.pathname === '/api/deck-posts/dp_me') return j({ post: POST });
      if (u.pathname === '/api/deck-posts') return j({ posts: [POST], total: 1, q: u.searchParams.get('q') || undefined });
      if (u.pathname.startsWith('/api/deck-posts-comments')) return j({ comments: [], hasMore: false });
      if (u.pathname === '/api/deck-posts-replays') return j(LIST);
      if (u.pathname === '/api/deck-posts-replays/file') { if (u.searchParams.get('id') === 'dpr_c1' && fileBytes) { res.writeHead(200, { 'content-type': 'application/octet-stream' }); return res.end(fileBytes); } return j({ error: '找不到' }, 404); }
      if (u.pathname.startsWith('/api/')) return j({});
      let p = join(BUILD, decodeURIComponent(u.pathname));
      if (existsSync(p + '.html')) p += '.html'; else if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
      if (!existsSync(p)) p = join(BUILD, '404.html');
      res.writeHead(200, { 'content-type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' }); createReadStream(p).pipe(res);
    });
    await new Promise((r) => srv.listen(0, r));
    const port = srv.address().port;
    try {
      const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1366, height: 900 } });
      await ctx.route(/pokemon-card\.com|ptcg-tw-sim-img|firebase|googleapis|gstatic/, (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="63" height="88"><rect width="63" height="88" fill="#4a6"/></svg>' }));
      const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
      await pg.goto(`http://localhost:${port}/deck-posts?post=dp_me`, { waitUntil: 'load' });
      await pg.waitForSelector('.dpr-item', { timeout: 30000 });
      const items = await pg.evaluate(() => [...document.querySelectorAll('.dpr .dpr-list > .dpr-item')].map((li) => ({ t: li.textContent.replace(/\s+/g, ' ').trim(), href: li.querySelector('a.linkbtn')?.getAttribute('href') || '', rm: !!li.querySelector('button.danger') })));
      ok('★★★ E1 公布欄明細：顯示兩筆對戰紀錄（勝／敗、伺服器紀錄／玩家上傳）、觀看連結正確、沒有權限時不顯示移除鈕',
        items.length === 2 && /勝/.test(items[0].t) && /伺服器紀錄/.test(items[0].t) && /\/game\?treplay=E1_r2_m0&dpfrom=dp_me$/.test(items[0].href)
          && /敗/.test(items[1].t) && /玩家上傳/.test(items[1].t) && /\/game\?dpreplay=dpr_c1&dpfrom=dp_me$/.test(items[1].href) && items.every((x) => !x.rm), JSON.stringify(items));
      // E2：點觀看（一般對戰）⇒ 回放打開、對手顯示「對手」、沒有原本的名字
      await pg.locator('.dpr-item a.linkbtn').nth(1).click();
      await pg.waitForSelector('.treplay-bar', { timeout: 30000 });
      await pg.waitForTimeout(600);
      const info = await pg.evaluate(() => ({ title: document.querySelector('.treplay-title')?.textContent || '', body: document.body.innerText }));
      ok('★★★ E2 ?dpreplay= 打開回放：標題是「阿明訓練家 vs 對手」、整頁找不到對手原本的名字',
        /阿明訓練家/.test(info.title) && /對手/.test(info.title) && !info.body.includes(OPP) && errs.length === 0, JSON.stringify({ title: info.title, errs: errs.slice(0, 2) }));
      // E3：離開回放 ⇒ 回到那一篇投稿
      await pg.locator('.treplay-btn', { hasText: '離開' }).click();
      await pg.waitForURL(/\/deck-posts\?post=dp_me/, { timeout: 15000 }).catch(() => {});
      ok('★★ E3 離開回放 ⇒ 回到那一篇投稿（/deck-posts?post=dp_me）', /\/deck-posts\?post=dp_me/.test(pg.url()), pg.url());
      await ctx.close();
    } finally { await browser.close(); srv.close(); }
  }
}

console.log(`\n=== v6.583／server v1.70 牌組公布欄附加對戰紀錄：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
