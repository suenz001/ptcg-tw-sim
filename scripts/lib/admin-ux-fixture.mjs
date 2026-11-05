// 抽取真 admin 頂層 AST；外部 API 與非本次範圍的卡片統計資料由測試提供。
import ts from 'typescript';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
export function adminUxFixture(root) {
  const html=readFileSync(join(root,'oracle-admin/admin.html'),'utf8').replace(/\r\n/g,'\n');
  const js=html.slice(html.indexOf('<script type="module">')+22,html.lastIndexOf('</script>'));
  const ast=ts.createSourceFile('admin.js',js,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const code=name=>{const nodes=ast.statements.filter(n=>ts.isFunctionDeclaration(n)?n.name?.text===name:ts.isExpressionStatement(n)&&ts.isBinaryExpression(n.expression)&&n.expression.left.getText(ast)===name);assert.equal(nodes.length,1,'真函式 '+name);return nodes[0].getText(ast);};
  const decl=name=>{const nodes=ast.statements.filter(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(ast)===name));assert.equal(nodes.length,1,'真宣告 '+name);return nodes[0].getText(ast);};
  const block=tag=>{const a=js.indexOf('// >>> '+tag),b=js.indexOf('// <<< '+tag,a);return a<0?'':js.slice(a,b);};
  const names=['escapeHtml','window.playerLink','tsArchivePlayerOf','tsArchiveDeckButton','_tsModal','bumpModalZ','window._tsCloseModal','_tsMatchOutcome','window.tevShowBracket','tvDefine','tvSetRows','tvView','tvRender','tvPagerHtml','tvTh','tvSearchBox','window.tvSort','window.tvPage','window.tvSearch','window.tvJump','renderTournamentStats','tsFilterLabel','tsFilterBarHtml','_tsPct','_tsFmtDateTime','_tsFmtDuration'];
  const setup=`let _zTop=200,tournStatsCache={archives:[]},tsEventFilter='all',_tsChampArchMsg='';${decl('TV_PAGE_SIZE')}const tableViews=Object.create(null);
    const detectMainPokemon=()=>'',tsChampDeckText=()=>'',tsChampDeckCellHtml=()=>'';
    window._calls=[];window._classWait=[];window._classFail=false;window._holdClass=false;
    function api(path,opts){window._calls.push({path,body:opts?.body?JSON.parse(opts.body):null});
      if(path==='/api/admin/deck-rules/classify-decks'){if(window._classFail)return Promise.resolve({error:'offline'});if(window._holdClass)return new Promise(r=>window._classWait.push(r));return Promise.resolve({results:Object.fromEntries(JSON.parse(opts.body).decks.map(d=>[d.key,'原型-'+d.entries[0].cardId]))});}
      if(path.startsWith('/api/admin/oracle/rooms')){if(window._holdRooms)return new Promise(r=>window._roomWait.push(r));return Promise.resolve(window._roomData);}
      if(path.startsWith('/api/admin/deck-archetype-stats'))return window._statAuto?Promise.resolve({}):new Promise(r=>window._statWait.push(r));
      if(path.startsWith('/api/admin/deck-archetype-matchups'))return new Promise(r=>window._mxWait.push(r));throw Error('禁止其他 API '+path);}
    ${block('v6629-explicit-admin-search')}\n${block('v6629-bracket-archetypes')}\n${names.map(code).join('\n')}
    window._stats=archives=>{tournStatsCache={archives};renderTournamentStats(document.getElementById('stats'),tournStatsCache);};
    window._event=a=>{tournStatsCache={archives:Array.isArray(a)?a:[a]};};`;
  const rooms=['loadOracleRooms','_restoreOracleSearchFocus','renderRoomsTab','window.setRoomsPage','window.setOracleRoomsRange','window.setStatusFilter','window.filterRoomsBySearch','archetypePickerHtml','window.pickOracleArchetype'];
  if(js.includes('function filterLocalRooms('))rooms.push('filterLocalRooms');
  const roomSetup=`let statusFilter='all',currentTab='oracle-rooms',oracleRoomsCache=[],firebaseRoomsCache=[],oracleRoomsCounts=null,firebaseRoomsCounts=null,oracleRoomsRange='7d',oracleRoomsArchScan=null,oracleRoomsSearch='',firebaseRoomsSearch='',oracleRoomsSrv=null,firebaseRoomsSrv=null,firebaseRoomsMsgCounts=false,oracleRoomsPage=1,firebaseRoomsPage=1,oracleRoomsRequest=0,_oracleSearchTimer=null,_oracleSearchFocus=false;${decl('ROOMS_PAGE_SIZE')}const uidEmailMap=new Map();let _deckRules=[{name:'原型A'}],_deckRulesLoadPromise=Promise.resolve(false);
    const primeEmailMap=()=>{},ensureCardIndex=()=>Promise.resolve(),ensureCardTags=()=>Promise.resolve();
    const renderRoomRow=r=>'<tr><td>'+escapeHtml(r._id)+'</td><td>'+escapeHtml(r.roomName)+'</td></tr>';
    ${rooms.map(code).join('\n')}
    window._roomWait=[];window._holdRooms=false;window._roomData={rooms:[],paged:true,total:0,page:1,pageSize:50,totalPages:1};
    window._rooms=(source,rows,paged=false)=>{if(source==='oracle'){oracleRoomsCache=rows;oracleRoomsSrv=paged?{total:rows.length,page:1,pageSize:50,totalPages:1}:null;}else firebaseRoomsCache=rows;renderRoomsTab(document.getElementById('tab-'+source+'-rooms'),source,rows);};
    window._loadRooms=loadOracleRooms;window._roomQuery=()=>oracleRoomsSearch;`;
  const rangeNames=['window.setArchSince','currentArchSince','window.loadArchetypeStats','mxReadOpts','mxPeriodText','window.loadArchMatchups','window.openMetaImageExport'];
  if(js.includes('function mxCommitOpts('))rangeNames.push('mxCommitOpts','window.applyArchMatchupFilters');
  const rangeSetup=`let _archSince='0',_archStats=null,_archStatsDays=0,_archStatsBusy=false,_mxData=null,_mxBusy=false,_mxDays=0,_mxOpt={src:'casual',topN:20,minGames:5};window._statWait=[];window._mxWait=[];window._renderedOpts=[];window._draws=[];let _miBusy=false,_miOut={};const miDraw=async(src,cur,trend,days)=>{window._draws.push({src,cur,days});return{};},miTrend=()=>null,miStamp=()=>'',renderMetaImageModal=()=>{};window.alert=()=>{throw Error('不應警告');};const miDate=n=>new Date(n).toISOString().slice(0,10);
    const renderArchetypeStats=()=>{},renderArchMatchups=()=>window._renderedOpts.push(mxReadOpts());
    ${rangeNames.map(code).join('\n')}
    window._range=()=>({since:currentArchSince(),stats:_archStats,statsDays:_archStatsDays,mx:_mxData,mxDays:_mxDays,opts:mxReadOpts(),period:mxPeriodText()});
    window._mxReady=()=>{_mxData={fixture:1};};window._seedStats=()=>{_archStats={period:'ALL'};_archStatsDays=0;};`;
  return {html,code,block,setup,roomSetup,rangeSetup,style:html.match(/<style>([\s\S]*?)<\/style>/)[1]};
}
export async function mountAdminUx(page,f,mode='stats') {
  await page.setContent('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+f.style+'</style><div id="stats"></div><div id="tab-oracle-rooms"></div><div id="tab-firebase-rooms"></div><div id="arch-stats-box"></div><div id="mx-box"></div><div id="mx-turn-box"></div><div id="mx-name-list"></div><select id="arch-since"><option value="0">全部</option><option value="7">7天</option></select><select id="mx-src"><option value="casual">一般</option><option value="tourn">賽事</option></select><select id="mx-topn"><option value="20">20</option><option value="10">10</option></select><select id="mx-min"><option value="5">5</option><option value="20">20</option></select><button id="meta-img-btn"></button><button id="meta-img-full-btn"></button><button id="mx-img-btn"></button><button id="mx-focus-btn"></button><button id="mx-turn-img-btn"></button>');
  await page.addScriptTag({content:f.setup+(mode==='rooms'?f.roomSetup:mode==='ranges'?f.rangeSetup:'')});
}
