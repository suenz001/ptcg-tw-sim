// v5.750:瑞士制配對在「存在無重賽解」時必須避免重複對手(回溯取代貪婪)。
//   反例:P1對過P3、P2對過P4、P3對{P1,P4}、P4對{P2,P3} → 無重賽解=P1-P4+P2-P3;
//   貪婪會先配P1-P2把P3-P4逼成重賽(P3已對P4)。雙敗同分聚底端最易中招。
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const E=join(ROOT,'.e-sw.ts'); const O=join(ROOT,'.e-sw.mjs');
writeFileSync(E,`export * from './src/lib/tournament/swiss';`);
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib')},logLevel:'error'});
const S=await import(pathToFileURL(O).href);
let pass=0,fail=0;const T=(n,f)=>{try{f();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};
const mk=(uid,mp,opps)=>({uid,name:uid,matchPoints:mp,opponents:opps,results:[],byes:0});

T('存在無重賽解時配對不得重賽(回溯)',()=>{
  // matchPoints 設成 P1>P2>P3>P4 deterministic order
  const players=[mk('P1',6,['P3']),mk('P2',6,['P4']),mk('P3',3,['P1','P4']),mk('P4',3,['P2','P3'])];
  const pr=S.pairSwissRound(players,2,()=>0);
  // 檢查每對是否重賽
  const opp={P1:['P3'],P2:['P4'],P3:['P1','P4'],P4:['P2','P3']};
  const rematches=pr.filter(m=>m.p2 && opp[m.p1].includes(m.p2));
  console.log('  配對:',pr.map(m=>m.p1+'-'+m.p2).join(', '));
  assert.equal(rematches.length,0,'不應有重賽,實際重賽='+JSON.stringify(rematches));
});

T('雙敗對手有被記為交手過(buildSwissPlayersFromMatches)',()=>{
  const matches=[{round:1,p1uid:'A',p2uid:'B',winnerUid:null,status:'done'}]; // 雙敗(done無winner)
  const regs=[{uid:'A',name:'A'},{uid:'B',name:'B'}];
  const ps=S.buildSwissPlayersFromMatches(matches,regs);
  const a=ps.find(p=>p.uid==='A'), b=ps.find(p=>p.uid==='B');
  assert.ok(a.opponents.includes('B'),'A 應記錄對手 B(雙敗也算交手過)');
  assert.ok(b.opponents.includes('A'),'B 應記錄對手 A');
  assert.equal(a.matchPoints,0,'雙敗不得分'); assert.equal(a.results[0],'L');
});

T('全互相交手過→允許最少重賽(不卡死)',()=>{
  // 2人都互相打過 → 只能重賽
  const players=[mk('X',3,['Y']),mk('Y',3,['X'])];
  const pr=S.pairSwissRound(players,2,()=>0);
  assert.equal(pr.length,1,'仍要配出1對(被迫重賽)');
  assert.ok((pr[0].p1==='X'&&pr[0].p2==='Y')||(pr[0].p1==='Y'&&pr[0].p2==='X'));
});
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);process.exit(fail?1:0);
