#!/usr/bin/env node
// 管理預組：測真實parser、中央驗證、原子目錄與伺服器端權限接線。
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { compile } from 'svelte/compiler';
import { pwLaunch } from './lib/pw.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PRODUCT = process.env.V6602_PRODUCT_ROOT || ROOT;
const scratch = mkdtempSync(join(tmpdir(), 'presets-6602-'));
let pass = 0, fail = 0;
async function test(name, fn) { try { await fn(); console.log('PASS '+name); pass++; } catch(e) { console.log('FAIL '+name+': '+e.message); fail++; } }
const clone = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
try {
  const out = join(scratch,'test.cjs');
  const managed = existsSync(join(PRODUCT,'src/lib/decks/managed-presets.ts')) ? "export * from './src/lib/decks/managed-presets'; export * from './src/lib/decks/preset-catalog-shape';" : '';
  await build({ stdin: { contents:managed+"export {validateDeck} from './src/lib/decks/validation'; export { PRESET_DECKS } from './src/lib/decks/presets';", resolveDir:PRODUCT }, outfile:out, bundle:true, platform:'node', format:'cjs', alias:{'$lib':join(PRODUCT,'src/lib')}, logLevel:'silent' });
  const api = createRequire(import.meta.url)(out);
  const pool = new Map();
  for(const s of JSON.parse(readFileSync(join(ROOT,'static/cards/index.json')))) {
    for(const c of JSON.parse(readFileSync(join(ROOT,'static/cards',s.code+'.json')))) pool.set(String(c.id),c);
  }
  // 以真預組找一副通過現行政策的牌表，避免自造不真實的合法性前提。
  let valid;
  for(const deck of api.PRESET_DECKS) {
    try { if(api.validateDeck(deck,pool).legal){valid=deck;break;} } catch {}
  }
  assert.ok(valid,'真預組至少一副合法');
  const text = valid.entries.map(e=>`${e.count} ${pool.get(e.cardId).name} #${e.cardId}`).join('\n');
  await test('精確卡表通過中央驗證且張數為60',()=>assert.equal(api.parsePresetText('測試',text,pool).entries.reduce((s,e)=>s+e.count,0),60));
  await test('未知行不得忽略',()=>assert.throws(()=>api.parsePresetText('測試',text+'\n錯誤行',pool)));
  await test('卡名與ID不同必須拒絕',()=>assert.throws(()=>api.parsePresetText('測試',text.replace(pool.get(valid.entries[0].cardId).name,'錯的卡名'),pool)));
  await test('不滿60張拒絕',()=>assert.throws(()=>api.parsePresetText('測試',text.split('\n').slice(1).join('\n'),pool)));
  await test('重名版本拒絕簡易格式',()=>{const name=[...pool.values()].find(c=>[...pool.values()].filter(x=>x.name===c.name).length>1).name;assert.throws(()=>api.parsePresetText('測試','60 '+name,pool),/多個版本/);});
  let doc;
  const col={ async findOne(){return clone(doc);},async updateOne(q,u,opts){
    if(!doc && opts?.upsert){doc={_id:q._id,...clone(u.$setOnInsert)};return {modifiedCount:0};}
    if(!doc || q.revision!==undefined&&doc.revision!==q.revision)return {modifiedCount:0};
    if(u.$set) Object.assign(doc,clone(u.$set));return {modifiedCount:1};
  }};
  const service=api.createPresetService ? api.createPresetService(col,api.PRESET_DECKS) : { read:async()=>{throw new Error('BASE尚無管理目錄');},mutate:async()=>{throw new Error('BASE尚無管理目錄');} };
  await test('初始化保留所有種子與role',async()=>{const d=await service.read();assert.deepEqual(d.decks.map(({deleted,...x})=>x),api.PRESET_DECKS);});
  await test('公開輸出不含操作者或下架狀態',async()=>{const d=api.presetPublicCatalog(await service.read());assert.ok(!JSON.stringify(d).includes('lastActor'));assert.ok(!('deleted' in d.decks[0]));});
  await test('下架後再次初始化不復活',async()=>{await service.mutate({revision:1,requestId:'delete001',action:'delete',id:valid.id},'admin',()=>{});const d=await api.createPresetService(col,api.PRESET_DECKS).read();assert.equal(d.decks.find(x=>x.id===valid.id).deleted,true);assert.ok(!api.presetPublicCatalog(d).decks.some(x=>x.id===valid.id));});
  await test('舊revision不可覆蓋',async()=>assert.rejects(()=>service.mutate({revision:1,requestId:'delete002',action:'delete',id:valid.id},'admin',()=>{})));
  await test('同一請求重送不重複操作',async()=>{const before=doc.revision;await service.mutate({revision:1,requestId:'delete001',action:'delete',id:valid.id},'admin',()=>{});assert.equal(doc.revision,before);});
  await test('復原保留精確牌表',async()=>{await service.mutate({revision:doc.revision,requestId:'restore01',action:'restore',id:valid.id},'admin',()=>{});assert.deepEqual(doc.decks.find(x=>x.id===valid.id).entries,valid.entries);});
  await test('新增經驗證且給穩定預組ID',async()=>{await service.mutate({revision:doc.revision,requestId:'adding001',action:'add'},'admin',()=>api.parsePresetText('管理預組',text,pool));assert.equal(doc.decks.at(-1).id,'__preset_admin_adding001');});
  await test('重名不暗中覆寫',async()=>assert.rejects(()=>service.mutate({revision:doc.revision,requestId:'adding002',action:'add'},'admin',()=>api.parsePresetText('管理預組',text,pool))));
  await test('中間經別的操作後重送同ID不得撞key',async()=>{await service.mutate({revision:doc.revision,requestId:'delete003',action:'delete',id:valid.id},'admin',()=>{});await assert.rejects(()=>service.mutate({revision:doc.revision,requestId:'adding001',action:'add'},'admin',()=>api.parsePresetText('另一副',text,pool)),/識別碼已使用/);});
  await test('損壞快照與重複ID拒絕，空目錄接受',()=>{
    const good=api.presetPublicCatalog(doc);assert.ok(api.parsePresetCatalog(good));
    assert.equal(api.parsePresetCatalog({...good,decks:[good.decks[0],good.decks[0]]}),null);
    assert.equal(api.parsePresetCatalog({...good,decks:[{id:'__preset_bad',name:'壞'}]}),null);
    assert.equal(api.parsePresetCatalog({...good,decks:[{...good.decks[0],entries:[{cardId:'1',count:-1}]}]}),null);
    assert.ok(api.parsePresetCatalog({...good,decks:[]}));
  });
  await test('空目錄是權威，初始化不可補回',async()=>{doc.decks.forEach(d=>d.deleted=true);const d=await service.read();assert.deepEqual(api.presetPublicCatalog(d).decks,[]);});
  await test('兩管理員同revision並行，只有一個成功',async()=>{
    const revision=doc.revision;
    const results=await Promise.allSettled(['racing001','racing002'].map(requestId=>service.mutate({revision,requestId,action:'restore',id:valid.id},'admin',()=>{})));
    assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(doc.revision,revision+1);
  });
  await test('初始化碰E11000會重讀且既有目錄不寫入',async()=>{
    let row=null,writes=0;
    const col={findOne:async()=>row,updateOne:async()=>{writes++;row={revision:1,decks:[]};throw Object.assign(new Error('duplicate'),{code:11000});}};
    const s=api.createPresetService(col,api.PRESET_DECKS);assert.deepEqual((await s.read()).decks,[]);await s.read();assert.equal(writes,1);
  });
  const read=p=>readFileSync(join(PRODUCT,p),'utf8').replace(/\r\n/g,'\n');
  const sap=read('oracle-admin/server_admin_patch.js');
  const block=sap.split('// >>> v175-managed-presets\n')[1]?.split('// <<< v175-managed-presets')[0]||'';
  await test('真admin路由未授權零寫入，新增再次驗證而非信client',async()=>{
    const routes=new Map();let writes=0;
    const svc={read:async()=>({revision:1,decks:[]}),mutate:async(b,actor,parse)=>{parse();writes++;return {revision:2,decks:[]};}};
    const TENG={...api,createPresetService:()=>svc};
    new Function('app','TENG','TPOOL','db','tournIdentity','isTournAdmin',block)(
      {get:(p,h)=>routes.set('GET '+p,h),post:(p,h)=>routes.set('POST '+p,h)},TENG,pool,{collection:()=>({})},async req=>req.identity||{},id=>id.uid==='admin');
    async function call(body,identity) {let code=200,data;const res={status(n){code=n;return this;},set(){return this;},json(d){data=d;return this;}};await routes.get('POST /api/admin-preset-decks')({body,identity},res);return {code,data};}
    assert.equal((await call({action:'add',name:'測試',text},{uid:'other'})).code,403);assert.equal(writes,0);
    assert.equal((await call({action:'add',name:'測試',text:'1 不存在 #999999'},{uid:'admin'})).code,400);assert.equal(writes,0);
    assert.equal((await call({action:'add',name:'測試',text},{uid:'admin'})).code,200);assert.equal(writes,1);
  });
  await test('真伺服器路由驗admin且在錦標賽鎖之前',()=>{assert.ok(block.includes('id.error || !isTournAdmin(id)'));assert.ok(sap.indexOf('// >>> v175-managed-presets')<sap.indexOf("app.get('/api/tournament"));assert.ok(block.includes('TENG.parsePresetText(b.name, b.text, TPOOL)'));});
  await test('兩個消費頁全部沿用同一反應式目錄',()=>{for(const p of ['decks','game']){const s=read('src/routes/'+p+'/+page.svelte');assert.ok(s.includes('PresetCatalog onupdate='));assert.ok(s.includes('let PRESET_DECKS = $state'));}});
  await test('seed與管理邏輯隨既有引擎bundle部署',()=>{const s=read('scripts/build-server-engine.mjs');assert.ok(s.includes("export { PRESET_DECKS } from '$lib/decks/presets'"));assert.ok(s.includes('createPresetService'));});
  await test('瀏覽器：壞快照不崩潰、載入與錯誤可辨、成功空清單不復活',async()=>{
    const js=await build({stdin:{contents:"import {mount} from 'svelte';import C from './src/lib/decks/PresetCatalog.svelte';mount(C,{target:document.getElementById('app'),props:{onupdate:items=>{window.items=items;}}});",resolveDir:PRODUCT},bundle:true,write:false,format:'iife',platform:'browser',conditions:['browser'],define:{'import.meta.env.VITE_ORACLE_API_URL':'"http://presets.test"'},plugins:[{name:'svelte',setup(b){b.onLoad({filter:/\.svelte$/},args=>({contents:compile(readFileSync(args.path,'utf8'),{filename:args.path,generate:'client'}).js.code,resolveDir:dirname(args.path)}));}}],logLevel:'silent'});
    const browser=await pwLaunch('v6602預組目錄');assert.ok(browser,'瀏覽器必須可用');
    try {
      const page=await browser.newPage({viewport:{width:390,height:844}});let mode='fail',calls=0;
      await page.route('http://presets.test/**',async route=>{
        if(route.request().url().endsWith('/api/preset-decks')){calls++;await new Promise(r=>setTimeout(r,150));return route.fulfill({status:mode==='fail'?503:200,contentType:'application/json',body:JSON.stringify({presetsApi:1,revision:2,decks:[]})});}
        return route.fulfill({contentType:'text/html',body:'<div id="app"></div><script>'+js.outputFiles[0].text+'</script>'});
      });
      await page.addInitScript(()=>localStorage.setItem('ptcg:managed-presets:v1:http://presets.test',JSON.stringify({presetsApi:1,revision:1,decks:[{}]})));
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto('http://presets.test/');await page.getByRole('status').filter({hasText:'無法載入預設牌組'}).waitFor();assert.equal(await page.evaluate(()=>window.items),undefined);assert.deepEqual(errors,[]);
      mode='empty';await page.getByRole('button',{name:'重新載入預組'}).click();await page.waitForFunction(()=>Array.isArray(window.items));assert.deepEqual(await page.evaluate(()=>window.items),[]);assert.equal(calls,2);
      assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('ptcg:managed-presets:v1:http://presets.test')).decks.length),0);
      // 正常快照在離線時保留；刪除後清單更新會明確提醒重新選擇。
      const good={presetsApi:1,revision:1,decks:[valid]};
      await page.evaluate(d=>localStorage.setItem('ptcg:managed-presets:v1:http://presets.test',JSON.stringify(d)),good);
      // 第二頁不注入損壞快照。
      const p2=await browser.newPage();
      await p2.route('http://presets.test/**',async route=>route.request().url().endsWith('/api/preset-decks')?route.fulfill({status:mode==='fail'?503:200,contentType:'application/json',body:JSON.stringify({presetsApi:1,revision:2,decks:[]})}):route.fulfill({contentType:'text/html',body:'<div id="app"></div><script>'+js.outputFiles[0].text+'</script>'}));
      await p2.addInitScript(d=>localStorage.setItem('ptcg:managed-presets:v1:http://presets.test',JSON.stringify(d)),good);
      mode='fail';await p2.goto('http://presets.test/');await p2.getByRole('status').filter({hasText:'可能過期'}).waitFor();assert.equal((await p2.evaluate(()=>window.items)).length,1);
      mode='empty';await p2.getByRole('button',{name:'重新載入預組'}).click();await p2.getByRole('status').filter({hasText:'請重新選擇'}).waitFor();assert.deepEqual(await p2.evaluate(()=>window.items),[]);await p2.close();
      assert.deepEqual(errors,[]);await page.close();
    } finally {await browser.close();}
  });
} finally { rmSync(scratch,{recursive:true,force:true}); }
console.log(`v6602: ${pass} PASS / ${fail} FAIL`);if(fail)process.exitCode=1;
