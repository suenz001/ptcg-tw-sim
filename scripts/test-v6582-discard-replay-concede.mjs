#!/usr/bin/env node
/**
 * v6.582 守衛：站長 2026-10-17 三項（參考 PTCGCodex）
 *   ① 棄牌區分類頁籤（全部／寶可夢／物品／支援者／道具／競技場／能量＋張數）
 *   ② 對戰回放自動播放＋時間軸＋速度（0.5x／1x／2x／4x）
 *   ③ 對局控制拆兩顆：🔄 提議重新開局（不算勝敗）｜🏳 認輸並提議重新開局（我方算敗、對方獲勝）
 *
 *   U：純函式實跑（discard-filter、concede）
 *   R：兩套房間 API 實跑（room-oracle.ts 接假的 oracle-client；room.ts 接假的 firebase/firestore）：
 *      認輸 → 終局＋重開提議 → 對手同意 → 同牌組新局、房間回到 playing；拒絕 ⇒ 勝負不變；各種不合法狀態一律拒絕
 *   Y：接收端（sync-guards.resolveRoomUpdate）：本地是認輸後的終局、收到重開的新局 ⇒ 採納
 *   S：頁面接線（棄牌頁籤只走 discard-filter、回放計時器有清理、認輸按鈕只在該出現的地方出現）＋ HEAD-FAIL
 *   E：真瀏覽器（build/）：棄牌頁籤、對局控制兩顆按鈕、vs AI 認輸後重新開局、回放自動播放／暫停／時間軸／播到底自動停、手機回放列
 *
 * Run: node scripts/test-v6582-discard-replay-concede.mjs
 */
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';
import { build } from 'esbuild';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { pwChromium, pwLaunchWith } from './lib/pw.mjs';
import { buildAiBundle, loadLivePool, presetById, playGame, firstPlayerOf } from './lib/ai-sim-harness.mjs';
import { normEol } from './lib/eol-agnostic.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠ BASE_SHA 必須留在 main 上（IRON_RULES Rule 45）：v6.581
const BASE_SHA = 'e5fc5464a8ef0b046a8f8a0d5c8c80680644a1c4';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };
const R = (p) => normEol(readFileSync(join(ROOT, p), 'utf8'));

// ── 載入：discard-filter／concede／replay-record／sync-guards（BASE 沒有前兩支 ⇒ null，各條各自紅）──
async function loadLib(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6582-'));
  const E = join(tmp, 'e.ts'), S = join(tmp, 's.js'), O = join(tmp, 'o.mjs');
  writeFileSync(S, 'export const base="";export const browser=false;');
  const p = (x) => join(srcRoot, x).replace(/\\/g, '/');
  const parts = [];
  if (existsSync(join(srcRoot, 'src/lib/game/discard-filter.ts'))) parts.push(`export * as DF from '${p('src/lib/game/discard-filter')}';`);
  if (existsSync(join(srcRoot, 'src/lib/game/concede.ts'))) parts.push(`export * as CD from '${p('src/lib/game/concede')}';`);
  parts.push(`export * as RR from '${p('src/lib/game/replay-record')}';`, `export * as RS from '${p('src/lib/game/replay-store')}';`, `export * as SG from '${p('src/lib/game/sync-guards')}';`);
  writeFileSync(E, parts.join('\n'));
  try {
    await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
      alias: { '$lib': join(srcRoot, 'src/lib'), '$app/paths': S, '$app/environment': S }, logLevel: 'silent', nodePaths: [join(ROOT, 'node_modules')] });
    return await import(pathToFileURL(O).href);
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}

