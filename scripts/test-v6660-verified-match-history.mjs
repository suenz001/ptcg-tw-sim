// 本機測試：實跑上報 handler 與歷史逆轉，所有資料、憑證與 DB 都是測試替身。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { normEol } from './lib/eol-agnostic.mjs';
import { V6659_PAIRS, revertV6659IfPresent } from './lib/revert-v6659-profile-upgrades.mjs';
import { V6660_PAIRS, revertV6660IfPresent } from './lib/revert-v6660-profile-hardening.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const base = '9b7494b3269bd2369795a8bdb2d31e72e4ef3a60';
const path = 'oracle-admin/server_admin_patch.js';
const read = file => normEol(readFileSync(join(root, file), 'utf8'));
const source = read(path);
function section(input, start, end) {
  const a = input.indexOf(start);
  const b = input.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, '缺少守衛錨點 ' + start);
  return input.slice(a, b);
}

function createReportHarness(input) {
  const records = new Map();
  const identities = new Map();
  const room = {
    status: 'ended',
    seats: [{ uid: 'oracle1', email: ' WINNER@example.test ', deckId: 'seat-deck-1' },
      { uid: 'oracle2', email: 'opponent@example.test', deckId: 'seat-deck-2' }],
    gameState: { id: 'game1', phase: 'game-over', winner: 0, turn: 5, winReason: '拿完獎賞卡' },
  };
  let handler, lookups = 0, authChecks = 0, failRoomRead = false;
  const db = { collection(name) {
    if (name === 'rooms') return {
      async findOne(query, opts) {
        lookups++;
        const fields = Object.keys(opts.projection);
        assert.deepEqual(fields.sort(), [
          'gameState.id', 'gameState.phase', 'gameState.turn', 'gameState.winReason', 'gameState.winner',
          'seats.deckId', 'seats.email', 'seats.uid', 'status',
        ]);
        if (failRoomRead) throw Error('測試房間讀取失敗');
        if (query._id !== 'ABCD') return null;
        const project = (obj, prefix) => Object.fromEntries(fields.filter(field => field.startsWith(prefix))
          .map(field => field.slice(prefix.length)).map(key => [key, obj[key]]));
        return { status: room.status, seats: room.seats.map(seat => project(seat, 'seats.')),
          gameState: project(room.gameState, 'gameState.') };
      },
    };
    if (name === 'matchRecords') return {
      async updateOne(query, update) {
        const previous = records.get(query._id);
        const existingKeys = Object.keys(update.$setOnInsert || {});
        assert.ok(Object.keys(update.$set || {}).every(key => !existingKeys.includes(key)), 'Mongo 同欄位不能同時 set 和 setOnInsert');
        records.set(query._id, { ...(previous || update.$setOnInsert), ...update.$set });
        return { upsertedCount: Number(!previous) };
      },
    };
    if (name === 'playerIdentity') return {
      async updateOne(query, { $set }, opts) {
        assert.equal(opts.upsert, true);
        identities.set(query._id, $set);
      },
    };
    throw Error('非預期集合 ' + name);
  } };
  const validate = section(input, '    function mrValidateRecord(rec)', '    // >>> PTCG-PLAYER-IDENTITY-START');
  const sanitize = section(input, '  const DECK_ID_RE =', '  // ⭐v6.276');
  const identity = section(input, '    function recordPlayerIdentity(', '    // <<< PTCG-PLAYER-IDENTITY-END');
  const verify = input.includes('    async function verifyProfileMatchWinner')
    ? section(input, '    async function verifyProfileMatchWinner', '    // <<< v6660-verified-profile-win') : '';
  const handlerCode = section(input, "    app.post('/api/match-result'", "    app.get('/api/admin/match-records'");
  const install = new Function('app', 'db', 'adminAuth', 'mrRateLimitCheck', 'mrReadJsonBody', 'console',
    [sanitize, validate, identity, verify, handlerCode].join('\n'));
  install({ post(_route, fn) { handler = fn; } }, db, { async verifyIdToken(token) {
    authChecks++;
    if (token === 'member') return { email: 'Winner@Example.test', firebase: { sign_in_provider: 'password' } };
    return { email: 'opponent@example.test', firebase: { sign_in_provider: 'password' } };
  } }, () => true, (req) => req.body, { log() {}, warn() {} });
  return { room, records, identities, lookups: () => lookups, authChecks: () => authChecks,
    failRoomRead() { failRoomRead = true; },
    async report({ authorization, ...patch } = {}) {
      const body = { matchId: 'game1', roomCode: 'ABCD', winner: 0, endedAt: 5, finalTurn: 5, mode: 'online',
        p1: { name: '甲', cardCounts: {} }, p2: { name: '乙', cardCounts: {} }, ...patch };
      let status = 200;
      await handler({ headers: authorization ? { authorization } : {}, body }, {
        status(n) { status = n; return this; },
        json() {},
      });
      assert.equal(status, 200, '一般上報功能維持可用');
      return records.get(body.matchId);
    },
  };
}

