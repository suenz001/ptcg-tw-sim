// v6.028【對戰圓形競技場】只擋「放置傷害指示物」守衛。
//
// 卡面（static/cards M2.json id 14397，I 標）：
//   「雙方的所有備戰寶可夢，不會因對手的招式與特性的效果而【被放置傷害指示物】。[會受到招式的傷害。]」
//
// 舊實作把所有 attack-effect / ability-effect 一律擋掉 → 誤擋換位、退化、丟道具/能量、
// 回手回牌庫、效果 KO 等十餘種效果。玩家回報：場上有對戰圓形時【鐵掌力士｜大力捕捉器】
// 抓不到對手備戰。
//
// 本測試兩面都鎖：
//   A. 誤擋修復側 — 非放指示物的效果，對戰圓形在場時**不可**被擋
//   B. 保護仍有效側 — 放指示物的效果，對戰圓形在場時**仍要**擋（防修過頭）
//   C. 契約側 — 未傳 counterPlacement 時**保守照擋**（fail-closed，漏標不會變成無聲漏洞）
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.ba-s.js'), E = join(ROOT, '.ba-e.ts'), O = join(ROOT, '.ba-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* */ } } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { canApplyEffectToTarget } from './src/lib/game/defense';\n"
  + "export { ABILITY_EFFECTS, ATTACK_POST } from './src/lib/game/effects/_shared';\n"
  + "import './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { canApplyEffectToTarget, ABILITY_EFFECTS } = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const byName = (n) => [...pool.values()].find((c) => c.name === n);
const arena = byName('對戰圓形競技場');
const iron = byName('鐵掌力士');
assert.ok(arena && iron, '素材卡應在現役卡池');

let nn = 0;
const inst = (c, x = {}) => ({ iid: 'i' + (++nn), cardId: String(c.id), damage: 0, energyAttached: [], ...x });
const basic = [...pool.values()].find((c) => c.supertype === 'Pokemon' && !c.evolvesFrom);

function mkState(withArena, myActiveCard) {
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
    log: [], setupDone: [true, true], pendingPrizes: [0, 0], pendingMulliganDraw: [0, 0], pendingSelection: null,
    activeStadium: withArena ? { iid: 'stad1', cardId: String(arena.id) } : null,
    players: [
      { name: 'P1', active: inst(myActiveCard || basic), bench: [], hand: [], deck: [inst(basic)], discard: [], prizes: [1, 1, 1, 1, 1, 1] },
      { name: 'P2', active: inst(basic), bench: [inst(basic), inst(basic)], hand: [], deck: [inst(basic)], discard: [], prizes: [1, 1, 1, 1, 1, 1] },
    ],
  };
}

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

// ── 卡面前提 ─────────────────────────────────────────────────────────────────
T('卡面前提：對戰圓形只擋「被放置傷害指示物」（rulesText 逐字）', () => {
  const t = String(arena.rulesText || '');
  assert.ok(t.includes('放置傷害指示物'), '卡面應提到放置傷害指示物，實際=' + t);
  assert.ok(t.includes('會受到招式的傷害'), '卡面括號應載明仍受招式傷害');
});

// ── A. 誤擋修復側 ────────────────────────────────────────────────────────────
const kinds = ['attack-effect', 'ability-effect'];
for (const kind of kinds) {
  T(`非放指示物效果（${kind}, counterPlacement:false）→ 對戰圓形不擋`, () => {
    const st = mkState(true);
    const tgt = st.players[1].bench[0];
    const r = canApplyEffectToTarget(st, 0, tgt, pool.get(tgt.cardId), kind, pool, { isBench: true, counterPlacement: false });
    assert.equal(r.blocked, false, '換位/退化/丟道具/bounce/效果KO 都不該被對戰圓形擋，實際 reason=' + r.reason);
  });
}