// ── 兩套房間 API：room-oracle.ts（假 oracle-client，記憶體裡的房間＋版本號）與 room.ts（假 firebase/firestore）──
const ORACLE_STUB = `
export const ROOMS = new Map(); export let UID = 'u0'; export function setUid(u) { UID = u; }
export async function oracleAuth() { return { uid: UID }; }
export function oracleCurrentUid() { return UID; }
export async function oracleGetRoom(code) { const r = ROOMS.get(code); return r ? JSON.parse(JSON.stringify(r)) : null; }
export async function oracleUpsertRoom(code, data, ver) { const cur = ROOMS.get(code); if ((cur?._version ?? 0) !== (ver ?? 0)) return { conflict: true }; const n = { ...JSON.parse(JSON.stringify(data)), _version: (ver ?? 0) + 1 }; ROOMS.set(code, n); return { ok: true, room: n }; }
export const oracleUpsertRoomDelta = undefined; export function deltaPutBase() { return null; }
export async function oracleApi() { return {}; } export async function oracleDeleteRoom(c) { ROOMS.delete(c); }
export async function oracleListRooms() { return []; } export async function oraclePollRoom() { return null; } export async function oracleListMessages() { return []; }
export async function oracleListRoomsCombined() { return null; } export const ROOMS_UNCHANGED = Symbol('u'); export const ROOMS_COMBINED_UNSUPPORTED = Symbol('n');
export function isOracleTimeout() { return false; } export function isOracleUploadBudgetTimeout() { return false; } export const ORACLE_SIDEEFFECT_TIMEOUT_MS = 1000;
`;
const FIRESTORE_STUB = `
export const DOCS = new Map();
const clone = (x) => JSON.parse(JSON.stringify(x));
const DEL = { __del: 1 };
export function deleteField() { return DEL; } export function serverTimestamp() { return 0; }
export function doc(_db, col, id) { return { key: col + '/' + id }; }
function apply(key, patch) { const cur = DOCS.get(key) ?? {}; const n = { ...cur }; for (const [k, v] of Object.entries(patch)) { if (v === DEL) delete n[k]; else n[k] = clone(v); } DOCS.set(key, n); }
const snap = (key) => ({ exists: () => DOCS.has(key), data: () => clone(DOCS.get(key)) });
export async function getDoc(ref) { return snap(ref.key); }
export async function updateDoc(ref, patch) { apply(ref.key, patch); }
export async function setDoc(ref, data) { DOCS.set(ref.key, clone(data)); }
export async function runTransaction(_db, fn) { const writes = []; const tx = { get: async (ref) => snap(ref.key), update: (ref, patch) => { writes.push([ref.key, patch]); }, set: (ref, d) => writes.push([ref.key, d, 'set']) }; const out = await fn(tx); for (const [k, p, m] of writes) { if (m === 'set') DOCS.set(k, clone(p)); else apply(k, p); } return out; }
export function onSnapshot() { return () => {}; } export async function getDocs() { return { docs: [] }; }
export function collection() { return {}; } export function query() { return {}; } export function where() { return {}; } export function limit() { return {}; } export function orderBy() { return {}; }
export async function addDoc() { return {}; } export async function deleteDoc() {}
`;
async function loadRooms(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6582r-'));
  const S = join(tmp, 's.js'), OC = join(tmp, 'oc.js'), FS = join(tmp, 'fs.js'), FB = join(tmp, 'fb.js');
  writeFileSync(S, 'export const base="";export const browser=false;');
  writeFileSync(OC, ORACLE_STUB); writeFileSync(FS, FIRESTORE_STUB);
  writeFileSync(FB, `import { setUid, UID } from '${OC.replace(/\\/g, '/')}'; export const auth = { get currentUser() { return { uid: UID, email: null }; } }; export const db = {}; export const app = {}; export { setUid };`);
  const stub = { name: 'stub', setup(b) {
    b.onResolve({ filter: /(^|\/)oracle-client$/ }, () => ({ path: OC }));
    b.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: FS }));
    b.onResolve({ filter: /^\$lib\/firebase$/ }, () => ({ path: FB }));
  } };
  const out = {};
  for (const [k, f] of [['O', 'src/lib/game/room-oracle.ts'], ['F', 'src/lib/game/room.ts']]) {
    const E = join(tmp, k + '.ts'), O = join(tmp, k + '.mjs');
    writeFileSync(E, `export * as API from '${join(srcRoot, f).replace(/\\/g, '/')}';\nexport * as OC from '${OC.replace(/\\/g, '/')}';\nexport * as FS from '${FS.replace(/\\/g, '/')}';\nexport * as ENG from '${join(srcRoot, 'src/lib/game/engine').replace(/\\/g, '/')}';`);
    try {
      await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', plugins: [stub],
        alias: { '$lib': join(srcRoot, 'src/lib'), '$app/paths': S, '$app/environment': S }, logLevel: 'silent', nodePaths: [join(ROOT, 'node_modules')] });
      out[k] = await import(pathToFileURL(O).href + '?' + k + Date.now());
    } finally { /* 打包失敗一律炸出來（不可靜默掏空，test-v6263） */ }
  }
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
  return out;
}

const mod = await buildAiBundle(ROOT, {});
const pool = loadLivePool(ROOT);

/** 一場進行中的對局（playing）＋座位 */
function playingRoom() {
  const decks = [presetById(mod, '__preset_cynthia_garchomp__'), presetById(mod, '__preset_mbg__')];
  let mid = null;
  const agents = [(st, i) => mod.aiNew(st, pool, i), (st, i) => mod.aiNew(st, pool, i)];
  playGame({ mod, pool, decks, agents, seed: 3, firstPlayer: firstPlayerOf(3), onStep: (st, act, next) => { if (!mid && next?.phase === 'playing' && (next.turn ?? 0) >= 4) mid = next; } });
  const entries = (d) => d.entries ?? d.cards ?? d;
  const seat = (uid, name, d) => ({ role: 'p', uid, name, deckEntries: entries(d), deckId: 'd', ready: true, firstChoicePreference: 'random' });
  return { mid, room: { status: 'playing', gameState: JSON.parse(JSON.stringify(mid)), seats: [seat('u0', 'Alice', decks[0]), seat('u1', 'Bob', decks[1]), { role: 'spectator', uid: 'u9', name: 'S' }], restartProposalCount: 2 } };
}

