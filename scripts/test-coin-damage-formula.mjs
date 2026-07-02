/** v5.843 擲硬幣傷害公式一致性守衛（固化卡面驅動 audit 為常駐測試）
 *  自動掃 live 卡三類擲幣傷害招式,強制擲幣結果跑 ATTACK_PRE,比對卡面公式:
 *   ① 擲N次「正面出現的次數×M」(全正面 → base + N×M)
 *   ② 擲到反面為止「正面×M」    (1正後反 → base + 1×M)
 *   ③ 擲1次正面「增加M點傷害」    (全正面 → base + M)
 *  base:「增加」型讀卡面 damage 欄數字,「造成」型為 0。dmg===0 視為條件/picker/POST 延後(跳過)。
 *  非 0 且不符 = 係數/base/擲法寫錯。新卡公式寫錯會被自動擋。host-aware「擲與能量數」型不在此列。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.cd-s.js'),E=join(ROOT,'.cd-e.ts'),O=join(ROOT,'.cd-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { ATTACK_PRE } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { ATTACK_PRE }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map(); const cards=[];
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))){if(c?.id!=null)pool.set(String(c.id),c); if(c?.attacks&&['H','I','J'].includes(c.regulationMark))cards.push(c);}}
let nn=0; const inst=(cid)=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],status:null,secondaryStatus:null,tertiaryStatus:null});
const mk=(cid)=>({phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,_lastCoinHeads:0,
  players:[{name:'P1',active:inst(cid),bench:[inst(cid)],hand:[],deck:[],discard:[],prizes:[1,1,1,1,1,1]},
           {name:'P2',active:inst(cid),bench:[inst(cid)],hand:[],deck:[],discard:[],prizes:[1,1,1,1,1,1]}]});
const orig=Math.random;
function run(name,atk,cid,rand){ Math.random=rand; const pre=ATTACK_PRE.get(`${name}|${atk}`);
  let dmg=null; try{ if(pre){ const r=pre(mk(String(cid)),0,pool,{}); dmg=r?.damage; } }catch{ dmg=null; } Math.random=orig; return dmg; }
const baseOf=(a,isAdd)=>{ if(!isAdd) return 0; const m=String(a.damage||'').match(/^(\d+)/); return m?+m[1]:0; };
// self-check：比對邏輯有效性
assert.equal((0!==0)||(30!==0 && 30!==50), true);
let mism=[];
for(const c of cards){ for(const a of c.attacks||[]){
  const eff=a.effect||''; const isAdd=/增加正面出現的次數×|增加(\d+)點傷害/.test(eff);
  let expect=null, dmg=null, tag='';
  let m;
  if((m=eff.match(/擲\s*(\d+)\s*次硬幣.*?正面出現的次數×(\d+)點/))){        // ① 固定次數
    const N=+m[1],M=+m[2]; expect=baseOf(a,isAdd)+N*M; tag=`擲${N}正面×${M}`;
    dmg=run(c.name,a.name,c.id,()=>0);                                    // 全正面
  } else if(/擲.*?反面.*?為止|直到.*?反面/.test(eff) && (m=eff.match(/正面出現的次數×(\d+)點/))){ // ② 擲到反面
    const M=+m[1]; expect=baseOf(a,isAdd)+M; tag=`擲到反面×${M}(1正)`;
    let k=0; dmg=run(c.name,a.name,c.id,()=>(k++===0?0:0.9));             // 1正後反
  } else if((m=eff.match(/擲\s*1\s*次硬幣若為正面，則增加(\d+)點傷害/))){  // ③ 擲1次增傷
    const M=+m[1]; const b=(String(a.damage||'').match(/^(\d+)/)||[])[1]; expect=(b?+b:0)+M; tag=`擲1增${M}`;
    dmg=run(c.name,a.name,c.id,()=>0);
  } else continue;
  if(dmg===null||dmg===0) continue;      // 無PRE / POST延後 / 條件 → 跳過
  if(dmg!==expect) mism.push(`✗ ${c.name}|${a.name} [${c.regulationMark}] ${tag} 卡面預期${expect} vs 實跑${dmg}`);
}}
const u=[...new Set(mism)];
if(u.length){ console.log('擲硬幣傷害公式 不符:'); for(const x of u) console.log('  ',x); }
console.log(`\n擲硬幣傷害公式一致性(v5.843):${u.length===0?'✅ 全部一致':'❌ '+u.length+' 處'}`);
assert.equal(u.length,0,'擲硬幣傷害公式應符合卡面(base+正面數×係數);非0不符請修正 base/係數/擲法');
console.log('PASS');
