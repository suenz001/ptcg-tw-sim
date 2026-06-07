/** 回歸網：先後攻偏好「對手決定」解析（v5.476）。勝方讓對手決定→用敗方偏好；雙方都對手決定→隨機。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const E=join(ROOT,'.fc-e.ts'),O=join(ROOT,'.fc-o.mjs'),S=join(ROOT,'.fc-s.mjs');
process.on('exit',()=>{for(const p of [E,O,S]){try{unlinkSync(p)}catch{}}});
writeFileSync(S,'export const base="";export const assets="";');
writeFileSync(E,`export { createGame } from './src/lib/game/engine';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { createGame } = await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const D={cardId:'13163',count:20};
const spec=(n)=>({name:n,entries:[D]});
let pass=0,fail=0;const T=(n,f)=>{try{f();console.log('  ✅',n);pass++;}catch(e){console.log('  ❌',n+':',e.message);fail++;}};
const orig=Math.random;
function firstIdx(prefs){ // coinWinner 固定=0
  Math.random=()=>0; // <0.5 → coinWinnerIdx=0
  const g=createGame(spec('A'),spec('B'),pool,{firstChoicePreferences:prefs});
  Math.random=orig; return g.firstPlayerIdx;
}
T('勝(0)=對手決定, 敗(1)=先攻 → 敗方(1)先攻', ()=>assert.equal(firstIdx(['opponent','first']),1));
T('勝(0)=對手決定, 敗(1)=後攻 → 勝方(0)先攻', ()=>assert.equal(firstIdx(['opponent','second']),0));
T('勝(0)=對手決定, 敗(1)=對手決定 → 隨機(勝方0先攻)', ()=>assert.equal(firstIdx(['opponent','opponent']),0));
T('勝(0)=對手決定, 敗(1)=隨機 → 隨機(勝方0先攻)', ()=>assert.equal(firstIdx(['opponent','random']),0));
T('既有不受影響：勝(0)=先攻 → 0', ()=>assert.equal(firstIdx(['first','random']),0));
T('既有不受影響：勝(0)=後攻 → 敗(1)', ()=>assert.equal(firstIdx(['second','random']),1));
Math.random=orig;
console.log(`\n對手決定解析：${pass} pass / ${fail} fail`);
process.exit(fail?1:0);