T('玩家回報情境：對戰圓形在場時，鐵掌力士｜大力捕捉器仍能選對手備戰', () => {
  const fn = ABILITY_EFFECTS.get('鐵掌力士|0');
  assert.ok(fn, '大力捕捉器 handler 應存在');
  for (const withArena of [false, true]) {
    const st = mkState(withArena, iron);
    const out = fn(st, 0, pool, st.players[0].active);
    assert.ok(out.pendingSelection, (withArena ? '有' : '無') + '對戰圓形時都應開啟選擇視窗');
    assert.equal(out.pendingSelection.type, 'opp-bench-choose');
    assert.equal((out.pendingSelection.params?.validIids || []).length, 2, '兩隻備戰都應可選');
  }
});

// ── B. 保護仍有效側（防修過頭）───────────────────────────────────────────────
for (const kind of kinds) {
  T(`放置傷害指示物（${kind}, counterPlacement:true）→ 對戰圓形仍要擋`, () => {
    const st = mkState(true);
    const tgt = st.players[1].bench[0];
    const r = canApplyEffectToTarget(st, 0, tgt, pool.get(tgt.cardId), kind, pool, { isBench: true, counterPlacement: true });
    assert.equal(r.blocked, true, '幻影奇襲/咒詛炸彈/揚沙 等放指示物效果必須仍被擋');
    assert.ok(String(r.reason).includes('對戰圓形'), 'reason 應指出是對戰圓形，實際=' + r.reason);
  });
}

T('招式傷害（attack-damage）→ 對戰圓形一律不擋（卡面括號明載）', () => {
  const st = mkState(true);
  const tgt = st.players[1].bench[0];
  const r = canApplyEffectToTarget(st, 0, tgt, pool.get(tgt.cardId), 'attack-damage', pool, { isBench: true });
  assert.equal(r.blocked, false, '備戰狙擊傷害不該被對戰圓形擋');
});

T('場上沒有對戰圓形時，放指示物本來就不擋（對照組）', () => {
  const st = mkState(false);
  const tgt = st.players[1].bench[0];
  const r = canApplyEffectToTarget(st, 0, tgt, pool.get(tgt.cardId), 'attack-effect', pool, { isBench: true, counterPlacement: true });
  assert.equal(r.blocked, false);
});

// ── C. fail-closed 契約 ──────────────────────────────────────────────────────
T('⭐契約：未傳 counterPlacement → 保守照擋（漏標時維持舊行為，不可變成無聲放行）', () => {
  const st = mkState(true);
  const tgt = st.players[1].bench[0];
  for (const kind of kinds) {
    const r = canApplyEffectToTarget(st, 0, tgt, pool.get(tgt.cardId), kind, pool, { isBench: true });
    assert.equal(r.blocked, true, kind + ' 未表態時必須 fail-closed（照擋）');
  }
});

// ── D. 隔離：其他 bench defense 的卡面範圍各不相同，不可被本次改動波及 ──────
T('隔離：對手戰鬥位目標不受 bench-only 的對戰圓形影響（isBench:false）', () => {
  const st = mkState(true);
  const tgt = st.players[1].active;
  const r = canApplyEffectToTarget(st, 0, tgt, pool.get(tgt.cardId), 'attack-effect', pool, { isBench: false, counterPlacement: true });
  assert.equal(r.blocked, false, '對戰圓形只保護備戰');
});

T('隔離：球形盾牌（蟲甲聖）仍擋備戰招式效果，且不受 counterPlacement 影響', () => {
  const bug = byName('蟲甲聖');
  if (!bug) { console.log('   （現役卡池無蟲甲聖，略過）'); return; }
  const st = mkState(false);
  st.players[1].active = inst(bug);   // 防守方有蟲甲聖 → 自方備戰受球形盾牌保護
  const tgt = st.players[1].bench[0];
  const r = canApplyEffectToTarget(st, 0, tgt, pool.get(tgt.cardId), 'attack-effect', pool, { isBench: true, counterPlacement: false });
  assert.equal(r.blocked, true, '球形盾牌卡面是「傷害與效果」全擋，不該因 counterPlacement:false 而失效');
  assert.ok(String(r.reason).includes('球形盾牌'), '實際 reason=' + r.reason);
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
