import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { compile } from 'svelte/compiler';
import { pwLaunch } from './lib/pw.mjs';
import { readBaseBlob } from './lib/base-blob.mjs';
import { PAIRS, revertV6610File } from './lib/revert-v6610-energy-labels.mjs';
// ⭐v6.611（Rule 40）：標記元件改成「一顆膠囊」——釘位元組的 P 段先用 v6.611 還原表還原成 v6.610 再比（意圖：v6.610 只改那六檔、CSS 沒動）；
//   B 段仍然測現行元件，只把觀測點換成一顆膠囊的文字（數量格式「一張省略、多張桌機×N／手機N」與完整卡名、可點、不冒泡等意圖逐條保留）。
import { revertV6611File, hasV6611File } from './lib/revert-v6611-energy-pill.mjs';
import { revertV6613File, hasV6613File } from './lib/revert-v6613-action-spacing.mjs';   // ⭐v6.613（Rule 40）
import { revertV6612File, hasV6612File } from './lib/revert-v6612-view-mode.mjs';   // ⭐v6.612（Rule 40）
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PRODUCT = process.env.V6610_PRODUCT || ROOT;
const BASE='9aa83ddd54e2ba286957ebd7b9eabd0a5f669478';
const rd=p=>readFileSync(join(PRODUCT,p),'utf8').replace(/\r\n/g,'\n');
const rdP=p=>{let x=rd(p);if(hasV6613File(p,x))x=revertV6613File(p,x);if(hasV6612File(p,x))x=revertV6612File(p,x);return hasV6611File(p,x)?revertV6611File(p,x):x;};   // ⭐v6.611（Rule 40）：只給 P 段用（標記元件與 changelog 三檔先還原成 v6.610）
const base=p=>{const r=readBaseBlob(ROOT,BASE,p);assert.ok(r.ok);return r.out.replace(/\r\n/g,'\n');};
let pass=0,fail=0;
async function T(name,fn){try{await fn();pass++;console.log('PASS '+name);}catch(e){if(!(e instanceof assert.AssertionError))throw e;fail++;console.log('FAIL '+name+' '+e.message);}}
for(const path of ['src/lib/game/engine.ts','src/lib/game/effects.ts','src/lib/game/damage-estimate.ts','src/routes/game/+page.svelte'])await T('P 遊戲與桌機接線不變 '+path,()=>assert.equal(rdP(path),base(path)));   // ⭐v6.612（Rule 40）：對戰頁先還原 v6.612 的手機／電腦版接線
await T('P 只精確移除本版六檔差異、無關內容保留、缺失重複拒絕',()=>{
 for(const[path,pairs]of Object.entries(PAIRS)){
  const s=rdP(path);if(s===base(path))continue;
  let reverted;assert.doesNotThrow(()=>{reverted=revertV6610File(path,s);});
  // helper/元件以A/B行為守住；完整六檔的BASE等值另由外部還原證據驗證，避免純註解造成行為假紅。
  if(path!== 'src/lib/cards/attached-energy.ts' && path!== 'src/lib/ui/SpecialEnergyBadges.svelte')assert.equal(reverted,base(path));
  assert.equal(revertV6610File(path,s+'\n// unrelated\n'),reverted+'\n// unrelated\n');
  for(const[a]of pairs){assert.throws(()=>revertV6610File(path,s.replace(a,'')));assert.throws(()=>revertV6610File(path,s.replace(a,a+a)));}
 }
});
const helper='src/lib/cards/attached-energy.ts',badge='src/lib/ui/SpecialEnergyBadges.svelte',mobile='src/routes/game/MobilePortraitBattle.svelte';
const moduleCode=(await build({entryPoints:[join(PRODUCT,helper)],bundle:true,write:false,format:'esm',platform:'node'})).outputFiles[0].text;
const M=await import('data:text/javascript;base64,'+Buffer.from(moduleCode).toString('base64'));
const card=(id,name,subtype='Special')=>({id,name,supertype:'Energy',subtype});
const cards=[card('rock','硬岩【鬥】能量'),card('sky','新衝天能量'),card('rocket','火箭隊能量'),card('boomerang','回力鏢能量'),card('ancient','古舊能量'),card('basic','基本【鬥】能量','Basic')];
const host=ids=>({iid:'host-test',cardId:'pokemon',damage:0,energyAttached:ids.map((cardId,i)=>({iid:'energy-'+i,cardId,damage:0,energyAttached:[]}))});
await T('A1 全17種短名最多兩字，衝天火箭回力明確映射',()=>{
 const live=new Set();for(const set of JSON.parse(rd('static/cards/index.json')))for(const c of JSON.parse(rd('static/cards/'+set.code+'.json')))if(c.supertype==='Energy'&&c.subtype==='Special'&&['H','I','J'].includes(c.regulationMark))live.add(c.name);
 assert.equal(live.size,17);assert.equal(new Set([...live].map(n=>M.SPECIAL_ENERGY_NAMES[n])).size,17);
 for(const name of live){assert.ok(M.SPECIAL_ENERGY_NAMES[name]);assert.ok([...M.SPECIAL_ENERGY_NAMES[name]].length<=2,name);}
 assert.equal(M.SPECIAL_ENERGY_NAMES['新衝天能量'],'衝天');assert.equal(M.SPECIAL_ENERGY_NAMES['火箭隊能量'],'火箭');assert.equal(M.SPECIAL_ENERGY_NAMES['回力鏢能量'],'回力');
});
await T('A2 分組保留完整卡名與卡片張數、輸入及基本能量不變',()=>{
 const inst=host(['rock','rock','sky','basic']),original=JSON.stringify(inst),pool=new Map(cards.map(c=>[c.id,c]));
 assert.deepEqual(M.attachedEnergyGroups(inst,pool).map(g=>[g.name,g.count]),[['硬岩【鬥】能量',2],['新衝天能量',1],['基本【鬥】能量',1]]);
 assert.deepEqual(M.basicEnergyOnly(inst,pool).energyAttached.map(x=>x.cardId),['basic']);assert.equal(JSON.stringify(inst),original);
});
await T('A3 未知與未映射卡用兩字通稱，完整名稱與不同ID仍保留',()=>{
 const future=card('future','未來新增測試能量'),g=M.attachedEnergyGroups(host(['future','missing','missing2']),new Map([[future.id,future]]));
 assert.deepEqual(g.map(x=>[x.shortName,x.name]),[['特殊',future.name],['未知','未知能量'],['未知','未知能量']]);assert.notEqual(g[1].key,g[2].key);
});
await T('P 標記CSS逐位元不變',()=>assert.equal(rdP(badge).match(/<style>[\s\S]*<\/style>/)[0],base(badge).match(/<style>[\s\S]*<\/style>/)[0]));
const plugins=[{name:'actual-product',setup(b){
 b.onResolve({filter:/^\$lib\//},a=>{let p=join(PRODUCT,'src/lib',a.path.slice(5));if(!extname(p))p+='.ts';return{path:p};});
 b.onLoad({filter:/\.svelte$/},a=>({contents:compile(readFileSync(a.path,'utf8'),{filename:a.path,generate:'client',css:'injected'}).js.code,loader:'js',resolveDir:ROOT}));
}}];
async function bundle(source,filename){const name=filename.replace('.svelte',''),compiled=compile(source,{filename,generate:'client',css:'injected'}).js.code;return(await build({stdin:{contents:compiled+`\nimport{mount,unmount,tick}from'svelte';let mounted;window.inspects=[];window.mountSpec=async(spec)=>{if(mounted)await unmount(mounted);mounted=mount(${name},{target:document.querySelector('#mount'),props:{inst:spec.inst,pool:new Map(spec.cards),compact:spec.compact,mobile:spec.mobile,disabled:spec.disabled,oninspect:iid=>window.inspects.push(iid),onOpenEnergy:iid=>window.inspects.push(iid)}});await tick();};`,resolveDir:ROOT,sourcefile:filename+'.js'},bundle:true,write:false,format:'iife',platform:'browser',conditions:['browser'],define:{'process.env.NODE_ENV':'"production"'},plugins})).outputFiles[0].text;}
const js=await bundle(rd(badge),'EnergyLabel.svelte');
const calls=[...rd(mobile).matchAll(/<SpecialEnergyBadges\s[^>]*\/>/g)].map(m=>m[0]);assert.equal(calls.length,4);
const parent=await bundle(`<script>import SpecialEnergyBadges from '$lib/ui/SpecialEnergyBadges.svelte';let{inst,pool,onOpenEnergy}=$props();</script>${calls.join('\n')}`,'MobileLabels.svelte');
const browser=await pwLaunch('6610精簡特殊能量數量與兩字短名');assert.ok(browser);const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
async function mount(ids,compact=false,mobile=false,script=js,width=86,disabled=false){await page.setContent(`<div onclick="document.body.dataset.parent='clicked'"><div id="mount" style="width:${width}px;max-height:180px;overflow:hidden"></div></div>`);await page.addScriptTag({content:script});await page.evaluate(spec=>mountSpec(spec),{inst:host(ids),cards:cards.map(c=>[c.id,c]),compact,mobile,disabled});}
try{
await T('B1 桌機手機單張省略，兩張以上桌機×N手機N',async()=>{for(const mobile of [false,true])for(const n of [1,2,12]){await mount(Array(n).fill('rock'),false,mobile);assert.equal(await page.locator('button').innerText(),n===1?'硬岩':mobile?'硬岩'+n:'硬岩×'+n);}});   // ⭐v6.611（Rule 40）：膠囊內不留空格
await T('B2 備戰compact不決定桌機手機格式、多種類合併仍維持',async()=>{for(const mobile of [false,true]){await mount(['rock'],true,mobile);assert.equal(await page.locator('button').innerText(),'硬岩');await mount(['rock','rock'],true,mobile);assert.equal(await page.locator('button').innerText(),mobile?'硬岩2':'硬岩×2');await mount(['rock','sky'],true,mobile);assert.equal(await page.locator('button').innerText(),'特2種');}});
// ⭐v6.611（Rule 40）：三種合成一顆膠囊——桌機「衝天 等3種」、手機全列「衝天・火箭・回力」；完整卡名與張數仍在 aria-label、點一下打開正確 host、不冒泡
await T('B3 兩字標記仍有完整卡名與張數、可點正確host',async()=>{for(const mobile of [false,true]){await page.evaluate(()=>{window.inspects=[];});await mount(['sky','rocket','boomerang'],false,mobile);assert.deepEqual(await page.locator('button').allTextContents(),[mobile?'衝天・火箭・回力':'衝天 等3種']);const b=page.locator('button');for(let i=0;i<3;i++)assert.match(await b.getAttribute('aria-label'),new RegExp(cards[i+1].name+' 1張'));await b.click();assert.deepEqual(await page.evaluate(()=>window.inspects),['host-test']);assert.equal(await page.locator('body').getAttribute('data-parent'),null);}});
await T('B4 單張與12張於窄戰鬥備戰欄完整可見且可點',async()=>{for(const mobile of [false,true])for(const compact of [false,true])for(const n of [1,12]){await mount(Array(n).fill('sky'),compact,mobile,js,compact?60:86);const b=page.locator('button');const r=await b.evaluate(e=>{const b=e.getBoundingClientRect(),p=e.parentElement.parentElement.getBoundingClientRect();return{full:e.scrollWidth<=e.clientWidth+1,inside:b.left>=p.left&&b.right<=p.right+1,hit:document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)===e};});assert.ok(r.full&&r.inside&&r.hit,JSON.stringify({mobile,compact,n,r}));await b.click();assert.deepEqual(await page.evaluate(()=>window.inspects),['host-test']);}});
await T('B5 disabled與無能量保持原操作契約',async()=>{await mount(['rock'],false,true,js,86,true);assert.equal(await page.locator('button').isDisabled(),true);assert.deepEqual(await page.evaluate(()=>window.inspects),[]);await mount([]);assert.equal(await page.locator('button').count(),0);});
await T('B6 手機四個真呼叫點都使用手機格式、備戰多種類不變',async()=>{await mount(['rock','rock'],false,false,parent,320);assert.deepEqual(await page.locator('button').allTextContents(),['硬岩2','硬岩2','硬岩2','硬岩2']);await mount(['rock'],false,false,parent,320);assert.deepEqual(await page.locator('button').allTextContents(),['硬岩','硬岩','硬岩','硬岩']);await mount(['rock','sky'],false,false,parent,320);assert.deepEqual(await page.locator('button').allTextContents(),['特2種','硬岩・衝天','硬岩・衝天','特2種']);});   // ⭐v6.611（Rule 40）：戰鬥區兩種合成一顆
await T('P 無瀏覽器錯誤',()=>assert.deepEqual(errors,[]));
}finally{await browser.close();}
console.log(`v6610 PASS ${pass} / FAIL ${fail}`);if(fail)process.exitCode=1;