async function roomScenarios(K, kind) {
  const r = {};
  if (!K || typeof K.API?.concedeAndProposeRestart !== 'function') return r;
  const { API, OC, FS } = K;
  const put = (room) => { if (kind === 'O') OC.ROOMS.set('ABCD', { ...JSON.parse(JSON.stringify(room)), _version: 1 }); else FS.DOCS.set('rooms/ABCD', JSON.parse(JSON.stringify(room))); };
  const get = () => kind === 'O' ? JSON.parse(JSON.stringify(OC.ROOMS.get('ABCD'))) : JSON.parse(JSON.stringify(FS.DOCS.get('rooms/ABCD')));
  const as = (u) => OC.setUid(u);
  const { mid, room } = playingRoom();
  const tryErr = async (f) => { try { await f(); return null; } catch (e) { return String(e?.message ?? e); } };
  // R1 認輸：終局（對手獲勝）＋ended＋提議＋count+1＋標記認輸者
  put(room); as('u1');
  await API.concedeAndProposeRestart('abcd');
  const a = get();
  r.R1 = a.status === 'ended' && a.gameState.phase === 'game-over' && a.gameState.winner === 0 && a.gameState.winReason === (mid.players[1].name + ' 認輸')
    && a.gameState.log.length === mid.log.length + 1 && /認輸/.test(a.gameState.log.at(-1).message)
    && a.restartProposed?.[1] === true && !a.restartProposed?.[0] && a.restartProposalCount === 3 && a.restartConcededBy === 1
    && a.gameState.id === mid.id && JSON.stringify(a.gameState.players) === JSON.stringify(JSON.parse(JSON.stringify(mid)).players);
  r.R1n = JSON.stringify({ logOk: a.gameState.log.length === mid.log.length + 1, plOk: JSON.stringify(a.gameState.players) === JSON.stringify(JSON.parse(JSON.stringify(mid)).players), wr: a.gameState.winReason, st: a.status, ph: a.gameState?.phase, w: a.gameState?.winner, rp: a.restartProposed, c: a.restartProposalCount, by: a.restartConcededBy });
  // R2 對手同意 ⇒ 同牌組新局、房間回到 playing、旗標清乾淨
  as('u0'); await API.respondRestart('abcd', true);
  const did = await API.checkAndAcceptRestart('abcd', pool);
  const b = get();
  const deckCount = (g, i) => { const p = g.players[i]; return p.deck.length + p.hand.length + (p.prizes?.length ?? 0) + p.bench.length + (p.active ? 1 : 0); };
  r.R2 = did === true && b.status === 'playing' && b.gameState.id !== mid.id && b.gameState.phase === 'setup' && (b.restartProposed == null) && (b.restartConcededBy == null)
    && deckCount(b.gameState, 0) === 60 && deckCount(b.gameState, 1) === 60 && b.restartProposalCount === 3;
  r.R2n = JSON.stringify({ did, st: b.status, ph: b.gameState?.phase, rp: b.restartProposed, by: b.restartConcededBy });
  // R3 對手拒絕 ⇒ 勝負不變（仍是認輸的終局、ended），提議清掉
  put(room); as('u0'); await API.concedeAndProposeRestart('abcd');
  as('u1'); await API.respondRestart('abcd', false);
  const c = get();
  r.R3 = c.status === 'ended' && c.gameState.phase === 'game-over' && c.gameState.winner === 1 && (c.restartProposed == null || (!c.restartProposed[0] && !c.restartProposed[1]))
    && (await API.checkAndAcceptRestart('abcd', pool)) === false && get().gameState.phase === 'game-over';
  // R4 不合法：已結束的局、提議進行中、觀戰者 ⇒ 一律拒絕且房間不變
  const b1 = JSON.stringify(get());
  as('u1'); const e1 = await tryErr(() => API.concedeAndProposeRestart('abcd'));   // 已 ended
  const u1 = b1 === JSON.stringify(get());
  put({ ...room, restartProposed: { 0: true }, restartProposedAt: 1 }); const b2 = JSON.stringify(get());
  as('u1'); const e2 = await tryErr(() => API.concedeAndProposeRestart('abcd'));
  const u2 = b2 === JSON.stringify(get());
  put(room); const b3 = JSON.stringify(get());
  as('u9'); const e3 = await tryErr(() => API.concedeAndProposeRestart('abcd'));
  const u3 = b3 === JSON.stringify(get());
  r.R4 = !!e1 && !!e2 && !!e3 && u1 && u2 && u3;
  r.R4n = JSON.stringify({ e1, e2, e3, u1, u2, u3 });
  // R5 一般提議會把殘留的認輸標記清掉（不會讓下一次一般提議被當成認輸）
  put({ ...room, restartConcededBy: 1 }); as('u0'); await API.proposeRestart('abcd');
  const d = get();
  r.R5 = d.restartProposed?.[0] === true && (d.restartConcededBy == null) && d.status === 'playing' && d.gameState.phase === 'playing';
  // R6 一般重開（status 本來就 playing）語義不變：同意後仍 playing、新局
  as('u1'); await API.respondRestart('abcd', true);
  const did2 = await API.checkAndAcceptRestart('abcd', pool);
  const e = get();
  r.R6 = did2 === true && e.status === 'playing' && e.gameState.phase === 'setup' && e.gameState.id !== mid.id;
  // R7（審查 P2-1）認輸 → 認輸者離開前撤回提議（cancelRestart）→ 對手再按同意 ⇒ 不會開出新局；認輸結果不變、認輸標記清掉
  put(room); as('u1'); await API.concedeAndProposeRestart('abcd');
  await API.cancelRestart('abcd');
  as('u0'); const e7 = await tryErr(() => API.respondRestart('abcd', true));
  const did7 = await API.checkAndAcceptRestart('abcd', pool);
  const f7 = get();
  r.R7 = !!e7 && did7 === false && f7.status === 'ended' && f7.gameState.phase === 'game-over' && f7.gameState.winner === 0 && (f7.restartConcededBy == null);
  r.R7n = JSON.stringify({ e7, did7, st: f7.status, by: f7.restartConcededBy });
  // R8（審查 P3-1／P3-2）拒絕 ⇒ 認輸標記清掉；重開 ⇒ 「再來一局」殘留清掉
  put(room); as('u1'); await API.concedeAndProposeRestart('abcd'); as('u0'); await API.respondRestart('abcd', false);
  const g8 = get();
  put({ ...room }); as('u1'); await API.concedeAndProposeRestart('abcd');
  if (kind === 'O') { const x = OC.ROOMS.get('ABCD'); x.rematchReady = { 1: true }; } else { FS.DOCS.get('rooms/ABCD').rematchReady = { 1: true }; }
  as('u0'); await API.respondRestart('abcd', true); await API.checkAndAcceptRestart('abcd', pool);
  const h8 = get();
  r.R8 = (g8.restartConcededBy == null) && h8.status === 'playing' && (h8.rematchReady == null || (!h8.rematchReady[0] && !h8.rematchReady[1]));
  r.R8n = JSON.stringify({ by: g8.restartConcededBy, rr: h8.rematchReady });
  return r;
}

