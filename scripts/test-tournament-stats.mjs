import { buildLeaderboards, buildProfile, detectCutPlacements } from './tournament-stats-core.mjs';
import assert from 'node:assert';
const P = (uid,name,email)=>({uid,name,email});
const M = (round,p1,p2,win,extra={})=>({round,idx:0,p1uid:p1,p2uid:p2,winnerUid:win,status:'done',bye:false,...extra});
// 官方:8人 瑞士2輪 + Top Cut(8強/4強/決賽), 冠軍 ua
const OFF={ eventName:'官方賽', format:'swiss-then-cut', communityEvent:false, finishedAt:200, championUid:'ua',
  players:['a','b','c','d','e','f','g','h'].map(x=>P('u'+x,x.toUpperCase(),x+'@')),
  matches:[
    M(1,'ua','ub','ua'),M(1,'uc','ud','uc'),M(1,'ue','uf','ue'),M(1,'ug','uh','ug'),
    M(2,'ua','uc','ua'),M(2,'ue','ug','ue'),M(2,'ub','ud','ub'),M(2,'uf','uh','uf'),
    M(3,'ua','uh','ua'),M(3,'ub','ug','ub'),M(3,'uc','uf','uc'),M(3,'ud','ue','ud'), // 8強
    M(4,'ua','ub','ua'),M(4,'uc','ud','uc'), // 4強
    M(5,'ua','uc','ua'), // 決賽 → ua 冠
  ]};
// 社群:單淘汰4人, 冠軍 ua, a 暱稱改 Alice(較晚)
const COM={ eventName:'社群賽', format:'single-elim', communityEvent:true, finishedAt:300, championUid:'ua',
  players:[P('ua','Alice','a@'),P('ue','E','e@'),P('ux','X','x@'),P('uy','Y','y@')],
  matches:[ M(1,'ua','ue','ua'),M(1,'ux','uy','ux'), M(2,'ua','ux','ua') ]};
const commEvents=[ {createdBy:'a@',proposerName:'Alice',createdAt:300}, {createdBy:'a@',proposerName:'Alice',createdAt:100}, {createdBy:'z@',proposerName:'Zed',createdAt:50} ];

let pass=0,fail=0; const T=(n,f)=>{try{f();console.log(' OK',n);pass++;}catch(e){console.log(' FAIL',n,'::',e.message);fail++;}};

T('detectCutPlacements 8強/4強/決賽', ()=>{
  const c=detectCutPlacements(OFF.matches);
  assert.equal(c.top8.size,8,'8強應8人'); assert.equal(c.top4.size,4); assert.equal(c.finals.size,2);
  assert.ok(c.finals.has('ua')&&c.finals.has('uc')); assert.ok(c.top4.has('ub')&&c.top4.has('ud')); assert.ok(c.top8.has('uh'));
});
const lb=buildLeaderboards([OFF,COM],commEvents);
T('冠軍榜官方 top1=Alice(1)', ()=>{ assert.equal(lb.champions.official[0].count,1); assert.equal(lb.champions.official[0].displayName,'Alice'); });
T('冠軍榜社群 top1=Alice(1)', ()=>{ assert.equal(lb.champions.community[0].displayName,'Alice'); assert.equal(lb.champions.community[0].count,1); });
T('勝場榜 Alice=7(官5+社2)', ()=>{ const a=lb.wins.find(x=>x.displayName==='Alice'); assert.equal(a.count,7); });
T('8強榜 各1、長度<=5', ()=>{ assert.ok(lb.top8.length<=5&&lb.top8.length>0); assert.ok(lb.top8.every(x=>x.count===1)); });
T('決賽榜 含Alice/C 各1', ()=>{ assert.ok(lb.finals.some(x=>x.displayName==='Alice'&&x.count===1)); });
T('社群主辦榜 Alice=2 第一', ()=>{ assert.equal(lb.communityHost[0].displayName,'Alice'); assert.equal(lb.communityHost[0].count,2); });
const pf=buildProfile([OFF,COM],'a@');
T('個資 Alice 官冠1社冠1決1四1八1', ()=>{ assert.equal(pf.championsOfficial,1); assert.equal(pf.championsCommunity,1); assert.equal(pf.finals,1); assert.equal(pf.top4,1); assert.equal(pf.top8,1); });
T('個資 參賽2/勝7/暱稱Alice/events2', ()=>{ assert.equal(pf.eventsPlayed,2); assert.equal(pf.totalWins,7); assert.equal(pf.displayName,'Alice'); assert.equal(pf.events.length,2); assert.equal(pf.events[0].result,'冠軍'); });
T('個資 h@ 只入8強(非4強)', ()=>{ const p=buildProfile([OFF,COM],'h@'); assert.equal(p.top8,1); assert.equal(p.top4,0); assert.equal(p.finals,0); });
T('社群不算8強/決賽(COM不汙染)', ()=>{ const p=buildProfile([COM],'a@'); assert.equal(p.top8,0); assert.equal(p.finals,0); assert.equal(p.championsCommunity,1); });

// ── v5.695 同分 tie-break：最近達成者優先 ──
const offX={ eventName:'官X', format:'single-elim', communityEvent:false, finishedAt:1000, championUid:'ux', players:[P('ux','PX','x@'),P('uo','O','o@')], matches:[M(1,'ux','uo','ux')] };
const offY={ eventName:'官Y', format:'single-elim', communityEvent:false, finishedAt:2000, championUid:'uy', players:[P('uy','PY','y@'),P('uo','O','o@')], matches:[M(1,'uy','uo','uy')] };
const lb2=buildLeaderboards([offX,offY],[]);
T('star 冠軍榜同分→最近奪冠者優先(PY@2000 在 PX@1000 前)', ()=>{ const off=lb2.champions.official; const iX=off.findIndex(r=>r.displayName==='PX'), iY=off.findIndex(r=>r.displayName==='PY'); assert.ok(iY>=0&&iX>=0&&iY<iX, '最近奪冠者應在前 '+JSON.stringify(off)); });
T('star 勝場榜同分→最近有勝場者優先(PY 在 PX 前)', ()=>{ const w=lb2.wins; const iX=w.findIndex(r=>r.displayName==='PX'), iY=w.findIndex(r=>r.displayName==='PY'); assert.ok(iY>=0&&iX>=0&&iY<iX, '最近有勝場者應在前 '+JSON.stringify(w)); });

console.log('\n錦標賽戰績聚合:PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
