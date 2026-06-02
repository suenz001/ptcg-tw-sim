#!/usr/bin/env node
/**
 * 回歸測試網：寶可夢「招式效果」(attack-effect) 對各免疫來源是否正確處理。
 *
 * 背景：招式分兩類 ——
 *   (A) 招式傷害 attack-damage（卡面列傷害值）→ 由 scripts/test-damage-immunity-matrix.mjs 測。
 *   (B) 招式效果 attack-effect（放傷害指示物 / 上特殊狀態 / 棄能量 / 招式內昏厥 等文字效果）。
 *   兩類免疫來源不同，且 defense.ts 自註：v4.54 / v4.57 / v4.58 反覆踩「kind 弄錯」雷
 *   （attack-damage 卡誤標 attack-effect、或反之）。中央關卡擋不住分類標錯，需測試把關。
 *
 * 此測試直接打中央關卡 canApplyEffectToTarget（所有招式效果 caller 都應走它），
 *   對「各免疫來源 × attack-effect 應擋」+「kind 區分」(純樸只擋效果 / 太晶只擋傷害 /
 *   阿塞蘿拉只擋 ex) 一次跑過。新增免疫來源或新效果招式時，請在對應區塊補一條。
 *
 * Run: node scripts/test-attack-effect-immunity-matrix.mjs   （exit 0=全過 / 1=有 FAIL）
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENTRY = join(ROOT, '.tmp-aei-entry.ts');
const OUT = join(ROOT, '.tmp-aei-bundle.mjs');
const SHIM = join(ROOT, '.tmp-aei-shim.mjs');
process.on('exit', () => { for (const p of [ENTRY, OUT, SHIM]) { try { unlinkSync(p); } catch {} } });

writeFileSync(SHIM, 'export const base="";export const assets="";');
writeFileSync(ENTRY, `export { canApplyEffectToTarget } from './src/lib/game/defense';`);
await build({
  entryPoints: [ENTRY], outfile: OUT, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': SHIM },
  logLevel: 'error',
});
const { canApplyEffectToTarget } = await import(pathToFileURL(OUT).href);

const pool = new Map();
for (const f of readdirSync(join(ROOT, 'static/cards'))) {
  if (!f.endsWith('.json') || f === 'index.json') continue;
  for (const c of JSON.parse(readFileSync(join(ROOT, 'static/cards', f), 'utf8'))) pool.set(String(c.id), c);
}
const byName = (n) => { for (const [id, c] of pool) if (c.name === n) return id; throw new Error('找不到卡：' + n); };

const ATK_NORMAL = byName('含羞苞');
const ATK_EX     = byName('拉普拉斯ex');
const MIST       = byName('薄霧能量');
const HARDROCK   = byName('硬岩【鬥】能量');
const FIGHT_BASIC= byName('古空棘魚');
const CLEAN      = byName('含羞苞');
const SHADOWVEIL = byName('斯魔茶');
const EMPEROR    = byName('帝王拿波ex');
const SHELL      = byName('肋骨海龜');
const VEIL_HOLDER= byName('火箭隊的急凍鳥');
const ROCKET_BAS = byName('火箭隊的團珠蛛');
const ARENA      = byName('對戰圓形競技場');
const TERA       = byName('厄鬼椪 碧草面具ex');

let nn = 0;
const inst = (cid, x = {}) => ({ iid: 'i' + (++nn), cardId: cid, damage: 0, energyAttached: [], ...x });
const en = (cid) => ({ iid: 'e' + (++nn), cardId: cid, damage: 0, energyAttached: [] });

function mkState({ atk = ATK_NORMAL, atkEnergy = [], defActive = null, defBench = [], stadium = null } = {}) {
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, turn: 3,
    activeStadium: stadium ? { cardId: stadium } : null,
    players: [
      { name: 'P0', active: inst(atk, { energyAttached: atkEnergy }), bench: [], hand: [], deck: [], discard: [], prizes: [], setupDone: true },
      { name: 'P1', active: defActive, bench: defBench, hand: [], deck: [], discard: [], prizes: [], setupDone: true },
    ],
  };
}
function check(state, target, kind, isBench) {
  return canApplyEffectToTarget(state, 0, target, pool.get(target.cardId), kind, pool, { isBench });
}

let pass = 0; const fails = [];
const ck = (name, ok, detail = '') => { if (ok) pass++; else fails.push(`${name} — ${detail}`); };

{ const t = inst(CLEAN, { immuneToAllAttackThisTurn: true });
  ck('飛翔類 / 擋 attack-effect', check(mkState({ defActive: t }), t, 'attack-effect', false).blocked, '應 blocked');
  const t2 = inst(CLEAN, { immuneToAllAttackThisTurn: true });
  ck('飛翔類 / 也擋 attack-damage', check(mkState({ defActive: t2 }), t2, 'attack-damage', false).blocked, '應 blocked'); }
{ const t = inst(CLEAN, { immuneToAttackEffectsThisTurn: true });
  ck('純樸 / 擋 attack-effect', check(mkState({ defActive: t }), t, 'attack-effect', false).blocked, '應 blocked');
  const t2 = inst(CLEAN, { immuneToAttackEffectsThisTurn: true });
  ck('純樸 / 不擋 attack-damage（kind 區分）', !check(mkState({ defActive: t2 }), t2, 'attack-damage', false).blocked, '應 NOT blocked'); }
{ const t = inst(CLEAN, { immuneToExAttackThisTurn: true });
  ck('阿塞蘿拉 / ex 攻擊方擋 attack-effect', check(mkState({ atk: ATK_EX, defActive: t }), t, 'attack-effect', false).blocked, '應 blocked');
  const t2 = inst(CLEAN, { immuneToExAttackThisTurn: true });
  ck('阿塞蘿拉 / 一般攻擊方不擋', !check(mkState({ atk: ATK_NORMAL, defActive: t2 }), t2, 'attack-effect', false).blocked, '應 NOT blocked'); }

{ const t = inst(SHADOWVEIL);
  ck('化隱 / 擋 attack-effect', check(mkState({ defActive: t }), t, 'attack-effect', false).blocked, '應 blocked'); }
{ const t = inst(EMPEROR);
  ck('皇帝之勢 / 擋 attack-effect', check(mkState({ defActive: t }), t, 'attack-effect', false).blocked, '應 blocked'); }
{ const t1 = inst(SHELL);
  ck('全能硬殼 / 攻擊方有特殊能量 → 擋', check(mkState({ atk: ATK_NORMAL, atkEnergy: [en(MIST)], defActive: t1 }), t1, 'attack-effect', false).blocked, '應 blocked');
  const t2 = inst(SHELL);
  ck('全能硬殼 / 攻擊方無特殊能量 → 不擋（special-case）', !check(mkState({ atk: ATK_NORMAL, atkEnergy: [], defActive: t2 }), t2, 'attack-effect', false).blocked, '應 NOT blocked'); }
{ const holder = inst(VEIL_HOLDER); const rocketT = inst(ROCKET_BAS);
  ck('抵抗之幕 / 火箭隊的基礎目標 → 擋', check(mkState({ defActive: rocketT, defBench: [holder] }), rocketT, 'attack-effect', false).blocked, '應 blocked');
  const holder2 = inst(VEIL_HOLDER); const nonRocket = inst(CLEAN);
  ck('抵抗之幕 / 非火箭隊目標 → 不擋（targetFilter）', !check(mkState({ defActive: nonRocket, defBench: [holder2] }), nonRocket, 'attack-effect', false).blocked, '應 NOT blocked'); }

{ const t = inst(CLEAN, { energyAttached: [en(MIST)] });
  ck('薄霧能量 / 擋 attack-effect', check(mkState({ defActive: t }), t, 'attack-effect', false).blocked, '應 blocked'); }
{ const tf = inst(FIGHT_BASIC, { energyAttached: [en(HARDROCK)] });
  ck('硬岩【鬥】能量 / 鬥屬性目標 → 擋', check(mkState({ defActive: tf }), tf, 'attack-effect', false).blocked, '應 blocked');
  const tn = inst(CLEAN, { energyAttached: [en(HARDROCK)] });
  ck('硬岩【鬥】能量 / 非鬥屬性 → 不擋（requireType）', !check(mkState({ defActive: tn }), tn, 'attack-effect', false).blocked, '應 NOT blocked'); }

{ const t = inst(CLEAN);
  ck('對戰圓形競技場 / 擋備戰 attack-effect', check(mkState({ defActive: inst(CLEAN), defBench: [t], stadium: ARENA }), t, 'attack-effect', true).blocked, '應 blocked'); }
{ const td = inst(TERA);
  ck('太晶備戰 / 擋 attack-damage', check(mkState({ defActive: inst(CLEAN), defBench: [td] }), td, 'attack-damage', true).blocked, '應 blocked');
  const te = inst(TERA);
  ck('太晶備戰 / 不擋 attack-effect（kind 區分）', !check(mkState({ defActive: inst(CLEAN), defBench: [te] }), te, 'attack-effect', true).blocked, '應 NOT blocked'); }

{ const t = inst(CLEAN);
  ck('一般目標無免疫 / attack-effect 不被擋', !check(mkState({ defActive: t }), t, 'attack-effect', false).blocked, '應 NOT blocked'); }

console.log(`\n招式效果免疫矩陣：PASS ${pass} / FAIL ${fails.length}`);
for (const f of fails) console.log('  ❌', f);
if (fails.length > 0) { console.log('\n有招式效果免疫判定錯誤！'); process.exit(1); }
console.log('全部通過 ✅');