const CUR = await loadLib(ROOT);
const ROOMS = await loadRooms(ROOT);

function unitScenarios(L) {
  const r = {};
  if (!L?.DF || !L?.CD) return r;
  const { DF, CD } = L;
  // U1：卡庫每一張卡都分得進某一類；道具不會被算成物品；張數加總＝全部
  const cards = [...pool.values()];
  const by = {}; for (const c of cards) { const k = DF.discardCategory(c); by[k] = (by[k] ?? 0) + 1; }
  const toolsAsItem = cards.filter((c) => c.supertype === 'Trainer' && c.subtype === 'PokemonTool' && DF.discardCategory(c) !== 'tool').length;
  r.U1 = cards.length > 3000 && (by.other ?? 0) === 0 && by.pokemon > 1000 && by.item > 100 && by.supporter > 100 && by.tool > 30 && by.stadium > 20 && by.energy > 20 && toolsAsItem === 0
    && DF.discardCategory(undefined) === 'other' && DF.discardCategory({ supertype: 'Trainer', subtype: 'Item' }) === 'item' && DF.discardCategory({ supertype: 'Trainer', subtype: '' }) === 'item';
  r.U1n = JSON.stringify(by);
  // U2：頁籤張數與篩選
  const sample = cards.filter((c, i) => i % 97 === 0).map((c) => String(c.id));
  const counts = DF.discardTabCounts([...sample, 'nope'], (id) => pool.get(id));
  const sum = counts.pokemon + counts.item + counts.supporter + counts.tool + counts.stadium + counts.energy;
  r.U2 = counts.all === sample.length + 1 && sum === sample.length && DF.DISCARD_TABS.map((t) => t.key).join() === 'all,pokemon,item,supporter,tool,stadium,energy'
    && sample.every((id) => DF.discardTabMatches('all', pool.get(id)) && DF.discardTabMatches(DF.discardCategory(pool.get(id)), pool.get(id)))
    && !DF.discardTabMatches('energy', { supertype: 'Pokemon' }) && !DF.discardTabMatches('item', undefined);
  // U3：認輸盤面
  const g = { id: 'g', phase: 'playing', turn: 5, log: [{ message: 'a' }], players: [{ name: 'A' }, { name: 'B' }] };
  const snap = JSON.stringify(g);
  const x = CD.buildConcededGame(g, 0, 123);
  r.U3 = x && x.phase === 'game-over' && x.winner === 1 && x.winReason === 'A 認輸' && x.log.length === 2 && x.log[1].timestamp === 123 && x.log[1].turn === 5
    && JSON.stringify(g) === snap && CD.buildConcededGame({ ...g, phase: 'game-over' }, 0, 1) === null && CD.buildConcededGame(g, 2, 1) === null && CD.buildConcededGame(null, 0, 1) === null
    && CD.buildConcededGame(g, 1, 1).winner === 0 && CD.buildConcededGame({ ...g, phase: 'setup' }, 0, 1) === null;   // 開局不能認輸（審查 P3-3）
  // Y：接收端——本地是認輸後的終局，收到重開的新局（不同 id、setup）⇒ 採納；同一局的舊盤面（playing）⇒ 不蓋回終局
  const old = { id: 'g1', phase: 'game-over', createdAt: 100, log: [1, 2, 3], players: [] };
  const fresh = { id: 'g2', phase: 'setup', createdAt: 200, log: [], players: [] };
  const d1 = L.SG.resolveRoomUpdate(old, fresh, { myPlayerIndex: 0, roomRestartCount: 3, lastAdoptedRestartCount: 2, lastSeenUndoApplyAt: 0, activeGameId: 'g1' });
  const d2 = L.SG.resolveRoomUpdate(old, { ...old, phase: 'playing', log: [1, 2, 3, 4] }, { myPlayerIndex: 0, roomRestartCount: 3, lastAdoptedRestartCount: 2, lastSeenUndoApplyAt: 0, activeGameId: 'g1' });
  r.Y1 = d1.kind === 'adopt' && d1.game === fresh && d2.kind === 'reject';
  r.Y1n = JSON.stringify({ d1: d1.kind, d2: d2.kind });
  return r;
}

const U = unitScenarios(CUR);
const RO = await roomScenarios(ROOMS.O, 'O');
const RF = await roomScenarios(ROOMS.F, 'F');

