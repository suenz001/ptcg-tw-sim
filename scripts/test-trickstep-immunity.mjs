#!/usr/bin/env node
/**
 * 回歸測試網：「移動／放回對手戰鬥位能量」型招式效果，對受招式效果免疫的對手戰鬥寶可夢應無效。
 *
 * 背景（v5.555）：耿鬼ex｜戲法舞步、超能妙喵｜戲法舞步、高傲雉雞｜反轉之風 這類 inline
 *   招式效果（搬／放回對手戰鬥位能量）在 ATTACK_POST 開 pendingSelection 才結算，先前沒先
 *   經過招式效果免疫的中央判定 → 對附「硬岩【鬥】能量」的鬥寶可夢（不受對手招式效果影響）
 *   仍會搬能量。修法：發動前統一走 defense.ts isOppActiveImmuneToAttackEffect（收斂
 *   canApplyEffectToTarget('attack-effect') 全免疫來源）。
 *
 * Run: node scripts/test-trickstep-immunity.mjs  （exit 0=全過 / 1=有 FAIL）
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENTRY = join(ROOT, '.tmp-ts-entry.ts');
const OUT = join(ROOT, '.tmp-ts-bundle.mjs');
const SHIM = join(ROOT, '.tmp-ts-shim.mjs');
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

const GENGAR_EX = '16916';  // 耿鬼ex｜戲法舞步（160，cost [惡][惡]）HP310
const MEOWMEOW  = '18457';  // 超能妙喵｜戲法舞步（80，cost [超][無]）
const LUCARIO   = '13986';  // 超級路卡利歐ex（鬥屬性，HP340 → 吃 160/80 不昏厥）
const HARDROCK  = '18057';  // 硬岩【鬥】能量（鬥寶可夢不受對手招式效果影響）
const DARK      = '14430';  // 基本【惡】能量
const PSY       = '14103';  // 基本【超】能量

let nn = 0;
const inst = (cid, e = [], x = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: e, ...x });
const en = (cid) => ({ iid: 'e' + (++nn), cardId: String(cid), damage: 0, energyAttached: [] });

// P0 = 攻擊方; P1 = 防守方(戰鬥位 LUCARIO + 指定能量 + 1 隻備戰供搬移目的地)
function mk(attackerId, attackerEnergy, defEnergy) {
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, turn: 3, isFirstTurn: false,
    pendingPrizes: [0, 0], log: [], pendingSelection: null, activeStadium: null, setupDone: [true, true],
    players: [
      { active: inst(attackerId, attackerEnergy), bench: [], hand: [], deck: Array.from({ length: 8 }, () => en(DARK)), discard: [], prizes: Array.from({ length: 6 }, () => en(DARK)), name: 'P0' },
      { active: inst(LUCARIO, defEnergy), bench: [inst(LUCARIO)], hand: [], deck: Array.from({ length: 8 }, () => en(DARK)), discard: [], prizes: Array.from({ length: 6 }, () => en(DARK)), name: 'P1' },
    ],
  };
}

let pass = 0, fail = 0;
const ck = (label, cond) => { if (cond) { pass++; console.log('  ✅', label); } else { fail++; console.log('  ❌', label); } };

// 取攻後對手戰鬥位能量數 + 是否開了 trick-step picker
function run(attackerId, attackerEnergy, defEnergy) {
  const s0 = mk(attackerId, attackerEnergy, defEnergy);
  const before = s0.players[1].active.energyAttached.length;
  const s = applyAction(s0, { type: 'ATTACK', attackIndex: 0 }, pool);
  const da = s.players[1].active;
  const after = da ? da.energyAttached.length : -1;
  const pend = s.pendingSelection;
  const isTrickPicker = !!pend && (pend.effectKey === 'trick-step-energy' || pend.effectKey === 'v327-unfezant-reverse-wind' || /戲法|反轉/.test(pend.params?.label || pend.params?.titleOverride || ''));
  const log = s.log.map((l) => (typeof l === 'string' ? l : (l.message || ''))).join(' | ');
  return { before, after, isTrickPicker, alive: !!da, log };
}

console.log('① 耿鬼ex｜戲法舞步 vs 硬岩【鬥】能量 鬥寶可夢 → 應免疫（不開 picker、能量不變）');
{
  const r = run(GENGAR_EX, [en(DARK), en(DARK)], [en(HARDROCK), en(DARK)]);
  ck('防守方存活（HP340 吃 160）', r.alive);
  ck('沒有開 trick-step picker（被免疫擋下）', !r.isTrickPicker);
  ck('對手戰鬥位能量數不變（2→2，未被搬走）', r.before === 2 && r.after === 2);
  ck('log 提及不受招式效果影響', /不受招式效果影響|硬岩|免疫/.test(r.log));
}

console.log('② 對照：耿鬼ex｜戲法舞步 vs 鬥寶可夢「無」硬岩 → 應正常開 picker');
{
  const r = run(GENGAR_EX, [en(DARK), en(DARK)], [en(DARK), en(DARK)]);
  ck('防守方存活', r.alive);
  ck('正常開啟 trick-step picker（未被免疫）', r.isTrickPicker);
}

console.log('③ 超能妙喵｜戲法舞步 vs 硬岩【鬥】能量 鬥寶可夢 → 應免疫（能量不變）');
{
  const r = run(MEOWMEOW, [en(PSY), en(PSY)], [en(HARDROCK), en(DARK)]);
  ck('防守方存活（HP340 吃 80）', r.alive);
  ck('對手戰鬥位能量數不變（2→2，未自動搬走）', r.before === 2 && r.after === 2);
  ck('log 提及不受招式效果影響', /不受招式效果影響|硬岩|免疫/.test(r.log));
}

console.log(`\n戲法舞步/反轉之風 招式效果免疫：PASS ${pass} / FAIL ${fail}`);
if (fail > 0) { console.log('FAIL exists'); process.exit(1); }
console.log('all pass');
