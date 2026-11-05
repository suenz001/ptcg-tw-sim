// 真 admin 消費點的瀏覽器 fixture；只替換外部查詢與不相關的原型標籤。
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
export function sliceBetween(source, start, end) {
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,'來源錨點 '+start);return source.slice(a,b);
}
export function tournamentDeckFixture(root) {
  const rd=p=>readFileSync(join(root,p),'utf8').replace(/\r\n/g,'\n');
  const html=rd('oracle-admin/admin.html');
  const pool=JSON.parse(rd('static/cards/index.json')).flatMap(s=>JSON.parse(rd('static/cards/'+s.code+'.json')));
  const info={},canonicalMap=new Map();
  const rows=sliceBetween(html,'          for (const c of cards) {','        } catch (e) {');
  for(const set of JSON.parse(rd('static/cards/index.json')))new Function('cards','s','map','canonicalMap','computeCanonicalKey',rows)(JSON.parse(rd('static/cards/'+set.code+'.json')),set,info,canonicalMap,c=>c.id);
  new Function('map',sliceBetween(html,'      for (let jp = 50220;','      cardCanonicalMap = canonicalMap;'))(info);
  const formatter=sliceBetween(html,'// >>> v6627-player-deck-import-text','// <<< v6627-player-deck-import-text');
  const added=html.includes('// >>> v6628-archived-tournament-decks')?sliceBetween(html,'// >>> v6628-archived-tournament-decks','// <<< v6628-archived-tournament-decks'):'';
  const newer=html.includes('// >>> v6629-bracket-archetypes')?sliceBetween(html,'// >>> v6629-bracket-archetypes','// <<< v6629-bracket-archetypes'):'';
  const modal=sliceBetween(html,'let _zTop = 200;','// v1.60 一般 modal');
  const outcome=sliceBetween(html,'function _tsMatchOutcome(m)', '\n}\n')+'\n}';
  const bracket=sliceBetween(html,'window.tevShowBracket = function (eventIdEnc)','// v1.48 對戰 log');
  const replay=sliceBetween(html,'window.tevOpenReplay = function','window.tevDeleteArchive =');
  const table=sliceBetween(html,"  tvDefine({\n    id: 'tsArchives',","\n  tvSetRows('tsArchives'");
  const escape=sliceBetween(html,'function escapeHtml(s)','// ── Deck modal');
  const dates=sliceBetween(html,'function _tsFmtDateTime(ms)','function _tsPct(');
  const style=html.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1];assert.ok(style);
  const code=`let tournStatsCache={archives:initialArchives};const cardInfoMap=initialInfo;
    ${escape}\n${dates}\n${modal}\n${formatter}\n${added}\n${newer}\n${outcome}\n${bracket}\n${replay}
    let pending=[];window._fixtureDelay=false;window._fixtureLoadReject=false;window._fixtureLoadCalls=0;window._fixtureApiCalls=0;
    const ensureCardIndex=()=>{window._fixtureLoadCalls++;if(window._fixtureLoadReject)throw Error('index failed');return window._fixtureDelay?new Promise(resolve=>pending.push(resolve)):Promise.resolve();};
    window._fixtureResolve=()=>pending.shift()?.();
    window._fixtureSetArchives=archives=>tournStatsCache={archives};
    window._fixtureArchives=()=>tournStatsCache.archives;
    window._fixtureInfo=cardInfoMap;window._fixtureFormat=(...args)=>playerDeckImportText(...args);
    const playerLink=(email,name)=>'<a href="#player">'+escapeHtml(name)+'</a>';
    window._fixtureClassificationCalls=0;window.api=(path,opts)=>{if(path==='/api/admin/deck-rules/classify-decks'){window._fixtureClassificationCalls++;return Promise.resolve({results:Object.fromEntries(JSON.parse(opts.body).decks.map(d=>[d.key,'測試原型']))});}window._fixtureApiCalls++;throw Error('不得查詢其他牌組');};
    window._fixtureOpened=[];window.open=(...args)=>window._fixtureOpened.push(args);
    window._fixtureClipboard='';window._fixtureClipboardReject=false;window._fixtureClipboardHold=false;
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{if(window._fixtureClipboardReject)throw Error('denied');if(window._fixtureClipboardHold)await new Promise(resolve=>window._fixtureClipboardRelease=resolve);window._fixtureClipboard=text;}}});
    let archiveTable;
    const tvDefine=config=>archiveTable=config;
    const tvTh=(id,key,label)=>'<th>'+escapeHtml(label)+'</th>';
    const tsChampDeckText=()=>'';
    const tsChampDeckCellHtml=()=>'<span>測試原型</span>';
    ${table}
    window._fixtureRender=(archives)=>{tournStatsCache={archives};document.getElementById('archive-table').innerHTML=archiveTable.render({pageRows:archives});};
    window._fixtureRender(initialArchives);`;
  return {code,style,info,pool};
}
export async function mountTournamentFixture(page,fixture,archives) {
  await page.setContent('<!doctype html><html lang="zh-Hant"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+fixture.style+'</style><body><div id="archive-table" class="table-wrap"></div><div id="modal-container"></div></body></html>');
  await page.evaluate(({code,info,archives})=>new Function('initialArchives','initialInfo',code)(archives,info),{code:fixture.code,info:fixture.info,archives});
}