const LABELS = {
  U1: '★★★ U1 卡庫每一張卡都分得進一類（道具不會被算成物品、查不到的卡只在「全部」）',
  U2: '★★ U2 頁籤張數加總＝全部、篩選與分類同一個判準、頁籤順序',
  U3: '★★★ U3 認輸盤面：對手獲勝、log 多一行、不改原盤面、已結束／座位不合法 ⇒ null',
  Y1: '★★★ Y1 接收端：認輸後的終局收到重開新局 ⇒ 採納；同一局的舊盤面不蓋回終局',
};
for (const k of Object.keys(LABELS)) ok(LABELS[k], U[k] === true, U[k + 'n']);
const RL = {
  R1: '★★★ {k} R1 認輸：終局（對手獲勝）＋ended＋提議（我方）＋count+1＋標記認輸者，盤面其餘不變',
  R2: '★★★ {k} R2 對手同意 ⇒ 同牌組新局（各 60 張）、房間回到 playing、提議與認輸標記清掉',
  R3: '★★★ {k} R3 對手拒絕 ⇒ 勝負不變（仍是認輸的終局），也不會被重開',
  R4: '★★ {k} R4 已結束的局／提議進行中／觀戰者 ⇒ 拒絕且房間不變',
  R5: '★★ {k} R5 一般提議會清掉殘留的認輸標記（下一次一般提議不會被當成認輸）',
  R6: '★★ {k} R6 一般重開語義不變（仍 playing、新局）',
  R7: '★★★ {k} R7 認輸後撤回提議（離開房間時）⇒ 對手同意也不會開出新局，認輸結果不變',
  R8: '★★ {k} R8 拒絕 ⇒ 認輸標記清掉；重開 ⇒ 「再來一局」殘留清掉',
};
for (const [K, RS] of [['Oracle（正式站）', RO], ['Firestore（測試站）', RF]]) for (const k of Object.keys(RL)) ok(RL[k].replace('{k}', K), RS[k] === true, RS[k + 'n']);

