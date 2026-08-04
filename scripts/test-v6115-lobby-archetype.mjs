// v6.115 守衛：大廳「對戰中的房間」顯示牌組原型名稱。
//
// Wilson：「不用顯示獎賞卡和寶可夢，只要去比對雙方玩家的牌庫內容，是屬於我在 admin 裡面
// 設定的符合哪一套牌組原型，然後就能判斷玩家是用什麼牌組在玩。」
//
// 這一版的風險全在「什麼東西會離開伺服器」與「什麼時候可以看到」，所以守衛分三塊：
//   A. 端點實跑：只回名稱字串，牌表／手牌／牌庫一律不出去（白名單建構）
//   B. 兩條時機限制 —— 等待中的房間不給（牌組狙擊）、開局放置階段不給（對手還看不到你的場面）
//   C. UI 端不得繞過伺服器自己碰牌表，且大廳排版與既有功能不得退化
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PATCH = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');
const PAGE = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8');
const OCLIENT = readFileSync(join(ROOT, 'src/lib/game/oracle-client.ts'), 'utf8');

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); console.log('  \u2713 ' + name); pass++; }
  catch (e) { console.log('  \u2717 ' + name + '\n      ' + (e && e.message)); fail++; }
}
async function TA(name, fn) {
  try { await fn(); console.log('  \u2713 ' + name); pass++; }
  catch (e) { console.log('  \u2717 ' + name + '\n      ' + (e && e.message)); fail++; }
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }

