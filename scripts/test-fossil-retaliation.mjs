// 陳舊的頭蓋化石（HP60 化石寶可夢）受對手招式傷害 → 在攻擊方放 3 個傷害指示物（30）
// 測 wiring：非KO分支 / KO分支(受傷時含KO仍反擊) / 非化石不反擊 + 直接單元測 applyInherentRetaliation
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.stub-paths.js'); writeFileSync(S, 'export const base="";');
const E = join(ROOT, '.ent-fossil.ts'); const O = join(ROOT, '.ent-fossil.mjs');
writeFileSync(E, `export { createGame, applyAction } from './src/lib/game/engine';
export { applyInherentRetaliation, INHERENT_RETALIATION } from './src/lib/game/effects';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction, applyInherentRetaliation, INHERENT_RETALIATION } = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const FOSSIL = '19215'; // 陳舊的頭蓋化石
assert(pool.get(FOSSIL)?.name === '陳舊的頭蓋化石', '化石卡資料缺失');

// 找一張：基礎寶可夢、attacks[i] 全【無】cost、damage 為純數字且 10≤dmg≤50（不會一擊 KO HP60 化石）
let atkId, atkIndex, atkDmg, atkCost;
for (const [, c] of pool) {
  if (c.supertype !== 'Pokemon' || c.subtype !== 'Basic' || c.evolvesFrom) continue;
  if (!Array.isArray(c.attacks)) continue;
  for (let i = 0; i < c.attacks.length; i++) {
    const a = c.attacks[i];
    const cost = a.cost || [];
    const d = parseInt(a.damage, 10);
    if (cost.length >= 1 && cost.length <= 3 && cost.every(x => x === 'Colorless')
        && String(a.damage).match(/^\d+$/) && d >= 10 && d <= 50) {
      atkId = c.id; atkIndex = i; atkDmg = d; atkCost = cost.length; break;
    }
  }
  if (atkId) break;
}
assert(atkId, '找不到合適的【無】cost 純數字傷害攻擊者');
console.log(`攻擊者 id=${atkId} (${pool.get(atkId).name}) 招式#${atkIndex} 傷害${atkDmg} cost${atkCost}個無色`);

// 任意基本能量當【無】cost
const anyBasicE = [...pool].find(([, c]) => c.supertype === 'Energy' && /基本/.test(c.subtype || '') )?.[0]
  || [...pool].find(([, c]) => c.supertype === 'Energy')?.[0];
assert(anyBasicE, '找不到能量卡');

let iid = 0; const inst = (cid, e = {}) => ({ iid: `a${++iid}`, cardId: String(cid), damage: 0, energyAttached: [], ...e });
const prizeOf = n => Array.from({ length: n }, () => inst(atkId));

// P0=攻擊方(active=attacker), P1=防守方(active=fossil)
function mk(fossilDamage, defenderId = FOSSIL, fossilExtra = {}) {
  const s = createGame({ name: 'P1', entries: [{ cardId: atkId, count: 1 }] },
    { name: 'P2', entries: [{ cardId: atkId, count: 1 }] }, pool);
  const attacker = inst(atkId, { energyAttached: Array.from({ length: atkCost }, () => inst(anyBasicE)) });
  const defender = defenderId === FOSSIL
    ? inst(FOSSIL, { damage: fossilDamage, fossilOnField: true, ...fossilExtra })
    : inst(defenderId, { damage: fossilDamage });
  return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, isFirstTurn: false,
    setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
    players: [
      { ...s.players[0], hand: [], deck: [inst(atkId)], discard: [], prizes: prizeOf(6), bench: [inst(atkId)], active: attacker },
      { ...s.players[1], hand: [], deck: [inst(atkId)], discard: [], prizes: prizeOf(6), bench: [inst(atkId)], active: defender },
    ] };
}

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log('PASS', n); pass++; } catch (e) { console.log('FAIL', n, '::', e.message); fail++; } };

// ① INHERENT_RETALIATION 註冊
T('INHERENT_RETALIATION 含陳舊的頭蓋化石=3', () => {
  assert.equal(INHERENT_RETALIATION.get('陳舊的頭蓋化石'), 3);
});

// ② 單元：helper 直接套用 → 攻擊方 +30
T('helper：化石受傷 → 攻擊方 active +30', () => {
  const st = mk(0);
  const out = applyInherentRetaliation(st, 1, pool.get(FOSSIL), pool);
  assert.equal(out.players[0].active.damage, 30, '攻擊方應 +30，實際' + out.players[0].active.damage);
});
T('helper：非化石防守方 → 攻擊方不變', () => {
  const st = mk(0, atkId);
  const out = applyInherentRetaliation(st, 1, pool.get(atkId), pool);
  assert.equal(out.players[0].active.damage, 0, '非化石不應反擊');
});

// ③ 整合(非KO)：攻擊者打化石(傷害<60不KO) → 攻擊者身上 +30〔修正核心 wiring〕
T('整合(非KO)：攻擊化石 → 攻擊方 active 多30傷害', () => {
  const n = applyAction(mk(0), { type: 'ATTACK', attackIndex: atkIndex }, pool);
  // 化石仍在(沒被一擊KO)
  assert(n.players[1].active && n.players[1].active.cardId === FOSSIL, '化石應存活');
  assert.equal(n.players[0].active.damage, 30, '攻擊方應被反擊+30，實際' + (n.players[0].active?.damage));
});

// ④ 整合(KO)：化石預傷使本次攻擊KO化石 → 受傷時含KO，仍反擊 +30
T('整合(KO)：攻擊KO化石 → 攻擊方仍被反擊+30', () => {
  const pre = 60 - atkDmg; // 攻擊後 = 60 剛好 KO
  const n = applyAction(mk(pre), { type: 'ATTACK', attackIndex: atkIndex }, pool);
  assert(!n.players[1].active || n.players[1].active.cardId !== FOSSIL, '化石應被KO移除');
  assert.equal(n.players[0].active.damage, 30, 'KO情境攻擊方仍應+30，實際' + (n.players[0].active?.damage));
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
