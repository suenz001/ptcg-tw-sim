// 真實Svelte更新與瀏覽器幾何：手機共用紀錄跟隨；桌機保留column-reverse。
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {compile} from 'svelte/compiler';
import {build} from 'esbuild';
import {pwLaunch} from './lib/pw.mjs';
import {readBaseBlob} from './lib/base-blob.mjs';
import {revertV6607Mobile} from './lib/revert-v6607-mobile.mjs';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PRODUCT=process.env.V6607_PRODUCT || ROOT,BASE='b13354f3f5c82038f47cdb47d34277bfb73bfe48';
const read=p=>readFileSync(join(PRODUCT,p),'utf8').replace(/\r\n/g,'\n');
const mobile=read('src/routes/game/MobilePortraitBattle.svelte');let pass=0,fail=0;
async function T(id,fn){try{await fn();console.log('PASS '+id);pass++;}catch(e){if(!(e instanceof assert.AssertionError))throw e;console.log('FAIL '+id+' '+e.message);fail++;}}
const baseFile=p=>{const x=readBaseBlob(ROOT,BASE,p);assert.ok(x.ok,'完整BASE必須可讀');return x.out.replace(/\r\n/g,'\n');};
await T('P1 桌機對戰與觀戰頁逐位元不變',()=>assert.equal(read('src/routes/game/+page.svelte'),baseFile('src/routes/game/+page.svelte')));
await T('P2 手機只改紀錄跟隨，卡片與資訊顯示不變',()=>{const base=baseFile('src/routes/game/MobilePortraitBattle.svelte');assert.equal(mobile===base?mobile:revertV6607Mobile(mobile),base);});
const fresh=mobile.includes('use:followBattleLog');const begin=fresh?mobile.indexOf('  // v6.607：'):mobile.indexOf('  // v5.194：log 容器');assert.ok(begin>=0);const finish=mobile.indexOf('  // ── Derived state',begin);assert.ok(finish>begin);
const opening=mobile.match(/<section class="mp-log"[^>]*>/)?.[0];assert.ok(opening);
const logic=mobile.slice(begin,finish);
const source=`<script lang="ts">import{tick}from'svelte';let game=$state({log:Array.from({length:40},(_,i)=>({message:'原始動作 '+i}))});${logic}\nwindow.logProbe={short(){game={log:[{message:'短紀錄'}]}},append(n=1){game={log:[...game.log,...Array.from({length:n},(_,i)=>({message:'新動作 '+(game.log.length+i)+' 長紀錄測試'.repeat(10)}))]}},rewrite(){game={log:game.log.map(x=>({message:x.message+' 補充內容'.repeat(20)}))}},tick};</script>${opening}{#each (game.log??[]) as entry,i(i+(entry.message??''))}<div class="mp-log-line">{entry.message}</div>{/each}</section>`;
const compiled=compile(source,{generate:'client',dev:false,filename:'LogProbe.svelte'}).js.code;
const bundle=(await build({stdin:{contents:compiled+`\nimport{mount,unmount}from'svelte';const instance=mount(LogProbe,{target:document.querySelector('main')});window.dropLog=()=>unmount(instance);`,resolveDir:ROOT,sourcefile:'LogProbe.js'},bundle:true,write:false,format:'iife',platform:'browser',conditions:['browser'],define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'product',setup(b){b.onResolve({filter:/^\$lib\/game\/battle-log-follow$/},()=>({path:join(PRODUCT,'src/lib/game/battle-log-follow.ts')}));}}]})).outputFiles[0].text;
const browser=await pwLaunch('v6607對戰紀錄跟隨');assert.ok(browser);const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
async function settle(){await page.waitForTimeout(80);}
async function mount(hidden=false){await page.setContent(`<style>.mp-log{height:100%;width:330px;overflow-y:auto;}main{height:140px;${hidden?'display:none;':''}}.mp-log-line{font-size:15px;line-height:22px;min-height:22px}</style><main></main>`);await page.addScriptTag({content:bundle});await settle();}
async function bottom(){await page.evaluate(()=>{const e=document.querySelector('.mp-log');e.scrollTop=e.scrollHeight;});await settle();}
async function state(){return page.evaluate(()=>{const e=document.querySelector('.mp-log');return{top:e.scrollTop,max:e.scrollHeight-e.clientHeight, gap:e.scrollHeight-e.clientHeight-e.scrollTop};});}
try{
 await mount();await bottom();
 await T('A1 底部連續新增及多行動作持續跟隨',async()=>{for(const n of [1,12,2,18]){await page.evaluate(async n=>{logProbe.append(n);await logProbe.tick();document.querySelector('.mp-log').dispatchEvent(new Event('scroll'));},n);await settle();assert.ok((await state()).gap<=1,JSON.stringify(await state()));}});
 await bottom();await page.evaluate(()=>{const e=document.querySelector('.mp-log');e.scrollTop-=280;});await settle();const old=await state();
 await T('A2 翻閱舊紀錄新增動作不拉到底',async()=>{assert.ok(old.gap>200);await page.evaluate(()=>logProbe.append(14));await settle();const s=await state();assert.ok(Math.abs(s.top-old.top)<=1,JSON.stringify({old,s}));assert.ok(s.gap>200);});
 await T('A3 手動回到底後恢復跟隨',async()=>{await bottom();await page.evaluate(()=>logProbe.append(4));await settle();assert.ok((await state()).gap<=1);});
 await T('A4 紀錄區縮矮仍跟隨最新',async()=>{await bottom();await page.evaluate(()=>document.querySelector('main').style.height='60px');await settle();assert.ok((await state()).gap<=1,JSON.stringify(await state()));});
 await T('A5 同筆數文字增高仍保持底部',async()=>{await bottom();await page.evaluate(()=>logProbe.rewrite());await settle();assert.ok((await state()).gap<=1,JSON.stringify(await state()));});
 await T('A6 隱藏後顯示初始紀錄也到底',async()=>{await mount(true);await page.evaluate(()=>document.querySelector('main').style.display='block');await settle();assert.ok((await state()).max>300);assert.ok((await state()).gap<=1,JSON.stringify(await state()));});
 await T('A7 真滑鼠往上閱讀與回底行為',async()=>{await bottom();await page.mouse.move(100,70);await page.mouse.wheel(0,-280);await settle();const s=await state();assert.ok(s.gap>150);await page.evaluate(()=>logProbe.append(12));await settle();assert.ok(Math.abs((await state()).top-s.top)<=1);await bottom();await page.evaluate(()=>logProbe.append(2));await settle();assert.ok((await state()).gap<=1);});
 await T('A8 手機觸控往上翻不被新動作帶走',async()=>{await bottom();const cdp=await page.context().newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:100,y:45}]});for(const y of [65,90,120]){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:100,y}]});await page.waitForTimeout(35);}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(500);const s=await state();assert.ok(s.gap>30,JSON.stringify(s));await page.evaluate(()=>logProbe.append(12));await settle();assert.ok((await state()).gap>30);await cdp.detach();});
 await T('A10 尚不能捲動的短紀錄滾輪不取消跟隨',async()=>{await mount();await page.evaluate(()=>logProbe.short());await settle();assert.equal((await state()).max,0);await page.mouse.move(100,60);await page.mouse.wheel(0,-240);await settle();assert.equal((await state()).top,0);await page.evaluate(()=>logProbe.append(20));await settle();assert.ok((await state()).max>200);assert.ok((await state()).gap<=1,JSON.stringify(await state()));});
 await T('A11 短紀錄真觸控無位移仍繼續跟隨',async()=>{await mount();await page.evaluate(()=>logProbe.short());await settle();assert.equal((await state()).max,0);const cdp=await page.context().newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:100,y:40}]});for(const y of [65,90,120]){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:100,y}]});await page.waitForTimeout(30);}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await settle();assert.equal((await state()).top,0);await page.evaluate(()=>logProbe.append(20));await settle();assert.ok((await state()).gap<=1,JSON.stringify(await state()));await cdp.detach();});
 await T('A12 縮放修飾滾輪事件不取消底部意圖',async()=>{await mount();await bottom();await page.locator('.mp-log').evaluate(e=>e.dispatchEvent(new WheelEvent('wheel',{deltaY:-150,ctrlKey:true,bubbles:true})));await settle();await page.evaluate(()=>logProbe.append(15));await settle();assert.ok((await state()).gap<=1,JSON.stringify(await state()));});
 await T('P3 桌機反向排版底部跟隨及回顧不回跳',async()=>{await page.setContent('<style>#log{height:150px;overflow-y:auto;display:flex;flex-direction:column-reverse}#log>div{min-height:25px;flex-shrink:0}</style><div id="log"></div>');const r=await page.evaluate(()=>{const e=document.querySelector('#log');for(let i=0;i<50;i++){const d=document.createElement('div');d.textContent='動作'+i;e.prepend(d);}return e.scrollTop;});assert.equal(r,0);for(let i=0;i<4;i++){await page.evaluate(()=>{const e=document.querySelector('#log');const d=document.createElement('div');d.textContent='新動作';e.prepend(d)});await settle();assert.equal(await page.locator('#log').evaluate(e=>e.scrollTop),0);}await page.locator('#log').evaluate(e=>e.scrollTop=-250);await settle();const marker=await page.locator('#log>div').nth(20).evaluate(e=>e.getBoundingClientRect().top);await page.evaluate(()=>{const d=document.createElement('div');d.textContent='再新增';document.querySelector('#log').prepend(d)});await settle();assert.ok(Math.abs((await page.locator('#log>div').nth(21).evaluate(e=>e.getBoundingClientRect().top))-marker)<=1);});
 await T('A9 無瀏覽器程式錯誤',()=>assert.deepEqual(errors,[]));
}finally{await browser.close();}
console.log(`v6607 PASS ${pass} / FAIL ${fail}`);if(fail)process.exitCode=1;
