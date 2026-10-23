import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extractBaseArchive, linkBaseModules } from './lib/base-archive.mjs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parse } from 'acorn';
import { runInNewContext } from 'node:vm';
import { transform } from 'esbuild';
import { createHash } from 'node:crypto';
import { revertAdminV173 } from './lib/sap-revert-admin-v173.mjs';
import { NEW_TAIL_SHA_V173, NEW_TEV_SHA_V173, NEW_TEV_LEN_V173, revertV173 } from './lib/tourn-revert-v173.mjs';
import { hasBaseCommit, readBaseBlob, shallowSkip } from './lib/base-blob.mjs';
import { revertV6592Game, V6592_GAME_PAIRS } from './lib/revert-v6592-game.mjs';
import { revertV6595Game } from './lib/revert-v6595-game.mjs';   // ⭐v6.595（Rule 40）：對戰頁先還原 v6.595 再驗 v6.592 的六組還原
import { normEol } from './lib/eol-agnostic.mjs';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const src = readFileSync(join(ROOT, 'oracle-admin/server_admin_patch.js'), 'utf8');
const ast = parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
const routes = new Map(); let actionFn;
function walk(n) {
  if (!n || typeof n !== 'object') return;
  if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && n.callee.object.name === 'app') {
    const name = n.arguments[0]?.value;
    if (name === '/api/tourn-player-clock') routes.set(n.callee.property.name, src.slice(n.arguments[1].start, n.arguments[1].end));
  }
  if (n.type === 'FunctionDeclaration' && n.id.name === 'tActionApplyOnce') actionFn = src.slice(n.start, n.end);
  for (const value of Object.values(n)) if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === 'object') walk(value);
}
walk(ast);
let passed = 0;
async function test(name, fn) { await fn(); console.log('PASS ' + name); passed++; }
async function invoke(method, { admin = true, runtime = {}, body } = {}) {
  let status = 200, result;
  const res = { status(n) { status = n; return this; }, json(v) { result = v; return this; }, set() { return this; } };
  const fn = runInNewContext('(' + routes.get(method) + ')', { tournIdentity: async () => ({ uid: 'test' }),
    isTournAdmin: () => admin, playerClockRuntime: runtime });
  await fn({ body }, res); return { status, result };
}
await test('GET/POST非admin都403，設定無副作用', async () => {
  for (const method of ['get', 'post']) assert.equal((await invoke(method, { admin: false })).status, 403);
});
await test('缺新版server engine明確503，不假裝可用', async () => {
  for (const method of ['get', 'post']) assert.equal((await invoke(method, { runtime: null })).status, 503);
});
await test('GET讀取故障回503，不能顯示假關閉', async () => {
  const r = await invoke('get', { runtime: { refresh: async () => {}, ready: () => false } }); assert.equal(r.status, 503);
});
await test('GET傳遞預設OFF與15分鐘', async () => {
  const r = await invoke('get', { runtime: { refresh: async () => {}, ready: () => true, currentPolicy: () => ({ enabled: false, minutes: 15 }) } });
  assert.equal(r.status, 200); assert.equal(r.result.policy.enabled, false); assert.equal(r.result.policy.minutes, 15);
});
await test('POST實際傳遞admin開關與18分鐘，再觸發同步', async () => {
  let saved, refreshed = false;
  const r = await invoke('post', { body: { enabled: true, minutes: 18 }, runtime: {
    configure: async (enabled, minutes) => (saved = { enabled, minutes }), refresh: async () => { refreshed = true; },
  } });
  assert.equal(r.result.ok, true); assert.deepEqual(saved, { enabled: true, minutes: 18 }); assert.equal(refreshed, true);
});
await test('POST無效設定回400，沒有假成功', async () => {
  const r = await invoke('post', { body: { enabled: true, minutes: 0 }, runtime: { configure: async () => { throw new Error('invalid'); } } });
  assert.equal(r.status, 400); assert.equal(r.result.ok, undefined);
});
await test('真人動作的盤面與時計同一筆CAS保存，寫入成功後才remember', async () => {
  let saved, remembered = 0, calculated = 0;
  const old = { phase: 'playing' }, next = { phase: 'playing', changed: true };
  const ctx = { _actDupHit: () => false, _actRingPush: () => [], playerClockRuntime: {
    calculate(doc, g) { assert.equal(g, next); calculated++; return { spent: [1000, 0], stalled: [true, false] }; },
    remember(doc, c) { assert.ok(saved); assert.equal(c, saved.playerClock); remembered++; },
  } };
  const fn = runInNewContext('(' + actionFn + ')', ctx);
  const result = await fn({ matchId: 'm', version: 2, gameState: old }, 0, '', {
    reload: async () => null, canAct: () => true, applyAction: () => next, actorSeat: () => 1, now: () => 2000,
    cas: async (v, set) => { assert.equal(v, 2); saved = set; return { matchedCount: 1 }; },
  });
  assert.equal(result.kind, 'applied'); assert.equal(saved.gameState, next); assert.equal(saved.version, 3);
  assert.deepEqual(Array.from(saved.playerClock.stalled), [false, false]); assert.equal(calculated, 1); assert.equal(remembered, 1);
});
await test('clock新鮮度採納拒絕舊版本、舊政策及晚到舊關閉前回應', async () => {
  const page = normEol(readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8'));
  const start = page.indexOf('  function adoptPlayerClock('), end = page.indexOf('\n  }', start) + 4;
  assert.ok(start >= 0 && end > start);
  const js = (await transform(page.slice(start, end), { loader: 'ts', target: 'es2022' })).code;
  const ctx = { tVersion: 10, tActiveRoom: 'room', playerClockSeen: { room: '', version: -1, revision: -1, at: -1 }, tPlayerClock: null };
  const adopt = runInNewContext('(' + js.trim().replace(/;$/, '') + ')', ctx);
  adopt({ version: 10, playerClockRevision: 2, serverNow: 100, playerClock: { marker: 'new' } });
  adopt({ version: 9, playerClockRevision: 2, serverNow: 101, playerClock: { marker: 'stale' } });
  assert.equal(ctx.tPlayerClock.marker, 'new');
  adopt({ version: 10, playerClockRevision: 3, serverNow: 102, playerClock: null }); assert.equal(ctx.tPlayerClock, null);
  adopt({ version: 10, playerClockRevision: 2, serverNow: 103, playerClock: { marker: 'revive' } }); assert.equal(ctx.tPlayerClock, null);
  adopt({ version: 10, playerClockRevision: 3, serverNow: 101, playerClock: { marker: 'oldtime' } }); assert.equal(ctx.tPlayerClock, null);
});
await test('區塊指紋與完整精確還原，TEV保持逐位元一致', () => {
  if (!hasBaseCommit(ROOT, 'eb5a4503')) { shallowSkip('v6592 exact-revert', '需要上一版 eb5a4503'); return; }
  const normalized = src.replace(/\r\n/g, '\n');
  const blob = readBaseBlob(ROOT, 'eb5a4503', 'oracle-admin/server_admin_patch.js');
  assert.ok(blob.ok, '必須成功取得上一版補丁');
  const base = normEol(blob.out);
  const tailAnchor = "app.get('/api/tournament", tevAnchor = "const TEVENTS = db.collection('tournamentEvents');";
  const tail = normalized.slice(normalized.indexOf(tailAnchor)), tev = normalized.slice(normalized.indexOf(tevAnchor));
  const sha = s => createHash('sha256').update(s).digest('hex');
  assert.equal(sha(tail), NEW_TAIL_SHA_V173); assert.equal(sha(tev), NEW_TEV_SHA_V173); assert.equal(tev.length, NEW_TEV_LEN_V173);
  assert.equal(revertAdminV173(normalized), base); assert.equal(revertV173(tail), base.slice(base.indexOf(tailAnchor)));
  assert.equal(revertV173(tev), base.slice(base.indexOf(tevAnchor)));
  assert.notEqual(sha(tail.replace('playerClockRevision', 'playerClockRevisionMutated')), NEW_TAIL_SHA_V173);
});
await test('五個既有守衛真的呼叫新版還原器，不接受註解假接線', () => {
  for (const name of ['test-v6276-deck-tournament-stats.mjs', 'test-v6291-tourn-verified-gate.mjs', 'test-v6292-tourn-verified-gate2.mjs', 'test-v6381-archive-gamedraw-and-swiss-note.mjs', 'test-v6303-ui-batch.mjs']) {
    const source = readFileSync(join(ROOT, 'scripts', name), 'utf8');
    const tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
    const called = name.includes('6303') ? 'revertAdminV173' : 'revertV173';
    let imported = false, invoked = false;
    function scan(n) {
      if (!n || typeof n !== 'object') return;
      if (n.type === 'ImportDeclaration' && n.specifiers.some(s => s.imported?.name === called)) imported = true;
      if (n.type === 'CallExpression' && n.callee.name === called) invoked = true;
      for (const v of Object.values(n)) if (Array.isArray(v)) v.forEach(scan); else if (v && typeof v === 'object') scan(v);
    }
    scan(tree); assert.ok(imported && invoked, name);
  }
});
await test('遊戲頁六組逐字還原BASE、缺失與重複錨點拒絕、額外差異保留', () => {
  if (!hasBaseCommit(ROOT, 'eb5a4503')) { shallowSkip('v6592 game exact-revert', '需要上一版 eb5a4503'); return; }
  const page = revertV6595Game(normEol(readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8')));
  const base = readBaseBlob(ROOT, 'eb5a4503', 'src/routes/game/+page.svelte');
  assert.ok(base.ok); assert.equal(V6592_GAME_PAIRS.length, 6);
  assert.equal(revertV6592Game(page), normEol(base.out));
  for (const [current] of V6592_GAME_PAIRS) {
    assert.throws(() => revertV6592Game(page.replace(current, '')));
    assert.throws(() => revertV6592Game(page + current));
  }
  assert.equal(revertV6592Game(page + '\n<!-- 額外差異 -->'), normEol(base.out) + '\n<!-- 額外差異 -->');
});
await test('原生BASE封存保留文字與二進位、中文空白路徑、真連結，錯ref或目的地必須失敗', () => {
  if (!hasBaseCommit(ROOT, 'eb5a4503')) { shallowSkip('v6592 archive', '需要上一版 eb5a4503'); return; }
  const temp = mkdtempSync(join(tmpdir(), 'v6592 archive 中文 '));
  try {
    extractBaseArchive(ROOT, 'eb5a4503', ['static/site-version.txt', 'src/lib/assets/pokemon-card-back.jpg'], temp);
    assert.equal(readFileSync(join(temp, 'static/site-version.txt'), 'utf8').trim(), '6.591');
    assert.deepEqual(readFileSync(join(temp, 'src/lib/assets/pokemon-card-back.jpg')), readFileSync(join(ROOT, 'src/lib/assets/pokemon-card-back.jpg')));
    linkBaseModules(ROOT, temp);
    assert.ok(statSync(join(temp, 'node_modules')).isDirectory());
    assert.deepEqual(readFileSync(join(temp, 'node_modules/svelte/package.json')), readFileSync(join(ROOT, 'node_modules/svelte/package.json')));
    assert.throws(() => extractBaseArchive(ROOT, 'v6592-no-such-ref', ['static/site-version.txt'], temp));
    assert.throws(() => extractBaseArchive(ROOT, 'eb5a4503', ['static/site-version.txt'], join(temp, 'missing-directory')));
    assert.throws(() => linkBaseModules(ROOT, temp));
  } finally {
    assert.ok(temp.startsWith(join(tmpdir(), 'v6592 archive 中文 ')));
    rmSync(temp, { recursive: true, force: true });
  }
});
console.log(`${passed} PASS`);