// ── S：頁面接線 ──
function pageChecks(pg, rf, ro) {
  const s = {};
  s.S1 = /DISCARD_TABS,\s*discardTabMatches,\s*discardTabCounts/.test(pg) && /discardGrouped\.filter\(\(g\) => discardTabMatches\(discardTab, getCard\(g\.cardId\)\)\)/.test(pg)
    && /\$effect\.pre\(\(\) => \{ viewDiscardFor; discardTab = 'all'; \}\)/.test(pg) && !/subtype === 'PokemonTool'[^\n]*discardTab/.test(pg);
  const eff = (pg.match(/\/\/ >>> v6582-replay-autoplay[\s\S]*?\/\/ <<< v6582-replay-autoplay/) || [''])[0];
  s.S2 = /return \(\) => clearTimeout\(t\)/.test(eff) && /if \(!isTReplay\) replayPlaying = false/.test(eff) && /at >= n - 1\) \{ replayPlaying = false/.test(eff)
    && (pg.match(/class="treplay-range"/g) || []).length === 2 && /class="treplay-timeline"/.test(pg) && /class="treplay-mob-mid"/.test(pg);
  const h = (pg.match(/\/\/ >>> v6582-concede-restart\n[\s\S]*?\/\/ <<< v6582-concede-restart/) || [''])[0];
  s.S3 = /concedeAndProposeRestart\(roomCode\)/.test(h) && /buildConcededGame\(game, \(1 - aiPlayerIndex\)/.test(h) && /fireMatchRecord\(conceded/.test(h)
    && /!isTournament && !isTReplay && !isSpectator/.test(h) && /aiPlayerIndex !== null/.test(h)
    && /\{#if !isTournament && !isTReplay && !isSpectator\}\s*<button class="toggle-btn restart-game-btn concede-restart-btn"/.test(pg)
    && /roomData\?\.restartConcededBy === 1 - mySeatIdx && game\?\.phase === 'game-over'/.test(pg) && /game\.phase === 'playing' && !isTournament/.test(h);
  // S5（審查 P2-1）離開房間前撤回自己還在等的重開提議
  const lv = (pg.match(/async function leaveOnlineGame\(\) \{[\s\S]*?\n  \}\n/) || [''])[0];
  s.S5 = /const _cancelMyRestart = \(typeof myRestartProposed !== 'undefined'\) && myRestartProposed === true;/.test(lv)
    && /if \(_cancelMyRestart && typeof cancelRestart === 'function'\) \{\s*try \{ await cancelRestart\(_leavingRoomCode\); \}/.test(lv) && lv.indexOf('cancelRestart(_leavingRoomCode)') < lv.indexOf('await leaveRoom(_leavingRoomCode)');
  // 兩套房間 API 的認輸都只走 buildConcededGame（判準不寫第二份，Rule 38）
  s.S4 = [rf, ro].every((t) => /export async function concedeAndProposeRestart/.test(t) && /buildConcededGame\(data\.gameState as any, myIdx, gameClockNow\(\)\)/.test(t) && !/認輸，對手獲勝/.test(t));
  return s;
}
const S = pageChecks(R('src/routes/game/+page.svelte'), R('src/lib/game/room.ts'), R('src/lib/game/room-oracle.ts'));
const SL = {
  S1: '★★ S1 棄牌區只走 discard-filter（篩選、張數），每次打開回到「全部」',
  S2: '★★★ S2 回放計時器：effect 有清理、離開回放就停、播到底自動停；桌機＋手機都有時間軸',
  S3: '★★★ S3 認輸：線上走房間 API、本機 vs AI 先記錄再重開；錦標賽／觀戰／回放不顯示；對手視窗分辨認輸',
  S4: '★★★ S4 兩套房間 API 的認輸盤面都只呼叫 buildConcededGame（不另寫一份）',
  S5: '★★★ S5 離開房間前先撤回自己還在等回應的重開提議（再 leaveRoom）',
};
for (const k of Object.keys(SL)) ok(SL[k], S[k] === true);

// ── HEAD-FAIL：同一組檢查換成 BASE 檔案 ⇒ 必須紅 ──
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('HEAD-FAIL（缺 BASE ' + BASE_SHA.slice(0, 8) + '）');
else {
  const tmp = mkdtempSync(join(tmpdir(), 'v6582b-'));
  try {
    const { execFileSync } = await import('node:child_process');
    execFileSync('bash', ['-c', `git -C "${ROOT}" archive ${BASE_SHA} src | tar -x -C "${tmp}"`]);
    const B = await loadLib(tmp);
    const BR = await loadRooms(tmp);
    const bu = unitScenarios(B), bo = await roomScenarios(BR.O, 'O'), bf = await roomScenarios(BR.F, 'F');
    const bs = pageChecks(normEol(readFileSync(join(tmp, 'src/routes/game/+page.svelte'), 'utf8')), normEol(readFileSync(join(tmp, 'src/lib/game/room.ts'), 'utf8')), normEol(readFileSync(join(tmp, 'src/lib/game/room-oracle.ts'), 'utf8')));
    const red = [...['U1', 'U2', 'U3'].filter((k) => bu[k] !== true), ...['R1', 'R2', 'R3', 'R4'].filter((k) => bo[k] !== true).map((k) => 'O' + k), ...['R1', 'R2'].filter((k) => bf[k] !== true).map((k) => 'F' + k), ...['S1', 'S2', 'S3', 'S4', 'S5'].filter((k) => bs[k] !== true)];
    ok('★★★ HEAD-FAIL：BASE（v6.581）上 U1-3／O-R1-4／F-R1-2／S1-5 全紅（逐條）', red.length === 14, red.join(','));
    ok('★ HEAD-FAIL 正對照：Y1（接收端本來就對）在 BASE 也成立 ⇒ 本版沒動到 sync-guards', unitScenarios({ ...B, DF: CUR.DF, CD: CUR.CD }).Y1 === true);
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}

// ── E：真瀏覽器 ──
const BUILD = process.env.V6582_BUILD || join(ROOT, 'build');
const chromium = existsSync(join(BUILD, '404.html')) && CUR?.RR ? pwChromium('v6.582') : null;
if (!existsSync(join(BUILD, '404.html'))) console.log('  ENV-SKIP E（沒有 build/）');
else if (chromium) {
  const browser = await pwLaunchWith(chromium, 'v6.582');
  if (browser) {
    const { createReadStream, statSync } = await import('node:fs');
    const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x'); let p = join(BUILD, decodeURIComponent(u.pathname));
      if (existsSync(p + '.html')) p += '.html'; else if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
      if (!existsSync(p)) p = join(BUILD, '404.html');
      res.writeHead(200, { 'content-type': MIME[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' }); createReadStream(p).pipe(res);
    });
    await new Promise((r) => srv.listen(0, r));
    const port = srv.address().port;
    const tmp = mkdtempSync(join(tmpdir(), 'v6582e-'));
    const newCtx = async (vp) => {
      const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: vp });
      await ctx.route(/pokemon-card\.com|ptcg-tw-sim-img/, (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="63" height="88"><rect width="63" height="88" fill="#4a6"/></svg>' }));
      return ctx;
    };
    try {
      // E1～E3：vs AI 打兩回合 → 棄牌頁籤 → 對局控制 → 認輸並重新開局
      {
        const ctx = await newCtx({ width: 1366, height: 900 });
        await ctx.addInitScript(() => { let x = 7; Math.random = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; localStorage.setItem('ptcg_battle_layout', 'blue'); localStorage.setItem('ptcg_card_reveal', '0'); });
        const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
        const dialogs = []; pg.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
        await pg.goto(`http://localhost:${port}/game`, { waitUntil: 'load' });
        await pg.waitForSelector('.mode-card:not([disabled])', { timeout: 60000 });
        await pg.click('.mode-card');
        const sels = pg.locator('main.lobby select');
        await sels.nth(0).selectOption('__preset_tactic_dragonite__');
        await sels.nth(1).selectOption('__preset_tactic_gardevoir__');
        const start = pg.locator('button.btn-primary', { hasText: '開始' });
        await start.waitFor({ state: 'visible', timeout: 30000 });
        for (let i = 0; i < 30 && !(await start.isEnabled()); i++) await pg.waitForTimeout(500);
        await start.click();
        await pg.waitForSelector('.hand-card.draggable', { timeout: 60000 });
        await pg.waitForTimeout(1500);
        const a = await pg.locator('.hand-card.draggable').first().boundingBox(), z = await pg.locator('.my-active-zone').boundingBox();
        if (a && z) { await pg.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await pg.mouse.down(); await pg.mouse.move(a.x + 20, a.y, { steps: 3 }); await pg.mouse.move(z.x + z.width / 2, z.y + z.height / 2, { steps: 12 }); await pg.mouse.up(); }
        await pg.mouse.move(5, 500);
        const sysSel = () => pg.locator('button:visible:not([disabled])', { hasText: /^確定|我看完了|不選|確認補抽|完成補抽|準備完成|確認/ });
        let turns = 0;
        // 只放了一隻戰鬥寶可夢、沒有備戰 ⇒ 打太久會被 AI 打倒而輸掉；輪到我的第一個回合就停（對手先攻時已經出過牌）
        for (let w = 0; w < 200 && turns < 2; w++) {
          if ((await pg.locator('button:visible:not([disabled])', { hasText: '跳過攻擊' }).count()) > 0 && w > 10) {
            await pg.waitForTimeout(1500); turns++;
            const oppN = await pg.evaluate(() => Number(document.querySelector('[title="查看對手棄牌區"]')?.textContent?.match(/(\d+)/)?.[1] ?? 0));
            if (turns >= 2 || oppN > 0) break;
            const eb = pg.locator('button:visible:not([disabled])', { hasText: /結束回合|跳過攻擊/ }); if (await eb.count()) await eb.first().click({ timeout: 2000 }).catch(() => {});
          }
          const sb = sysSel(); if (await sb.count()) await sb.first().click({ timeout: 2000 }).catch(() => {});
          await pg.waitForTimeout(300);
        }
        // E1 棄牌頁籤（對手：AI 這兩回合用過物品）
        await pg.locator('[title="查看對手棄牌區"]').first().click({ force: true });
        await pg.waitForSelector('.discard-tab', { timeout: 5000 });
        const tabs = await pg.evaluate(() => [...document.querySelectorAll('.discard-tab')].map((b) => ({ t: b.textContent.replace(/\s+/g, ''), on: b.classList.contains('active') })));
        const names = () => pg.evaluate(() => [...document.querySelectorAll('.discard-modal .sel-card .sel-name')].map((e) => e.textContent));
        const all = await names();
        const per = {};
        for (const lab of ['寶可夢', '物品', '支援者', '道具', '競技場', '能量']) { await pg.locator('.discard-tab', { hasText: lab }).click(); await pg.waitForTimeout(120); per[lab] = await names(); }
        await pg.locator('.discard-modal .zoom-close').click(); await pg.waitForTimeout(200);
        await pg.locator('[title="查看對手棄牌區"]').first().click({ force: true }); await pg.waitForTimeout(250);
        const reopen = await pg.evaluate(() => document.querySelector('.discard-tab.active')?.textContent.replace(/\s+/g, ''));
        await pg.locator('.discard-modal .zoom-close').click(); await pg.waitForTimeout(200);
        const n = (t) => Number((tabs.find((x) => x.t.includes(t))?.t.match(/(\d+)$/) || [])[1]);
        const sumTabs = ['寶可夢', '物品', '支援者', '道具', '競技場', '能量'].reduce((s, k) => s + n(k), 0);
        const union = Object.values(per).flat();
        ok('[E1 前提] 輪到我、對手棄牌區有卡、對局還沒結束', turns >= 1 && all.length > 0, JSON.stringify({ turns, all }));
        ok('★★★ E1 棄牌區 7 個頁籤＋張數（各類加總＝全部）、每一類只顯示該類、合起來＝全部、重開回到「全部」',
          tabs.length === 7 && tabs[0].on && /^全部\d+$/.test(tabs[0].t) && sumTabs === n('全部') && union.length === all.length && union.slice().sort().join() === all.slice().sort().join() && /^全部/.test(reopen || ''),
          JSON.stringify({ tabs, per, reopen }));
        // E2 對局控制兩顆按鈕並排
        await pg.locator('.settings-chip').first().click(); await pg.waitForTimeout(400);
        const btns = await pg.evaluate(() => [...document.querySelectorAll('.restart-pair button')].map((b) => { const r = b.getBoundingClientRect(); return { t: b.textContent.trim(), d: b.disabled, top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width) }; }));
        ok('★★★ E2 對局控制：左「提議重新開局」、右「認輸並提議重新開局」，同一列並排、都可按',
          btns.length === 2 && /提議重新開局/.test(btns[0].t) && /認輸並提議重新開局/.test(btns[1].t) && btns[0].top === btns[1].top && btns[0].left < btns[1].left && btns.every((b) => !b.d && b.w > 100), JSON.stringify(btns));
        // E3 認輸（vs AI）⇒ 確認視窗 ⇒ 新局（回到開局、對戰紀錄重來）
        const logBefore = await pg.evaluate(() => document.querySelectorAll('.battle-log .log-entry, .log-line, .battle-log li').length);
        await pg.locator('.concede-restart-btn').click();
        await pg.waitForTimeout(3500);
        const after = await pg.evaluate(() => ({ turn: document.querySelector('.battle-header')?.textContent?.match(/回合\s*(\d+)/)?.[1] ?? null, over: !!document.querySelector('.gameover-modal') }));
        ok('★★★ E3 vs AI 認輸 ⇒ 先問確認、然後直接重新開局（回到第 1 回合、沒有卡在結算畫面）、頁面零錯誤',
          dialogs.some((m) => /認輸並重新開局/.test(m)) && after.turn === '1' && !after.over && errs.length === 0, JSON.stringify({ dialogs: dialogs.map((m) => m.slice(0, 20)), after, logBefore, errs: errs.slice(0, 2) }));
        await ctx.close();
      }
      // E4～E6：回放自動播放（匯入復盤檔）
      {
        const decks = [presetById(mod, '__preset_cynthia_garchomp__'), presetById(mod, '__preset_mbg__')];
        let rec = null, final = null;
        const agents = [(st, i) => mod.aiNew(st, pool, i), (st, i) => mod.aiNew(st, pool, i)];
        playGame({ mod, pool, decks, agents, seed: 3, firstPlayer: firstPlayerOf(3), onStep: (st, act, next) => { for (const g of [st, next]) { if (!g?.id) continue; if (!rec) rec = CUR.RR.createReplayRecorder(g.id); CUR.RR.recordStep(rec, g); if (g.phase === 'game-over') final = g; } } });
        const data = CUR.RR.finalizeReplay({ rec, finalState: final, online: false, seat: null, ai: true, revealOpp: false, appVersion: 'T', now: 1760000000000 });
        const f = join(tmp, 'a.ptcgreplay'); writeFileSync(f, await CUR.RS.gzipText(JSON.stringify(data)));
        const total = data.snapshots.length + 1;
        const open = async (vp) => {
          const ctx = await newCtx(vp);
          const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
          await pg.goto(`http://localhost:${port}/game`, { waitUntil: 'load' });
          await pg.waitForSelector('.mode-card:not([disabled])', { timeout: 60000 });
          await pg.waitForSelector('.replay-lobby', { timeout: 20000 });
          await pg.locator('.replay-lobby input[type=file]').setInputFiles(f);
          await pg.waitForSelector('.treplay-bar, .treplay-mob', { timeout: 30000 });
          await pg.waitForTimeout(500);
          return { ctx, pg, errs };
        };
        const { ctx, pg, errs } = await open({ width: 1600, height: 1000 });
        const cur = () => pg.evaluate(() => Number((document.querySelector('.treplay-step')?.textContent.match(/（(\d+)\/(\d+)）/) || [])[1]));
        const rng = () => pg.evaluate(() => Number(document.querySelector('.treplay-bar .treplay-range')?.value));
        const s0 = await cur();
        await pg.locator('.treplay-speed', { hasText: '4x' }).click();
        await pg.locator('.treplay-play').click();
        await pg.waitForTimeout(1700);
        const s1 = await cur(), playLbl = await pg.locator('.treplay-play').textContent();
        await pg.locator('.treplay-play').click();   // 暫停
        const s2 = await cur(); await pg.waitForTimeout(1200); const s3 = await cur();
        ok('★★★ E4 ▶ 4x 自動播放會一格一格前進；⏸ 暫停後停住；時間軸跟著走',
          s0 === 1 && s1 >= 4 && s1 <= 8 && /暫停/.test(playLbl) && s3 === s2 && (await rng()) === s3 - 1, JSON.stringify({ s0, s1, s2, s3, playLbl, total }));
        // E5 拖時間軸到中間 ⇒ 跳到那一格；播到最後一格自動停
        const mid = Math.floor(total / 2);
        await pg.locator('.treplay-bar .treplay-range').evaluate((el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, mid);
        await pg.waitForTimeout(250);
        const sMid = await cur();
        await pg.locator('.treplay-bar .treplay-range').evaluate((el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, total - 3);
        await pg.locator('.treplay-play').click();
        await pg.waitForTimeout(2500);
        const sEnd = await cur(), lblEnd = await pg.locator('.treplay-play').textContent();
        ok('★★★ E5 拖時間軸跳到指定格；播到最後一格自動停（按鈕回到 ▶）',
          sMid === mid + 1 && sEnd === total && /播放/.test(lblEnd), JSON.stringify({ sMid, mid, sEnd, total, lblEnd }));
        // E5b 在最後一格按 ▶ ⇒ 從頭播；播放中離開回放 ⇒ 不再前進、零錯誤
        await pg.locator('.treplay-play').click(); await pg.waitForTimeout(700);
        const sRestart = await cur();
        await pg.locator('.treplay-btn', { hasText: '離開' }).click(); await pg.waitForTimeout(1500);
        const gone = await pg.evaluate(() => !document.querySelector('.treplay-bar'));
        ok('★★ E5b 在最後一格按 ▶ 從頭播；播放中離開回放 ⇒ 回放列消失、零錯誤', sRestart >= 1 && sRestart <= 4 && gone && errs.length === 0, JSON.stringify({ sRestart, gone, errs: errs.slice(0, 2) }));
        await ctx.close();
        // E6 手機直式：回放列有 ▶、時間軸、速度；按 ▶ 會前進
        const m = await open({ width: 390, height: 844 });
        const mcur = () => m.pg.evaluate(() => Number((document.querySelector('.treplay-mob-step')?.textContent.match(/(\d+)\/(\d+)/) || [])[1]));
        const has = await m.pg.evaluate(() => {
          const bar = document.querySelector('.treplay-mob')?.getBoundingClientRect();
          const slots = [...document.querySelectorAll('.mp-opp-slot')].map((e) => e.getBoundingClientRect()).filter((r) => r.height > 0);
          const oppTop = slots.length ? Math.min(...slots.map((r) => r.top)) : null;
          return { play: !!document.querySelector('.treplay-mob-play'), range: !!document.querySelector('.treplay-mob .treplay-range'), speed: document.querySelector('.treplay-mob-speed')?.textContent,
            barH: bar ? Math.round(bar.height) : null, barBottom: bar ? Math.round(bar.bottom) : null, oppTop: oppTop == null ? null : Math.round(oppTop), sw: document.documentElement.scrollWidth,
            btnsMinH: Math.min(...[...document.querySelectorAll('.treplay-mob .treplay-mob-btn')].map((b) => b.getBoundingClientRect().height)) };
        });
        await m.pg.locator('.treplay-mob-speed').click(); await m.pg.locator('.treplay-mob-speed').click();   // 1x → 2x → 4x
        const sp = await m.pg.locator('.treplay-mob-speed').textContent();
        const m0 = await mcur(); await m.pg.locator('.treplay-mob-play').click(); await m.pg.waitForTimeout(1700); const m1 = await mcur();
        await m.pg.locator('.treplay-mob-play').click();
        ok('★★★ E6 手機直式：回放列單一列（不蓋到對手備戰區、按鈕仍 ≥40px）、有 ▶／時間軸／速度，按 ▶ 會前進，不撐出橫向捲動',
          has.play && has.range && has.speed === '1x' && sp === '4x' && m1 > m0 && has.sw <= 390 && m.errs.length === 0
          && has.oppTop != null && has.barBottom <= has.oppTop && has.barH <= 54 && has.btnsMinH >= 40, JSON.stringify({ has, sp, m0, m1 }));
        await m.ctx.close();
      }
    } finally { await browser.close(); srv.close(); try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
  }
}

console.log(`\n=== v6.582 棄牌分類／回放自動播放／認輸並提議重新開局：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
