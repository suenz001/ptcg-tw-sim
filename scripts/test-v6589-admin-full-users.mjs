// v6.589：實跑完整帳號掃描、快取及 admin 首頁；不連正式 Firebase。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { functionSource } from './lib/deck-replay-db-fixture.mjs';
import { readBaseBlob, hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';
import { pwLaunch } from './lib/pw.mjs';
import { revertAdminV172 } from './lib/sap-revert-admin-v172.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BASE = 'd1e945cac5e167e85dba7fc53e42dfe83ec1ef13';
const SAP = 'oracle-admin/server_admin_patch.js', ADM = 'oracle-admin/admin.html';
const rd = p => readFileSync(join(ROOT,p),'utf8').replace(/\r\n/g,'\n');
const source = rd(SAP), admin = rd(ADM), original = [SAP,ADM].map(p=>readFileSync(join(ROOT,p)));
const productRoot = process.env.V6589_PRODUCT_ROOT;
const product = productRoot ? readFileSync(join(productRoot,SAP),'utf8').replace(/\r\n/g,'\n') : source;
const productAdmin = productRoot ? readFileSync(join(productRoot,ADM),'utf8').replace(/\r\n/g,'\n') : admin;
let pass=0,fail=0;
function ok(name,yes){console.log((yes?'PASS ':'FAIL ')+name);yes?pass++:fail++;}
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const now=Date.UTC(2026,9,19,1);
function user(i){return {uid:'u'+i,email:i%4===0?'fixture@example.invalid':null,metadata:{lastSignInTime:new Date(now-(i%2===0?3600000:3*86400000)).toISOString()}};}
function setup(text,{size=55001,delay=0,failPage=-1,repeat=false,pageAdvance=0}={}){
  const clock={now},state={size,delay,failPage,repeat,calls:0,yields:0},warnings=[];
  const RealDate=Date;
  function FakeDate(...args){return args.length?new RealDate(...args):new RealDate(clock.now);}
  FakeDate.now=()=>clock.now;
  const auth={async listUsers(n,token){state.calls++;clock.now+=pageAdvance;const start=Number(token||0);if(state.delay)await new Promise(r=>setTimeout(r,state.delay));if(start===state.failPage)throw Error('fixture failure');return {users:Array.from({length:Math.min(n,Math.max(0,state.size-start))},(_,i)=>user(start+i)),pageToken:start+n<state.size?(state.repeat?'1000':String(start+n)):undefined};}};
  const a=text.indexOf('const USERS_STATS_TTL_MS');
  const fn=functionSource(text,'getUsersStatsCached');
  const b=text.indexOf(fn,a)+fn.length;
  if(a<0||b<a)throw Error('helpers 定位失敗');
  const env=new Function('adminAuth','Date','console','setImmediate',text.slice(a,b)+';return {getUsersStatsCached,getRawUsersCached,aggregateUsersStats,_rawUsersCache};')(auth,FakeDate,{warn:(...x)=>warnings.push(x)},fn=>{state.yields++;return setImmediate(fn);});
  return {env,state,clock,warnings};
}
async function facts(text){
  const {env,state}=setup(text);
  const [stats,raw]=await Promise.all([env.getUsersStatsCached(),env.getRawUsersCached(false)]);
  const calls=state.calls;
  const again=await env.getUsersStatsCached();
  return {total:stats.total===55001,members:stats.members===13751,anonymous:stats.anonymous===41250,active:stats.active24h===27501,
    complete:stats.complete===true,retained:raw.users.length===50000&&raw.capped===true,
    oneScan:calls===56,yields:state.yields===56,cache:state.calls===calls&&again===stats,private:!('users' in stats)&&!('email' in stats),at:stats.at===now};
}
ok('D 伺服器版本檔頭符合既有格式',/^\/\/ === ORACLE ADMIN ENDPOINTS === v\d+\.\d+ /.test(product));
const f=await facts(product);for(const [k,v]of Object.entries(f))ok('S 完整55,001帳號 '+k,v);
for(const size of [0,999,50000,100001]){
  const {env,state}=setup(product,{size});const stats=await env.getUsersStatsCached();const raw=await env.getRawUsersCached(false);
  ok('S 邊界 '+size,stats.total===size&&raw.users.length===Math.min(size,50000)&&raw.capped===(size>50000));
  ok('S 邊界查詢頁數 '+size,state.calls===Math.max(1,Math.ceil(size/1000)));
}
// 舊口徑正對照：重複 UID、會員、24小時的嚴格邊界與無登入時間。
const small=setup(product,{size:0});
const items=[user(0),user(0),user(1),{uid:'edge',email:null,metadata:{lastSignInTime:new Date(now-86400000).toISOString()}},{uid:'never',email:null,metadata:{}}];
const nums=small.env.aggregateUsersStats(items,now);
ok('S UID去重／會員／24h邊界正對照',nums.total===4&&nums.members===1&&nums.anonymous===3&&nums.active24h===1);
const slow=setup(product,{size:1001,pageAdvance:13*3600000});const slowStats=await slow.env.getUsersStatsCached();
ok('S 長掃描的24h視窗依完成資料時間計算',slowStats.total===1001&&slowStats.active24h===0&&slowStats.at===slow.clock.now);
// 同一輪過期請求先回完整舊值；後頁失敗不得以部分帳號覆蓋它。
const c=setup(product,{size:55001,delay:1});const first=await c.env.getUsersStatsCached();
c.clock.now+=6*60000;c.state.size=56001;c.state.failPage=50000;
const stale=await c.env.getUsersStatsCached();ok('C 過期回同一份舊值',stale===first);
try{await c.env.getRawUsersCached(true);}catch{}
ok('C 後頁失敗保留舊統計及原名單',c.env._rawUsersCache.stats===first&&c.env._rawUsersCache.users.length===50000);
c.state.failPage=-1;
const raw=await c.env.getRawUsersCached(true);const recovered=await c.env.getUsersStatsCached();
ok('C 失敗後可重試並發布完整新值',recovered.total===56001&&recovered===raw.stats&&recovered.at===c.clock.now);
const cold=setup(product,{size:55001,failPage:50000});let rejected=false;
try{await cold.env.getUsersStatsCached();}catch{rejected=true;}
ok('C 冷啟後頁失敗不發布假完整值',rejected&&cold.env._rawUsersCache.users===null);
// 不接受重複游標，避免永遠掃不完；舊版僅供外部HEAD-FAIL時避開無此防護的迴圈。
if(product.includes('seenTokens')){
 const cycle=setup(product,{size:55001,repeat:true});let stopped=false;try{await cycle.env.getUsersStatsCached();}catch{stopped=true;}
 ok('C 重複游標明確失敗且不發布',stopped&&cycle.state.calls===2&&cycle.env._rawUsersCache.users===null);
}else ok('C 重複游標防護存在',false);
const mutations=[
 ['五萬就停止',product.replace('} while (pageToken);','} while (pageToken && scanned < RAW_USERS_MAX);'),'total'],
 ['統計只算名單',product.replace('for (const u of result.users) stats.add(u);','if (scanned < RAW_USERS_MAX) for (const u of result.users) stats.add(u);'),'total'],
 ['會員全歸零',product.replace('if (u.email) memberUids.add(u.uid);','if (false) memberUids.add(u.uid);'),'members'],
 ['活躍全歸零',product.replace('active24h,','active24h: 0,'),'active'],
 ['掃描未讓路',product.replace('await new Promise(resolve => setImmediate(resolve));',''),'yields'],
 ['名單不保護',product.replace('if (users.length < RAW_USERS_MAX) users.push(...result.users);','users.push(...result.users);'),'retained'],
 ['新統計未寫入快取',product.replace('_rawUsersCache.stats = r.stats;','_rawUsersCache.stats = {total:0};'),'total'],
];
for(const [name,text,key]of mutations){if(text===product){ok('M 結構 '+name,!!productRoot);continue;}const x=await facts(text);ok('M '+name+' 指定紅',!x[key]);ok('M '+name+' 隱私正對照',x.private);}
ok('N1 註解不影響統計',equal(await facts(product+'\n// 僅改註解'),f));
if(hasBaseCommit(ROOT,BASE)){
 const old=readBaseBlob(ROOT,BASE,SAP);if(!old.ok)throw Error('BASE失敗');
 const oldText=old.out.replace(/\r\n/g,'\n'),before=await facts(oldText);
 ok('H BASE總數停在50000，完整統計會紅',!before.total&&!before.complete&&before.retained&&before.cache);
 const tail="app.get('/api/tournament",i=source.indexOf(tail),j=oldText.indexOf(tail);
 ok('D 錦標賽28鎖所守整段完全不變',i>=0&&j>=0&&source.slice(i)===oldText.slice(j));
 let reverted='';try{reverted=revertAdminV172(product);}catch{}
 ok('D 整份SAP精確還原BASE',reverted===oldText);
}else shallowSkip('v6589 BASE','需要完整main歷史');
const browser=await pwLaunch('v6.589 admin完整帳號統計');
if(browser)try{
 const page=await browser.newPage();
 const css=/<style>([\s\S]*?)<\/style>/.exec(productAdmin)[1];
 async function show(users,width=390,text=productAdmin){
  await page.setViewportSize({width,height:900});await page.setContent('<style>'+css+'</style><main><div id="tab-overview"></div></main>');
  await page.evaluate(({fn,users})=>{window.api=async()=>({users,oracle:{total:10},firebase:{total:5},feedback:{total:2}});return(new Function(fn+';return loadOverview();'))();},{fn:functionSource(text,'loadOverview'),users});
 }
 for(const width of [320,390,1280]){
  await show({enabled:true,total:55001,members:13751,anonymous:41250,active24h:27501,at:now,complete:true},width);
  ok('U '+width+' 完整總數與非在線說明',await page.locator('.stat-value').first().textContent()==='55001'&&(await page.locator('main').textContent()).includes('不是同時在線人數')&&(await page.locator('.stat-label').first().textContent()).includes('帳號總數'));
  ok('U '+width+' 數字與說明無橫向溢出',await page.evaluate(()=>[...document.querySelectorAll('.stat-card,.stat-label,.stat-value,main p')].every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1;})&&document.documentElement.scrollWidth<=innerWidth));
  if(process.env.V6589_ARTIFACT_DIR)await page.screenshot({path:join(process.env.V6589_ARTIFACT_DIR,'admin-'+width+'.png')});
 }
 await show({enabled:true,total:50000});
 ok('U 舊server不冒稱完整總數', (await page.locator('main').textContent()).includes('舊版伺服器統計可能受 50,000 筆上限截斷')&&(await page.locator('.stat-label').first().textContent()).includes('舊版'));
 await show({enabled:true,error:'fixture failure'});ok('U API錯誤不顯示假人數',(await page.locator('main').textContent()).includes('fixture failure')&&!await page.locator('.stat-label').filter({hasText:'帳號總數'}).count());
 if(!productRoot){
  const begin=productAdmin.indexOf('const CL_ADMIN_ONLY_ENTRIES =');
  const end=productAdmin.indexOf('/** 純函式',begin);
  const code=productAdmin.slice(begin,end)+['clParseEntries','clEntriesHtml','loadChangelogAdmin'].map(n=>functionSource(productAdmin,n)).join('\n');
  await page.setContent('<div id="tab-changelog"></div>');
  await page.evaluate(async code=>{
   window.escapeHtml=x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
   window.getDoc=async()=>({exists:()=>false});window.doc=()=>({});window.dbF={};
   window.fetch=async()=>({ok:true,text:async()=>'<details><summary><span class="ver-badge">v99.0</span>未來玩家版本</summary></details>'});
   return(new Function("const CL_SITE_BASE='https://fixture.invalid';let _clAdminEntries=null;"+code+';return loadChangelogAdmin();'))();
  },code);
  ok('U 真admin更新記錄載入並列出內部版本',await page.locator('#cl-full-list').textContent().then(s=>s.includes('v6.589')&&s.includes('後台完整帳號統計')&&s.includes('內部')));
  ok('U 內部與未來公開版本依版號排序',await page.locator('#cl-full-list details').first().textContent().then(s=>s.includes('v99.0')));
 }
 if(!productRoot){
  const bad=productAdmin.replace('不是同時在線人數','目前在線人數');await show({enabled:true,total:55001,complete:true},390,bad);ok('M 在線語意突變會紅',!(await page.locator('main').textContent()).includes('不是同時在線人數'));
 }
 await show({enabled:true,total:55001,complete:true});ok('最後HEAD首頁回綠',await page.locator('.stat-value').first().textContent()==='55001');
}finally{await browser.close();}
ok('原始產品bytes不變',[SAP,ADM].every((p,i)=>readFileSync(join(ROOT,p)).equals(original[i])));
ok('最後HEAD完整統計回綠',Object.values(await facts(product)).every(Boolean));
if(hasBaseCommit(ROOT,BASE))for(const p of ['static/changelog.html','static/changelog-bodies.html','static/changelog-archive.html']){
 // v6.590 Rule40：守的是v6.589隱藏版沒有公開紀錄；後續玩家版可正常新增公開條目。
 const b=readBaseBlob(ROOT,BASE,p);if(!b.ok)throw Error('公開紀錄BASE失敗');
 const currentVersion=rd('src/lib/version.ts').match(/VERSION = '([^']+)'/)?.[1];
 if(!currentVersion)throw Error('讀不到產品版本');
 const release=currentVersion==='6.589'?{ok:true,out:rd(p)}:readBaseBlob(ROOT,'3c8a3da9477244fcd0ac9912a3cc55246f76f6fb',p);
 if(!release.ok)throw Error('隱藏版發布紀錄失敗');
 const before=b.out.replace(/\r\n/g,'\n'),after=release.out.replace(/\r\n/g,'\n');
 ok('v6.589公開更新紀錄完全不變 '+p,after===before);
 ok('公開紀錄位元組突變必紅 '+p,after+'\n'!==before);
}
console.log(`\n=== v6.589 ${pass} PASS / ${fail} FAIL ===`);process.exit(fail?1:0);
