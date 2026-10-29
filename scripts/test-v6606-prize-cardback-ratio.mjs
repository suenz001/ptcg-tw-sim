// 真 CSS＋原始蓋牌 DOM 量測；所有網路請求阻擋，不讀取玩家資料。
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readBaseBlob} from './lib/base-blob.mjs';
import {createHash} from 'node:crypto';
import {extractCss,pageHtml} from './lib/zoom-modal-fixture.mjs';
import {pwLaunch} from './lib/pw.mjs';
import {revertV6606Game} from './lib/revert-v6606-game.mjs';
import {revertV6609Game} from './lib/revert-v6609-energy-ui.mjs';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PRODUCT=process.env.V6606_PRODUCT || ROOT;
const gamePath='src/routes/game/+page.svelte';
const read=p=>readFileSync(join(PRODUCT,p),'utf8').replace(/\r\n/g,'\n');
const source=read(gamePath),official=read('src/lib/game/card-back.css');
const base=p=>{const r=readBaseBlob(ROOT,'9d427ed528d920aee3549d7d07a096bd7135ae26',p);assert.ok(r.ok,'BASE必須可讀取：'+p);return r.out.replace(/\r\n/g,'\n');};
const rule=/  \.prize-view-cardback\{[^\n]*\n(?=\n  \/\* ③)/g;
let pass=0,fail=0;
async function test(id,fn){try{await fn();pass++;console.log('PASS '+id);}catch(e){fail++;console.log('FAIL '+id+' '+e.message);}}
await test('P1 整頁僅允許卡背尺寸規則改動，機密條件與DOM逐位元不變',()=>{assert.equal([...source.matchAll(rule)].length,1);assert.equal((source.includes('$lib/ui/SpecialEnergyBadges.svelte') ? revertV6609Game(source) : source).replace(rule,''),base(gamePath).replace(rule,''));});
await test('P2 官方卡背共用外觀與資產保持原樣',()=>{assert.equal(official,base('src/lib/game/card-back.css'));assert.equal(createHash('sha256').update(readFileSync(join(PRODUCT,'src/lib/assets/pokemon-card-back.jpg'))).digest('hex'),'37a4df719ed9134a4652c639fea545f549c6cce40647ad5d82909be02a6afeb3','官方原圖資產不變');});
await test('R1 精確還原整頁回上一版',()=>assert.equal(revertV6606Game(source),base(gamePath)));
const image=readFileSync(join(PRODUCT,'src/lib/assets/pokemon-card-back.jpg'));
function jpegSize(b){let at=2;while(at<b.length){assert.equal(b[at++],255);while(b[at]===255)at++;const marker=b[at++],len=b.readUInt16BE(at);if([192,193,194].includes(marker))return{width:b.readUInt16BE(at+5),height:b.readUInt16BE(at+3)};at+=len;}throw Error('找不到JPEG尺寸');}
const size=jpegSize(image),ratio=size.height/size.width;
const back=source.split('\n').find(l=>l.includes('<div class="sel-card prize-view-back" title="蓋著的獎賞卡（雙方都看不到）">')).trim();
assert.ok(back.endsWith('</span></div>'),'必須取完整卡片 DOM');
const deckBack=source.split('\n').find(l=>l.includes('<div class="sel-card prize-view-back"><span class="sel-name">第 {row.position} 張')).trim().replace('{row.position}','1');
const faceData='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="660" height="921"><rect width="660" height="921" fill="#cca950"/></svg>');
const face='<button class="sel-card"><img src="'+faceData+'" alt="測試卡"><span class="sel-name">很長的已公開卡片名稱測試</span></button>';
const css=extractCss(source)+'\n'+official.replace('../assets/pokemon-card-back.jpg','data:image/jpeg;base64,'+image.toString('base64'));
const browser=await pwLaunch('v6606卡背比例');assert.ok(browser,'卡背比例必須執行瀏覽器驗收');
const measurements=[];
try{
 for(const layout of ['classic','tabletop','fable','blue'])for(const[width,height]of[[320,740],[390,844],[430,932],[844,390],[1366,900]]){
  const page=await browser.newPage({viewport:{width,height}});await page.route('**/*',r=>r.abort());
  const markup='<div class="battle-root"><div class="playmat layout-'+layout+'"></div><div class="zoom-overlay"><div class="zoom-modal discard-modal prize-view-modal"><h3>獎賞卡檢視</h3><div class="sel-grid">'+back.repeat(5)+face+'</div><div class="sel-grid deck-probe">'+deckBack.repeat(6)+'</div></div></div></div>';
  await page.setContent(pageHtml(css,markup));await page.locator('img').first().evaluate(i=>i.decode());
  const measure=()=>page.evaluate(()=>{const rect=e=>{const r=e.getBoundingClientRect();return{w:r.width,h:r.height};};const backs=[...document.querySelectorAll('.prize-view-cardback')].map(e=>{const c=e.parentElement,s=getComputedStyle(c),box=rect(e);return{...box,available:c.getBoundingClientRect().width-parseFloat(s.borderLeftWidth)-parseFloat(s.borderRightWidth)-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight),borderBox:getComputedStyle(e).boxSizing};});return{backs,face:rect(document.querySelector('img')),overflow:document.documentElement.scrollWidth>innerWidth+1};});
  const before=await measure();
  if(process.env.V6606_VISUAL&&layout==='blue'&&[390,1366].includes(width)){mkdirSync(process.env.V6606_VISUAL,{recursive:true});await page.screenshot({path:join(process.env.V6606_VISUAL,width+'.png')});}
  await page.locator('.sel-name').evaluateAll(els=>els.forEach(e=>e.remove()));const noNames=await measure();
  measurements.push({layout,width,height,before,noNames});
  await page.close();
 }
}finally{await browser.close();}
const near=(a,b,tolerance=.35)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} 應接近 ${b}`);
await test('A1 手機三種窄寬卡背符合原圖比例',()=>{for(const m of measurements.filter(m=>m.width<=430))for(const b of m.before.backs)near(b.h/b.w,ratio,.003);});
await test('A2 所有桌墊含邊框維持等比例',()=>{for(const m of measurements)for(const b of m.before.backs){assert.equal(b.borderBox,'border-box');near(b.h/b.w,ratio,.003);}});
await test('A3 橫式與桌機保留96px卡背寬度',()=>{for(const m of measurements.filter(m=>m.width>=844))for(const b of m.before.backs){near(b.w,96);near(b.h,96*ratio);}});
await test('A4 卡背不撐破格子並跟著實際可用寬縮放',()=>{for(const m of measurements){assert.equal(m.before.overflow,false);for(const b of m.before.backs){assert.ok(b.w<=b.available+.4);near(b.w,Math.min(96,b.available));}}});
await test('A5 名稱有無不改變卡背圖框尺寸',()=>{for(const m of measurements)for(let i=0;i<m.before.backs.length;i++){near(m.before.backs[i].w,m.noNames.backs[i].w);near(m.before.backs[i].h,m.noNames.backs[i].h);}});
await test('A6 公開正面卡圖仍等比例，未被卡背修法拉長',()=>{for(const m of measurements){assert.ok(m.before.face.w>0);near(m.before.face.h/m.before.face.w,ratio,.003);near(m.before.face.w,Math.min(96,m.before.backs[0].available));}});
await test('A7 復盤未提供卡片的牌庫卡背同樣等比例',()=>{for(const m of measurements)for(const b of m.before.backs.slice(5))near(b.h/b.w,ratio,.003);});
console.log(`v6606 PASS ${pass} / FAIL ${fail}`);if(fail)process.exitCode=1;
