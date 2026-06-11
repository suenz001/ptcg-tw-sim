#!/usr/bin/env node
/**
 * 回歸測試網：防守方「受招式傷害」反擊特性在【被擊倒(KO)】時是否觸發。
 *
 * 背景：尖刺盔甲/怨恨旋渦/快掃拳返 等反擊特性讀 state.players[dIdx].active
 *   來算能量數/null-guard。被 KO 時 active 已移入棄牌區(=null)→反擊不觸發（老毛病）。
 *   v5.548 修：RetaliationFn 加 defSnapshot 參數，引擎 KO 分支傳 koInst(受傷前快照)。
 *   只讀攻擊方的反擊(反擊/反擊雞冠/自動用武…)本來就 KO-safe，作為對照。
 *
 * Run: node scripts/test-retaliation-ko.mjs  （exit 0=全過 / 1=有 FAIL）
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENTRY = join(ROOT, '.tmp-retal-entry.ts');
const OUT = join(ROOT, '.tmp-retal-bundle.mjs');
const SHIM = join(ROOT, '.tmp-retal-shim.mjs');
process.on('exit', () => { for (const p of [ENTRY, OUT, SHIM]) { try { unlinkSync(p); } catch {} } });
writeFileSync(SHIM, 'export const base="";export const assets="";');
writeFileSync(ENTRY, `export { applyAction } from './src/lib/game/engine';`);
await build({ entryPoints: [ENTRY], outfile: OUT, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': SHIM }, logLevel: 'error' });
const { applyAction } = await import(pathToFileURL(OUT).href);

const pool = new Map();
for (const f of readdirSync(join(ROOT, 'static/cards'))) {
  if (!f.endsWith('.json') || f === 'index.json') continue;
  for (const c of JSON.parse(readFileSync(join(ROOT, 'static/cards', f), 'utf8'))) pool.set(String(c.id), c);
}
const eid = (n) => { for (const [id, c] of pool) if (c.name === n) return id; return null; };
const WATER = eid('基本【水】能量'), GRASS = eid('基本【草】能量'), METAL = eid('基本【鋼】能量');

const CHESNAUGHT = '18427'; // 布里卡隆｜尖刺盔甲（草能量×30）180HP
const LAPRAS = '14085';     // 拉普拉斯ex｜衝浪（攻擊者）

let nn = 0;
const inst = (cid, e = [], x = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: e, ...x });
const en = (cid) => ({ iid: 'e' + (++nn), cardId: String(cid), damage: 0, energyAttached: [] });

function mk(defId, defDamage, defEnergy) {
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, turn: 3, isFirstTurn: false,
    pendingPrizes: [0, 0], log: [], pendingSelection: null, activeStadium: null, setupDone: [true, true],
    players: [
      { active: inst(LAPRAS, [en(WATER), en(WATER), en(WATER)]), bench: [], hand: [], deck: Array.from({ length: 10 }, () => en(WATER)), discard: [], prizes: Array.from({ length: 6 }, () => en(WATER)), name: 'P0' },
      { active: inst(defId, defEnergy, { damage: defDamage }), bench: [inst(LAPRAS)], hand: [], deck: Array.from({ length: 10 }, () => en(GRASS)), discard: [], prizes: Array.from({ length: 6 }, () => en(GRASS)), name: 'P1' },
    ],
  };
}
let pass = 0, fail = 0;
function check(label, defId, defDamage, defEnergy, expectAttackerDmg) {
  const s0 = mk(defId, defDamage, defEnergy);
  const s = applyAction(s0, { type: 'ATTACK', attackIndex: 0 }, pool);
  const atk = s.players[0].active;
  const got = atk ? atk.damage : -1;
  const def = s.players[1].active;
  const ko = def === null || def.cardId !== String(defId);
  const ok = got === expectAttackerDmg;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: 布里卡隆${ko ? '被KO' : '存活'} → 攻擊方傷害 ${got}（期望 ${expectAttackerDmg}）`);
  if (ok) pass++; else fail++;
}
// 尖刺盔甲：草能量×30。非KO 與 KO 都應觸發（核心回歸）
check('尖刺盔甲 非KO 草1', CHESNAUGHT, 0, [en(GRASS)], 30);
check('尖刺盔甲 KO   草1', CHESNAUGHT, 175, [en(GRASS)], 30);
check('尖刺盔甲 KO   草2', CHESNAUGHT, 175, [en(GRASS), en(GRASS)], 60);
check('尖刺盔甲 KO   草0(無草)', CHESNAUGHT, 175, [en(WATER)], 0);

console.log(`\n受傷反擊KO測試：PASS ${pass} / FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
