#!/usr/bin/env node
// v6.590：編譯後生命週期、真正 CSS 幾何與產品 action；不連正式站、不寫產品檔。
import { revertV6592Game } from './lib/revert-v6592-game.mjs';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {compile} from 'svelte/compiler';
import {build,transform} from 'esbuild';
import {pwLaunch} from './lib/pw.mjs';
import {functionSource} from './lib/deck-replay-db-fixture.mjs';
import {extractCss} from './lib/zoom-modal-fixture.mjs';
import {readBaseBlob,hasBaseCommit,shallowSkip} from './lib/base-blob.mjs';
import {revertMobileUiV6590} from './lib/mobile-ui-v6590-pairs.mjs';
const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const PRODUCT=process.env.V6590_PRODUCT_ROOT||ROOT,BASE='3c8a3da9477244fcd0ac9912a3cc55246f76f6fb';
const paths=['src/routes/game/+page.svelte','src/routes/game/MobilePortraitBattle.svelte','src/lib/modal-drag.ts'];
const originalBytes=paths.map(p=>readFileSync(join(PRODUCT,p))),read=p=>readFileSync(join(PRODUCT,p),'utf8').replace(/\r\n/g,'\n');
const [game,mobile,drag]=paths.map(read);let pass=0,fail=0;
const ok=(name,yes,detail='')=>{if(yes){pass++;console.log('PASS '+name)}else{fail++;console.error('FAIL '+name+' '+detail)}};
const sha=s=>createHash('sha256').update(s).digest('hex');
if(hasBaseCommit(ROOT,BASE)){for(let i=0;i<paths.length;i++){const b=readBaseBlob(ROOT,BASE,paths[i]);if(!b.ok)throw Error('BASE讀取失敗');let restored='';try{restored=revertMobileUiV6590(i===0?revertV6592Game(game):[game,mobile,drag][i],paths[i])}catch{}ok('R 精確還原 '+paths[i],restored===b.out.replace(/\r\n/g,'\n'));}}else shallowSkip('v6590 BASE','需v6.589歷史');
function historyCode(s){const end=s.indexOf("return () => { window.removeEventListener('popstate', onPop); };");if(end<0)throw Error('history終點缺失');const start=s.lastIndexOf('  $effect(() => {',end);if(start<0)throw Error('history起點缺失');const derived=s.includes('const battleHistoryActive = $derived(!!game);')?'const battleHistoryActive = $derived(!!game);':'';return derived+s.slice(start,s.indexOf('  });',end)+5);}
const bodyStart=game.indexOf('// >>> v6590-mobile-body-lock'),bodyEnd=game.indexOf('// <<< v6590-mobile-body-lock');
const bodyCode=bodyStart>=0&&bodyEnd>bodyStart?game.slice(bodyStart,bodyEnd):'';
const oldBody=game.match(/<svelte:body\s+class:mp-locked=\{[^}]+\}\s*\/>/)?.[0]||'';
async function probeBundle(body=bodyCode,hist=historyCode(game)){
 const source=`<script lang="ts">let game=$state(null),isPortraitMobile=$state(true);${body}\n${hist}</script>${oldBody}<button id="start" onclick={()=>game={id:1}}>start</button><button id="update" onclick={()=>game={id:2}}>update</button><button id="stop" onclick={()=>game=null}>stop</button><button id="desktop" onclick={()=>isPortraitMobile=false}>desktop</button><button id="mobile" onclick={()=>isPortraitMobile=true}>mobile</button>`;
 const code=compile(source,{generate:'client',dev:false,filename:'Lifecycle.svelte'}).js.code;
 return (await build({stdin:{contents:code+'\nimport {mount,unmount} from "svelte";window.probe=mount(Lifecycle,{target:document.querySelector("#app")});window.destroyProbe=()=>unmount(window.probe);',resolveDir:ROOT,sourcefile:'Lifecycle.js'},bundle:true,write:false,format:'iife',platform:'browser',conditions:['browser'],define:{'process.env.NODE_ENV':'"production"'}})).outputFiles[0].text;
}
const browser=await pwLaunch({headless:true});
if(browser){try{
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><body class="keep-other"><main id="app"></main>');
 await page.evaluate(()=>{window.pushCount=0;history.pushState=()=>{window.pushCount++}});await page.addScriptTag({content:await probeBundle()});
 const state=()=>page.evaluate(()=>({locked:document.body.classList.contains('mp-locked'),other:document.body.classList.contains('keep-other'),pushes:window.pushCount}));
 ok('L 初始未鎖',!(await state()).locked);await page.click('#start');ok('L 真正編譯並mount後body加鎖',(await state()).locked);ok('H 進入對戰只push一次',(await state()).pushes===1);await page.click('#update');ok('H 更換game物件不新增歷史',(await state()).pushes===1);await page.evaluate(()=>window.dispatchEvent(new PopStateEvent('popstate')));ok('H 返回攔截仍在',(await state()).pushes===2);await page.click('#desktop');ok('L 換桌機解除',!(await state()).locked);await page.click('#mobile');ok('L 換回手機加鎖',(await state()).locked);await page.click('#stop');ok('L 離開對戰解除',!(await state()).locked);await page.evaluate(()=>window.dispatchEvent(new PopStateEvent('popstate')));ok('H 離開後listener解除',(await state()).pushes===2);await page.click('#start');ok('H 再進入僅新增一次',(await state()).pushes===3);await page.evaluate(()=>window.destroyProbe());ok('L 卸載解除且保留其他class',!(await state()).locked&&(await state()).other);
 const selectStart=game.indexOf('<select id="res-mode"'),selectEnd=game.indexOf('</select>',selectStart)+9,hintStart=game.indexOf('<div class="setting-hint">',selectEnd),hintEnd=game.indexOf('</div>',hintStart)+6;if(selectStart<0||hintStart<0||selectEnd<9||hintEnd<6)throw Error('縮放模板錨點失效');
 const uiSource='<script lang="ts">let isPortraitMobile=$state(true),resolutionMode=$state("75"),gameZoom=$state(1);function setResolutionMode(mode){resolutionMode=mode}</script>'+game.slice(selectStart,selectEnd)+game.slice(hintStart,hintEnd)+'<button id="desktop" onclick={()=>isPortraitMobile=false}>desktop</button>';
 const uiCode=compile(uiSource,{generate:'client',filename:'ZoomSettings.svelte'}).js.code;
 const uiBundle=await build({stdin:{contents:uiCode+'\nimport {mount} from "svelte";mount(ZoomSettings,{target:document.querySelector("#app")});',resolveDir:ROOT,sourcefile:'ZoomSettings.js'},bundle:true,write:false,format:'iife',platform:'browser',conditions:['browser']});const uiPage=await browser.newPage();await uiPage.setContent('<main id="app"></main>');await uiPage.addScriptTag({content:uiBundle.outputFiles[0].text});ok('Z 手機縮放選單停用',await uiPage.locator('#res-mode').isDisabled());ok('Z 手機提示不承諾調低比例',await uiPage.locator('.setting-hint').textContent().then(s=>s.includes('僅套用桌機')&&!s.includes('70%')));await uiPage.click('#desktop');ok('Z 桌機選單啟用並保留偏好',(await uiPage.locator('#res-mode').isEnabled())&&(await uiPage.locator('#res-mode').inputValue())==='75');await uiPage.close();
 const zoomCode=(await transform(functionSource(game,'recomputeZoom'),{loader:'ts'})).code;
 const zoom=new Function('mobile','layout','mode',`let window={innerWidth:1366,innerHeight:768},isPortraitMobile=mobile,battleLayout=layout,resolutionMode=mode,gameZoom=0,isTabletLayout=true;${zoomCode};recomputeZoom();return gameZoom;`);
 for(const layout of ['classic','tabletop','fable','blue'])for(const mode of ['auto','100','75','60'])ok('Z 手機原比例 '+layout+'/'+mode,zoom(true,layout,mode)===1);
 ok('Z 桌機保留75%正對照',zoom(false,'classic','75')===0.75);ok('Z 桌機自動正對照',zoom(false,'classic','auto')===1);
 const bundle=await build({stdin:{contents:drag,resolveDir:ROOT,loader:'ts'},bundle:true,write:false,format:'iife',globalName:'Drag'});await page.addScriptTag({content:bundle.outputFiles[0].text});
 for(const mode of ['reachable','contain']){const pos=await page.evaluate(mode=>Drag.clampModalOffset({left:16,top:100,width:300,height:400},{x:0,y:-2000},390,844,mode,34,72,59),mode);ok('S '+mode+' 上緣避讓59px',pos.y+100>=59);}
 for(const mode of ['reachable','contain']){
 const modalPage=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await modalPage.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{--safe-top:59px;--safe-bottom:34px}.overlay{position:fixed;inset:0}.window{position:absolute;left:16px;top:200px;width:300px;height:250px}.modal-drag-handle{height:40px;touch-action:none;background:green}</style><div class="overlay"><div class="window"><div class="modal-drag-handle">拖曳標題</div></div></div>');
 await modalPage.addScriptTag({content:bundle.outputFiles[0].text+';window.dragProbe=Drag.modalDrag(document.querySelector(".window"),{clamp:"'+mode+'",collapsible:false});'});
 const handle=await modalPage.locator('.modal-drag-handle').boundingBox();const initialTop=await modalPage.locator('.window').evaluate(e=>e.getBoundingClientRect().top);
 await modalPage.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await modalPage.mouse.down();await modalPage.waitForTimeout(30);await modalPage.mouse.move(handle.x+handle.width/2,1,{steps:12});await modalPage.mouse.up();
 const movedTop=await modalPage.locator('.window').evaluate(e=>e.getBoundingClientRect().top);ok('S 真action安全區接線 '+mode,Math.abs(movedTop-59)<0.5&&movedTop<initialTop-10,JSON.stringify({initialTop,movedTop}));
 await modalPage.evaluate(()=>{document.documentElement.style.setProperty('--safe-top','83px');window.dispatchEvent(new Event('resize'))});const resizedTop=await modalPage.locator('.window').evaluate(e=>e.getBoundingClientRect().top);ok('S resize重夾安全區 '+mode,Math.abs(resizedTop-83)<0.5,JSON.stringify({resizedTop}));await modalPage.evaluate(()=>window.dragProbe.destroy());await modalPage.close();
 }
 const bench='<div class="mp-row">'+Array.from({length:5},()=>'<div class="mp-slot mp-empty"></div>').join('')+'</div>';
 const active='<div class="mp-active-row"><button class="mp-active"><div class="mp-active-card-back"></div><div class="mp-active-info"><div class="mp-active-name">測試寶可夢ex</div><div class="mp-hp"><span>HP 300/300</span></div><div class="mp-meta"><span>⚡2</span><span>中毒</span></div></div></button></div>';
 const markup=`<div class="battle-root"><div class="mp"><header class="mp-top">回合1<button class="mp-end-btn">結束回合</button></header><div class="mp-timer-strip">P1 0:06</div>${bench}<div class="mp-chips"><button class="mp-chip discard">棄牌區</button><button class="mp-chip stadium">競技場</button></div>${active}<section class="mp-log">${'<div>測試紀錄</div>'.repeat(30)}</section>${active}<div class="mp-chips"><button class="mp-chip discard">棄牌區</button><button class="mp-chip stadium">競技場</button></div>${bench}<footer class="mp-hand">${'<button class="mp-hand-card">卡片</button>'.repeat(8)}</footer></div></div>`;
 const css=extractCss(read('src/routes/+layout.svelte'))+extractCss(game)+extractCss(mobile);
 for(const [w,h,top,bottom]of [[320,568,0,0],[375,667,0,0],[390,844,59,34],[844,390,0,21],[812,375,0,21],[568,320,0,21]]){await page.setViewportSize({width:w,height:h});await page.setContent(`<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><style>:root{--safe-top:${top}px;--safe-bottom:${bottom}px}</style>${markup}`);const r=await page.evaluate(()=>{const hand=document.querySelector('.mp-hand').getBoundingClientRect(),card=document.querySelector('.mp-hand-card').getBoundingClientRect();return{handBottom:hand.bottom,cardBottom:card.bottom,cardTop:card.top,headerTop:document.querySelector('.mp-top').getBoundingClientRect().top}});ok('G 手牌完整可達 '+w+'x'+h,r.cardTop>=0&&r.cardBottom<=h-bottom+1&&r.handBottom<=h-bottom+1,JSON.stringify(r));ok('G 頂部保留安全區 '+w+'x'+h,r.headerTop>=top);const hit=await page.evaluate(()=>Array.from(document.querySelectorAll('.mp-chip')).every(e=>{const r=e.getBoundingClientRect();const target=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return target===e||e.contains(target)}));ok('G 棄牌／競技場實際命中 '+w+'x'+h,hit);const hp=await page.evaluate(()=>Array.from(document.querySelectorAll('.mp-hp')).every(e=>{const r=e.getBoundingClientRect(),host=e.closest('.mp-active').getBoundingClientRect();return r.top>=host.top&&r.bottom<=host.bottom&&r.width>=60&&r.height>=10}));ok('G HP顯示留在戰鬥區 '+w+'x'+h,hp);}
 const dragScrollCode=(await transform(functionSource(mobile,'dragScroll'),{loader:'ts'})).code;
 await page.setContent('<div id="row" style="width:150px;overflow:auto"><div style="width:1200px;height:60px"></div></div>');await page.addScriptTag({content:dragScrollCode+';window.action=dragScroll(document.querySelector("#row"))'});
 for(const kind of ['pointercancel','blur','buttons-zero']){const r=await page.evaluate(kind=>{const n=document.querySelector('#row');n.scrollLeft=200;n.dispatchEvent(new PointerEvent('pointerdown',{pointerType:'mouse',clientX:100,buttons:1,bubbles:true}));window.dispatchEvent(new PointerEvent('pointermove',{pointerType:'mouse',clientX:70,buttons:1}));if(kind==='buttons-zero')window.dispatchEvent(new PointerEvent('pointermove',{pointerType:'mouse',clientX:70,buttons:0}));else window.dispatchEvent(new Event(kind));const left=n.scrollLeft;const cleanAfterCancel=!n.classList.contains('mp-dragging');window.dispatchEvent(new PointerEvent('pointermove',{pointerType:'mouse',clientX:20,buttons:0}));return{stopped:n.scrollLeft===left,clean:!n.classList.contains('mp-dragging'),cleanAfterCancel};},kind);ok('D 取消清理 '+kind,r.stopped&&r.clean&&r.cleanAfterCancel);}
 await page.evaluate(()=>window.action.destroy());
 const touchCode=(await transform(functionSource(mobile,'preventScroll'),{loader:'ts'})).code;
 await page.setViewportSize({width:390,height:844});await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><style>.mp{touch-action:none}.mp-active-info{touch-action:pan-y;height:90px;overflow-y:auto;position:absolute;left:10px;top:20px;width:250px}</style><div class="mp"><div class="mp-active-info">'+ '<div style="height:30px">狀態資訊</div>'.repeat(30)+'<div></div></div><div id="blocked">場地</div></div>');
 await page.addScriptTag({content:touchCode+';window.scrollAction=preventScroll(document.querySelector(".mp"));'});
 const touch=await page.evaluate(()=>{const a=new Event('touchmove',{bubbles:true,cancelable:true}),b=new Event('touchmove',{bubbles:true,cancelable:true});document.querySelector('.mp-active-info div').dispatchEvent(a);document.querySelector('#blocked').dispatchEvent(b);return{infoAllowed:!a.defaultPrevented,outsideBlocked:b.defaultPrevented}});ok('T 資訊區放行、場地仍攔截',touch.infoAllowed&&touch.outsideBlocked);
 const cdp=await page.context().newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:80,y:95}]});for(let i=1;i<=12;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:80,y:95-i*5}]});await page.waitForTimeout(16)}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(300);ok('T 真觸控可捲過多狀態',await page.locator('.mp-active-info').evaluate(e=>e.scrollTop>0));await page.evaluate(()=>window.scrollAction.destroy());ok('T 卸載後移除touch攔截',await page.evaluate(()=>{const e=new Event('touchmove',{bubbles:true,cancelable:true});document.querySelector('#blocked').dispatchEvent(e);return !e.defaultPrevented}));
 await page.close();
}finally{await browser.close()}}
for(let i=0;i<paths.length;i++)ok('N1 產品位元組未被測試改寫 '+paths[i],sha(originalBytes[i])===sha(readFileSync(join(PRODUCT,paths[i]))));
console.log(`v6.590 手機UI守衛：${pass} PASS / ${fail} FAIL`);if(fail)process.exitCode=1;
