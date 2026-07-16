// v5.961 守衛(狙擊/放指示物中央收斂第2輪):
//  ①雙尾:no-bench+active → picker 含戰鬥位(opp-poke-choose;HEAD opp-bench-choose 無備戰不開 picker)
//  ②緊急滑板:「剩餘HP≤30免撤退」用有效HP(effHP;HEAD 忽略第3參用 base card.hp)
//  ③惡作劇之手:放指示物走中央 dealAttackDamageToTarget(對2隻各+30;經 picker→RESOLVE 全流程)
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const E=join(ROOT,'.r2-e.ts'),O=join(ROOT,'.r2-o.mjs'),S=join(ROOT,'.r2-s.mjs');
process.on('exit',()=>{for(const p of[E,O,S]){try{unlinkSync(p)}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { ATTACK_POST } from './src/lib/game/effects/_shared';\nexport { applyAction } from './src/lib/game/engine';\nexport { TOOL_RETREAT_MOD } from './src/lib/game/effects/cards/tools';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { ATTACK_POST, applyAction, TOOL_RETREAT_MOD } = await import(pathToFileURL(O).href);
const pool=new Map();
for(const f of readdirSync(join(ROOT,'static/cards'))){if(!f.endsWith('.json')||f==='index.json')continue;
  for(const c of JSON.parse(readFileSync(join(ROOT,'static/cards',f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
let nn=0; const inst=(cid,x={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...x});
let pass=0,fail=0; const chk=(n,c)=>{if(c)pass++;else{fail++;console.log('  ❌',n);}};

// ① 雙尾:opp 只有 active(無備戰) → 應開 opp-poke-choose 且 validIids 含 active
{
  const act=inst('14086'); // 願增猿 HP110(當對手戰鬥位)
  const st={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,setupDone:[true,true],pendingPrizes:[0,0],
    players:[{name:'P0',active:inst('14385'),bench:[],hand:[],deck:[],discard:[],prizes:[]},
             {name:'P1',active:act,bench:[],hand:[],deck:[],discard:[],prizes:[]}]};
  const out=ATTACK_POST.get('雙尾怪手|雙尾')(st,0,pool);
  const ps=out.pendingSelection;
  chk('①雙尾 no-bench 開 picker 且含戰鬥位', !!ps && ps.type==='opp-poke-choose' && (ps.params?.validIids||[]).includes(act.iid));
}

// ② 緊急滑板:effHP=110,damage=60 → 剩餘50>30 → reduceBy:1(HEAD 用 base 60→剩0≤30→zero)
{
  const fn=TOOL_RETREAT_MOD.get('緊急滑板');
  const r=fn({hp:60,name:'緊急滑板holder'}, {damage:60}, 110);
  chk('②緊急滑板 effHP=110 剩50>30 → reduceBy:1(非免撤退)', r && r.reduceBy===1 && !r.zero);
  const r2=fn({hp:60}, {damage:60}, 60);  // effHP=base 時仍 zero(無回歸)
  chk('②b 緊急滑板 effHP=base60 剩0≤30 → zero(無回歸)', r2 && r2.zero===true);
}

// ③ 惡作劇之手:opp active+bench1(高HP) picker 選2 → 各 +30
{
  const oa=inst('14086'), ob=inst('14086'); // 願增猿 HP110 ×2
  const st={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,setupDone:[true,true],pendingPrizes:[0,0],
    players:[{name:'P0',active:inst('12124'),bench:[],hand:[],deck:[],discard:[],prizes:[]},
             {name:'P1',active:oa,bench:[ob],hand:[],deck:[],discard:[],prizes:[]}]};
  let out=ATTACK_POST.get('謎擬Ｑex|惡作劇之手')(st,0,pool);
  chk('③惡作劇之手 開 picker', !!out.pendingSelection);
  if(out.pendingSelection){
    out=applyAction(out,{type:'RESOLVE_SELECTION',selectedIids:[oa.iid,ob.iid]},pool);
    const a=out.players[1].active, b=out.players[1].bench[0];
    chk('③b 惡作劇之手 對2隻各 +30(中央)', a&&a.damage===30 && b&&b.damage===30);
  }
}

console.log(`snipe-nobench-round2:PASS ${pass} / FAIL ${fail}`);
if(fail>0)process.exit(1);
