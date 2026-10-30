import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {compile} from 'svelte/compiler';
import {pwLaunch} from './lib/pw.mjs';
import {readBaseBlob} from './lib/base-blob.mjs';
import {revertV6609Game,revertV6609Mobile} from './lib/revert-v6609-energy-ui.mjs';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PRODUCT = process.env.V6609_PRODUCT || ROOT;
const BASE='e0abc828e1cf96cb2d15084f5d9a86718723c2d6';
const read=p=>readFileSync(join(PRODUCT,p),'utf8').replace(/\r\n/g,'\n');
let pass=0,fail=0;
async function T(name,fn){try{await fn();pass++;console.log('PASS '+name);}catch(e){if(!(e instanceof assert.AssertionError))throw e;fail++;console.log('FAIL '+name+' '+e.message);}}
const base=p=>{const x=readBaseBlob(ROOT,BASE,p);assert.ok(x.ok);return x.out.replace(/\r\n/g,'\n');};
for(const p of ['src/lib/game/engine.ts','src/lib/game/effects.ts','src/lib/game/damage-estimate.ts'])await T('P '+p+'逐位元不變',()=>assert.equal(read(p),base(p)));
const game=read('src/routes/game/+page.svelte'),mobile=read('src/routes/game/MobilePortraitBattle.svelte');
await T('P 僅精確還原本版即可得到BASE兩頁',()=>{for(const[p,s,f]of [['src/routes/game/+page.svelte',game,revertV6609Game],['src/routes/game/MobilePortraitBattle.svelte',mobile,revertV6609Mobile]])assert.equal(s===base(p)?s:f(s),base(p));});
const present=existsSync(join(PRODUCT,'src/lib/cards/attached-energy.ts'));
let M=null;
if(present){const bundle=await build({entryPoints:[join(PRODUCT,'src/lib/cards/attached-energy.ts')],bundle:true,write:false,format:'esm',platform:'node'});M=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));}
const card=(id,name,subtype='Special')=>({id,name,supertype:'Energy',subtype});
const cards=[card('a','硬岩【鬥】能量'),card('b','古舊能量'),card('c','富裕能量'),card('d','硬岩【鬥】能量'),card('e','基本【鬥】能量','Basic'),card('f','新衝天能量')];
const pool=new Map(cards.map(c=>[c.id,c]));
const host=(ids)=>({iid:'host-p2',cardId:'pokemon',damage:0,energyAttached:ids.map((id,i)=>({iid:'energy-'+i,cardId:id,damage:0,energyAttached:[]}))});
const h=host(['a','d','b','c','e']),original=JSON.stringify(h);
await T('A1 同名異圖合併且不同特殊能量不混合',()=>{assert.ok(M);assert.deepEqual(M.attachedEnergyGroups(h,pool).map(g=>[g.name,g.count]),[['硬岩【鬥】能量',2],['古舊能量',1],['富裕能量',1],['基本【鬥】能量',1]]);});
await T('A2 新衝天一張仍只算一張卡',()=>{assert.ok(M);assert.equal(M.attachedEnergyGroups(host(['f']),pool)[0].count,1);});
await T('A3 基本圖示不重複計特殊能量且輸入不變',()=>{assert.ok(M);assert.deepEqual(M.basicEnergyOnly(h,pool).energyAttached.map(e=>e.cardId),['e']);assert.equal(JSON.stringify(h),original);});
await T('A4 未知卡保留並可查看而不捏造名稱',()=>{assert.ok(M);assert.deepEqual(M.attachedEnergyGroups(host(['missing','missing2']),pool).map(g=>[g.name,g.count]),[['未知能量',1],['未知能量',1]]);});
await T('A5 明確兩字短名、未映射卡使用通稱',()=>{assert.ok(M);const p=new Map([['new',card('new','未來測試能量')]]);assert.equal(M.attachedEnergyGroups(host(['new']),p)[0].shortName,'特殊');assert.equal(M.SPECIAL_ENERGY_NAMES['新衝天能量'],'衝天');assert.equal(M.SPECIAL_ENERGY_NAMES['火箭隊能量'],'火箭');});
await T('A6 重複iid不重複算張數',()=>{assert.ok(M);const x=host(['a']);x.energyAttached.push(x.energyAttached[0]);assert.equal(M.attachedEnergyGroups(x,pool)[0].count,1);});
await T('A7 現行H/I/J所有特殊能量均有唯一明確短名',()=>{assert.ok(M);const names=new Set();for(const set of JSON.parse(read('static/cards/index.json')))for(const c of JSON.parse(read('static/cards/'+set.code+'.json')))if(c.supertype==='Energy'&&c.subtype==='Special'&&['H','I','J'].includes(c.regulationMark))names.add(c.name);assert.equal(names.size,17);assert.equal(new Set([...names].map(n=>M.SPECIAL_ENERGY_NAMES[n])).size,names.size);for(const n of names)assert.ok(M.SPECIAL_ENERGY_NAMES[n],n);});
await T('W1 桌機四位置八處舊能量列不重複顯示特殊卡',()=>{assert.equal((game.match(/energyPips\(basicEnergyOnly\(/g)||[]).length,8);assert.equal((game.match(/oninspect=\{openEnergyView\}/g)||[]).length,9);assert.ok(game.includes("_chips.filter(ch => ch.key !== 'special')"));});
await T('W2 備戰compact與手機四位置皆接中央元件',()=>{assert.equal((game.match(/blueDeco\(b, true\)/g)||[]).length,2);assert.equal((mobile.match(/oninspect=\{onOpenEnergy\}/g)||[]).length,4);assert.equal((mobile.match(/<span class="mp-slot-basic">/g)||[]).length,2);assert.ok(mobile.includes('onOpenEnergy: (iid: string) => void'));assert.ok(game.includes('onOpenEnergy={openEnergyView}'));});
await T('W3 主卡原生按鈕與徽章不嵌套、資訊欄仍可捲',()=>{assert.equal((mobile.match(/<button class="mp-card-open"/g)||[]).length,4);assert.ok(!mobile.includes('<button class="mp-active mp-active-mine'));assert.ok(!mobile.includes('.mp-active-info, .mp-slot-hp'));assert.ok(mobile.includes('.mp-active-info { position:relative; z-index:1; }'));});
await T('W4 查看追蹤當步公開active/bench、不讀手牌/牌庫',()=>{assert.ok(game.includes('energyView?.gameId === game.id'));assert.ok(game.includes('game.players.flatMap(p => [p.active, ...p.bench])'));assert.ok(game.includes('if (isTReplay) replayPlaying = false;'));assert.ok(game.includes('if (energyViewHost) { if (zoomCard) closeZoom(); else energyView = null; return; }'));});
await T('W5 未知卡不被桌機原屬性圖示gate漏掉',()=>{for(const n of ['b','oppPlayer.active','myPlayer.active'])assert.ok(game.includes('{#if '+n+'.energyAttached.length > 0}'));assert.ok(game.includes('{#if inst.energyAttached.length > 0}'));});
const source=present?read('src/lib/ui/SpecialEnergyBadges.svelte'):'<span>特</span>';
const compiled=compile(source,{generate:'client',dev:false,css:'injected',filename:'EnergyBadge.svelte'}).js.code;
const js=(await build({stdin:{contents:compiled+`\nimport{mount,unmount,tick}from'svelte';let mounted;window.inspect=[];window.mountEnergy=async(spec)=>{if(mounted)await unmount(mounted);mounted=mount(EnergyBadge,{target:document.querySelector('#badges'),props:{inst:spec.inst,pool:new Map(spec.cards),compact:spec.compact,oninspect:iid=>{window.inspect.push(iid);document.body.dataset.open='yes'}}});await tick();};`,resolveDir:ROOT,sourcefile:'EnergyBadge.js'},bundle:true,write:false,format:'iife',platform:'browser',conditions:['browser'],define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'product',setup(b){b.onResolve({filter:/^\$lib\//},a=>({path:join(PRODUCT,'src/lib',a.path.slice(5)+'.ts')}));}}]})).outputFiles[0].text;
let viewerJs=null;
if(present){
 const logic=game.match(/\/\/ >>> v6609-energy-view([\s\S]*?)\/\/ <<< v6609-energy-view/)?.[1];
 assert.ok(logic,'真正頁面的檢視生命週期必須可抽出');
 const probe=`<script lang="ts">import{tick}from'svelte';import{attachedEnergyGroups}from'$lib/cards/attached-energy';const seed=${JSON.stringify({id:'game-a',players:[{active:host(['a','b']),bench:[]},{active:null,bench:[]}]})};let game=$state(structuredClone(seed));const pool=new Map(${JSON.stringify([...pool])});const isTReplay=true;let replayPlaying=$state(true);${logic}\nwindow.viewerProbe={open:()=>openEnergyView('host-p2'),removeEnergy:()=>game.players[0].active.energyAttached.shift(),bench(){game.players[0].bench=[game.players[0].active];game.players[0].active=null;},remove(){game.players[0].active=null;game.players[0].bench=[];},restore(){game=structuredClone(seed);},id(x){game.id=x;},state:()=>({open:!!energyViewHost,stored:!!energyView,count:energyViewGroups.length,playing:replayPlaying}),tick};</script><main>{#if energyViewHost}<p>能量視窗</p>{/if}</main>`;
 const output=compile(probe,{generate:'client',dev:false,filename:'ViewerProbe.svelte'}).js.code;
 viewerJs=(await build({stdin:{contents:output+"\nimport{mount}from'svelte';mount(ViewerProbe,{target:document.querySelector('#viewer')});",resolveDir:ROOT,sourcefile:'ViewerProbe.js'},bundle:true,write:false,platform:'browser',format:'iife',conditions:['browser'],define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'product',setup(b){b.onResolve({filter:/^\$lib\//},a=>({path:join(PRODUCT,'src/lib',a.path.slice(5)+'.ts')}));}}]})).outputFiles[0].text;
}
const browser=await pwLaunch('v6609特殊能量顯示與手機命中');assert.ok(browser);
const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
const css=mobile.match(/<style>([\s\S]*)<\/style>/)[1];
async function mount(ids,compact=false,n=0){await page.setContent(`<style>${css}</style><div style="width:60px;height:80px"><div class="mp-slot" onclick="document.body.dataset.action='yes'"><button class="mp-card-open"></button><span class="mp-slot-eg"><span class="mp-slot-basic">${'<span class="mp-pip mp-pip-sm">鬥</span>'.repeat(n)}</span><span id="badges" style="display:contents"></span></span></div></div>`);await page.addScriptTag({content:js});await page.evaluate(spec=>mountEnergy(spec),{inst:host(ids),cards:[...pool],compact});}
try{
// ⭐v6.611（Rule 40，站長 2026-10-30 看過對照圖同意）：戰鬥區的特殊能量合成一顆膠囊；桌機超過兩種寫「第一種 等N種」。
//   意圖（看得到名稱與張數）保留：膠囊文字＋aria-label 逐種列出完整卡名與張數。
await T('B1 戰鬥區硬岩古舊富裕顯示名稱與卡片張數',async()=>{await mount(['a','d','b','c']);assert.deepEqual(await page.locator('#badges button').allTextContents(),['硬岩×2 等3種']);const al=await page.locator('#badges button').getAttribute('aria-label');for(const t of ['硬岩【鬥】能量 2張','古舊能量 1張','富裕能量 1張'])assert.ok(al.includes(t),al);});
await T('B2 備戰單種顯示完整短名、多種合成種類數',async()=>{await mount(['a','d'],true);assert.equal(await page.locator('#badges').innerText(),'硬岩×2');   /* ⭐v6.611（Rule 40）：膠囊內不留空格 */await mount(['a','d','b','c'],true);assert.equal(await page.locator('#badges').innerText(),'特3種');});
await T('B3 點特殊徽章回傳正確host、不誤觸主卡',async()=>{await mount(['a'],true);const b=page.locator('#badges button');assert.equal(await b.count(),1);await b.click();assert.deepEqual(await page.evaluate(()=>window.inspect),['host-p2']);assert.equal(await page.locator('body').getAttribute('data-action'),null);});
await T('B4 鍵盤Enter可開啟、Escape冒泡可關閉',async()=>{await mount(['a'],true);assert.equal(await page.locator('#badges button').count(),1);await page.evaluate(()=>window.addEventListener('keydown',e=>{if(e.key==='Escape')document.body.dataset.open='no'}));await page.locator('#badges button').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('body').getAttribute('data-open'),'yes');await page.keyboard.press('Escape');assert.equal(await page.locator('body').getAttribute('data-open'),'no');});
await T('B5 多種基本能量不能把備戰特殊徽章壓至零或推出卡位',async()=>{for(const n of [0,1,2,3,4,8]){await mount(['f'],true,n);assert.equal(await page.locator('#badges button').count(),1);const result=await page.locator('#badges button').evaluate(e=>{const r=e.getBoundingClientRect(),s=e.closest('.mp-slot').getBoundingClientRect();return{w:r.width,inside:r.right<=s.right&&r.left>=s.left,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e}});assert.ok(result.w>25&&result.inside&&result.hit,JSON.stringify({n,...result}));}});
await T('B6 已知特殊能量完整可及名稱及金色統一樣式',async()=>{await mount(['a']);assert.equal(await page.locator('#badges button').count(),1);assert.match(await page.locator('#badges button').getAttribute('aria-label'),/硬岩【鬥】能量 1張/);await page.mouse.move(0,0);/* ⭐v6.611：膠囊有 hover 底色 ⇒ 先把滑鼠移開再量（前一條點擊後滑鼠可能停在同一位置） */const c=await page.locator('#badges button').evaluate(e=>({fg:getComputedStyle(e).color,bg:getComputedStyle(e).backgroundColor}));assert.deepEqual(c,{fg:'rgb(255, 217, 138)',bg:'rgba(28, 22, 14, 0.86)'});   /* ⭐v6.611（Rule 40）：統一改成膠囊的金字＋深色半透明底（仍是同一組、所有種類一致） */});
await T('B7 經典戰鬥區17種特殊能量不擠掉HP且可捲到最後一種',async()=>{
 const many=Object.keys(M?.SPECIAL_ENERGY_NAMES??{}).map((name,i)=>card('many-'+i,name));
 await page.setContent('<style>#slot{display:flex;width:320px;height:180px}#art{width:80px;flex:none}#info{flex:1;min-width:0}.active-nrg-col{display:flex;flex-direction:column;align-items:center;gap:3px;flex-shrink:0;line-height:1}</style><div id="slot"><div id="art">卡圖</div><div class="active-nrg-col" id="badges"></div><div id="info">寶可夢名稱・HP</div></div>');
 await page.addScriptTag({content:js});await page.evaluate(spec=>mountEnergy(spec),{inst:host(many.map(c=>c.id)),cards:many.map(c=>[c.id,c]),compact:false});
 // ⭐v6.611（Rule 40）：17 種合成一顆膠囊「… 等17種」；意圖（不擠掉 HP、最後一種也查得到）改驗：欄寬與高度上限照舊，aria-label 含最後一種、點一下開檢視
 assert.equal(await page.locator('#badges button').count(),1);assert.match(await page.locator('#badges button').innerText(),/ 等17種$/);assert.ok((await page.locator('#badges button').getAttribute('aria-label')).includes(many[16].name+' 1張'));
 const r=await page.evaluate(()=>({info:document.querySelector('#info').getBoundingClientRect().width,col:document.querySelector('.active-nrg-col').getBoundingClientRect().width,overflow:document.querySelector('#slot').scrollWidth>320,badgeHeight:document.querySelector('.special-energy-badges').getBoundingClientRect().height}));
 assert.ok(r.info>=100&&r.col<=90&&!r.overflow&&r.badgeHeight<=110,JSON.stringify(r));
 await page.locator('#badges button').last().scrollIntoViewIfNeeded();await page.locator('#badges button').last().click();assert.deepEqual(await page.evaluate(()=>window.inspect),['host-p2']);
});
await T('B8 手機戰鬥卡維持原按鈕的置中文字對齊',async()=>{const tag=mobile.includes('class="mp-card-open"')?'div':'button';await page.setContent(`<style>${css}</style><${tag} class="mp-active" style="height:100px"><div class="mp-active-info"><div class="mp-active-name">測試寶可夢</div></div></${tag}>`);assert.equal(await page.locator('.mp-active-name').evaluate(e=>getComputedStyle(e).textAlign),'center');});
await T('B9 真Svelte檢視器追蹤當步能量與換備戰，離場或跨局關閉且不自行重開',async()=>{
 assert.ok(viewerJs);await page.setContent('<div id="viewer"></div>');await page.addScriptTag({content:viewerJs});
 const call=async(method,value)=>page.evaluate(async({method,value})=>{viewerProbe[method](value);await viewerProbe.tick();return viewerProbe.state();},{method,value});
 assert.deepEqual(await call('open'),{open:true,stored:true,count:2,playing:false});
 assert.equal((await call('removeEnergy')).count,1);assert.equal((await call('bench')).open,true);
 assert.deepEqual(await call('remove'),{open:false,stored:false,count:0,playing:false});assert.equal((await call('restore')).open,false);
 await call('open');assert.equal((await call('id','game-b')).open,false);assert.equal((await call('id','game-a')).open,false);
});
await T('B10 窄戰鬥欄三種特殊能量逐枚完整可見且可點、兩字短名不截斷',async()=>{
 for(const ids of [['a','b','c'],[...Array(12).fill('f'),'b','c']]){
  await page.setContent('<div class="playmat"><div style="width:90px;height:110px;overflow:hidden" id="badges"></div></div>');
  await page.addScriptTag({content:js});await page.evaluate(spec=>mountEnergy(spec),{inst:host(ids),cards:[...pool],compact:false});
  // ⭐v6.611（Rule 40）：三種合成一顆膠囊「… 等3種」——意圖（窄欄完整可見、不截斷、可點）照驗這一顆
  assert.equal(await page.locator('#badges button').count(),1);assert.match(await page.locator('#badges button').innerText(),/ 等3種$/);
  for(const button of await page.locator('#badges button').all()){
   const r=await button.evaluate(e=>{const b=e.getBoundingClientRect(),parent=e.closest('#badges').getBoundingClientRect(),hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return{text:e.textContent,full:e.scrollWidth<=e.clientWidth+1,inside:b.left>=parent.left&&b.right<=parent.right+1&&b.top>=parent.top&&b.bottom<=parent.bottom+1,hit:hit===e||e.contains(hit)};});
   assert.ok(r.full&&r.inside&&r.hit,JSON.stringify(r));await button.click();
  }
  assert.deepEqual(await page.evaluate(()=>window.inspect),['host-p2']);
 }
});
await T('B11 桌墊旁置只作用於特殊能量、純基本保持原位',async()=>{
 for(const [layout,offset]of [['tabletop',208],['fable',238]])for(const ids of [['e'],['a']]){
  await page.setContent(`<style>.active-card{position:relative;width:200px;height:160px}.tt-attach-overlay{position:absolute;left:12px;bottom:10px}</style><div class="playmat layout-${layout}"><div class="active-card"><div class="tt-attach-overlay" id="badges"></div></div></div>`);
  await page.addScriptTag({content:js});await page.evaluate(spec=>mountEnergy(spec),{inst:host(ids),cards:[...pool],compact:false});
  const position=await page.locator('.tt-attach-overlay').evaluate(e=>parseFloat(getComputedStyle(e).left));
  assert.equal(position,ids[0]==='e'?12:offset,JSON.stringify({layout,ids,position}));
 }
});
await T('B12 真頁面快捷鍵：關窗保留、開窗抑制Enter/L、Esc先關卡圖再清清單',async()=>{
 const fn=game.match(/function onGlobalKey\(e: KeyboardEvent\) \{[\s\S]*?^  \}/m)?.[0];assert.ok(fn);
 const code=(await build({stdin:{contents:fn,loader:'ts'},write:false,format:'esm'})).outputFiles[0].text;
 const execute=new Function('seed',`
  let energyViewHost=seed.host?{}:null,energyView=seed.host?{iid:'test'}:null,zoomCard=seed.zoom?{}:null;
  let lightboxUrl=null,zoomStack=[],isTReplay=false,replayDeckSeat=null,floatingEvoMenu='keep',floatingRetreatMenu='keep',viewDiscardFor=1,selectionPicked=new Set(['keep']),selectionCounts={keep:1};
  const calls=[];const runKbdShortcut=e=>{calls.push(e.key);return e.key!=='Escape';};
  const closeZoom=()=>{calls.push('closeZoom');zoomCard=null;};
  const popZoom=()=>{calls.push('popZoom');};const closeLightboxImg=()=>{calls.push('lightbox');};const closeReplayDeck=()=>{calls.push('replayDeck');};
  ${code}
  onGlobalKey({key:seed.key});return{calls,list:!!energyView,zoom:!!zoomCard,picks:selectionPicked.size};`);
 for(const key of ['Enter','l','L']){
  assert.deepEqual(execute({key,host:false,zoom:false}).calls,[key]);
  assert.deepEqual(execute({key,host:true,zoom:false}),{calls:[],list:true,zoom:false,picks:1});
 }
 assert.deepEqual(execute({key:'Escape',host:true,zoom:true}),{calls:['Escape','closeZoom'],list:true,zoom:false,picks:1});
 assert.deepEqual(execute({key:'Escape',host:true,zoom:false}),{calls:['Escape'],list:false,zoom:false,picks:1});
});
await T('P 無能量時不產生假徽章',async()=>{await mount([]);assert.equal(await page.locator('#badges button').count(),0);assert.deepEqual(errors,[]);});
}finally{await browser.close();}
console.log(`v6609 PASS ${pass} / FAIL ${fail}`);if(fail)process.exitCode=1;
