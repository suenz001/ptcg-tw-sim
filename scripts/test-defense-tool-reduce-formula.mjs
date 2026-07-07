/** v5.899 屬性防禦道具(渾厚鱗片等TOOL_DEFENSE_REDUCE_BY_TYPE)+金屬障礙的減傷,原漏 addLog/formula.push
 *  → 傷害公式看起來像「100(基礎)+30(猛攻手鐲)=80」缺 -50 項(玩家以為數學錯)。修:補 formula 項+log。
 *  HEAD-FAIL:HEAD formula 無 渾厚鱗片 項且 = 對不上。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.df-s.js'), E = join(ROOT, '.df-e.ts'), O = join(ROOT, '.df-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || f === 'card-set-map.json' || f.includes('_') || !live.has(f.slice(0, -5))) continue; try{for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);}catch{} }
const WRAP='10426', GRASS='11173', MRB='17025', SCALE='14824';
let brace=null; for(const [id,c] of pool){ if(c.name==='猛攻手鐲'){brace=id;break;} }
let nn = 0;
const inst = (cid, ex={}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], toolAttached: undefined, extraTools: [], status: null, secondaryStatus: null, tertiaryStatus: null, ...ex });
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };
const logTxt = s => s.log.map(l=>typeof l==='string'?l:(l.msg||l.message||'')).join('\n');

T('★裹蜜蟲朋友之環(5備戰)+猛攻手鐲 vs 猛雷鼓ex(渾厚鱗片) → 80,公式含-50(渾厚鱗片) [HEAD-FAIL]', () => {
  const attacker=inst(WRAP,{energyAttached:[inst(GRASS)],toolAttached:inst(brace)});
  const defender=inst(MRB,{toolAttached:inst(SCALE)});
  const s={id:'t',phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,setupDone:[true,true],pendingPrizes:[0,0],
    players:[{name:'ME',active:attacker,bench:[inst('14319'),inst('14319'),inst('14319'),inst('14319'),inst('14319')],hand:[],deck:[inst('14319')],discard:[],prizes:[inst('14319')]},
             {name:'OP',active:defender,bench:[inst('14319')],hand:[],deck:[inst('14319')],discard:[],prizes:[inst('14319')]}]};
  const out=mod.applyAction(s,{type:'ATTACK',attackIndex:0},pool);
  assert.equal(out.players[1].active?.damage, 80, '傷害 100+30-50=80');
  const txt=logTxt(out);
  assert.ok(txt.includes('渾厚鱗片：招式傷害 -50'), 'log 揭示渾厚鱗片 -50');
  assert.ok(/100\(基礎\).*\+30\(猛攻手鐲\).*-50\(渾厚鱗片\).*= 80/.test(txt), `公式含-50且=80對得上,實際:\n${txt}`);
});

console.log('\n屬性防禦道具減傷公式(v5.899):PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
