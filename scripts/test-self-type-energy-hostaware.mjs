/**
 * 自身【X】能量數×傷害 — host-aware 計數（v5.688）
 * 卡面「增加/造成 這隻寶可夢身上附加的【X】能量的數量×N點傷害」應認列「當下視為【X】」的特殊能量：
 *   古舊能量(全屬性×1)、火箭隊能量(超/惡各×2)、稜鏡(Basic)、燃火(進化×3)、新衝天(Stage2×2)。
 * 原 bug：selfEnergyCountPre(energyMatchesType 迴圈)×3 + selfTypeEnergyPre/水炮迴旋(countOneEnergy)
 *   + 強力蒸汽(attachedEnergyNameIncludes) 都非 host-aware → 漏算古舊等(同蜜糖風暴類)。
 * 修：全部改用中央 countEnergyTypeHostAware。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.se-s.mjs'), E = join(ROOT, '.se-e.ts'), O = join(ROOT, '.se-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { createGame } from './src/lib/game/engine';\nexport { ATTACK_PRE } from './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, ATTACK_PRE } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const ANCIENT = '17212', ROCKET = '14853', GRASS = '14102', WATER = '18519', LIGHT = '18520', DARK = '14430';
let nn = 0;
const inst = (cid, x = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...x });
const DEF = '14705';
function dmg(cid, key, energyIds) {
  const s = createGame({ name:'P1', entries:[{cardId:cid,count:1}] }, { name:'P2', entries:[{cardId:DEF,count:1}] }, pool);
  const st = { ...s, phase:'playing', turnPhase:'main', activePlayerIndex:0,
    players:[{ ...s.players[0], active: inst(cid,{energyAttached:energyIds.map(e=>inst(e))}), bench:[] }, { ...s.players[1], active: inst(DEF), bench:[] }] };
  return ATTACK_PRE.get(key)(st, 0, pool).damage;
}
let pass = 0, fail = 0;
const T = (nm, f) => { try { f(); console.log('  OK', nm); pass++; } catch (e) { console.log('  FAIL', nm, '::', e.message); fail++; } };

// 每個程式點各一招（古舊應視為該屬性 ×1；HEAD 漏算）
T('★吼鯨王|水炮 selfTypeEnergyPre：水+古舊=2水 → 10+2×50=110 (HEAD古舊漏→60)', () =>
  assert.equal(dmg('16652','吼鯨王|水炮',[WATER,ANCIENT]), 110));
T('★大電海燕ex|雷電槍 selfEnergyCountPre(v2740)：雷+古舊 → 40+2×40=120 (HEAD→80)', () =>
  assert.equal(dmg('10518','大電海燕ex|雷電槍',[LIGHT,ANCIENT]), 120));
T('★哥達鴨|水炮 selfEnergyCountPre(v2640)：水+古舊 → 60+2×20=100 (HEAD→80)', () =>
  assert.equal(dmg('14693','哥達鴨|水炮',[WATER,ANCIENT]), 100));
T('★椰蛋樹|木之重壓 selfEnergyCountPre(v2490表)：草+古舊 → 60+2×30=120 (HEAD→90)', () =>
  assert.equal(dmg('13962','椰蛋樹|木之重壓',[GRASS,ANCIENT]), 120));
T('★拉普拉斯ex|水炮迴旋 inline：水+古舊=2 → 2×30=60 (HEAD古舊漏→30)', () =>
  assert.equal(dmg('14085','拉普拉斯ex|水炮迴旋',[WATER,ANCIENT]), 60));
// 火箭隊能量「視為提供2個【惡】」→ 扣殺輪(惡)應算2單位
T('★瑪俐的莫魯貝可|扣殺輪：1火箭隊能量=2惡單位 → 20+2×40=100 (HEAD→60)', () =>
  assert.equal(dmg('12611','瑪俐的莫魯貝可|扣殺輪',[ROCKET]), 100));
// baseline：純基本能量不受影響
T('baseline 吼鯨王|水炮 2基本水 → 110', () => assert.equal(dmg('16652','吼鯨王|水炮',[WATER,WATER]), 110));

console.log('\n自身型別能量 host-aware:PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
