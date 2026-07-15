// v5.952 守衛:效果KO/剩餘HP判定用有效HP(含+HP道具)非base HP。
//   胡地|手之力量 160傷 vs 100HP+英雄斗篷(=有效200) → 不該KO(HEAD 用base 100→誤KO)
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E=join(ROOT,'.eko-e.ts'),O=join(ROOT,'.eko-o.mjs'),S=join(ROOT,'.eko-s.mjs');
process.on('exit',()=>{for(const p of[E,O,S]){try{unlinkSync(p)}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,`export { ATTACK_POST } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { ATTACK_POST } = await import(pathToFileURL(O).href);
const pool=new Map();
for(const f of readdirSync(join(ROOT,'static/cards'))){if(!f.endsWith('.json')||f==='index.json')continue;
  for(const c of JSON.parse(readFileSync(join(ROOT,'static/cards',f),'utf8')))pool.set(String(c.id),c);}
let nn=0;
const inst=(cid,x={})=>({iid:'i'+(++nn),cardId:cid,damage:0,energyAttached:[],...x});
const ALAKAZAM='17974'; // 胡地 手之力量
const BASIC100='18074'; // 古空棘魚 100HP
const HEROCAPE='17158'; // 英雄斗篷 +100HP
function mk() {
  const def = inst(BASIC100, { toolAttached: inst(HEROCAPE) });  // 有效HP=200
  return { st:{
    phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:0, turn:5, isFirstTurn:false,
    pendingPrizes:[0,0], log:[], pendingSelection:null, activeStadium:null, setupDone:[true,true],
    players:[
      { active: inst(ALAKAZAM), bench:[], hand:Array.from({length:8},()=>inst(BASIC100)), deck:[], discard:[], prizes:Array.from({length:6},()=>inst(BASIC100)), name:'P0' },  // 手牌8張→160傷
      { active: def, bench:[], hand:[], deck:[], discard:[], prizes:Array.from({length:6},()=>inst(BASIC100)), name:'P1' },
    ] }, def };
}
const { st, def } = mk();
const fn = ATTACK_POST.get('胡地|手之力量');
assert.ok(fn, 'ATTACK_POST 應有 胡地|手之力量');
const out = fn(st, 0, pool);
const oppActive = out.players[1].active;
// 斷言:160傷 < 有效200 → 不KO,active 存活 damage=160(HEAD base100→160>=100 KO成 null)
assert.ok(oppActive && oppActive.iid === def.iid, `160傷<有效HP200不該KO(得 active=${oppActive?oppActive.iid:'null(誤KO)'})`);
assert.strictEqual(oppActive.damage, 160, `應累積160傷害(得 ${oppActive.damage})`);
console.log('✅ 效果KO有效HP守衛過(手之力量160 vs 有效200 不誤KO)');
