import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const root = resolve(process.env.V6592_PRODUCT_ROOT || ROOT);
const temp = mkdtempSync(join(tmpdir(), 'ptcg-clock-'));
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.error('FAIL ' + name + ': ' + e.message); } }
try {
  const out = join(temp, 'clock.cjs');
  const entry = join(root, 'src/lib/tournament/player-clock.ts');
  let api = {};
  if (existsSync(entry)) {
    await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: out });
    api = createRequire(import.meta.url)(out);
  }
  // 新功能在真 BASE 不存在時，仍逐條列出缺失；不可因載入失敗而只得到一個整支 throw。
  const { advancePlayerClock: step, playerClockDue: due, DEFAULT_PLAYER_CLOCK_POLICY: off, parsePlayerClockPolicy: parse } = api;
  const base = () => ({ phase: 'playing', gameStartTime: 100, turn: 1, activePlayerIndex: 0,
    players: [{ active: { iid: 'a' }, bench: [{ iid: 'b' }] }, { active: { iid: 'c' }, bench: [{ iid: 'd' }] }] });
  const policy = { enabled: true, minutes: 15, epoch: 100, changedAt: 100 };
  test('預設關閉，無盤面計時副作用', () => assert.equal(step(null, base(), off, 100), null));
  test('無效設定不啟用', () => assert.equal(parse({ enabled: true, minutes: 0 }).enabled, false));
  test('等待對手選牌只扣對手；回來接續本人累計', () => {
    let g = base(), c = step(null, g, policy, 100);
    g = { ...g, pendingSelection: { actorIdx: 1 } };
    c = step(c, g, policy, 1100);
    assert.deepEqual(c.spent, [1000, 0]);
    delete g.pendingSelection;
    c = step(c, g, policy, 6100);
    assert.deepEqual(c.spent, [1000, 5000]);
    c = step(c, g, policy, 7100);
    assert.deepEqual(c.spent, [2000, 5000]);
  });
  test('900秒門檻給滿30秒，出牌不能重置', () => {
    const g = base(); let c = step(null, g, policy, 100);
    c = step(c, g, policy, 900100);
    assert.equal(c.quickLeft[0], 30000); assert.equal(due(c, 0), false);
    c = step(c, g, policy, 920100); assert.equal(c.quickLeft[0], 10000);
    c = step(c, g, policy, 930100); assert.equal(due(c, 0), true);
  });
  test('晚醒的背景計時不多送30秒', () => {
    const g = base(); const c = step(step(null, g, policy, 100), g, policy, 940100);
    assert.equal(c.quickLeft[0], 0); assert.equal(due(c, 0), true);
  });
  test('對手選擇時暫停快速倒數；返回不重置', () => {
    let g = base(), c = step(step(null, g, policy, 100), g, policy, 910100);
    g = { ...g, pendingSelection: { actorIdx: 1 } };
    c = step(c, g, policy, 910100); c = step(c, g, policy, 990100);
    assert.equal(c.quickLeft[0], 20000); assert.equal(due(c, 0), false);
    delete g.pendingSelection; c = step(c, g, policy, 990100);
    c = step(c, g, policy, 1000100); assert.equal(c.quickLeft[0], 10000);
  });
  test('雙方補位由下一回合方先處理，等待方不扣', () => {
    for (const active of [0, 1]) {
      const g = base(); g.activePlayerIndex = active; g.players.forEach(p => p.active = null);
      const c = step(step(null, g, policy, 100), g, policy, 1100);
      assert.equal(c.spent[active], 0); assert.equal(c.spent[1 - active], 1000);
    }
  });
  test('引擎允許雙方取獎，各自必要操作各計時', () => {
    const g = { ...base(), pendingPrizes: [1, 1] };
    const c = step(step(null, g, policy, 100), g, policy, 1100);
    assert.deepEqual(c.spent, [1000, 1000]);
  });
  test('相同turn切換座位仍換半回合，之後本人新回合給30秒', () => {
    const g = base(); let c = step(step(null, g, policy, 100), g, policy, 930100);
    g.activePlayerIndex = 1; c = step(c, g, policy, 930100);
    g.activePlayerIndex = 0; g.turn = 2; c = step(c, g, policy, 931100);
    assert.equal(c.quickLeft[0], 30000); assert.equal(c.quick[0], true);
  });
  test('調高18分鐘退出快速模式，累計不歸零', () => {
    const g = base(); let c = step(step(null, g, policy, 100), g, policy, 920100);
    c = step(c, g, { ...policy, minutes: 18, changedAt: 920100 }, 920100);
    assert.equal(c.quick[0], false); assert.equal(c.spent[0], 920000);
  });
  test('調低先給30秒；關閉立即停止；重新啟用新額度', () => {
    const g = base(); let c = step(step(null, g, policy, 100), g, policy, 800100);
    c = step(c, g, { ...policy, minutes: 10, changedAt: 800100 }, 800100);
    assert.equal(c.quickLeft[0], 30000); assert.equal(c.quick[0], true);
    assert.equal(step(c, g, off, 801100), null);
    c = step(c, g, { ...policy, epoch: 802100, changedAt: 802100 }, 802100);
    assert.deepEqual(c.spent, [0, 0]);
  });
  test('不修改舊時計，未知選擇owner與終局不扣時', () => {
    const g = base(), c = step(null, g, policy, 100), before = JSON.stringify(c);
    step(c, g, policy, 2000); assert.equal(JSON.stringify(c), before);
    assert.deepEqual(step(c, { ...g, pendingSelection: {} }, policy, 2000).actors, []);
    assert.equal(step(c, { ...g, phase: 'game-over' }, policy, 2000), null);
  });
  console.log(`${passed} PASS, ${failed} FAIL`);
} finally {
  if (!resolve(temp).startsWith(resolve(tmpdir()) + sep)) throw new Error('暫存清理路徑超出預期目錄');
  rmSync(temp, { recursive: true, force: true });
}

if (failed) process.exitCode = 1;
else {
await import("./test-v6592-player-clock-runtime.mjs");

await import("./test-v6592-player-clock-wiring.mjs");
}