/** 用大括號配對把「_roomArchCache 宣告 + app.get 註冊」整段抽出來（不寫死行數）。 */
function extractEndpoint() {
  const start = PATCH.indexOf('const _roomArchCache = new Map();');
  if (start < 0) return null;
  const g = PATCH.indexOf("app.get('/api/rooms-archetypes'", start);
  if (g < 0) return null;
  let i = PATCH.indexOf('{', g), depth = 0, end = -1;
  for (; i < PATCH.length; i++) {
    const c = PATCH[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return null;
  const close = PATCH.indexOf(');', end);
  return PATCH.slice(start, close + 2);
}
const EP_SRC = extractEndpoint();

/** 把抽出來的原始碼實跑一次，回傳 res.json 收到的東西。 */
async function runEndpoint(query, roomDocs, opts) {
  ok(EP_SRC, '\u62bd\u4e0d\u51fa\u7aef\u9ede\u539f\u59cb\u78bc');
  const o = opts || {};
  let handler = null;
  const app = { get: (_p, h) => { handler = h; } };
  const db = {
    collection: () => ({
      find: (filter, proj) => {
        db._lastFilter = filter; db._lastProj = proj;
        const ids = (filter && filter._id && filter._id.$in) || [];
        return { toArray: async () => roomDocs.filter(d => ids.includes(d._id) && d.status === filter.status) };
      },
    }),
  };
  const nameMap = new Map(o.emptyNameMap ? [] : [['1', '\u7d22\u7f85\u4e9e\u514bex'], ['2', '\u53cc\u5507\u9f8d'], ['9', '\u57fa\u672c\u3010\u60e1\u3011\u80fd\u91cf']]);
  const getCardNameMap = async () => nameMap;
  const TRULES = { find: () => ({ sort: () => ({ toArray: async () => (o.noRules ? [] : [
    { _id: 'r1', name: '\u7d22\u7f85\u4e9e\u514bex', includes: ['\u7d22\u7f85\u4e9e\u514bex'], enabled: true, priority: 1 },
  ]) }) }) };
  const deckToSets = (entries, nm) => {
    const ids = new Set(), names = new Set();
    for (const e of (entries || [])) { const id = String(e.cardId); ids.add(id); const n = nm.get(id); if (n) names.add(n); }
    return { ids, names };
  };
  const classifyDeck = (sets, rules) => {
    const all = rules.filter(r => (r.includes || []).every(n => sets.names.has(n)));
    return { rule: all[0] || null, all };
  };
  // v6.119：端點改用 getEnabledRulesCached()（TRULES 查詢加了 30s TTL），一起注入。
  const getEnabledRulesCached = async () => await TRULES.find().sort().toArray();
  const fn = new Function('app', 'db', 'getCardNameMap', 'TRULES', 'classifyDeck', 'deckToSets', 'getEnabledRulesCached', EP_SRC);
  fn(app, db, getCardNameMap, TRULES, classifyDeck, deckToSets, getEnabledRulesCached);
  ok(typeof handler === 'function', '\u7aef\u9ede\u6c92\u6709\u8a3b\u518c handler');
  let out = null, code = 200;
  const res = { json: (x) => { out = x; return res; }, status: (c) => { code = c; return res; } };
  await handler({ query }, res);
  return { out, code, filter: db._lastFilter, proj: db._lastProj };
}

const deckZoro = [{ cardId: '1', count: 4 }, { cardId: '9', count: 8 }];
const deckOther = [{ cardId: '2', count: 4 }, { cardId: '9', count: 8 }];
const playingRoom = (id, phase) => ({
  _id: id, status: 'playing',
  seats: [{ deckEntries: deckZoro }, { deckEntries: deckOther }],
  gameState: { phase },
});

console.log('\u2460 \u7aef\u9ede\u5be6\u8dd1\uff1a\u53ea\u56de\u540d\u7a31\u5b57\u4e32');

await TA('\u2b50 \u5c0d\u6230\u4e2d\u623f\u9593\u56de\u96d9\u65b9\u724c\u7d44\u540d\u7a31', async () => {
  const { out } = await runEndpoint({ ids: 'A1B2' }, [playingRoom('A1B2', 'playing')]);
  ok(out && out.rooms, '\u6c92\u6709\u56de rooms');
  ok(out.rooms.A1B2, '\u627e\u4e0d\u5230 A1B2');
  ok(out.rooms.A1B2.p1 === '\u7d22\u7f85\u4e9e\u514bex', 'p1 \u61c9\u70ba\u7d22\u7f85\u4e9e\u514bex\uff0c\u5be6\u5f97 ' + out.rooms.A1B2.p1);
  ok(out.rooms.A1B2.p2 === '\u672a\u5206\u985e', '\u898f\u5247\u6c92\u547d\u4e2d\u61c9\u70ba\u300c\u672a\u5206\u985e\u300d\uff0c\u5be6\u5f97 ' + out.rooms.A1B2.p2);
});

await TA('\u2b50\u2b50 \u56de\u61c9\u88e1\u4e0d\u53ef\u80fd\u593e\u5e36\u724c\u8868\uff0f\u624b\u724c\uff0f\u724c\u5eab', async () => {
  const { out } = await runEndpoint({ ids: 'A1B2' }, [playingRoom('A1B2', 'playing')]);
  const j = JSON.stringify(out);
  for (const k of ['deckEntries', 'cardId', 'seats', 'hand', 'deck', 'gameState']) {
    ok(!j.includes(k), '\u56de\u61c9\u88e1\u51fa\u73fe\u4e86 ' + k + '\uff1a' + j.slice(0, 200));
  }
  ok(Object.keys(out.rooms.A1B2).join(',') === 'p1,p2',
    '\u56de\u61c9\u53ea\u80fd\u6709 p1/p2\uff08\u767d\u540d\u55ae\u5efa\u69cb\uff09\uff0c\u5be6\u5f97 ' + Object.keys(out.rooms.A1B2));
});

console.log('\u2461 \u5169\u689d\u6642\u6a5f\u9650\u5236\uff08\u771f\u6d29\u6f0f\u8def\u5f91\uff09');

await TA('\u2b50\u2b50 \u958b\u5c40\u653e\u7f6e\uff08setup\uff09\u968e\u6bb5\u4e0d\u56de\u2014\u2014\u90a3\u6642\u5c0d\u624b\u9084\u770b\u4e0d\u5230\u4f60\u7684\u5834\u9762', async () => {
  const { out } = await runEndpoint({ ids: 'A1B2' }, [playingRoom('A1B2', 'setup')]);
  ok(!out.rooms.A1B2,
    'setup \u968e\u6bb5\u5c31\u5831\u51fa\u724c\u7d44\u4e86\u2014\u2014\u73a9\u5bb6\u53ea\u8981\u53e6\u958b\u4e00\u500b\u5206\u9801\u770b\u5927\u5ef3\uff0c\u5c31\u80fd\u4f9d\u5c0d\u624b\u724c\u7d44\u6c7a\u5b9a\u81ea\u5df1\u7684\u958b\u5c40\u7b56\u7565');
});

await TA('\u2b50\u2b50 \u7b49\u5f85\u4e2d\uff08lobby\uff09\u7684\u623f\u9593\u62ff\u4e0d\u5230\uff08\u724c\u7d44\u72d9\u64ca\uff09', async () => {
  const lobby = { ...playingRoom('C3D4', 'playing'), status: 'lobby' };
  const { out, filter } = await runEndpoint({ ids: 'C3D4' }, [lobby]);
  ok(filter && filter.status === 'playing', '\u67e5\u8a62\u6c92\u6709\u9650\u5b9a status===playing\uff1a' + JSON.stringify(filter));
  ok(!out.rooms.C3D4, '\u7b49\u5f85\u4e2d\u7684\u623f\u9593\u4e0d\u5f97\u56de\u724c\u7d44\u540d\u7a31');
});

await TA('\u6b63\u5c0d\u7167\uff1a\u4e0a\u9762\u5169\u689d gate \u4e0d\u662f\u300c\u4ec0\u9ebc\u90fd\u4e0d\u56de\u300d', async () => {
  const { out } = await runEndpoint({ ids: 'A1B2,C3D4' },
    [playingRoom('A1B2', 'playing'), playingRoom('C3D4', 'playing')]);
  ok(out.rooms.A1B2 && out.rooms.C3D4, '\u5169\u9593\u6b63\u5e38\u5c0d\u6230\u4e2d\u7684\u623f\u90fd\u8a72\u6709\u7d50\u679c');
});

console.log('\u2462 \u908a\u754c\u8207\u9632\u5446');

await TA('\u898f\u5247\u5eab\u6c92\u8f09\u5165 / \u7121\u724c\u8868 \u2192 \u56de null\uff08\u4e0d\u80fd\u8b8a\u6210\u300c\u672a\u5206\u985e\u300d\uff09', async () => {
  const r1 = await runEndpoint({ ids: 'A1B2' }, [playingRoom('A1B2', 'playing')], { noRules: true });
  ok(r1.out.rooms.A1B2.p1 === null,
    '\u898f\u5247\u5eab\u7a7a\u7684\u6642\u5019\u8b8a\u6210\u300c\u672a\u5206\u985e\u300d\u6703\u8b93\u6574\u500b\u5927\u5ef3\u8b8a\u672a\u5206\u985e\uff0c\u61c9\u8a72\u56de null \u8b93 UI \u4e0d\u986f\u793a');
  const noDeck = { _id: 'A1B2', status: 'playing', seats: [{ deckEntries: [] }, {}], gameState: { phase: 'playing' } };
  const r2 = await runEndpoint({ ids: 'A1B2' }, [noDeck]);
  ok(r2.out.rooms.A1B2.p1 === null && r2.out.rooms.A1B2.p2 === null, '\u6c92\u724c\u8868\u61c9\u56de null');
});

await TA('ids \u53c3\u6578\u6703\u88ab sanitize\uff08\u9632\u6ce8\u5165 / \u9632\u4e00\u6b21\u62c9\u5168\u90e8\u623f\u9593\uff09', async () => {
  const { out } = await runEndpoint({ ids: '' }, []);
  ok(out && out.rooms && Object.keys(out.rooms).length === 0, '\u7a7a ids \u61c9\u56de\u7a7a\u7269\u4ef6');
  const bad = await runEndpoint({ ids: "A1B2,{$ne:null},../../etc,VERYLONGROOMCODE" }, [playingRoom('A1B2', 'playing')]);
  const asked = (bad.filter && bad.filter._id && bad.filter._id.$in) || [];
  ok(asked.every(x => /^[A-Z0-9]{1,8}$/.test(x)), '\u6c92\u6709\u904e\u6ffe\u6389\u7570\u5e38 id\uff1a' + JSON.stringify(asked));
});

T('\u2b50 \u7aef\u9ede\u4e0d\u5f97\u6389\u9032 admin \u6b0a\u9650\uff08\u5927\u5ef3\u6240\u6709\u4eba\u90fd\u8981\u7528\uff09\u4f46\u4e5f\u4e0d\u5f97\u56de\u724c\u8868', () => {
  ok(EP_SRC, '\u62bd\u4e0d\u51fa\u7aef\u9ede');
  ok(!/requireFirebaseAdmin/.test(EP_SRC), '\u9019\u662f\u5927\u5ef3\u516c\u958b\u7aef\u9ede\uff0c\u4e0d\u80fd\u6389 admin \u6b0a\u9650');
  ok(/projection:/.test(EP_SRC), '\u67e5\u8a62\u6c92\u6709 projection\uff0c\u6703\u628a\u6574\u4efd\u623f\u9593\uff08\u542b\u96d9\u65b9\u624b\u724c\uff09\u62c9\u9032\u8a18\u61b6\u9ad4');
});

T('\u7aef\u9ede\u8a9e\u6cd5\u6b63\u78ba\uff08patch \u6574\u4efd\u53ef parse\uff09', () => {
  // node --check \u5df2\u5728 CI \u7684 lint \u968e\u6bb5\u8dd1\uff1b\u9019\u88e1\u81f3\u5c11\u78ba\u4fdd\u62bd\u53d6\u51fa\u4f86\u7684\u90a3\u6bb5\u80fd\u88ab\u7de8\u8b6f
  ok(EP_SRC && EP_SRC.length > 500, '\u7aef\u9ede\u539f\u59cb\u78bc\u592a\u77ed\uff0c\u53ef\u80fd\u62bd\u932f\u4e86');
  new Function('app', 'db', 'getCardNameMap', 'TRULES', 'classifyDeck', 'deckToSets', 'getEnabledRulesCached', EP_SRC);
});

console.log('\u2463 UI \u7aef');

function sliceBetween(text, startNeedle, endNeedle) {
  const i = text.indexOf(startNeedle);
  if (i < 0) return null;
  const j = text.indexOf(endNeedle, i + startNeedle.length);
  return text.slice(i, j < 0 ? text.length : j);
}

T('\u2b50\u2b50 \u7b49\u5f85\u4e2d\u7684\u623f\u9593\u5340\u584a\u4e0d\u5f97\u51fa\u73fe\u4efb\u4f55\u724c\u7d44\u8cc7\u8a0a', () => {
  const blk = sliceBetween(PAGE, '{#each lobbyRooms as r (r.roomId)}', '{#each playingRooms as r (r.roomId)}');
  ok(blk, '\u627e\u4e0d\u5230 lobbyRooms \u5340\u584a');
  ok(blk.length < 4000, 'lobbyRooms \u5340\u584a\u622a\u5f97\u592a\u5927\uff08' + blk.length + '\uff09\uff0canchor \u53ef\u80fd\u5931\u6548');
  for (const bad of ['roomArchetypes', 'deckEntries', 'gameState', 'or-arch']) {
    ok(!blk.includes(bad), '\u7b49\u5f85\u4e2d\u7684\u623f\u9593\u51fa\u73fe\u4e86 ' + bad + ' \u2014\u2014 \u724c\u7d44\u72d9\u64ca');
  }
});

T('\u6b63\u5c0d\u7167\uff1a\u5c0d\u6230\u4e2d\u5340\u584a\u78ba\u5be6\u6709\u63a5\u4e0a\u724c\u7d44\u540d\u7a31', () => {
  const blk = sliceBetween(PAGE, '{#each playingRooms as r (r.roomId)}', '</ul>');
  ok(blk, '\u627e\u4e0d\u5230 playingRooms \u5340\u584a');
  ok(blk.includes('roomArchetypes[r.roomId]'), '\u5c0d\u6230\u4e2d\u5340\u584a\u6c92\u63a5\u724c\u7d44\u540d\u7a31 \u21d2 \u9019\u529f\u80fd\u6839\u672c\u6c92\u4e0a');
  ok(blk.includes('or-arch'), '\u6c92\u6709\u724c\u7d44\u540d\u7a31\u7684\u6a23\u5f0f\u985e\u5225');
  for (const bad of ['deckEntries', 'r.gameState', '.hand', '.deck']) {
    ok(!blk.includes(bad), 'UI \u76f4\u63a5\u78b0\u4e86 ' + bad + ' \u2014\u2014 \u724c\u8868\u53ea\u80fd\u7559\u5728\u4f3a\u670d\u5668');
  }
});

T('\u2b50 \u524d\u7aef\u4e0d\u80fd\u8ddf\u8457\u5927\u5ef3\u6bcf 2 \u79d2\u8f2a\u8a62\u4e00\u8d77\u653e\u5927\u8ca0\u8f09', () => {
  const i = PAGE.indexOf('async function ensureRoomArchetypes');
  ok(i > 0, '\u627e\u4e0d\u5230 ensureRoomArchetypes');
  const fn = PAGE.slice(i, i + 1400);
  ok(/if \(!ORACLE_MODE\) return;/.test(fn), '\u6c92\u6709 ORACLE_MODE gate\uff08\u6e2c\u8a66\u7ad9\u6839\u672c\u6c92\u9019\u500b\u7aef\u9ede\uff09');
  ok(/_archAskedAt/.test(fn), '\u6c92\u6709\u300c\u554f\u904e\u5c31\u4e0d\u91cd\u554f\u300d\u7684\u7bc0\u6d41');
  ok(/!roomArchetypes\[r\.roomId\]/.test(fn), '\u6c92\u6709\u8df3\u904e\u5df2\u6709\u7d50\u679c\u7684\u623f\u9593');
  ok(/catch/.test(fn), '\u62ff\u4e0d\u5230\u6642\u5fc5\u9808 fail-open\uff0c\u4e0d\u80fd\u9023\u5e36\u5f04\u58de\u5927\u5ef3');
});

T('\u2b50 oracle-client \u7684 helper \u4e0d\u5f97\u628a null \u7576\u6210\u300c\u672a\u5206\u985e\u300d', () => {
  ok(/export async function oracleRoomArchetypes/.test(OCLIENT), '\u627e\u4e0d\u5230 oracleRoomArchetypes');
  const i = OCLIENT.indexOf('export async function oracleRoomArchetypes');
  const fn = OCLIENT.slice(i - 700, i + 700);
  ok(/\u672a\u5206\u985e/.test(fn), 'helper \u7684\u8a3b\u89e3\u6c92\u8b1b\u6e05\u695a\u5169\u7a2e\u300c\u6c92\u6709\u300d\u7684\u5dee\u5225');
});

console.log('\u2464 \u820a\u7248\u5834\u9762\u5361\u5716\u5df2\u79fb\u9664\uff0c\u5927\u5ef3\u6392\u7248\u8207\u65e2\u6709\u529f\u80fd\u4e0d\u5f97\u9000\u5316');

T('v6.114 \u7684\u8ff7\u4f60\u5834\u9762\u5217\u5df2\u5b8c\u5168\u62ff\u6389\uff08Wilson\uff1a\u4e0d\u7528\u986f\u793a\u734e\u8cde\u5361\u548c\u5bf6\u53ef\u5922\uff09', () => {
  for (const gone of ['buildLobbyFieldPreview', 'lobbyCardImageUrl', 'or-field', 'or-prize" ', 'benchCardIds']) {
    ok(!PAGE.includes(gone), '\u9084\u6709\u6b98\u7559\uff1a' + gone);
  }
});

T('\u2b50 \u6bcf\u4e00\u884c\u90fd\u8981 flex-wrap\uff1b\u624b\u6a5f\u89e3\u9664\u6e05\u55ae\u5167\u6efe\u52d5', () => {
  for (const cls of ['.or-main', '.or-meta']) {
    const i = PAGE.indexOf('  ' + cls + '{');
    ok(i > 0, '\u627e\u4e0d\u5230 ' + cls);
    ok(/flex-wrap:\s*wrap/.test(PAGE.slice(i, i + 220)), cls + ' \u6c92\u6709 flex-wrap:wrap');
  }
  const m = PAGE.indexOf('@media (max-width:600px){');
  ok(m > 0, '\u627e\u4e0d\u5230\u5927\u5ef3\u7684\u624b\u6a5f media query');
  const win = PAGE.slice(m, m + 400);
  ok(/\.open-room-list\{[^}]*max-height:\s*none/.test(win) && /overflow-y:\s*visible/.test(win),
    '\u624b\u6a5f\u6c92\u89e3\u9664\u6e05\u55ae\u5167\u6efe\u52d5');
});

T('\u65e2\u6709\u529f\u80fd\u90fd\u9084\u5728', () => {
  for (const [needle, what] of [
    ['or-practice-tag', '\u7df4\u7fd2\u623f\u6a19\u7c64'],
    ['or-waiting-tag', '\u7b49\u5f85\u958b\u6230\u6a19\u7c64'],
    ['hostPresence(r)', '\u623f\u4e3b\u5728\u7dda\u72c0\u614b'],
    ['fmtRoomAge(r.createdAt)', '\u623f\u9f61'],
    ['\u623f\u865f {r.roomId}', '\u623f\u865f\u986f\u793a'],
    ['\u7528\u623f\u865f\u624b\u52d5\u52a0\u5165', '\u624b\u52d5\u623f\u865f\u52a0\u5165'],
    ['spectator-btn', '\u89c0\u6230\u9215'],
  ]) ok(PAGE.includes(needle), what + ' \u4e0d\u898b\u4e86');
});

console.log('\n=== v6.115 \u5927\u5ef3\u724c\u7d44\u539f\u578b\u6a19\u7c64\uff1aPASS ' + pass + ' / FAIL ' + fail + ' ===');
if (fail > 0) process.exit(1);
