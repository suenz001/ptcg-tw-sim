#!/usr/bin/env node
/**
 * 回歸測試網：手動結算傷害的招式（狙擊 / 分配 / 單體狙擊）對「免疫特性 / 太晶 / 弱點」是否正確處理。
 *
 * 背景：引擎有兩條傷害路徑——(A) 主管線（招式回傳固定傷害，引擎集中算弱點+免疫+擊倒）；
 *   (B) 手動結算（regPre 回傳 0、resolver 自己加傷害；狙擊/分配/打全部備戰用這條）。
 *   B 類每個 resolver 都要自己重寫一遍免疫/弱點，漏掉就是 bug
 *   （歷史：神秘石居 v5.367 / 順滑大衣 v5.368 / 弱點 v5.369 / snipe active 神秘石居 v5.370）。
 *   此測試把 B 類共用 resolver × 各免疫情境一次跑過；新卡若沿用既有 resolver 自動受保護，
 *   新增 resolver 請在 RESOLVERS 加一行。
 *
 * Run: node scripts/test-damage-immunity-matrix.mjs   （exit 0=全過 / 1=有 FAIL）
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENTRY = join(ROOT, '.tmp-dmg-matrix-entry.ts');
const OUT = join(ROOT, '.tmp-dmg-matrix-bundle.mjs');
const SHIM = join(ROOT, '.tmp-dmg-matrix-shim.mjs');
process.on('exit', () => { for (const p of [ENTRY, OUT, SHIM]) { try { unlinkSync(p); } catch {} } });

writeFileSync(SHIM, 'export const base="";export const assets="";');
writeFileSync(ENTRY, `export { applyAction } from './src/lib/game/engine';`);
await build({
  entryPoints: [ENTRY], outfile: OUT, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': SHIM },
  logLevel: 'error',
});
const { applyAction } = await import(pathToFileURL(OUT).href);

const pool = new Map();
for (const f of readdirSync(join(ROOT, 'static/cards'))) {
  if (!f.endsWith('.json') || f === 'index.json') continue;
  for (const c of JSON.parse(readFileSync(join(ROOT, 'static/cards', f), 'utf8'))) pool.set(String(c.id), c);
}
const eid = (n) => { for (const [id, c] of pool) if (c.name === n) return id; return '?'; };
const FIRE = eid('基本【火】能量'), GRASS = eid('基本【草】能量'), DARK = eid('基本【惡】能量');

const EX_ATK = '12762';      // 奧利瓦ex（Grass ex）→ 觸發神秘石居(免疫 ex)
const FIRE_EX_ATK = '16610'; // 閃焰王牌ex（Fire ex）→ 測弱火 ×2
const ROCK = '12666';        // 岩殿居蟹｜神秘石居
const TERA = '14677';        // 太晶寶可夢（備戰免疫）
const NORMAL = '10605';      // 不良蛙 70HP
const COAT = '18491';        // 奇諾栗鼠ex｜順滑大衣（擲幣）
const WEAK_FIRE = '16535';   // 蜜集大蛇ex（弱火×2，330HP）

let nn = 0;
const inst = (cid, e = [], x = {}) => ({ iid: 'i' + (++nn), cardId: cid, damage: 0, energyAttached: e, ...x });
const en = (cid) => ({ iid: 'e' + (++nn), cardId: cid, damage: 0, energyAttached: [] });

function mkState(attackerId, defActive, defBench) {
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, turnCount: 3,
    pendingPrizes: [0, 0], log: [], pendingSelection: null, activeStadium: null,
    players: [
      { active: inst(attackerId, [en(GRASS), en(FIRE), en(DARK)]), bench: [inst(NORMAL)], hand: [], deck: Array.from({ length: 10 }, () => en(DARK)), discard: [], prizes: Array.from({ length: 6 }, () => en(DARK)), setupDone: true, name: 'P0' },
      { active: defActive, bench: defBench, hand: [], deck: Array.from({ length: 10 }, () => en(DARK)), discard: [], prizes: Array.from({ length: 6 }, () => en(DARK)), setupDone: true, name: 'P1' },
    ],
  };
}

function runResolver(effectKey, meta, attackerId, defActive, defBench, targetIid) {
  let st = mkState(attackerId, defActive, defBench);
  st.pendingSelection = { type: meta.type, actorIdx: 0, sourcePlayerIdx: 1, minCount: 1, maxCount: meta.maxCount ?? 1, effectKey, params: meta.p };
  const sel = meta.repeat ? Array.from({ length: meta.repeat }, () => targetIid) : [targetIid];
  st = applyAction(st, { type: 'RESOLVE_SELECTION', effectKey, selectedIids: sel, actorIdx: 0 }, pool);
  const t = st.players[1].active?.iid === targetIid ? st.players[1].active : st.players[1].bench.find((c) => c.iid === targetIid);
  return t ? t.damage : 'KO';
}

const RESOLVERS = [
  { key: 'snipe-variable', meta: { type: 'opp-poke-choose', p: { includeActive: true, damage: 200, label: 'T', kind: 'attack-damage' } } },
  { key: 'olive-oil-distribute', meta: { type: 'damage-distribute', maxCount: 6, repeat: 6, p: { totalCounters: 6, placedCounters: 0, counterDamage: 20, label: 'T', includeActive: true } } },
  { key: 'm5-seaking-water-shot', meta: { type: 'opp-poke-choose', p: { includeActive: true, damage: 200 } } },
  { key: 'm5-kuwaganon-dash', meta: { type: 'opp-poke-choose', p: { includeActive: true, damage: 200 } } },
  { key: 'm5-mandibuzz-bone-snipe', meta: { type: 'opp-poke-choose', p: { includeActive: true, damage: 200 } } },
];

let pass = 0; const fails = [];
const check = (name, ok, detail) => { if (ok) pass++; else fails.push(`${name} — ${detail}`); };

for (const r of RESOLVERS) {
  const rb = inst(ROCK);
  check(`${r.key} / 神秘石居 bench vs ex`, runResolver(r.key, r.meta, EX_ATK, inst(NORMAL), [rb], rb.iid) === 0, '應 0');
  const ra = inst(ROCK);
  check(`${r.key} / 神秘石居 ACTIVE vs ex`, runResolver(r.key, r.meta, EX_ATK, ra, [inst(NORMAL)], ra.iid) === 0, '應 0');
  const tb = inst(TERA);
  check(`${r.key} / 太晶 bench`, runResolver(r.key, r.meta, EX_ATK, inst(NORMAL), [tb], tb.iid) === 0, '應 0');
  const na = inst(NORMAL);
  const dn = runResolver(r.key, r.meta, EX_ATK, na, [inst(NORMAL)], na.iid);
  check(`${r.key} / 一般 active 受傷`, dn === 'KO' || dn > 0, `應 >0，得 ${dn}`);
}

{
  let imm = 0, hit = 0;
  for (let k = 0; k < 40; k++) {
    const ca = inst(COAT);
    const d = runResolver('snipe-variable', { type: 'opp-poke-choose', p: { includeActive: true, damage: 100, label: 'T', kind: 'attack-damage' } }, EX_ATK, ca, [inst(NORMAL)], ca.iid);
    if (d === 0) imm++; else hit++;
  }
  check('snipe-variable / 順滑大衣 active 擲幣', imm > 0 && hit > 0, `免疫 ${imm} / 受傷 ${hit}`);
}

{
  const wa = inst(WEAK_FIRE);
  let st = mkState(FIRE_EX_ATK, wa, [inst(NORMAL)]);
  st.pendingSelection = { type: 'opp-poke-choose', actorIdx: 0, sourcePlayerIdx: 1, minCount: 1, maxCount: 1, effectKey: 'snipe-variable', params: { includeActive: true, damage: 180, label: 'T', kind: 'attack-damage' } };
  st = applyAction(st, { type: 'RESOLVE_SELECTION', effectKey: 'snipe-variable', selectedIids: [wa.iid], actorIdx: 0 }, pool);
  check('snipe-variable / 弱火 active ×2', st.players[1].active?.iid !== wa.iid, '180×2 應 KO 330HP');

  const wb = inst(WEAK_FIRE);
  let st2 = mkState(FIRE_EX_ATK, inst(NORMAL), [wb]);
  st2.pendingSelection = { type: 'opp-poke-choose', actorIdx: 0, sourcePlayerIdx: 1, minCount: 1, maxCount: 1, effectKey: 'snipe-variable', params: { includeActive: true, damage: 180, label: 'T', kind: 'attack-damage' } };
  st2 = applyAction(st2, { type: 'RESOLVE_SELECTION', effectKey: 'snipe-variable', selectedIids: [wb.iid], actorIdx: 0 }, pool);
  const bd = st2.players[1].bench.find((c) => c.iid === wb.iid)?.damage;
  check('snipe-variable / 弱火 bench 不計弱抗', bd === 180, `應 180(flat)，得 ${bd}`);
}

console.log(`\n傷害免疫矩陣：PASS ${pass} / FAIL ${fails.length}`);
for (const f of fails) console.log('  ❌', f);
if (fails.length > 0) { console.log('\n有招式漏算免疫/弱點！'); process.exit(1); }
console.log('全部通過 ✅');
