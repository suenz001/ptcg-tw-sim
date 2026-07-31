// v6.083 守衛：Fable 5 審查後的四項修正（每項都經我獨立查證才實作）
//   1. 〔高〕picker 送 [] = 玩家明確選 0 —— 原本被當「沒傳」→ 全展示 / 全丟
//   2. 〔中〕霸者咆哮 per-placement（不是 per-turn-name）
//   3. 〔中〕energy-distribute 的 targetIids 白名單要在 attach 端強制（公平性）
//   4. 〔中〕拍檔提升 picker maxCount 按「屬性種類」cap
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.f83-s.js'),E=join(ROOT,'.f83-e.ts'),O=join(ROOT,'.f83-o.mjs');
process.on('exit',()=>{for(const p of[S,E,O]){try{unlinkSync(p)}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { ATTACK_PRE, RESOLVERS, getAbilityFn } from './src/lib/game/effects/_shared';\n"
              +"import './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const M = await import(pathToFileURL(O).href);
const ATTACK_PRE = M.ATTACK_PRE ?? new Map();
const RESOLVERS = M.RESOLVERS ?? new Map();
const getAbilityFn = M.getAbilityFn ?? (() => undefined);

const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){ if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))) if(c?.id!=null) pool.set(String(c.id),c); }
const byName=(n,p2)=>[...pool.values()].find(c=>c.name===n && (!p2||p2(c)));
const ZH={Grass:'草',Fire:'火',Water:'水',Lightning:'雷',Psychic:'超',Fighting:'鬥',Darkness:'惡',Metal:'鋼'};
const EID={}; for(const [id,c] of pool){ if(c.supertype!=='Energy'||c.subtype!=='Basic')continue;
  for(const [k,z] of Object.entries(ZH)) if(c.name===`基本【${z}】能量` && !EID[k]) EID[k]=id; }
