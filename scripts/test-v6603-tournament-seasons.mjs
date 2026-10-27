#!/usr/bin/env node
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import {readFileSync,existsSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {compile} from 'svelte/compiler';
import {pwLaunch} from './lib/pw.mjs';
const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');
const PRODUCT=process.env.V6603_PRODUCT_ROOT||ROOT;
const scratch=mkdtempSync(join(tmpdir(),'seasons-6603-'));
let pass=0,fail=0;
async function test(name,fn){try{await fn();console.log('PASS '+name);pass++;}catch(e){console.log('FAIL '+name+': '+e.message);fail++;}}
const clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
function matchesQuery(doc,q){return Object.entries(q).every(([k,v])=>{
  if(k==='$or')return v.some(s=>matchesQuery(doc,s));if(k==='$and')return v.every(s=>matchesQuery(doc,s));if(k==='$nor')return !v.some(s=>matchesQuery(doc,s));
  if(v&&typeof v==='object')return Object.entries(v).every(([op,val])=>op==='$not'? !matchesQuery(doc,{[k]:val}):op==='$type'?(val==='array'?Array.isArray(doc[k]):typeof doc[k]==='number'):op==='$gt'?doc[k]>val:op==='$gte'?doc[k]>=val:op==='$lt'?doc[k]<val:op==='$ne'?doc[k]!==val:false);
  return doc[k]===v;
});}
try{
  const out=join(scratch,'season.cjs');
  if (existsSync(join(PRODUCT,'src/lib/tournament/seasons.ts'))) await build({entryPoints:[join(PRODUCT,'src/lib/tournament/seasons.ts')],outfile:out,bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
  else writeFileSync(out,'module.exports={};');
  const M=createRequire(import.meta.url)(out);
  let now=Date.UTC(2026,9,27,1),row;
  const collection={async findOne(){return clone(row);},async updateOne(q,u,opt){if(!row&&opt?.upsert){row={_id:q._id,...clone(u.$setOnInsert)};return{modifiedCount:0};}if(!row||q.revision!==undefined&&q.revision!==row.revision)return{modifiedCount:0};if(u.$set)Object.assign(row,clone(u.$set));return{modifiedCount:1};}};
  const service=M.createSeasonService?M.createSeasonService(collection,()=>now):{load:async()=>{throw Error('BASE沒有賽季');},preview:async()=>{throw Error('BASE沒有賽季');},commit:async()=>{throw Error('BASE沒有賽季');}};
  let p;
  const commit=async(action,extra={})=>{const p=await service.preview({action,...extra});return service.commit({action,...extra,revision:p.revision,expectedId:p.next.id,requestId:'req_'+Math.random().toString(36).slice(2)},'admin');};
  await test('初始2026第一季保留所有既有歷史',async()=>{assert.deepEqual((await service.load()).seasons,[M.FIRST_SEASON]);assert.equal(M.FIRST_SEASON.startAt,0);});
  await test('同年立即下一季＋同請求重送不加季',async()=>{p=await service.preview({action:'next'});assert.equal(p.next.id,'2026-2');const input={action:'next',revision:p.revision,expectedId:p.next.id,requestId:'immediate001'};await service.commit(input,'admin');const revision=row.revision;await service.commit(input,'admin');assert.equal(row.revision,revision);assert.equal(row.seasons.length,2);});
  await test('同年可超過第四季，不按月份切',async()=>{for(let i=3;i<=5;i++){now++;await commit('next');}assert.equal(row.seasons.at(-1).id,'2026-5');});
  await test('台灣跨年日午夜轉正確UTC，非法日期拒絕',()=>{assert.equal(M.seasonDate('2027-01-01',now),Date.UTC(2026,11,31,16));assert.throws(()=>M.seasonDate('2027-02-30',now));assert.throws(()=>M.seasonDate('2026-10-27',now));});
  await test('排程不提前出現在已生效選單',async()=>{await commit('schedule',{date:'2027-01-01'});assert.equal(row.pending.next.id,'2027-1');assert.equal(row.seasons.at(-1).id,'2026-5');assert.throws(()=>M.seasonWindow(row,'2027-1'));});
  await test('有排程不可直接立即換季，須先取消',async()=>assert.rejects(()=>service.preview({action:'next'})));
  await test('停機跨年後補執行一次，以原定日命名',async()=>{now=Date.UTC(2027,0,2);const s=await M.createSeasonService(collection,()=>now).load(true);assert.equal(s.seasons.at(-1).id,'2027-1');assert.equal(s.seasons.at(-1).startAt,Date.UTC(2026,11,31,16));const count=s.seasons.length;await service.load(true);assert.equal(row.seasons.length,count);assert.equal(row.pending,null);});
  await test('新年度第二次是第二季，舊請求隔其他操作仍不重做',async()=>{now++;await commit('next');assert.equal(row.seasons.at(-1).id,'2027-2');const count=row.seasons.length;await service.commit({action:'next',revision:1,expectedId:'2026-2',requestId:'immediate001'},'admin');assert.equal(row.seasons.length,count);});
  await test('改期／取消與過期revision防護',async()=>{await commit('schedule',{date:'2027-02-01'});const stale=await service.preview({action:'cancel'});await commit('schedule',{date:'2027-03-01'});await assert.rejects(()=>service.commit({action:'cancel',revision:stale.revision,expectedId:stale.next.id,requestId:'cancel001'},'admin'));await commit('cancel');assert.equal(row.pending,null);});
  await test('兩管理員競爭同一確認，只增加一季',async()=>{now++;const p=await service.preview({action:'next'});const results=await Promise.allSettled(['concurrent1','concurrent2'].map(requestId=>service.commit({action:'next',revision:p.revision,expectedId:p.next.id,requestId},requestId)));assert.equal(results.filter(x=>x.status==='fulfilled').length,1);});
  await test('跨年確認過期，不把2027確認誤做成2028',async()=>{now=Date.UTC(2027,11,31,15,59);const p=await service.preview({action:'next'});now=Date.UTC(2027,11,31,16,1);await assert.rejects(()=>service.commit({action:'next',revision:p.revision,expectedId:p.next.id,requestId:'crossyear1'},'admin'));});
  const boundary=Date.UTC(2026,10,1);
  const records=[{id:'legacy'},{id:'fallback',startedAt:0,createdAt:boundary-1},{id:'oldCross',startedAt:boundary-1,createdAt:boundary-100,finishedAt:boundary+5000},{id:'precreated',startedAt:boundary,createdAt:boundary-100},{id:'new',startedAt:boundary+1},{id:'invalid',startedAt:'broken',createdAt:boundary+2}];
  await test('開賽歸屬、跨季結賽仍舊季、提前建立但新季開賽屬新季',()=>{const old=records.filter(r=>matchesQuery(r,M.seasonArchiveQuery(0,boundary))).map(r=>r.id);const recent=records.filter(r=>matchesQuery(r,M.seasonArchiveQuery(boundary,null))).map(r=>r.id);assert.deepEqual(old,['legacy','fallback','oldCross']);assert.deepEqual(recent,['precreated','new','invalid']);assert.equal(new Set([...old,...recent]).size,records.length);});
  await test('主辦榜按createdAt且保留原先狀態口徑',()=>{const events=[{createdByPlayer:true,createdAt:boundary-1},{createdByPlayer:true,createdAt:boundary,status:'cancelled'},{createdByPlayer:false,createdAt:boundary+1}];assert.equal(events.filter(r=>matchesQuery(r,M.seasonHostQuery(boundary,null))).length,1);});
  const sap=readFileSync(join(PRODUCT,'oracle-admin/server_admin_patch.js'),'utf8').replace(/\r\n/g,'\n');
  await test('管理端點驗證權限、預覽不寫入、確認後CAS寫入',async()=>{
    const block=sap.split('// >>> v176-tournament-seasons')[1]?.split('// <<< v176-tournament-seasons')[0];assert.ok(block);
    let state,reads=0,writes=0;const handlers={};
    const db={collection:()=>({findOne:async()=>{reads++;return clone(state);},updateOne:async(q,u,o)=>{writes++;if(!state&&o?.upsert){state={_id:'state',...clone(u.$setOnInsert)};return{modifiedCount:0};}if(q.revision!==state.revision)return{modifiedCount:0};Object.assign(state,clone(u.$set));return{modifiedCount:1};}})};
    new Function('app','TENG','db','tournIdentity','isTournAdmin',block)({get:(p,h)=>handlers.GET=h,post:(p,h)=>handlers.POST=h},M,db,async req=>req.identity||{error:'no'},id=>id.admin===true);
    const call=async(method,body,identity)=>{let code=200,data;await handlers[method]({body,identity},{status(n){code=n;return this;},set(){},json(x){data=x;return this;}});return{code,data};};
    assert.equal((await call('GET',{},{})).code,403);assert.equal((await call('POST',{action:'next'},{})).code,403);assert.equal(reads+writes,0);
    const admin={admin:true,uid:'fixture-admin'};await call('GET',{},admin);const before=writes;
    const preview=await call('POST',{action:'next',preview:true},admin);assert.equal(preview.code,200);assert.equal(writes,before);
    const input={action:'next',revision:preview.data.revision,expectedId:preview.data.next.id,requestId:'admin-confirm-001'};
    assert.equal((await call('POST',{...input,expectedId:'2099-9'},admin)).code,409);assert.equal(writes,before);
    const result=await call('POST',input,admin);assert.equal(result.code,200);assert.equal(result.data.seasons.length,2);assert.equal(state.operations.at(-1).action,'next');
    assert.ok(!JSON.stringify(result.data).includes('fixture-admin'));
  });
  await test('讀取突發合併、畸形日期不漏算且第一季未切換保持原口徑',async()=>{
    let reads=0;const s=M.createSeasonService({findOne:async()=>{reads++;await new Promise(r=>setTimeout(r,5));return{revision:1,seasons:[M.FIRST_SEASON],pending:null};}},()=>boundary);
    await Promise.all(Array.from({length:20},()=>s.load()));assert.equal(reads,1);
    const docs=[{startedAt:[boundary+1]},{startedAt:Infinity},{startedAt:0},{startedAt:boundary,createdAt:boundary-1}];
    assert.equal(docs.filter(x=>matchesQuery(x,M.seasonArchiveQuery(0,null))).length,4);
    assert.deepEqual(docs.map(x=>[matchesQuery(x,M.seasonArchiveQuery(0,boundary)),matchesQuery(x,M.seasonArchiveQuery(boundary,null))]),[[true,false],[true,false],[true,false],[false,true]]);
  });
  await test('真admin動作：取消確認不提交，接受確認才附revision/年度提交',async()=>{
    const admin=readFileSync(join(PRODUCT,'oracle-admin/admin.html'),'utf8');
    const logic=admin.split('// >>> v6603-admin-seasons')[1]?.split('// <<< v6603-admin-seasons')[0];assert.ok(logic);
    const browser=await pwLaunch('v6603管理確認');assert.ok(browser);
    try{
      const page=await browser.newPage();await page.route('https://season-admin.test/**',r=>r.fulfill({contentType:'text/html',body:'<div id="admin-season-panel"></div>'}));await page.goto('https://season-admin.test/');
      await page.evaluate(({logic})=>{
        window.calls=[];window.accept=false;window.messages=[];
        window.confirm=m=>{window.messages.push(m);return window.accept;};window.alert=m=>{throw Error(m);};
        window.api=async(path,options)=>{const b=options?JSON.parse(options.body):null;window.calls.push(b);if(!b)return{seasonApi:1,seasons:[{name:'2026 年第一季'}],pending:null};if(b.preview)return{revision:7,current:{name:'2026 年第一季'},next:{id:'2027-1',name:'2027 年第一季',startAt:Date.UTC(2026,11,31,16)}};return{ok:true};};
        (0,eval)(logic+';window.renderSeasons=loadSeasonPanel;');
      },{logic});
      await page.evaluate(()=>window.renderSeasons());await page.locator('#season-date').fill('2027-01-01');
      await page.evaluate(()=>window.seasonAdminAction('schedule'));assert.equal(await page.evaluate(()=>window.calls.filter(x=>x&&!x.preview).length),0);
      await page.evaluate(async()=>{window.accept=true;await window.seasonAdminAction('schedule');});
      const submitted=await page.evaluate(()=>window.calls.filter(x=>x&&!x.preview));assert.equal(submitted.length,1);assert.equal(submitted[0].revision,7);assert.equal(submitted[0].expectedId,'2027-1');assert.equal(submitted[0].date,'2027-01-01');assert.ok(submitted[0].requestId.length>=8);
      assert.ok((await page.evaluate(()=>window.messages[0])).includes('2026 年第一季'));
    }finally{await browser.close();}
  });
  await test('真排行端點：六類榜按季聚合、limit後切片、同季查詢合併、不回email',async()=>{
    const agg=sap.slice(sap.indexOf('    function _aggregateArchives('),sap.indexOf('    // ── v0.66 公開：排行榜'));
    const cut=sap.slice(sap.indexOf('    function _detectCutPlacements('),sap.indexOf('    // ⭐ v6.111：名次推導'));
    const lb=sap.slice(sap.indexOf('    const _LB_MAX = 20;'),sap.indexOf('    // ── v0.66 個人資料'));
    assert.ok(agg.length>2000 && cut.length>500 && lb.includes('seasonRankFlight'));
    const players=Array.from({length:8},(_,i)=>({uid:String(i),name:'測試'+i,email:'p'+i+'@fixture.test'}));
    const matches=[...Array.from({length:4},(_,i)=>({round:1,p1uid:String(i*2),p2uid:String(i*2+1),winnerUid:String(i*2),status:'done'})),{round:2,p1uid:'0',p2uid:'2',winnerUid:'0',status:'done'},{round:2,p1uid:'4',p2uid:'6',winnerUid:'4',status:'done'},{round:3,p1uid:'0',p2uid:'4',winnerUid:'0',status:'done'}];
    const archives=[{startedAt:boundary-1,finishedAt:boundary+100,championUid:'0',players,matches},{startedAt:boundary,finishedAt:boundary+200,championUid:'0',players,matches},{startedAt:boundary+1,finishedAt:boundary+300,communityEvent:true,championUid:'0',players,matches}];
    const hosts=[{createdByPlayer:true,createdAt:boundary-1,createdBy:'private',proposerName:'主辦'},{createdByPlayer:true,createdAt:boundary,createdBy:'private',proposerName:'主辦'}];
    let reads=0,indexCalls=0,indexShouldFail=true;
    const col=docs=>({createIndex:async()=>{indexCalls++;if(indexShouldFail)throw Error('fixture index failure');},find(q){reads++;const selected=docs.filter(d=>matchesQuery(d,q));const cursor={hint(){return cursor;},min(){return cursor;},max(){return cursor;},toArray:async()=>{await new Promise(r=>setTimeout(r,10));return selected;}};return cursor;}});

    const state={revision:2,seasons:[M.FIRST_SEASON,{...M.nextSeason([M.FIRST_SEASON],boundary),startAt:boundary}],pending:null};
    let handler;
    const archiveHelper=sap.slice(sap.indexOf('    async function seasonArchivesFor('),sap.indexOf('    // <<< v6603-season-rank'));
    const invalidate=new Function('app','TENG','TARCHIVE','TEVENTS','seasonService','seasonRankCache','seasonRankFlight','seasonRankEpoch',cut+agg+lb+';return ()=>{seasonRankEpoch++;seasonRankCache.clear();seasonRankFlight.clear();};')(
      {get:(p,h)=>{handler=h;}},M,col(archives),col(hosts),()=>({load:async()=>state}),new Map(),new Map(),0);
    async function call(seasonId,limit=20,expected=200){let code=200,data;await handler({query:{seasonId,limit}},{status(n){code=n;return this;},json(x){data=x;return this;}});assert.equal(code,expected,JSON.stringify(data));return data;}
    assert.ok((await call('2026-1',20,500)).error.includes('fixture index failure'));assert.equal(reads,0);assert.equal(indexCalls,3);indexShouldFail=false;
    const [old,again]=await Promise.all([call('2026-1'),call('2026-1',5)]);assert.equal(indexCalls,6,'索引失敗後可重試且合併');assert.equal(reads,2,'同季併發只有一組歸檔+主辦查詢');assert.equal(old.champions.official[0].count,1);assert.equal(old.wins[0].count,3);assert.equal(old.top8.length,8);assert.equal(old.finals.length,2);assert.equal(old.communityHost[0].count,1);assert.equal(old.champions.community.length,0);assert.equal(again.top8.length,5);
    const recent=await call('2026-2');assert.equal(recent.wins[0].count,6);assert.equal(recent.champions.official[0].count,1);assert.equal(recent.champions.community[0].count,1);assert.equal(recent.communityHost[0].count,1);assert.ok(!JSON.stringify(recent).includes('@'));assert.equal(recent.season.id,'2026-2');assert.equal(indexCalls,6,'成功後跨季查詢不再建索引');
    invalidate();const pending=call('2026-2');await new Promise(r=>setTimeout(r,1));archives.push({...archives[1],startedAt:boundary+3});invalidate();await pending;
    assert.equal((await call('2026-2')).champions.official[0].count,2,'失效前的舊inflight不准回填cache');
  });
  await test('個人仍讀全生涯、聚合判準沒有第二套',()=>{const profile=sap.split("app.get('/api/tournament/profile'")[1].split('// 管理員：編輯名人堂')[0];assert.ok(profile.includes("TARCHIVE.find({ 'players.email': id.email }"));assert.ok(!profile.includes('season'));assert.equal(sap.split('function _aggregateArchives(').length-1,1);});
  await test('scheduler在原邏輯前檢查到期且有歸檔失效',()=>{assert.ok(sap.includes('// >>> v6603-season-tick\n      try { await seasonService().load(); }'));assert.ok(sap.includes('// >>> v6603-season-archive\n        seasonRankInvalidate();'));assert.ok(sap.includes('// >>> v6603-season-delete\n        seasonRankInvalidate();'));});
  await test('索引、當季查詢、cache分季並在limit之前聚合',()=>{assert.ok(sap.includes('TARCHIVE.createIndex({startedAt:1})'));assert.ok(sap.includes('TARCHIVE.createIndex({createdAt:1})'));assert.ok(sap.includes('seasonArchivesFor(window.season.startAt,window.endAt)'));assert.ok(sap.includes('TENG.seasonArchiveQuery(startAt,endAt)'));assert.ok(sap.includes("const key = state.revision + ':' + window.season.id"));assert.ok(sap.includes('if (epoch === seasonRankEpoch)'));});
  await test('玩家切季清前季資料且擋亂序回應',()=>{const g=readFileSync(join(PRODUCT,'src/routes/game/+page.svelte'),'utf8');assert.ok(g.includes('if (generation !== tSeasonGeneration) return;'));assert.ok(g.includes("tSeasonId = id; tLeaderboard = null;"));assert.ok(g.includes('aria-label="排行賽季"'));});
  await test('真Svelte排行：換季後重進刷新、舊季選取、亂序不覆蓋、手機44px',async()=>{
    const g=readFileSync(join(PRODUCT,'src/routes/game/+page.svelte'),'utf8');
    const logic=g.split('// >>> v6603-season-picker')[1]?.split('// <<< v6603-season-picker')[0];assert.ok(logic);
    const switching=g.slice(g.indexOf('  function tSwitchTab('),g.indexOf('  // v5.642 名人堂點選',g.indexOf('  function tSwitchTab(')));
    const marker="{:else if tTab === 'leaderboard'}";const markup=g.slice(g.indexOf(marker)+marker.length,g.indexOf("{:else if tTab === 'profile'}"));
    const css=g.slice(g.indexOf('  /* 排行榜 */'),g.indexOf('  /* 個人資料 */'));
    const fixture=`<script lang="ts">
      import {onMount} from 'svelte';
      import {adoptOrKeep} from '$lib/ui/stale-keep';
      import {LB_TOP_OPTIONS,LB_TOP_MAX,lbTopRows} from '$lib/ui/leaderboard-top';
      let tLeaderboard=$state<any>(null),tLeaderboardStale=$state(false),tLbLoading=$state(false),tLbTop=$state(5),tTabRaw=$state('events');
      let tError='',tCheckinErrId='',tProfile=null,tProfileStale=false;
      const tProfileLoad=()=>{},refreshNotifyDiag=()=>{};
      const tLbSetTop=(v:any)=>{tLbTop=Number(v);};
      const tApi=async(path:string)=>{const r=await fetch('http://season.test/api'+path);if(!r.ok)throw Error('offline');return r.json();};
      ${logic}\n${switching}
      onMount(()=>{(window as any).chooseSeason=tSeasonSelect;});
    </script>
    <button onclick={()=>tSwitchTab('events')}>離開排行</button><button onclick={()=>{tSeasonLastLoad=0;tSwitchTab('leaderboard');}}>進入排行</button>
    {#if tTabRaw==='leaderboard'}${markup}{/if}<style>${css}</style>`;
    const js=await build({stdin:{contents:"import {mount} from 'svelte';import C from 'season-fixture';mount(C,{target:document.getElementById('app')});",resolveDir:ROOT},bundle:true,write:false,format:'iife',platform:'browser',conditions:['browser'],alias:{'$lib':join(PRODUCT,'src/lib')},plugins:[{name:'season-fixture',setup(b){b.onResolve({filter:/^season-fixture$/},()=>({path:'fixture',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:compile(fixture,{filename:'season-fixture.svelte',generate:'client'}).js.code,resolveDir:ROOT}));}}],logLevel:'silent'});
    const browser=await pwLaunch('v6603賽季排行');assert.ok(browser);
    try {
      for(const width of [390,1280]){
        const page=await browser.newPage({viewport:{width,height:844}});let current=1,offline=false;const errors=[];page.on('pageerror',e=>errors.push(e.message));
        const seasons=[M.FIRST_SEASON,M.nextSeason([M.FIRST_SEASON],boundary)];
        await page.route('http://season.test/**',async route=>{
          const u=new URL(route.request().url());if(u.pathname.startsWith('/api')){
            if(offline)return route.fulfill({status:503,contentType:'application/json',body:'{}'});
            const id=u.searchParams.get('seasonId')||seasons[current-1].id;
            if(u.searchParams.has('seasonId'))await new Promise(r=>setTimeout(r,id===seasons[0].id?200:10));
            return route.fulfill({contentType:'application/json',body:JSON.stringify({seasonApi:1,season:seasons.find(s=>s.id===id),seasons:seasons.slice(0,current),limit:20,champions:{official:[],community:[]},wins:[{displayName:id===seasons[0].id?'舊季玩家':'新季玩家',count:1}],top8:[],finals:[],communityHost:[]})});
          }
          return route.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div><script>'+js.outputFiles[0].text+'</script>'});
        });
        await page.goto('http://season.test/');await page.getByRole('button',{name:'進入排行'}).click();await page.getByRole('combobox',{name:'排行賽季'}).waitFor({timeout:5000}).catch(async e=>{throw new Error(e.message+' errors='+JSON.stringify(errors)+' body='+await page.locator('body').innerText());});assert.equal(await page.locator('select[aria-label="排行賽季"] option').count(),1);
        current=2;await page.getByRole('button',{name:'離開排行'}).click();await page.getByRole('button',{name:'進入排行'}).click();await page.waitForFunction(()=>document.querySelector('select[aria-label="排行賽季"]')?.querySelectorAll('option').length===2);assert.equal(await page.getByRole('combobox',{name:'排行賽季'}).inputValue(),seasons[1].id);
        await page.getByRole('combobox',{name:'排行賽季'}).selectOption(seasons[0].id);await page.getByText('舊季玩家',{exact:true}).waitFor();
        await page.evaluate(ids=>{window.chooseSeason(ids[0]);window.chooseSeason(ids[1]);},seasons.map(s=>s.id));await page.getByText('新季玩家',{exact:true}).waitFor();await page.waitForTimeout(250);assert.equal(await page.getByText('舊季玩家',{exact:true}).count(),0);
        const rect=await page.getByRole('combobox',{name:'排行賽季'}).boundingBox();assert.ok(rect.height>=44);assert.ok(rect.x+rect.width<=width);assert.deepEqual(errors,[]);
        offline=true;await page.getByRole('button',{name:'離開排行'}).click();await page.getByRole('button',{name:'進入排行'}).click();await page.waitForTimeout(100);assert.equal(await page.getByText('新季玩家',{exact:true}).count(),1,'同季載入失敗保留好資料');
        await page.evaluate(()=>window.chooseSeason('2026-1'));await page.waitForTimeout(100);assert.equal(await page.getByText('新季玩家',{exact:true}).count(),0,'異季失敗不得顯示上一季資料');await page.close();
      }
    }finally{await browser.close();}
  });
}finally{rmSync(scratch,{recursive:true,force:true});}
console.log(`v6603: ${pass} PASS / ${fail} FAIL`);if(fail)process.exitCode=1;
