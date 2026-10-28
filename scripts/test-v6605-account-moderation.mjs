// 帳號處分：執行真實服務、middleware、管理端點與完整補丁的啟動。
// BASE 沒有功能時逐條失敗；既有賽程區塊及對外更新紀錄為兩個正對照。
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const ROOT = resolve(fileURLToPath(new URL('..',import.meta.url)));
const PRODUCT = process.env.V6605_PRODUCT || ROOT;
const read = p => readFileSync(join(PRODUCT,p),'utf8').replace(/\r\n/g,'\n');
const sap = read('oracle-admin/server_admin_patch.js'), html = read('oracle-admin/admin.html');
const block = sap.split('// >>> v6605-account-moderation\n')[1]?.split('// <<< v6605-account-moderation')[0];
let passed=0, failed=0;
async function test(id, fn) { try { await fn(); passed++; console.log('PASS '+id); } catch(e) { failed++; console.log('FAIL '+id+' '+e.message); } }
const copy = value => value === undefined ? undefined : structuredClone(value);
function matches(row, query) {
  return Object.entries(query).every(([key,value]) => {
    if (key === '$or') return value.some(q=>matches(row,q));
    const actual = row[key];
    if (value && typeof value === 'object') return Object.entries(value).every(([op,v])=>op==='$gt'?actual>v:op==='$lt'?actual<v:op==='$in'?v.includes(actual):false);
    return value === null ? actual == null : actual === value;
  });
}
function collection() {
  const c = {rows:[], reads:0, writes:0, indexCalls:0, failIndex:false, failRead:false, failWrite:false,
    async createIndex(){c.indexCalls++;if(c.failIndex)throw Error('index offline');return 'ok';},
    async findOne(q){c.reads++;if(c.failRead)throw Error('db offline');return copy(c.rows.find(r=>matches(r,q)));},
    find(q={}) { c.reads++; let limit=Infinity, sort={}; return {sort(s){sort=s;return this;},limit(n){limit=n;return this;},project(){return this;},async toArray(){if(c.failRead)throw Error('db offline');const a=c.rows.filter(r=>matches(r,q)).sort((a,b)=>{for(const[k,d]of Object.entries(sort)){if(a[k]<b[k])return -d;if(a[k]>b[k])return d;}return 0;});return copy(a.slice(0,limit));}};},
    async insertOne(row){if(c.failWrite)throw Error('write offline');if(c.rows.some(r=>r._id===row._id)){const e=Error('duplicate');e.code=11000;throw e;}c.writes++;c.rows.push(copy(row));return{insertedId:row._id};},
    async updateOne(q,u){if(c.failWrite)throw Error('write offline');const r=c.rows.find(r=>matches(r,q));if(!r)return{matchedCount:0,modifiedCount:0};Object.assign(r,copy(u.$set));c.writes++;return{matchedCount:1,modifiedCount:1};},
  }; return c;
}
const admin={uid:'admin-user',email:'owner@example.test',verified:true};
const player={uid:'member-user',email:'member@example.test',verified:true};
function setup() {
  assert.ok(block,'BASE 尚無處分服務');
  const c=collection(), routes=new Map(); let gate, now=1800000000000;
  const users=[{...admin,displayName:'站長'},{...player,displayName:'<img src=x onerror=alert(1)>'},{uid:'other-user',email:'other@example.test'},{uid:'uid@literal',email:'literal@example.test'}];
  const auth={async getUser(uid){const u=users.find(u=>u.uid===uid);if(!u){const e=Error('missing');e.code='auth/user-not-found';throw e;}return copy(u);},async getUserByEmail(email){return this.getUser(users.find(u=>u.email===email)?.uid);}};
  const app={post:(path,...handlers)=>routes.set(path,handlers),use:fn=>{gate=fn;}};
  const identity=async req=>req.identity || {error:'需要登入',code:401};
  const protectedUser=id=>!!(id?.verified&&id.email===admin.email);
  const runtime=new Function('app','db','TADMIN','tournIdentity','isTournAdmin',block+'\nreturn {createAccountModeration,accountModeration};')(app,{collection:()=>c},{apps:[{}],auth:()=>auth},identity,protectedUser);
  const service=runtime.createAccountModeration(c,auth,u=>u.email===admin.email,()=>now);
  async function invoke(fn,req) { let code=200,data,next=false;const res={status(n){code=n;return this;},set(){return this;},json(value){data=value;return this;}};await fn(req,res,()=>{next=true;});return{code,data,next}; }
  async function call(action,body={},identity=admin) {
    const handlers=routes.get('/api/admin/moderation/'+action);assert.ok(handlers,'管理端點存在');
    let code=200,data,done=false;const req={body,identity},res={status(n){code=n;return this;},set(){return this;},json(x){data=x;done=true;return this;}};
    for(const h of handlers){let proceed=false;await h(req,res,()=>{proceed=true;});if(done||!proceed)break;}return{code,data};
  }
  const body=(extra={})=>({requestId:'request_000000000001',subjectUid:player.uid,scope:'chat',expiresAt:null,publicReason:'辱罵玩家',privateNote:'PRIVATE_NOTE',evidence:'PRIVATE_EVIDENCE',...extra});
  return{c,users,service,body,call,gate:async(path,identity=player,method='POST')=>invoke(gate,{path,method,identity,body:{playerId:'forged-user',email:'forged@example.test'}}),setNow:value=>{now=value;},now:()=>now};
}
const baseFile=p=>execFileSync('git',['show','92520fbe:'+p],{cwd:ROOT,encoding:'utf8',maxBuffer:8*1024*1024}).replace(/\r\n/g,'\n');
await test('P1 既有錦標賽尾段逐位元相同',()=>{const anchor="app.get('/api/tournament";assert.equal(sap.slice(sap.indexOf(anchor)),baseFile('oracle-admin/server_admin_patch.js').split(anchor).slice(1).join(anchor).replace(/^/,anchor));});
await test('P2 對外更新紀錄保持原文',()=>{for(const p of ['static/changelog.html','static/changelog-bodies.html','static/changelog-archive.html'])assert.equal(read(p),baseFile(p));});
await test('A1 服務插入先於私訊與兩段聊天',()=>{assert.ok(block);const gate=sap.indexOf('async function accountModerationGate');for(const path of ["app.post('/api/friends/dm/send'","app.post('/api/tournament/chat'","app.post('/api/deck-posts-comments'"])assert.ok(gate<sap.indexOf(path));});
await test('A2 管理端點拒絕普通會員與偽造UID',async()=>{const f=setup();for(const action of ['lookup','history','grant','revoke']){assert.equal((await f.call(action,f.body(),player)).code,403);assert.equal((await f.call(action,f.body(),{...admin,verified:false})).code,403);}assert.equal(f.c.reads+f.c.writes,0);});
await test('A3 UID與Email查詢由Auth解析，不信任body email',async()=>{const f=setup();assert.equal((await f.call('lookup',{query:player.email})).data.user.uid,player.uid);assert.equal((await f.call('lookup',{query:'missing'})).code,404);await f.service.grant(f.body({subjectUid:'uid@literal'}),admin);assert.equal(f.c.rows[0].subjectEmail,'literal@example.test');});
await test('A4 禁止處分自己或管理員',async()=>{const f=setup();assert.equal((await f.call('grant',f.body({subjectUid:admin.uid}))).code,403);const second={uid:'second-admin',email:admin.email,verified:true};f.users.push(second);await assert.rejects(()=>f.service.grant(f.body({subjectUid:second.uid}),admin),e=>e.status===403);assert.equal(f.c.writes,0);});
await test('B1 處分持久化包含公開原因與完整稽核',async()=>{const f=setup();await f.service.grant(f.body(),admin);const row=f.c.rows[0];assert.equal(row.subjectUid,player.uid);assert.equal(row.createdBy.uid,admin.uid);assert.equal(row.createdAt,f.now());assert.equal(row.privateNote,'PRIVATE_NOTE');assert.equal(row.evidence,'PRIVATE_EVIDENCE');assert.equal((await f.service.active(player.uid,'chat')).length,1);});
await test('B2 同requestId併發重送只新增一次，變更內容409',async()=>{const f=setup();await Promise.all([f.service.grant(f.body(),admin),f.service.grant(f.body(),admin)]);assert.equal(f.c.rows.length,1);for(const change of [{scope:'tournament-entry'},{publicReason:'另一原因'},{privateNote:'改備註'},{evidence:'改證據'},{expiresAt:f.now()+1000}])await assert.rejects(()=>f.service.grant(f.body(change),admin),e=>e.status===409);await assert.rejects(()=>f.service.grant(f.body(),{uid:'different-admin',email:admin.email}),e=>e.status===409);});
await test('B3 過期精確邊界與失敗後重試不延長期限',async()=>{const f=setup(),expiry=f.now()+100;await f.service.grant(f.body({expiresAt:expiry}),admin);f.setNow(expiry-1);assert.equal((await f.service.active(player.uid,'chat')).length,1);f.setNow(expiry);assert.equal((await f.service.active(player.uid,'chat')).length,0);await f.service.grant(f.body({expiresAt:expiry}),admin);assert.equal(f.c.rows.length,1);assert.equal(f.c.rows[0].expiresAt,expiry);});
await test('B4 多筆處分OR與CAS解除保留首位管理員',async()=>{const f=setup();await f.service.grant(f.body(),admin);await f.service.grant(f.body({requestId:'request_000000000002'}),admin);const revoke={caseId:f.body().requestId,subjectUid:player.uid,reason:'申訴確認'};await f.service.revoke(revoke,admin);const at=f.c.rows[0].revokedAt;f.setNow(f.now()+1000);await f.service.revoke(revoke,admin);assert.equal(f.c.rows[0].revokedAt,at);assert.equal((await f.service.active(player.uid,'chat')).length,1);await assert.rejects(()=>f.service.revoke({...revoke,reason:'改原因'},admin),e=>e.status===409);await assert.rejects(()=>f.service.revoke(revoke,{uid:'other-admin',email:admin.email}),e=>e.status===409);assert.equal(f.c.rows[0].revokeReason,'申訴確認');});
await test('B5 解除併發與帳號交叉case拒絕',async()=>{const f=setup();await f.service.grant(f.body(),admin);const b={caseId:f.body().requestId,subjectUid:player.uid,reason:'甲'};const rs=await Promise.allSettled([f.service.revoke(b,admin),f.service.revoke({...b,reason:'乙'},{uid:'other-admin',email:admin.email})]);assert.equal(rs.filter(r=>r.status==='fulfilled').length,1);assert.equal(rs.filter(r=>r.status==='rejected'&&r.reason.status===409).length,1);await assert.rejects(()=>f.service.revoke({...b,subjectUid:'other-user'},admin),e=>e.status===404);});
await test('B6 日期、長度、scope與requestId畸形拒絕',async()=>{const f=setup();for(const patch of [{scope:'global-ban'},{expiresAt:0},{expiresAt:'tomorrow'},{publicReason:''},{privateNote:'x'.repeat(2001)},{evidence:{}},{requestId:'bad'}])await assert.rejects(()=>f.service.grant(f.body(patch),admin),e=>e.status===400);assert.equal(f.c.writes,0);});
await test('B7 查詢先過濾舊過期資料，再限制有效筆數',async()=>{const f=setup();for(let i=0;i<130;i++)f.c.rows.push({_id:'expired_'+String(i).padStart(16,'0'),subjectUid:player.uid,scope:'chat',revokedAt:null,expiresAt:f.now()-1,createdAt:f.now()+i});await f.service.grant(f.body(),admin);assert.equal((await f.service.active(player.uid,'chat')).length,1);});
await test('B8 歷史keyset分頁同時間不漏不重，不刪過期證據',async()=>{const f=setup();for(let i=0;i<45;i++)await f.service.grant(f.body({requestId:'history_'+String(i).padStart(16,'0')}),admin);let cursor=null,ids=[];do{const page=await f.service.history(player.uid,cursor);ids.push(...page.items.map(x=>x._id));cursor=page.next;}while(cursor);assert.equal(ids.length,45);assert.equal(new Set(ids).size,45);f.setNow(f.now()+9999999);assert.equal(f.c.rows.length,45);});
await test('C1 三個禁言入口封鎖且不洩露內部資訊',async()=>{const f=setup();await f.service.grant(f.body(),admin);for(const path of ['/api/tournament/chat','/api/friends/dm/send','/api/deck-posts-comments']){const r=await f.gate(path);assert.equal(r.code,403);assert.equal(r.next,false);assert.ok(r.data.error.includes('辱罵玩家'));for(const secret of ['PRIVATE_NOTE','PRIVATE_EVIDENCE',player.email,player.uid,admin.email])assert.ok(!JSON.stringify(r.data).includes(secret));}});
await test('C2 四個參賽入口逐一封鎖，大小寫尾斜線同義',async()=>{const f=setup();await f.service.grant(f.body({scope:'tournament-entry'}),admin);for(const path of ['/api/tournament/register','/api/tournament/register-and-checkin','/api/tournament/checkin','/api/tournament/propose','/API/TOURNAMENT/CHECKIN/']){assert.equal((await f.gate(path)).code,403);}assert.equal((await f.gate('/api/tournament/chat')).next,true);});
await test('C3 讀取、退出、重連、既有比賽熱路徑保留',async()=>{const f=setup();await f.service.grant(f.body(),admin);for(const path of ['/api/tournament/match/enter','/api/tournament/join','/api/tournament/action','/api/tournament/state','/api/tournament/still-here','/api/tournament/match/forfeit','/api/tournament/drop','/api/tournament/unregister','/api/tournament/cancel-proposal','/api/friends/dm/list','/api/deck-posts-comments/delete'])assert.equal((await f.gate(path)).next,true,path);assert.equal((await f.gate('/api/tournament/chat',player,'GET')).next,true);assert.equal((await f.gate('/api/deck-posts-comments',player,'DELETE')).next,true);});
await test('C4 無處分／其他帳號／已解除立即放行，偽造身份不放行',async()=>{const f=setup();assert.equal((await f.gate('/api/tournament/chat')).next,true);assert.equal((await f.gate('/api/tournament/chat',{uid:player.uid,verified:false})).code,403);await f.service.grant(f.body(),admin);assert.equal((await f.gate('/api/tournament/chat',{...player,uid:'other-user'})).next,true);assert.equal((await f.gate('/api/tournament/chat')).code,403);await f.service.revoke({caseId:f.body().requestId,subjectUid:player.uid,reason:'解除'},admin);assert.equal((await f.gate('/api/tournament/chat')).next,true);});
await test('C5 DB與索引異常503，不放行且失敗後可恢復',async()=>{const f=setup();f.c.failIndex=true;let r=await f.gate('/api/tournament/checkin');assert.equal(r.code,503);assert.equal(r.next,false);f.c.failIndex=false;assert.equal((await f.gate('/api/tournament/checkin')).next,true);f.c.failRead=true;r=await f.gate('/api/friends/dm/send');assert.equal(r.code,503);assert.equal(r.next,false);assert.equal((await f.gate('/api/tournament/action')).next,true);f.c.failRead=false;assert.equal((await f.gate('/api/friends/dm/send')).next,true);});
await test('C6 多處分拒絕訊息反映永久／最晚期限',async()=>{const f=setup();await f.service.grant(f.body(),admin);await f.service.grant(f.body({requestId:'request_000000000002',expiresAt:f.now()+3600000}),admin);assert.ok((await f.gate('/api/tournament/chat')).data.error.includes('永久'));
  const g=setup(),long=g.now()+7200000,short=g.now()+3600000;
  await g.service.grant(g.body({expiresAt:long}),admin);g.setNow(g.now()+1);
  await g.service.grant(g.body({requestId:'request_000000000002',expiresAt:short}),admin);
  const message=(await g.gate('/api/tournament/chat')).data.error;
  assert.ok(message.includes(new Date(long).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})),'較新但較短的處分不能縮短舊處分期限');
});
await test('D1 完整補丁啟動可註冊後續錦標賽／好友／公布欄',async()=>{
  assert.ok(block);
  const registered=[], errors=[], coll=collection();
  coll.createIndexes=async()=>[]; coll.updateMany=async()=>({modifiedCount:0}); coll.indexes=async()=>[]; coll.countDocuments=async()=>0;
  const app={locals:{},use(){},get:(p)=>registered.push(p),post:(p)=>registered.push(p),delete:(p)=>registered.push(p),put:(p)=>registered.push(p),patch:(p)=>registered.push(p)};
  const engine={createGame(){}};
  const fs={existsSync:()=>false,readFileSync:()=>'{"cards":[]}'};
  const firebase={apps:[{}],auth:()=>({}),firestore:()=>({collection:()=>({doc:()=>({get:async()=>({exists:false})})})})};
  const timer=()=>({unref(){}});
  const context={app,db:{collection:()=>coll},rooms:coll,process:{env:{ADMIN_EMAILS:admin.email},hrtime:process.hrtime},Buffer,URL,Map,Set,Date,JSON,Promise,
    console:{log(){},warn:(...args)=>errors.push(args.join(' ')),error:(...args)=>errors.push(args.join(' '))},
    setTimeout:timer,clearTimeout(){},setInterval:timer,clearInterval(){},
    require:path=>{if(path.endsWith('server-engine.cjs'))return engine;if(path.endsWith('tournament-pool.json'))return{cards:[]};throw Error('stub require '+path);},
    __import:async path=>path==='firebase-admin'?{default:firebase}:path==='fs'?fs:path==='zlib'?{gzipSync:x=>x}:path.endsWith('server-engine.cjs')?{default:engine}:fs,
  };
  vm.runInNewContext(sap.replace(/\bimport\(/g,'__import('),context,{timeout:5000});
  for(let i=0;i<30;i++)await new Promise(resolve=>setImmediate(resolve));
  for(const path of ['/api/admin/moderation/grant','/api/friends/dm/send','/api/tournament/checkin','/api/tournament/match/enter','/api/deck-posts-comments'])assert.ok(registered.includes(path),path+' 未註冊：'+errors.join(' | '));
  assert.ok(!errors.some(e=>/is not defined|Cannot access.*initialization/.test(e)),errors.join(' | '));
});
await test('D2 admin模組語法與分頁接線',()=>{assert.ok(html.includes('data-tab="moderation"'));assert.ok(html.includes("currentTab === 'moderation') p = loadModeration()"));const script=html.split('<script type="module">')[1].split('</script>')[0].replace(/^import .*;\s*$/gm,'');new Function(script);});
await test('D3 admin真瀏覽器確認、重試、解除、失敗訊息與手機排版',async()=>{
  const ui=html.split('// >>> v6605-account-moderation-ui\n')[1]?.split('// <<< v6605-account-moderation-ui')[0];assert.ok(ui);
  const {chromium}=createRequire(import.meta.url)('playwright');
  const browser=await chromium.launch({headless:true});
  try {
    for(const width of [390,1280]) {
      const page=await browser.newPage({viewport:{width,height:900}});
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      const markup='<style>'+html.split('<style>')[1].split('</style>')[0]+'</style><main><div id="tab-moderation"></div></main>';
      await page.route('**/*',route=>route.request().url()==='https://moderation.example.test/'?route.fulfill({contentType:'text/html',body:markup}):route.abort()); // 所有帳號與網路皆使用假資料。
      await page.goto('https://moderation.example.test/');
      const escape=html.match(/function escapeHtml\(s\) \{[\s\S]*?\n\}/)?.[0];assert.ok(escape);
      await page.addScriptTag({content:`const currentUser={uid:'admin-user'};${escape}
        window.fixture={calls:[],confirm:false,failGrant:false,failLookup:false,granted:false};
        window.confirm=()=>fixture.confirm;window.prompt=()=>'解除理由';
        window.api=async(path,opt)=>{const b=JSON.parse(opt.body);fixture.calls.push({path,body:b});
          if(path.endsWith('/grant')){if(fixture.failGrant)return{error:'網路中斷'};fixture.granted=true;return{moderationApi:1,item:{}};}
          if(path.endsWith('/revoke'))return{moderationApi:1,item:{}};
          if(fixture.failLookup)return{error:'資料庫離線'};
          const item={_id:'request_000000000001',scope:'chat',createdAt:Date.now(),expiresAt:null,revokedAt:null,createdBy:{email:'owner@example.test'},publicReason:'<img src=x onerror=alert(1)>',privateNote:'<script>private</scr'+'ipt>',evidence:'證據'};
          if(path.endsWith('/history'))return{moderationApi:1,items:[],next:null};
          return{moderationApi:1,user:{uid:'member-user',email:'member@example.test',name:'<img src=x onerror=alert(1)>',protected:false},active:fixture.granted?[item]:[],activeTruncated:fixture.granted,items:fixture.granted?[item]:[],next:fixture.granted?{at:1,id:'request_000000000001'}:null};};
        ${ui}`});
      await page.evaluate(()=>loadModeration());
      await page.locator('#mod-query').fill('member@example.test');await page.getByRole('button',{name:'查詢帳號'}).click();await page.locator('#mod-form').waitFor({state:'visible'});
      assert.equal(await page.locator('#mod-user img').count(),0,'帳號名稱必須跳脫');
      await page.locator('#mod-reason').fill('辱罵玩家');
      await page.getByRole('button',{name:'確認新增處分…'}).click();
      assert.equal(await page.evaluate(()=>fixture.calls.filter(x=>x.path.endsWith('/grant')).length),0,'取消確認不得寫入');
      await page.evaluate(()=>{fixture.confirm=true;fixture.failGrant=true;});
      await page.getByRole('button',{name:'確認新增處分…'}).click();await page.getByRole('status').filter({hasText:'新增未確認成功'}).waitFor();
      await page.evaluate(()=>{fixture.failGrant=false;});await page.getByRole('button',{name:'確認新增處分…'}).click();
      await page.getByRole('status').filter({hasText:'處分已保存'}).waitFor();
      const requests=await page.evaluate(()=>fixture.calls.filter(x=>x.path.endsWith('/grant')).map(x=>x.body));assert.deepEqual(requests[0],requests[1],'結果不明後重試保留同一requestId與絕對期限');
      assert.equal(await page.locator('#mod-active img,#mod-active script').count(),0,'處分文字不得插入HTML');
      await page.getByRole('button',{name:'載入更多歷史'}).click();assert.ok((await page.locator('#mod-active').innerText()).includes('超過 100 筆'),'載入歷史不得丟截斷提示');
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false,`${width}px 不可橫向溢出`);
      await page.evaluate(()=>{fixture.failLookup=true;});await page.locator('#mod-active').getByRole('button',{name:'解除此筆處分…'}).click();await page.getByRole('status').filter({hasText:'重新查詢失敗'}).waitFor();
      assert.equal(await page.locator('#mod-form').isVisible(),false,'讀取失敗不可留下可操作表單');
      assert.equal(await page.locator('#mod-query').isDisabled(),false,'錯誤後可重新查詢');
      assert.deepEqual(errors,[]);await page.close();
    }
  } finally {await browser.close();}
});
console.log(`v6.605 moderation PASS ${passed} / FAIL ${failed}`);
if(failed)process.exitCode=1;