let n=0; const inst=(cid,e={})=>({iid:`f${++n}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0; const chk=(t,c,extra='')=>{ if(c){pass++;} else {fail++;console.log('  ❌',t,extra);} };
const mk=(me)=>({ phase:'playing', turnPhase:'main', turn:5, activePlayerIndex:0, firstPlayerIdx:0,
  isFirstTurn:false, setupDone:[true,true], log:[], pendingSelection:null, activeStadium:null,
  players:[{name:'P1',active:null,bench:[],hand:[],deck:[],discard:[],prizes:[],...me},
           {name:'P2',active:null,bench:[],hand:[],deck:[],discard:[],prizes:[],prizes:[]}] });

// ══ 1〔高〕[] = 玩家明確選 0 ══
{
  // 1a. 鮮豔鞭打（hand-reveal）：按「不給對手看」→ 0 傷害、**不得**全部展示
  const dr=byName('變隱龍', c=>(c.attacks||[]).some(a=>a.name==='鮮豔鞭打'));
  const g=[...pool.values()].find(c=>c.supertype==='Pokemon'&&c.pokemonType==='Grass');
  const f2=[...pool.values()].find(c=>c.supertype==='Pokemon'&&c.pokemonType==='Fire');
  const h1=inst(g.id), h2=inst(f2.id);
  const st=mk({ active:inst(dr.id), hand:[h1,h2] });
  const fn=ATTACK_PRE.get('變隱龍|鮮豔鞭打');
  chk('鮮豔鞭打 有 regPre', typeof fn==='function');
  if (typeof fn==='function') {
    const r0=fn(st,0,pool,{ discardedEnergyIids: [] });
    chk('〔高〕鮮豔鞭打：送 [] → 0 傷害（不是全展示）', r0.damage===0, String(r0.damage));
    chk('〔高〕鮮豔鞭打：送 [] → log 不含展示卡名',
        !r0.state.log.map(l=>l.message??l).some(t=>String(t).includes('給對手看 2 張')), '');
    const rU=fn(st,0,pool,{});   // undefined = AI/headless
    chk('AI fallback（undefined）仍全展示 → 2 種屬性 60', rU.damage===60, String(rU.damage));
    const rP=fn(st,0,pool,{ discardedEnergyIids:[h1.iid] });
    chk('正常選 1 張 → 1 種屬性 30', rP.damage===30, String(rP.damage));
  }
  // 1b. 劍武備（同機制）
  const ds=byName('雙劍鞘', c=>(c.attacks||[]).some(a=>a.name==='劍武備'));
  const one=byName('獨劍鞘');
  const st2=mk({ active:inst(ds.id), hand:[inst(one.id), inst(ds.id)] });
  const fn2=ATTACK_PRE.get('雙劍鞘|劍武備');
  if (typeof fn2==='function') {
    chk('〔高〕劍武備：送 [] → 0 傷害（不是全展示 120）', fn2(st2,0,pool,{discardedEnergyIids:[]}).damage===0,
        String(fn2(st2,0,pool,{discardedEnergyIids:[]}).damage));
    chk('劍武備：AI fallback 仍全展示 → 120', fn2(st2,0,pool,{}).damage===120);
  }
  // 1c. 電壓錘（registerSelfDiscardMultiply，既有 v4.71 病一併修）
  const em=byName('電擊魔獸', c=>(c.attacks||[]).some(a=>a.name==='電壓錘'));
  const e1=inst(EID.Lightning), e2=inst(EID.Lightning);
  const A=inst(em.id); A.energyAttached=[e1,e2];
  const st3=mk({ active:A });
  const fn3=ATTACK_PRE.get('電擊魔獸|電壓錘');
  if (typeof fn3==='function') {
    const r=fn3(st3,0,pool,{ discardedEnergyIids: [] });
    chk('〔高〕電壓錘：送 [] → 0 傷害（不是自動全丟）', r.damage===0, String(r.damage));
    chk('〔高〕電壓錘：送 [] → 能量沒被丟', (r.state.players[0].active?.energyAttached??[]).length===2,
        String(r.state.players[0].active?.energyAttached?.length));
    chk('電壓錘：AI fallback（undefined）仍自動丟 → 120', fn3(st3,0,pool,{}).damage===120,
        String(fn3(st3,0,pool,{}).damage));
  }
}

// ══ 2〔中〕霸者咆哮 per-placement（同回合第二隻仍可發動）══
{
  const RAYQ=byName('超級烈空坐ex', c=>(c.abilities||[]).some(a=>a.name==='霸者咆哮'));
  const fn=getAbilityFn('超級烈空坐ex','霸者咆哮',0);
  if (typeof fn==='function') {
    const a=inst(RAYQ.id), b=inst(RAYQ.id);
    const st=mk({ bench:[a,b], deck:[inst(EID.Fire),inst(EID.Water),inst(EID.Grass),inst(EID.Metal)] });
    const r1=fn(st,0,pool,a);
    chk('霸者咆哮：第 1 隻可發動', r1.pendingSelection?.effectKey==='m6-overlord-roar');
    // 模擬引擎已把第一次記進 abilityNamesUsedThisTurn（舊實作會因此擋掉第二隻）
    const mid={...r1, pendingSelection:null,
      players:[{...r1.players[0], abilityNamesUsedThisTurn:['霸者咆哮']}, r1.players[1]]};
    const r2=fn(mid,0,pool,b);
    chk('〔中〕霸者咆哮：同回合第 2 隻仍可發動（卡面沒有名稱層級限制）',
        r2.pendingSelection?.effectKey==='m6-overlord-roar',
        r2.log.map(l=>l.message??l).slice(-1)[0]);
  } else chk('霸者咆哮 有註冊', false);
}

// ══ 3〔中〕energy-distribute targetIids 白名單在 attach 端強制（公平性）══
{
  const rz=RESOLVERS.get('v87-energy-distribute-flat');
  chk('v87-energy-distribute-flat 有 resolver', typeof rz==='function');
  if (typeof rz==='function') {
    const MAG=byName('鴨嘴炎獸', c=>(c.abilities||[]).some(a=>a.name==='拍檔提升'));
    const OTHER=byName('杖尾鱗甲龍');
    const allowed=inst(MAG.id), notAllowed=inst(OTHER.id);
    const energy=inst(EID.Fire);
    const st=mk({ active:allowed, bench:[notAllowed], discard:[energy] });
    const params={ label:'拍檔提升', energyIids:[energy.iid], targetIids:[allowed.iid] };
    // ⭐ 惡意 client：把目標指到白名單外的寶可夢
    const bad=rz(st,0,[notAllowed.iid],params,pool);
    chk('〔中〕公平性：白名單外的目標拿不到能量',
        (bad.players[0].bench[0]?.energyAttached??[]).length===0,
        JSON.stringify(bad.players[0].bench[0]?.energyAttached));
    // 正對照：白名單內正常附加
    const good=rz(st,0,[allowed.iid],params,pool);
    chk('正對照：白名單內的目標拿得到能量',
        (good.players[0].active?.energyAttached??[]).length===1);
    // 否定對照：沒有 targetIids（舊卡）→ 不限（行為不變）
    const legacy=rz(st,0,[notAllowed.iid],{ label:'舊卡', energyIids:[energy.iid] },pool);
    chk('否定對照：沒 targetIids 的舊呼叫點不受影響',
        (legacy.players[0].bench[0]?.energyAttached??[]).length===1);
  }
}

// ══ 4〔中〕拍檔提升 picker maxCount 按屬性種類 cap ══
{
  const fn=getAbilityFn('鴨嘴炎獸','拍檔提升',0);
  const MAG=byName('鴨嘴炎獸', c=>(c.abilities||[]).some(a=>a.name==='拍檔提升'));
  if (typeof fn==='function') {
    const self=inst(MAG.id);
    // 手牌兩張火、零張雷 → 上限應是 1（不是 2）
    const st=mk({ active:self, hand:[inst(EID.Fire), inst(EID.Fire)] });
    const r=fn(st,0,pool,self);
    chk('〔中〕拍檔提升：只有火 → picker 上限 1', r.pendingSelection?.maxCount===1,
        String(r.pendingSelection?.maxCount));
    // 火 + 雷 各一 → 上限 2
    const st2=mk({ active:inst(MAG.id), hand:[inst(EID.Fire), inst(EID.Lightning)] });
    const r2=fn(st2,0,pool,st2.players[0].active);
    chk('正對照：火＋雷 → picker 上限 2', r2.pendingSelection?.maxCount===2,
        String(r2.pendingSelection?.maxCount));
  } else chk('拍檔提升 有註冊', false);
}

console.log(`test-v6083-fable-review-fixes: ${pass} passed, ${fail} failed`);
if (fail>0) process.exit(1);
