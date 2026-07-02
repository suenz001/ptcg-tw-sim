/** v5.844 reg key 卡名一致性守衛
 *  所有 ATTACK_PRE/POST/ABILITY registry key 的「卡名」部分,必須存在於 static/cards 官方 name。
 *  遊戲用卡片 name 查 handler → key 卡名有錯字/陸譯/多字元(如 <莉佳的>臭臭花) → 永遠 lookup 不到
 *  = 招式/特性靜默失效(玩家只覺得沒效果,最難察覺)。見 v5.843 抓出 4 個尖括號 key。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.rk-s.js'),E=join(ROOT,'.rk-e.ts'),O=join(ROOT,'.rk-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { ATTACK_PRE, ATTACK_POST, ABILITY_EFFECTS, ABILITY_EFFECTS_BY_NAME } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const M=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
// 官方 name 全集(含非 live,因為 key 可能對應剛輪替卡;錯字才是真問題)
const allNames=new Set();
for(const f of readdirSync(dir)){ if(!f.endsWith('.json')||f==='index.json') continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))) if(c?.name) allNames.add(c.name); }
// self-check:比對邏輯有效性(假卡名應被判不存在)
assert.equal(allNames.has('<不存在的>假卡名XYZ'), false);
const kk=(map)=>{try{return [...map.keys()];}catch{return [];}};
const keys=[...kk(M.ATTACK_PRE),...kk(M.ATTACK_POST),...kk(M.ABILITY_EFFECTS),...kk(M.ABILITY_EFFECTS_BY_NAME)];
const bad=new Set();
for(const k of keys){ const cn=String(k).split('|')[0]; if(cn && !allNames.has(cn)) bad.add(`${cn}  (key=${k})`); }
const u=[...bad].sort();
if(u.length){ console.log('reg key 卡名不存在於 static/cards:'); for(const x of u) console.log('  ✗',x); }
console.log(`\nreg key 卡名一致性(v5.844):${u.length===0?'✅ 全部對齊官方 name':'❌ '+u.length+' 個失效 key'}`);
assert.equal(u.length,0,'reg key 卡名須逐字對齊 static/cards 官方 name(否則 handler 靜默失效)');
console.log('PASS');
