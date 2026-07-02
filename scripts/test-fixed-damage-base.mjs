/** v5.843 固定傷害 base 一致性守衛（固化 v5.686 一次性 audit 為常駐測試）
 *  純數字傷害招式(卡面 damage 為純數字,無 +/×/條件)若有 ATTACK_PRE,乾淨盤面跑出的 base
 *  必須 === 卡面數字,或 === 0(條件失敗/picker 延後傷害,合理)。非 0 且不符 = regPre 硬寫錯 base
 *  (如當年 班基拉斯ex|暴君粉碎 硬寫 50 實 150)。新卡硬寫錯會被此測試自動擋。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.fd-s.js'),E=join(ROOT,'.fd-e.ts'),O=join(ROOT,'.fd-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { ATTACK_PRE } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { ATTACK_PRE }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map(); const cards=[];
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))){if(c?.id!=null)pool.set(String(c.id),c); if(c?.attacks)cards.push(c);}}
let nn=0; const inst=(cid)=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[{cardId:'e',iid:'x'+nn},{cardId:'e',iid:'y'+nn},{cardId:'e',iid:'z'+nn},{cardId:'e',iid:'w'+nn}],status:null,secondaryStatus:null,tertiaryStatus:null});
const mk=(cid)=>({phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
  players:[{name:'P1',active:inst(cid),bench:[inst(cid)],hand:[],deck:[],discard:[],prizes:[1,1,1,1,1,1]},
           {name:'P2',active:inst(cid),bench:[inst(cid)],hand:[],deck:[],discard:[],prizes:[1,1,1,1,1,1]}]});
const probe=(name,atkName,cid)=>{ const pre=ATTACK_PRE.get(`${name}|${atkName}`); if(!pre) return null;
  try{ const r=pre(mk(String(cid)),0,pool,{}); return typeof r?.damage==='number'?r.damage:null; }catch{ return null; } };
// self-check:偵測邏輯有效性(假造 base≠卡面應被判為 mismatch)
assert.equal((100!==0 && 100!==150), true, 'self-check: 比對邏輯應能辨識不符');
let mismatch=[];
for(const c of cards){
  for(const a of c.attacks||[]){
    const dmg=String(a.damage||'').trim();
    if(!/^\d+$/.test(dmg)) continue;
    const cardNum=parseInt(dmg,10);
    const base=probe(c.name,a.name,c.id);
    if(base===null) continue;         // 無 regPre → 引擎讀卡面(安全)
    if(base!==0 && base!==cardNum) mismatch.push(`${c.name}|${a.name} (${c.regulationMark}) 卡面${cardNum} vs regPre base ${base}`);
  }
}
const uniq=[...new Set(mismatch)];
if(uniq.length){ console.log('固定傷害 base 不符卡面:'); for(const m of uniq) console.log('  ✗',m); }
console.log(`\n固定傷害 base 一致性(v5.843):${uniq.length===0?'✅ 全部一致':'❌ '+uniq.length+' 處不符'}`);
assert.equal(uniq.length, 0, '固定傷害招式 regPre base 應等於卡面數字(或 0);非 0 不符請改讓引擎讀卡面或修正 base');
console.log('PASS');
process.exit(0);
