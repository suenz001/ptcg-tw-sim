/**
 * v6.104 守衛（Wilson 裁定）：**牌庫搜尋型 picker 的 minCount 必須永遠 0** —— 玩家有權「找不到」。
 *
 * 理由（同 Iron Rules Rule 14 的立意）：
 *   ① 牌庫是隱藏資訊。若「有沒有被強迫選」隨牌庫內容改變，對手可從你被迫與否
 *      反推你牌庫裡還有沒有那類卡 ＝ 資訊洩漏。
 *   ② 官方允許搜尋「找不到」（fail-to-find），玩家有權不拿（站規 v2.321）。
 *
 * 本版修的兩張：火箭隊的超級球、賽吉 —— 它們的舊註解停在 v2.993「卡面寫選 1 張 mandatory」，
 * **早於 v4.942 的統一裁定**；當年按 `hasX ? 1 : 0` 字面 grep 修 13 處時，這兩個等價拼法
 * （`validIids.length > 0 ? 1 : 0`）倖存了下來。
 *
 * ⚠ 對照組（**不可**一併改成可不選）：女服務生、霸者咆哮 —— 那是「查看牌庫上方 N 張」，
 *   N 張已攤開＝**已知資訊**，卡面沒有「可以」就是必選；那類的動態 minCount 是正確的。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.x4-s.js'), E = join(ROOT, '.x4-e.ts'), O = join(ROOT, '.x4-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E,
  "export { TRAINER_EFFECTS } from './src/lib/game/effects';\n" +
  "export { selectionAllowsSkip } from './src/lib/game/selection-ui';\n" +
  "import './src/lib/game/effects';");
await build({
  entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error',
});
const mod = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
let pass = 0, fail = 0;
const ok = (n, f) => { try { f(); console.log('  ✓', n); pass++; } catch (e) { console.log('  ✗', n, '→', e.message); fail++; } };

let seq = 0;
const inst = (cardId) => ({ iid: 'i' + (++seq), cardId: String(cardId), damage: 0, energyAttached: [] });
const byName = (name) => { for (const [id, c] of pool) if (c.name === name) return { id, c }; return null; };

console.log('① 牌庫**有**候選時，仍然可以不選');

ok('火箭隊的超級球：牌庫有「火箭隊的寶可夢」時 minCount 仍為 0', () => {
  const ball = byName('火箭隊的超級球');
  assert.ok(ball, 'static/cards 找不到 火箭隊的超級球');
  // 牌庫塞真的候選：名稱含「火箭隊的」的寶可夢
  const rocketMons = [];
  for (const [id, c] of pool) {
    if (c.supertype === 'Pokemon' && typeof c.name === 'string' && c.name.startsWith('火箭隊的')) rocketMons.push(id);
    if (rocketMons.length >= 3) break;
  }
  assert.ok(rocketMons.length >= 2, '卡池取樣失敗（守衛不做軟跳過）');
  const st = {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 3,
    isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
    players: [
      { name: 'P1', active: inst(rocketMons[0]), bench: [], hand: [], deck: rocketMons.map(inst), discard: [], prizes: [] },
      { name: 'P2', active: inst(rocketMons[0]), bench: [], hand: [], deck: [inst(rocketMons[0])], discard: [], prizes: [] },
    ],
  };
  const fn = mod.TRAINER_EFFECTS.get('火箭隊的超級球');
  assert.ok(fn, '找不到 火箭隊的超級球 的實作');
  const out = fn(st, 0, pool);
  const p = out.pendingSelection;
  assert.ok(p, '應開啟 deck-search picker');
  assert.ok((p.params?.validIids ?? []).length > 0, '前提：牌庫確實有候選（否則這項測不到重點）');
  assert.strictEqual(p.minCount ?? 0, 0, 'minCount 必須是 0（玩家有權找不到）');
  assert.strictEqual(mod.selectionAllowsSkip(p), true, 'UI 必須給【不選】鈕');
});

ok('賽吉：牌庫有可進化的卡時 minCount 仍為 0', () => {
  const sage = byName('賽吉');
  assert.ok(sage, 'static/cards 找不到 賽吉');
  // 找一組 基礎 → 進化 的鏈（且進化體無特性，符合卡面「擁有特性的寶可夢除外」）
  let base = null, evo = null;
  for (const [id, c] of pool) {
    if (c.supertype !== 'Pokemon' || !c.evolvesFrom || (c.abilities ?? []).length > 0) continue;
    for (const [bid, bc] of pool) {
      if (bc.supertype === 'Pokemon' && bc.name === c.evolvesFrom && bc.stage === 'Basic') { base = bid; evo = id; break; }
    }
    if (evo) break;
  }
  assert.ok(base && evo, '卡池取樣失敗（找不到 基礎→進化 鏈）');
  const st = {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 3,
    isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
    players: [
      { name: 'P1', active: inst(base), bench: [], hand: [], deck: [inst(evo), inst(base)], discard: [], prizes: [] },
      { name: 'P2', active: inst(base), bench: [], hand: [], deck: [inst(base)], discard: [], prizes: [] },
    ],
  };
  const fn = mod.TRAINER_EFFECTS.get('賽吉');
  assert.ok(fn, '找不到 賽吉 的實作');
  const p = fn(st, 0, pool).pendingSelection;
  assert.ok(p, '應開啟 deck-search picker');
  assert.ok((p.params?.validIids ?? []).length > 0, '前提：牌庫確實有可進化的卡');
  assert.strictEqual(p.minCount ?? 0, 0, 'minCount 必須是 0（玩家有權找不到）');
  assert.strictEqual(mod.selectionAllowsSkip(p), true, 'UI 必須給【不選】鈕');
});

console.log('② 靜態端：牌庫搜尋不得再出現動態 minCount（含等價拼法）');

ok('全站掃描：整副牌庫搜尋不得用動態 minCount（看頂 N 張的已知資訊型除外）', () => {
  const stack = [join(ROOT, 'src/lib/game')];
  const hits = [];
  while (stack.length) {
    const d = stack.pop();
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, ent.name);
      if (ent.isDirectory()) { stack.push(full); continue; }
      if (!ent.name.endsWith('.ts')) continue;
      // G 標卡檔（v29xx_g4_*）不在維護範圍
      if (/v\d+_g\d+_/.test(ent.name)) continue;
      const lines = readFileSync(full, 'utf8').split('\n');
      lines.forEach((ln, i) => {
        if (!/minCount:\s*(has\w+|\w+\.length\s*>\s*0)\s*\?\s*1\s*:\s*0/.test(ln)) return;
        // 同一個 withPending 區塊內出現「看頂 N 張」的標記 ⇒ 已知資訊型，合法
        const ctx = lines.slice(Math.max(0, i - 12), i + 13).join('\n');
        if (/TOP_?\d|TOP_N|top\d*Iids/.test(ctx)) return;
        hits.push(`${ent.name}:${i + 1}: ${ln.trim()}`);
      });
    }
  }
  assert.strictEqual(hits.length, 0, '整副牌庫搜尋仍有動態 minCount：\n' + hits.join('\n'));
});

ok('正對照：掃描式對「整副搜尋動態 minCount」會失敗、對「看頂 N 張」不會', () => {
  const bad = `filter: 'Pokemon',\n  minCount: validIids.length > 0 ? 1 : 0,`;
  const good = `filter: 'TOP4',\n  minCount: basicIids.length > 0 ? 1 : 0,\n  params: { top4Iids: [] },`;
  const scan = (src) => {
    const lines = src.split('\n');
    return lines.filter((ln, i) => {
      if (!/minCount:\s*(has\w+|\w+\.length\s*>\s*0)\s*\?\s*1\s*:\s*0/.test(ln)) return false;
      const ctx = lines.slice(Math.max(0, i - 12), i + 13).join('\n');
      return !/TOP_?\d|TOP_N|top\d*Iids/.test(ctx);
    }).length;
  };
  assert.strictEqual(scan(bad), 1, '壞樣本必須被抓出來');
  assert.strictEqual(scan(good), 0, '看頂 N 張型必須被豁免');
});

console.log(`\n=== v6.104 牌庫搜尋可不選：PASS ${pass} / FAIL ${fail} ===`);
if (fail > 0) process.exit(1);
