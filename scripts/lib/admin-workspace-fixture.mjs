// 使用完整真 admin HTML／模組；只替身外部 SDK、Auth 與資料回應，絕不連正式服務。
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
export function workspaceData() {
  const now=Date.UTC(2026,10,5,4),entries=[{cardId:'fixture-pokemon',count:50},{cardId:'fixture-energy',count:10}];
  const users=Array.from({length:120},(_,i)=>({uid:'fixture-user-'+i,email:'player'+i+'@example.test',displayName:'測試玩家 '+i,anonymous:false,emailVerified:true,createdAt:new Date(now-i*60000).toISOString(),lastSignIn:new Date(now-i*1000).toISOString()}));
  const seats=users.slice(0,2).map(u=>({uid:u.uid,email:u.email,name:u.displayName,deckEntries:entries,deckName:'測試牌組',archetype:'測試原型'}));
  const rooms=Array.from({length:50},(_,i)=>({_id:'ROOM'+String(i).padStart(3,'0'),roomName:'手機操作測試房 '+i,status:'playing',seats,createdAt:now-i*1000,updatedAt:now-i*1000,allowSpectate:true,messageCount:3,gameStateSummary:{turn:5,phase:'main',winner:null}}));
  const archives=users.map((u,i)=>({eventId:'event-'+i,eventName:'網站賽 '+i,playerCount:2,startedAt:now-i*86400000,finishedAt:now-i*86400000+60000,championUid:u.uid,championName:u.displayName,championEmail:u.email,players:[{...u,name:u.displayName,deckEntries:entries},{...users[(i+1)%users.length],name:'對手',deckEntries:entries}],matches:[{round:1,idx:0,p1uid:u.uid,p1name:u.displayName,p2uid:users[(i+1)%users.length].uid,p2name:'對手',status:'done',winnerUid:u.uid}]}));
  const event={_id:'live-event',name:'網站賽【進行中】',status:'running',format:'single-elim',roundLimitMin:25,noShowMin:5,roundCountdownMin:3};
  const cards=[{id:'fixture-pokemon',name:'測試寶可夢',supertype:'Pokemon',subtype:'Basic',stage:'Basic',pokemonType:'Grass',regulationMark:'J',collectorNumber:'001/002',setCode:'FIXTURE',attacks:[],abilities:[]},{id:'fixture-energy',name:'基本【草】能量',supertype:'Energy',subtype:'Basic',regulationMark:'J',collectorNumber:'002/002',setCode:'FIXTURE'}];
  const overview={total:{all:1200,online:1100,local:100},new24h:120,new24hPrev:100,new7d:600,new30d:1200,firstMover:{all:{firstWin:500,secondWin:450,draws:10}},duration:{avgMs:650000,sampleCount:960,histogram:[{_id:300000,count:250},{_id:600000,count:350}]},turns:{avg:12,sampleCount:960,distribution:[{_id:8,count:300},{_id:12,count:400}]},winReasons:[{reason:'取得所有獎賞卡',count:600},{reason:'對手投降',count:350}]};
  return {now,entries,users,seats,rooms,archives,event,cards,overview};
}
export async function mountWorkspace(page,root,{user=true,delay=0}={}) {
  const html=readFileSync(join(root,'oracle-admin/admin.html'),'utf8'),d=workspaceData();
  const state={reads:[],mutations:[],unknown:[],blocked:[],pageerrors:[],firestoreReads:0,firestoreWrites:0,hold:null};
  page.on('pageerror',e=>state.pageerrors.push(e.message));
  page.on('dialog',dialog=>dialog.dismiss());
  const sdk=`const user=${user?"{uid:'fixture-admin',email:'fixture-admin@example.test',providerData:[{providerId:'password'}],getIdToken:async()=> 'fixture-only'}":'null'};
    export const initializeApp=()=>({}),getAuth=()=>({currentUser:user}),getFirestore=()=>({}),doc=(db,...p)=>p.join('/');
    export const getDoc=async path=>{window.__fixtureFsReads=(window.__fixtureFsReads||0)+1;return {exists:()=>false,data:()=>({})};};
    export const setDoc=async()=>{window.__fixtureFsWrites=(window.__fixtureFsWrites||0)+1;throw Error('禁止正式資料寫入');};
    export const onAuthStateChanged=(auth,cb)=>{setTimeout(()=>cb(user),0);return()=>{};},signOut=async()=>{},signInWithEmailAndPassword=async()=>{throw Error('fixture不登入真帳號');};`;
  const respond=(path,request)=>{
    const p=path.pathname;
    if(p==='/api/admin/stats')return {users:{enabled:true,total:55001,members:40001,anonymous:15000,active24h:2400,complete:true,at:d.now},oracle:{total:120,playing:50,lobby:20,ended:50},firebase:{enabled:true,total:30,playing:5,lobby:3,ended:22},feedback:{enabled:true,total:120,unreplied:8,new24h:12}};
    if(p==='/api/admin/firebase/users-all')return {users:d.users,cachedAt:d.now,capped:false};
    if(p==='/api/admin/oracle/rooms'||p==='/api/admin/firebase/rooms')return {rooms:d.rooms,counts:{playing:120,lobby:20,ended:900},paged:true,total:120,page:Number(path.searchParams.get('page')||1),pageSize:50,totalPages:3,cap:50,matchedTotal:120,truncated:false,orderedBy:'updatedAt'};
    if(p==='/api/admin/deck-rules')return {rules:[{_id:'fixture-rule',name:'測試原型',enabled:true,priority:1,includes:['測試寶可夢'],excludes:[]}],rulesApi:1};
    if(p==='/api/admin/deck-rules/classify-decks'){const body=JSON.parse(request.postData()||'{}');return {results:Object.fromEntries((body.decks||[]).map(r=>[r.key,'測試原型']))};}
    if(p==='/api/admin/cards/tags')return {tags:{}};
    if(p==='/api/tournament/admin/events')return {events:[d.event]};
    if(p==='/api/tournament/admin/event/registrations')return {event:d.event,regs:d.users.slice(0,24).map(u=>({...u,name:u.displayName,deckCount:60,deckEntries:d.entries,deckText:'50 測試寶可夢 #fixture-pokemon\n10 基本【草】能量 #fixture-energy',registeredAt:d.now}))};
    if(p==='/api/tournament/admin/tie-matches')return {ties:[]};
    if(p==='/api/tournament/admin/pending-matches')return {pending:[]};
    if(p==='/api/tournament/champions')return {champions:[]};
    if(p==='/api/tournament/admin/daily-preset')return {dailyApi:1,twDateStr:'2026-11-05',slots:[]};
    if(p==='/api/tourn-chat-pin')return {pinApi:1,pin:null};
    if(p==='/api/tourn-time-limit-verdict')return {tlvApi:1,config:{mode:'double-loss'}};
    if(p==='/api/tournament/admin/stats')return {archives:d.archives,champions:[],paged:true,total:120,totalPages:1};
    if(p==='/api/admin-tourn-seasons')return {seasonApi:1,seasons:[{id:'2026-1',name:'2026年第一季',startAt:d.now-86400000}],pending:null};
    if(p==='/api/admin-preset-decks')return {managedPresetsApi:1,revision:1,decks:Array.from({length:24},(_,i)=>({id:'deck-'+i,name:'預設牌組 '+i,entries:d.entries,deleted:false}))};
    if(p==='/api/admin/firebase/feedback')return {feedback:Array.from({length:80},(_,i)=>({_id:'feedback-'+i,id:'feedback-'+i,email:d.users[i].email,name:d.users[i].displayName,text:'手機介面建議 '+i,createdAt:d.now-i*1000,status:'open'}))};
    if(p==='/api/admin/match-records')return {records:d.rooms.map((r,i)=>({...r,id:'match-'+i,players:d.seats,winner:0,turnCount:10,totalTurns:10,durationMs:600000,finishedAt:d.now})),total:120,totalPages:3,page:1};
    if(p==='/api/admin/stats/overview')return d.overview;
    if(p==='/api/admin/stats/cards')return {totalDecks:240,cards:d.cards.map(c=>({cardId:c.id,deckCount:100,totalCount:300})),topPokemon:[],topTrainers:[],energyDistribution:[]};
    if(p==='/api/admin/stats/players')return {players:d.users.map((u,i)=>({...u,name:u.displayName,total:40,wins:20,losses:20,winRate:50}))};
    if(p==='/api/admin/stats/cards/winrate')return {cards:d.cards.map(c=>({cardId:c.id,totalDecks:100,winDecks:50,winRate:50}))};
    if(p==='/api/admin/stats/heatmap')return {cells:[{day:1,hour:12,count:50},{day:2,hour:15,count:100}]};
    if(p==='/api/admin/stats/trends')return {days:7,granularity:'day',buckets:Array.from({length:7},(_,i)=>({bucket:'2026-11-0'+(i+1),total:80+i,online:75,local:5}))};
    if(p==='/api/tourn-player-clock')return {playerClockApi:1,policy:{enabled:false,minutes:15}};
    if(p.startsWith('/api/tournament/admin/clientdiag'))return {hours:24,summary:{},rows:[],recent:[],fingerprints:[],groups:[],total:0};
    if(p.startsWith('/api/tournament/admin/')||p==='/api/friends/admin/config'||p==='/api/friends/admin/dm-config')return {config:{enabled:false,maxWaitMs:25000},enabled:false,held:0,rooms:0};
    state.unknown.push(p);return {error:'fixture尚未提供 '+p};
  };
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.hostname==='www.gstatic.com'&&url.pathname.includes('/firebasejs/'))return route.fulfill({contentType:'text/javascript',body:sdk});
    if(url.hostname==='admin.fixture.test'&&url.pathname==='/admin')return route.fulfill({contentType:'text/html; charset=utf-8',body:html});
    if(url.hostname==='admin.fixture.test'&&url.pathname.startsWith('/api/')){
      const read=request.method()==='GET'||url.pathname==='/api/admin/deck-rules/classify-decks';
      (read?state.reads:state.mutations).push({path:url.pathname,query:url.search,method:request.method()});
      if(!read)return route.fulfill({status:405,contentType:'application/json',body:JSON.stringify({error:'fixture禁止異動'})});
      if(state.hold)await state.hold(url);
      if(delay)await new Promise(r=>setTimeout(r,delay));
      return route.fulfill({contentType:'application/json',body:JSON.stringify(respond(url,request))});
    }
    if(url.hostname==='suenz001.github.io'){
      if(url.pathname.endsWith('/cards/index.json'))return route.fulfill({contentType:'application/json',body:JSON.stringify([{code:'FIXTURE',name:'測試資料',cardCount:d.cards.length}])});
      if(url.pathname.endsWith('/cards/FIXTURE.json'))return route.fulfill({contentType:'application/json',body:JSON.stringify(d.cards)});
      for(const n of ['changelog.html','changelog-bodies.html','changelog-archive.html'])if(url.pathname.endsWith('/'+n))return route.fulfill({contentType:'text/html; charset=utf-8',body:readFileSync(join(root,'static',n),'utf8')});
    }
    state.blocked.push(url.hostname+url.pathname);return route.fulfill({status:404,body:''});
  });
  await page.goto('http://admin.fixture.test/admin');
  await page.locator(user?'#app-section':'#login-section').waitFor({state:'visible'});
  if(user)await page.getByText('55001',{exact:true}).waitFor();
  return {state,data:d};
}
export async function openWorkspaceTab(page,name) {
  await page.evaluate(async name=>{await window.switchTab(name);},name);
  await page.waitForTimeout(80);
}
