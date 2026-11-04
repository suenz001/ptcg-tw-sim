// v6.627：實跑玩家查詢牌組的複製出口與既有匯入器，保留舊格式相容。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { buildSync, transformSync } from 'esbuild';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PRODUCT = process.env.V6627_PRODUCT || ROOT;
const rd = p => readFileSync(join(PRODUCT, p), 'utf8').replace(/\r\n/g, '\n');
const html = rd('oracle-admin/admin.html'), page = rd('src/routes/decks/+page.svelte');
function block(s, a, b) { const i=s.indexOf(a), j=s.indexOf(b,i+a.length); assert.ok(i>=0&&j>i, a); return s.slice(i,j); }
function load(p) {
  const code=buildSync({ entryPoints:[join(PRODUCT,p)],bundle:true,write:false,format:'cjs',platform:'node',alias:{'$lib':join(PRODUCT,'src/lib')},logLevel:'silent' }).outputFiles[0].text;
  const module={exports:{}};new Function('module','exports','require',code)(module,module.exports,createRequire(import.meta.url));return module.exports;
}
const { splitTwoCardStadiumEntries }=load('src/lib/decks/cardIdMigration.ts');
const { resolvePlayerFacingCardId }=load('src/lib/cards/visibility.ts');
const pool=JSON.parse(rd('static/cards/index.json')).flatMap(s=>JSON.parse(rd('static/cards/'+s.code+'.json')));
// 實跑正式索引建構與 alias 迴圈，避免只測到理想化的 Map。
const cardInfoMap={}, canonicalMap=new Map();
const indexRows=block(html,'          for (const c of cards) {','        } catch (e) {');
for(const s of JSON.parse(rd('static/cards/index.json')))new Function('cards','s','map','canonicalMap','computeCanonicalKey',indexRows)(JSON.parse(rd('static/cards/'+s.code+'.json')),s,cardInfoMap,canonicalMap,c=>c.id);
const aliasRows=block(html,'      for (let jp = 50220;', '      cardCanonicalMap = canonicalMap;');
new Function('map',aliasRows)(cardInfoMap);
const escapeHtml=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const labelCode=block(html,'function cardLabel(', '\n// v');
const cardLabel=new Function('cardInfoMap', labelCode+'\nreturn cardLabel;')(cardInfoMap);
const helper=html.includes('// >>> v6627-player-deck-import-text')?block(html,'// >>> v6627-player-deck-import-text','// <<< v6627-player-deck-import-text'):'';
const showCode=block(html,'window.showDeckDetail = async function(deckId)', '\n// v0.99: modal stack');
async function saved(entries,name='測試牌組') {
  let rendered='';const host={innerHTML:''};const window={_lastPlayerDecks:{test:{name,entries}},_lastDeckCopyText:'STALE',_modalStack:[]};
  const show=new Function('window','document','cardInfoMap','ensureCardIndex','escapeHtml','cardLabel','pushModal','alert',helper+'\n'+showCode+'\nreturn window.showDeckDetail;')(window,{getElementById:()=>host},cardInfoMap,async()=>{},escapeHtml,cardLabel,s=>{rendered=s;},()=>{});
  await show('test');return {text:window._lastDeckCopyText,html:rendered};
}
const importCode=transformSync(block(page,'  function importFromText()', '\n  // ── Auth actions'),{loader:'ts',target:'es2022'}).code;
function imported(text) {
  let result=null;const warnings=[];
  new Function('pool','poolById','poolBySetNum','resolvePlayerFacingCardId','splitTwoCardStadiumEntries','newDeck','addDeckOnTop','setDirty','confirm','alert','input',`let importTextInput=input, activeId='', showTextModal=true; ${importCode}; importFromText();`)(pool,new Map(pool.map(c=>[c.id,c])),new Map(pool.map(c=>[`${c.setCode}-${c.collectorNumber}`,c])),resolvePlayerFacingCardId,splitTwoCardStadiumEntries,name=>({id:'fixture',name,entries:[]}),d=>{result=d;},()=>{},m=>{warnings.push(m);return false;},m=>warnings.push(m),text);
  return {deck:result,warnings};
}
const normalized=entries=>entries.map(e=>[e.cardId,e.count]).sort((a,b)=>a[0].localeCompare(b[0]));
const energy=pool.find(c=>c.supertype==='Energy'&&c.name.startsWith('基本')&&/^\d+$/.test(c.id));
assert.ok(energy,'實際基本能量');
// 模擬查詢端舊索引沒有標記的基本能量；卡號/卡面資料仍取真卡池。
cardInfoMap[energy.id]={...energy,regulationMark:''};
const promo=pool.find(c=>['H','I','J'].includes(c.regulationMark)&&/M-P/.test(c.setCode)&&/^\d+$/.test(c.id));assert.ok(promo);
let pass=0,fail=0;async function T(name,f){try{await f();pass++;console.log('PASS '+name);}catch(e){fail++;console.log('FAIL '+name+': '+e.message);}}
await T('玩家匯入說明不揭露管理來源',()=>{const help=block(page,'支援三種格式：', '</p>');assert.doesNotMatch(help,/admin|adim|後台|管理員|對戰紀錄複製/i);assert.match(help,/③/);});
await T('無標記基本能量與促銷卡60張精確匯回',async()=>{const entries=[{cardId:energy.id,count:58},{cardId:promo.id,count:2}];const s=await saved(entries,'匯回測試');const r=imported(s.text);assert.deepEqual(r.warnings,[]);assert.equal(r.deck?.name,'匯回測試');assert.deepEqual(normalized(r.deck.entries),normalized(entries));});
await T('同名不同印刷保持精確卡號',async()=>{const groups=new Map();for(const c of pool.filter(c=>['H','I','J'].includes(c.regulationMark)&&/^\d+$/.test(c.id))){const a=groups.get(c.name)||[];a.push(c);groups.set(c.name,a);}const cs=[...groups.values()].find(cs=>cs.length>1&&cs[0].id!==cs[1].id);assert.ok(cs);const entries=cs.slice(0,2).map((c,i)=>({cardId:c.id,count:i+1}));const r=imported((await saved(entries)).text);assert.deepEqual(r.warnings,[]);assert.deepEqual(normalized(r.deck.entries),normalized(entries));});
for(const id of ['19621','19622','19623'])await T('雙張場地左右不增減 '+id,async()=>{const entries=[{cardId:id,count:2},{cardId:id+'-1',count:2},{cardId:energy.id,count:56}];assert.ok(cardInfoMap[id+'-1']);const s=await saved(entries);const r=imported(s.text);assert.deepEqual(r.warnings,[]);assert.deepEqual(normalized(r.deck.entries),normalized(entries));});
await T('舊版M5 alias匯回目前精確印刷',async()=>{const poolIds=new Set(pool.map(c=>c.id));const aliases=Object.keys(cardInfoMap).filter(id=>!poolIds.has(id));assert.ok(aliases.length>0);for(const alias of aliases){const realId=Object.keys(cardInfoMap).find(id=>poolIds.has(id)&&cardInfoMap[id]===cardInfoMap[alias]);assert.ok(realId);const r=imported((await saved([{cardId:alias,count:60}])).text);assert.deepEqual(r.warnings,[],alias);assert.deepEqual(normalized(r.deck.entries),[[realId,60]],alias);}});
await T('預覽文字與複製共用且HTML安全',async()=>{const s=await saved([{cardId:energy.id,count:60}],'<img>\n// 侵入');assert.ok(s.html.includes('>'+escapeHtml(s.text)+'</pre>'));assert.equal(s.text.split('\n')[0],'// <img> // 侵入');assert.ok(!s.html.includes('<img>'));});
for(const [name,entries] of [['異常容器',{}],['空值項目',[null]],['字串張數',[{cardId:energy.id,count:'60'}]],['布林張數',[{cardId:energy.id,count:true}]],['缺卡',[{cardId:'999999999',count:60}]],['零張',[{cardId:energy.id,count:0}]],['小數',[{cardId:energy.id,count:1.5}]],['負數',[{cardId:energy.id,count:-1}]],['空牌組',[]],['部分缺卡',[{cardId:energy.id,count:59},{cardId:'999999999',count:1}]]])await T(name+'整份禁止複製且清舊資料',async()=>{const s=await saved(entries);assert.equal(s.text,'');assert.match(s.html,/<button\s+disabled/);assert.match(s.html,/role="alert"/);});
await T('剪貼簿成功才顯示成功，失敗不誤報',async()=>{const s=await saved([{cardId:energy.id,count:60}]);const handler=s.html.match(/<button[^>]*onclick="([^"]+)"[^>]*>📋 複製全部/)[1];let resolve,reject;const button={textContent:'📋 複製全部'};let written='';const navigator={clipboard:{writeText:t=>{written=t;return new Promise((r,j)=>{resolve=r;reject=j;});}}};const run=()=>new Function('navigator','window','setTimeout',handler).call(button,navigator,{_lastDeckCopyText:s.text},()=>{});run();assert.equal(written,s.text);assert.equal(button.textContent,'📋 複製全部');resolve();await new Promise(r=>setTimeout(r,0));assert.match(button.textContent,/已複製/);button.textContent='📋 複製全部';run();reject(new Error('denied'));await new Promise(r=>setTimeout(r,0));assert.doesNotMatch(button.textContent,/已複製/);assert.match(button.textContent,/失敗/);});
for(const [name,text] of [['完整',`2 ${promo.name} ${promo.setCode} ${promo.collectorNumber}`],['指定卡號',`2 ${promo.name} #${promo.id}`],['舊格式',cardLabel(promo.id,2)]])await T('保留匯入格式 '+name,()=>{const r=imported(text);assert.deepEqual(r.warnings,[]);assert.deepEqual(normalized(r.deck.entries),[[promo.id,2]]);});
await T('缺卡舊標籤不可冒充合法卡行',()=>{const text=cardLabel('999999999',1);assert.match(text,/索引未載入/);const r=imported(text);assert.equal(r.deck,null);});
console.log(`v6627 ${pass} PASS / ${fail} FAIL`);process.exitCode=fail?1:0;
