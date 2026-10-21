import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { buildAiBundle, loadLivePool, nextAction, seeded } from './lib/ai-sim-harness.mjs';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const mod = await buildAiBundle(ROOT, { extraExports: [
  "export { createPlayerClockRuntime } from './src/lib/tournament/player-clock-runtime';",
  "export { timeoutAction } from './src/lib/game/timeout-action';",
] });
const pool = loadLivePool(ROOT);
const deck = mod.PRESET_DECKS[0];
const originalRandom = Math.random;
Math.random = seeded(12345);
process.once('exit', () => { Math.random = originalRandom; });
let game = mod.createGame({ name: 'A', entries: deck.entries }, { name: 'B', entries: deck.entries }, pool, { firstPlayerOverride: 0 });
for (let n = 0; n < 200 && game.phase === 'setup'; n++) {
  const { act } = nextAction(game, [(g, i) => mod.aiNew(g, pool, i), (g, i) => mod.aiNew(g, pool, i)]);
  assert.ok(act, '開局必須能推進'); game = mod.applyAction(game, act, pool);
}
assert.equal(game.phase, 'playing');
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
function fixture() {
  let now = 1000, policy = null, room = { _id: 'test', matchId: 'm', version: 1, gameState: structuredClone(game) };
  const stats = { loads: 0, scans: 0, writes: 0, auto: 0, warnings: [] };
  let beforeCommit = null, loadFail = false, saveHook = null, loadHook = null;
  const dependencies = { now: () => now, pool,
    loadPolicy: async () => { if (loadFail) throw new Error('測試斷線'); const snapshot = policy; if (loadHook) await loadHook(); return snapshot; },
    savePolicy: async p => { if (saveHook) await saveHook(); policy = structuredClone(p); },
    activeRooms: async () => { stats.scans++; return ['test']; },
    loadRoom: async () => { stats.loads++; return structuredClone(room); },
    commit: async (old, next, clock, auto) => {
      if (beforeCommit) await beforeCommit();
      if (old.version !== room.version) return false;
      room = { ...room, version: room.version + 1, gameState: structuredClone(next), playerClock: structuredClone(clock) };
      stats.writes++; if (auto) stats.auto++; return true;
    }, warn: m => stats.warnings.push(m),
  };
  let runtime = mod.createPlayerClockRuntime(dependencies);
  return { get runtime() { return runtime; }, restart() { runtime = mod.createPlayerClockRuntime(dependencies); }, stats, get room() { return room; }, set room(r) { room = r; },
    set now(t) { now = t; }, get now() { return now; }, set hook(h) { beforeCommit = h; },
    set loadFail(v) { loadFail = v; }, set saveHook(h) { saveHook = h; },
    set loadHook(h) { loadHook = h; },
    async on() { await runtime.refresh(); await runtime.configure(true, 15); await runtime.refresh(); },
  };
}
await test('缺設定預設OFF，tick不查房間也不寫入', async () => {
  const f = fixture(); await f.runtime.refresh(); await f.runtime.tick();
  assert.equal(f.runtime.currentPolicy().enabled, false);
  assert.equal(f.stats.scans, 0); assert.equal(f.stats.loads, 0); assert.equal(f.stats.writes, 0);
});
await test('啟用舊局不追溯，持續tick不逐秒寫DB', async () => {
  const f = fixture(); await f.on(); assert.deepEqual(f.room.playerClock.spent, [0, 0]);
  const writes = f.stats.writes, loads = f.stats.loads;
  for (let n = 0; n < 20; n++) { f.now += 1000; await f.runtime.tick(); }
  assert.equal(f.stats.writes, writes); assert.equal(f.stats.loads, loads);
});
await test('真人未到期可操作，到期由AI只結束原回合', async () => {
  const f = fixture(); await f.on(); const actor = f.room.gameState.activePlayerIndex;
  f.now += 929999; assert.equal(f.runtime.blocked(f.room, actor), false);
  f.now++; assert.equal(f.runtime.blocked(f.room, actor), true);
  const oldHand = f.room.gameState.players[actor].hand.length;
  await f.runtime.work('test');
  assert.equal(f.room.gameState.activePlayerIndex, 1 - actor);
  assert.equal(f.room.gameState.players[actor].hand.length, oldHand);
  assert.equal(f.stats.auto, 1);
});
await test('關閉取消接管，開啟新epoch不續算關閉前秒數', async () => {
  const f = fixture(); await f.on(); f.now += 940000;
  await f.runtime.configure(false, 15); await f.runtime.work('test');
  assert.equal(f.stats.auto, 0); assert.equal(f.runtime.publicClock(f.room.playerClock), null);
  await f.runtime.configure(true, 18); await f.runtime.refresh();
  assert.deepEqual(f.room.playerClock.spent, [0, 0]);
});
await test('重建runtime不遺失已保存個人時計', async () => {
  const f = fixture(); await f.on(); f.now += 600000;
  f.room = { ...f.room, playerClock: f.runtime.calculate(f.room) };
  f.restart(); await f.runtime.refresh();
  assert.equal(f.runtime.calculate(f.room).spent[f.room.gameState.activePlayerIndex], 600000);
});
await test('整場最後回合界線不能被AI繞過', async () => {
  const f = fixture(); await f.on(); f.now += 940000;
  f.room.timeLimitTurn = f.room.gameState.turn - 1;
  await f.runtime.work('test'); assert.equal(f.stats.auto, 0);
});
await test('兩個接管請求同時到達僅執行一次', async () => {
  const f = fixture(); await f.on(); f.now += 940000;
  await Promise.all([f.runtime.work('test'), f.runtime.work('test')]);
  assert.equal(f.stats.auto, 1);
});
await test('真人搶先CAS成功，過期盤面不覆蓋', async () => {
  const f = fixture(); await f.on(); f.now += 940000;
  let once = false;
  f.hook = async () => {
    if (once) return; once = true;
    const next = mod.applyAction(f.room.gameState, { type: 'END_TURN' }, pool);
    f.room = { ...f.room, version: f.room.version + 1, gameState: next, playerClock: f.runtime.calculate(f.room, next) };
  };
  const actor = f.room.gameState.activePlayerIndex;
  await f.runtime.work('test');
  assert.equal(f.room.gameState.activePlayerIndex, 1 - actor); assert.equal(f.stats.auto, 0);
});
await test('接管入口一般主階段只給END_TURN，不出新牌', () => {
  assert.equal(mod.timeoutAction(game, pool, game.activePlayerIndex).type, 'END_TURN');
  assert.equal(mod.timeoutAction(game, pool, 1 - game.activePlayerIndex), null);
});
await test('對手回合的獎賞由到期的領獎方拿，不替對手結束回合', async () => {
  const f = fixture(), actor = f.room.gameState.activePlayerIndex, owner = 1 - actor;
  f.room.gameState.pendingPrizes = [0, 0]; f.room.gameState.pendingPrizes[owner] = 1;
  const prizes = f.room.gameState.players[owner].prizes.length;
  await f.on(); f.now += 930000; await f.runtime.work('test');
  assert.equal(f.room.gameState.players[owner].prizes.length, prizes - 1);
  assert.equal(f.room.gameState.activePlayerIndex, actor); assert.equal(f.stats.auto, 1);
});
await test('雙方補位只接管有責任且到期的一方，另一方繼續等待真人', async () => {
  const f = fixture(), actor = f.room.gameState.activePlayerIndex;
  for (const p of f.room.gameState.players) { p.bench = [p.active]; p.active = null; }
  await f.on(); f.now += 930000; await f.runtime.work('test');
  assert.ok(f.room.gameState.players[1 - actor].active);
  assert.equal(f.room.gameState.players[actor].active, null); assert.equal(f.stats.auto, 1);
});
await test('關閉等待已開始的CAS，但回覆後不再接管後續動作', async () => {
  const f = fixture(); await f.on(); f.now += 930000;
  let unlock, entered;
  const enteredPromise = new Promise(r => entered = r), gate = new Promise(r => unlock = r);
  f.hook = async () => { entered(); await gate; };
  const work = f.runtime.work('test'); await enteredPromise;
  let closed = false; const closing = f.runtime.configure(false, 15).then(() => { closed = true; });
  await Promise.resolve(); assert.equal(closed, false);
  unlock(); await Promise.all([work, closing]);
  const count = f.stats.auto; await f.runtime.work('test'); assert.equal(f.stats.auto, count);
  assert.equal(f.runtime.currentPolicy().enabled, false);
});
await test('設定讀取失敗期間真人換手，恢復後不把對手時間算給原玩家', async () => {
  const f = fixture(); await f.on(); const actor = f.room.gameState.activePlayerIndex;
  f.now += 10000; f.loadFail = true; await f.runtime.refresh();
  const next = mod.applyAction(f.room.gameState, { type: 'END_TURN' }, pool);
  f.room = { ...f.room, version: f.room.version + 1, playerClock: f.runtime.calculate(f.room, next), gameState: next };
  f.now += 20000; f.loadFail = false; await f.runtime.refresh();
  const c = f.runtime.calculate(f.room);
  assert.equal(c.spent[actor], 10000); assert.equal(c.spent[1 - actor], 20000);
});
await test('儲存設定尚未完成時真人換手，操作權與時間仍正確移交', async () => {
  const f = fixture(); await f.on(); const actor = f.room.gameState.activePlayerIndex;
  let unlock, entered;
  const gate = new Promise(r => unlock = r), start = new Promise(r => entered = r);
  f.saveHook = async () => { entered(); await gate; };
  f.now += 10000; const saving = f.runtime.configure(true, 18); await start;
  const next = mod.applyAction(f.room.gameState, { type: 'END_TURN' }, pool);
  f.room = { ...f.room, version: f.room.version + 1, playerClock: f.runtime.calculate(f.room, next), gameState: next };
  f.now += 20000; unlock(); await saving; await f.runtime.refresh();
  const c = f.runtime.calculate(f.room);
  assert.equal(c.spent[actor], 10000); assert.equal(c.spent[1 - actor], 20000);
});
await test('儲存OFF期間不得開始舊設定讀取，成功後不能復活ON', async () => {
  const f = fixture(); await f.on();
  let enterSave, releaseSave, releaseRead;
  const savingEntered = new Promise(r => enterSave = r), saveGate = new Promise(r => releaseSave = r);
  const readGate = new Promise(r => releaseRead = r);
  f.saveHook = async () => { enterSave(); await saveGate; };
  const saving = f.runtime.configure(false, 15); await savingEntered;
  f.loadHook = async () => readGate;
  const refresh = f.runtime.refresh();
  releaseSave(); const result = await saving; assert.equal(result.enabled, false);
  releaseRead(); await refresh;
  assert.equal(f.runtime.currentPolicy().enabled, false);
});
await test('設定前已在途的舊refresh不能覆蓋新設定', async () => {
  const f = fixture(); await f.on();
  let enter, release; const started = new Promise(r => enter = r), gate = new Promise(r => release = r);
  f.loadHook = async () => { enter(); await gate; };
  const refresh = f.runtime.refresh(); await started;
  const saving = f.runtime.configure(false, 18); release();
  await Promise.all([refresh, saving]);
  assert.equal(f.runtime.currentPolicy().enabled, false); assert.equal(f.runtime.currentPolicy().minutes, 18);
});
await test('真實出牌產生的選擇由AI完成必要結算', async () => {
  let st = structuredClone(game), found = 0;
  for (let n = 0; n < 250 && st.phase === 'playing'; n++) {
    if (st.pendingSelection) {
      const f = fixture(); f.room.gameState = structuredClone(st);
      const token = st.pendingSelection.token, owner = st.pendingSelection.actorIdx;
      await f.on(); f.now += 930000; await f.runtime.work('test');
      assert.ok(f.stats.auto > 0, `接管需有效推進 ${st.pendingSelection.effectKey}`);
      assert.notEqual(f.room.gameState.pendingSelection?.token, token, `不留原選擇 ${st.pendingSelection.effectKey}`);
      assert.equal(f.room.playerClock?.stalled?.[owner] ?? false, false);
      if (++found >= 8) break;
    }
    const { act } = nextAction(st, [(g, i) => mod.aiNew(g, pool, i), (g, i) => mod.aiNew(g, pool, i)]);
    if (!act) break;
    st = mod.applyAction(st, act, pool);
  }
  assert.ok(found >= 3, `必須真的覆蓋選擇，實際 ${found}`);
});
console.log(`${passed} PASS`);