async function assertConfirmed(input) {
  const h = createReportHarness(input);
  const initial = await h.report();
  assert.equal(initial.profileVerifiedWinner, undefined, '原戰報可入庫，名片勝場須驗證');
  assert.equal(initial.p1.email, 'winner@example.test', '線上玩家身分由房間提供並轉小寫');
  const confirmed = await h.report({ authorization: 'Bearer member', finalTurn: 99, winReason: '客戶端摘要' });
  assert.equal(confirmed.profileVerifiedWinner, 'winner@example.test', '已核實勝方應在既有戰報補記');
  assert.equal(confirmed.finalTurn, 5, '核實後採用房間回合');
  assert.equal(confirmed.winReason, '拿完獎賞卡', '核實後採用房間原因');
  assert.equal(h.records.size, 1, '兩次上報只會留一筆');
  assert.equal(h.lookups(), 2, '每次上報最多一次房間查詢');
  assert.equal(h.authChecks(), 1, '沒有憑證的上報不跑驗證');
}

await assertConfirmed(source);
async function assertSeatEnrichment(input) {
  const h = createReportHarness(input);
  const initial = await h.report({ p1: { name: '甲', email: 'client@example.test', cardCounts: {} } });
  assert.equal(initial.p1.email, 'winner@example.test');
  assert.equal(initial.p1.deckId, 'seat-deck-1');
  assert.equal(initial.p2.deckId, 'seat-deck-2');
  assert.equal(h.identities.get('winner@example.test')?.uid, 'oracle1');
  assert.equal(h.identities.get('opponent@example.test')?.uid, 'oracle2');
  assert.equal(h.lookups(), 1, '牌組與身分補齊共用原房間查詢');

  h.room.seats[1].deckId = 'bad';
  const own = { name: '甲', email: 'client@example.test', deckId: 'client-deck-1', cardCounts: {} };
  const withOwnDeck = await h.report({ matchId: 'own', p1: own });
  assert.equal(withOwnDeck.p1.deckId, 'client-deck-1');
  assert.ok(!Object.hasOwn(withOwnDeck.p2, 'deckId'));

  h.failRoomRead();
  const failed = await h.report({ matchId: 'failed', p1: { ...own, deckId: 'bad' } });
  assert.equal(failed.p1.email, null);
  assert.ok(!Object.hasOwn(failed.p1, 'deckId') && !Object.hasOwn(failed.p2, 'deckId'));
  assert.equal(h.lookups(), 3, '失敗時亦只查一次');
}
await assertSeatEnrichment(source);
const withoutIdentity = source.replace(/if \(typeof recordPlayerIdentity === 'function'\) recordPlayerIdentity\(db, _st, [^\n]+\);/, '');
assert.notEqual(withoutIdentity, source);
await assert.rejects(() => assertSeatEnrichment(withoutIdentity), { name: 'AssertionError' });
const withoutIdProjection = source.replace("'gameState.id': 1, 'gameState.phase':", "'gameState.phase':");
assert.notEqual(withoutIdProjection, source);
await assert.rejects(() => assertConfirmed(withoutIdProjection), { name: 'AssertionError' });
console.log('PASS 現行房間補齊、牌組相容、身分對照、接線與 Mongo 投影突變');

