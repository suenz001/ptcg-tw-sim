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
await T('A5 不一律取前兩字、新卡保留可辨認名稱',()=>{assert.ok(M);const p=new Map([['new',card('new','未來測試能量')]]);assert.equal(M.attachedEnergyGroups(host(['new']),p)[0].shortName,'未來測試');assert.equal(M.SPECIAL_ENERGY_NAMES['新衝天能量'],'新衝天');assert.equal(M.SPECIAL_ENERGY_NAMES['火箭隊能量'],'火箭隊');});
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
const browser=await pwLaunch('v6609特殊能量顯示與手機命中');assert.ok(browser);
const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
const css=mobile.match(/<style>([\s\S]*)<\/style>/)[1];
async function mount(ids,compact=false,n=0){await page.setContent(`<style>${css}</style><div style="width:60px;height:80px"><div class="mp-slot" onclick="document.body.dataset.action='yes'"><button class="mp-card-open"></button><span class="mp-slot-eg"><span class="mp-slot-basic">${'<span class="mp-pip mp-pip-sm">鬥</span>'.repeat(n)}</span><span id="badges" style="display:contents"></span></span></div></div>`);await page.addScriptTag({content:js});await page.evaluate(spec=>mountEnergy(spec),{inst:host(ids),cards:[...pool],compact});}
try{
await T('B1 戰鬥區硬岩古舊富裕顯示名稱與卡片張數',async()=>{await mount(['a','d','b','c']);assert.deepEqual(await page.locator('#badges button').allTextContents(),['硬岩 ×2','古舊 ×1','富裕 ×1']);});
await T('B2 備戰單種顯示完整短名、多種合成種類數',async()=>{await mount(['a','d'],true);assert.equal(await page.locator('#badges').innerText(),'硬岩2');await mount(['a','d','b','c'],true);assert.equal(await page.locator('#badges').innerText(),'特3種');});
await T('B3 點特殊徽章回傳正確host、不誤觸主卡',async()=>{await mount(['a'],true);const b=page.locator('#badges button');assert.equal(await b.count(),1);await b.click();assert.deepEqual(await page.evaluate(()=>window.inspect),['host-p2']);assert.equal(await page.locator('body').getAttribute('data-action'),null);});
await T('B4 鍵盤Enter可開啟、Escape冒泡可關閉',async()=>{await mount(['a'],true);assert.equal(await page.locator('#badges button').count(),1);await page.evaluate(()=>window.addEventListener('keydown',e=>{if(e.key==='Escape')document.body.dataset.open='no'}));await page.locator('#badges button').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('body').getAttribute('data-open'),'yes');await page.keyboard.press('Escape');assert.equal(await page.locator('body').getAttribute('data-open'),'no');});
await T('B5 多種基本能量不能把備戰特殊徽章壓至零或推出卡位',async()=>{for(const n of [0,1,2,3,4,8]){await mount(['f'],true,n);assert.equal(await page.locator('#badges button').count(),1);const result=await page.locator('#badges button').evaluate(e=>{const r=e.getBoundingClientRect(),s=e.closest('.mp-slot').getBoundingClientRect();return{w:r.width,inside:r.right<=s.right&&r.left>=s.left,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e}});assert.ok(result.w>25&&result.inside&&result.hit,JSON.stringify({n,...result}));}});
await T('B6 已知特殊能量完整可及名稱及金色統一樣式',async()=>{await mount(['a']);assert.equal(await page.locator('#badges button').count(),1);assert.match(await page.locator('#badges button').getAttribute('aria-label'),/硬岩【鬥】能量 1張/);const c=await page.locator('#badges button').evaluate(e=>({fg:getComputedStyle(e).color,bg:getComputedStyle(e).backgroundColor}));assert.deepEqual(c,{fg:'rgb(255, 225, 160)',bg:'rgb(65, 54, 42)'});});
await T('B7 經典戰鬥區17種特殊能量不擠掉HP且可捲到最後一種',async()=>{
 const many=Object.keys(M?.SPECIAL_ENERGY_NAMES??{}).map((name,i)=>card('many-'+i,name));
 await page.setContent('<style>#slot{display:flex;width:320px;height:180px}#art{width:80px;flex:none}#info{flex:1;min-width:0}.active-nrg-col{display:flex;flex-direction:column;align-items:center;gap:3px;flex-shrink:0;line-height:1}</style><div id="slot"><div id="art">卡圖</div><div class="active-nrg-col" id="badges"></div><div id="info">寶可夢名稱・HP</div></div>');
 await page.addScriptTag({content:js});await page.evaluate(spec=>mountEnergy(spec),{inst:host(many.map(c=>c.id)),cards:many.map(c=>[c.id,c]),compact:false});
 assert.equal(await page.locator('#badges button').count(),17);
 const r=await page.evaluate(()=>({info:document.querySelector('#info').getBoundingClientRect().width,col:document.querySelector('.active-nrg-col').getBoundingClientRect().width,overflow:document.querySelector('#slot').scrollWidth>320,badgeHeight:document.querySelector('.special-energy-badges').getBoundingClientRect().height}));
 assert.ok(r.info>=100&&r.col<=90&&!r.overflow&&r.badgeHeight<=110,JSON.stringify(r));
 await page.locator('#badges button').last().scrollIntoViewIfNeeded();await page.locator('#badges button').last().click();assert.deepEqual(await page.evaluate(()=>window.inspect),['host-p2']);
});
await T('B8 手機戰鬥卡維持原按鈕的置中文字對齊',async()=>{const tag=mobile.includes('class="mp-card-open"')?'div':'button';await page.setContent(`<style>${css}</style><${tag} class="mp-active" style="height:100px"><div class="mp-active-info"><div class="mp-active-name">測試寶可夢</div></div></${tag}>`);assert.equal(await page.locator('.mp-active-name').evaluate(e=>getComputedStyle(e).textAlign),'center');});
await T('P 無能量時不產生假徽章',async()=>{await mount([]);assert.equal(await page.locator('#badges button').count(),0);assert.deepEqual(errors,[]);});
}finally{await browser.close();}
console.log(`v6609 PASS ${pass} / FAIL ${fail}`);if(fail)process.exitCode=1;