const gameSource = read('src/routes/game/+page.svelte');
const clientReporter = section(gameSource, '  async function fireMatchRecord(', "  // ");
// 取完整函式，保留實際送往既有端點的 payload。測試替身直接交給本機 handler。
const nextFunction = gameSource.indexOf('\n  }', gameSource.indexOf(clientReporter));
assert.ok(nextFunction > 0);
const reportFunction = gameSource.slice(gameSource.indexOf(clientReporter), nextFunction + '\n  }'.length)
  .replace(/    const apiUrl = [^\n]+/, "    const apiUrl = 'https://example.test';");
const reporter = transformSync(reportFunction, { loader: 'ts' }).code;
const hClient = createReportHarness(source);
const emptySide = { name: '測試', deck: [], hand: [], bench: [], active: null, discard: [], prizes: [] };
const storedGame = { ...hClient.room.gameState, players: [emptySide, emptySide] };
const callClient = new Function('mode', 'roomData', 'roomCode', 'firebaseUser', 'aiPlayerIndex', 'gameClockNow', 'fetch',
  reporter + '\nreturn fireMatchRecord;');
const fromClient = callClient('online', hClient.room, 'ABCD', null, 1, () => 5, async (_url, opts) => {
  const body = JSON.parse(opts.body);
  assert.equal(body.vsAI, false, '新開頁面的預設 AI 座位不應污染線上資料');
  assert.equal(body.aiSide, null);
  await hClient.report({ ...body, authorization: opts.headers.Authorization });
});
await fromClient(storedGame, { getIdToken: () => Promise.resolve('member') });
assert.equal(hClient.records.get('game1')?.profileVerifiedWinner, 'winner@example.test', '前端預設狀態必須能送到後端核實');
console.log('PASS 預設 AI 座位下的真人線上前後端串接');
for (const [label, body, mutateRoom] of [
  ['找不到房間', { roomCode: 'OTHER' }],
  ['不同對局', { matchId: 'earlier' }],
  ['非勝方憑證', { authorization: 'Bearer opponent' }],
  ['本機雙人', { mode: 'local' }],
  ['AI', { vsAI: true }],
  ['首回合未進場', {}, room => { room.gameState.turn = 1; room.gameState.winReason = '無回應'; }],
  ['房間未完成', {}, room => { room.status = 'playing'; }],
  ['不同勝方', { winner: 1 }],
]) {
  const h = createReportHarness(source);
  mutateRoom?.(h.room);
  assert.equal((await h.report({ authorization: 'Bearer member', ...body })).profileVerifiedWinner, undefined, label);
}
console.log('PASS 正常線上終局與八種排除案例');

const withoutGameCheck = source.replace("state.id !== doc._id || state.winner", 'state.winner');
assert.notEqual(withoutGameCheck, source);
const diagnostic = createReportHarness(withoutGameCheck);
assert.equal((await diagnostic.report({ matchId: 'earlier', authorization: 'Bearer member' })).profileVerifiedWinner, 'winner@example.test');
const withoutToken = source.replace('if (!email || !token || !Number.isInteger', 'if (!email || !Number.isInteger');
assert.notEqual(withoutToken, source);
const tokenDiagnostic = createReportHarness(withoutToken);
await tokenDiagnostic.report();
assert.equal(tokenDiagnostic.authChecks(), 1, '無憑證照查代表早退守衛拿掉後會被計數偵測');
console.log('PASS 對局 ID 與無憑證早退突變');

if (hasBaseCommit(root, base)) {
  for (const file of Object.keys(V6660_PAIRS)) {
    const original = readBaseBlob(root, base, file);
    assert.ok(original.ok, file);
    assert.equal(revertV6660IfPresent(file, read(file)), normEol(original.out), file);
  }
  const old = normEol(readBaseBlob(root, base, path).out);
  await assert.rejects(() => assertConfirmed(old), { name: 'AssertionError' });
  const [from] = V6659_PAIRS[path][0];
  assert.throws(() => revertV6659IfPresent(path, old.replace(from, '[部分歷史錨點損毀]')), /v6659 還原錨點缺失/);
  assert.throws(() => revertV6659IfPresent(path, old.replace(from, () => from + from)), /v6659 inverse/);
  console.log('PASS 精確還原、舊版反證、缺失與重複錨點');
} else {
  shallowSkip('v6.660 歷史反證', '需要 v6.659 歷史 commit');
}
