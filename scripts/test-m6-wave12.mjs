// v6.078 守衛（M6 批次12）：電擊魔獸|電壓錘（基本能量 only）＋ hand-reveal 型招式
//   （變隱龍|鮮豔鞭打＝屬性種類×30、雙劍鞘|劍武備＝張數×60，後者本版由「自動全展示」改玩家挑）
//   ⭐ 否定對照：特殊能量不可選/不計、未選任何卡=0 傷、送不合法 iid 不生效。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.w12-s.js'),E=join(ROOT,'.w12-e.ts'),O=join(ROOT,'.w12-o.mjs');
process.on('exit',()=>{for(const p of[S,E,O]){try{unlinkSync(p)}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { applyAction, createGame } from './src/lib/game/engine';\n"
              +"export { ATTACK_PRE, ATTACK_PRE_DISCARD_CHOICE } from './src/lib/game/effects/_shared';\n"
              +"import './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const M = await import(pathToFileURL(O).href);
const ATTACK_PRE = M.ATTACK_PRE ?? new Map();
const SPECS = M.ATTACK_PRE_DISCARD_CHOICE ?? new Map();   // HEAD-FAIL 安全

const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){ if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))) if(c?.id!=null) pool.set(String(c.id),c); }
const byName=(n,pred)=>[...pool.values()].find(c=>c.name===n && (!pred||pred(c)));
const ZH={Grass:'草',Fire:'火',Water:'水',Lightning:'雷',Psychic:'超',Fighting:'鬥',Darkness:'惡',Metal:'鋼'};
const EID={}; for(const [id,c] of pool){ if(c.supertype!=='Energy')continue;
  for(const [k,z] of Object.entries(ZH)) if(c.name===`基本【${z}】能量` && !EID[k]) EID[k]=id; }
let n=0; const inst=(cid,e={})=>({iid:`x${++n}`,cardId:String(cid),damage:0,energyAttached:[],...e});
let pass=0,fail=0; const chk=(t,c,extra='')=>{ if(c){pass++;} else {fail++;console.log('  ❌',t,extra);} };
const mk=(over={})=>({ phase:'playing', turnPhase:'main', turn:5, activePlayerIndex:0, firstPlayerIdx:0,
  isFirstTurn:false, setupDone:[true,true], log:[], pendingSelection:null, activeStadium:null,
  players:[{name:'P1',active:null,bench:[],hand:[],deck:[],discard:[],prizes:[]},
           {name:'P2',active:null,bench:[],hand:[],deck:[],discard:[],prizes:[]}], ...over });
const logText=(l)=>String(l?.message ?? l?.text ?? l);

// ══ 1. 電擊魔獸｜電壓錘 —— 基本能量卡 only，張數 × 60 ══
{
  const spec = SPECS.get('電擊魔獸|電壓錘');
  chk('電壓錘 有 PreDiscardSpec', !!spec);
  chk('電壓錘 scope=attacker（卡面「這隻寶可夢」非「場上」）', spec?.scope==='attacker', spec?.scope);
  chk('電壓錘 picker 限基本能量（basicEnergyOnly）', spec?.basicEnergyOnly===true, String(spec?.basicEnergyOnly));
  chk('電壓錘 每張 60', spec?.damagePerEnergy===60, String(spec?.damagePerEnergy));

  const em=byName('電擊魔獸', c=>(c.attacks||[]).some(a=>a.name==='電壓錘'));
  const special=[...pool.values()].find(c=>c.supertype==='Energy'&&c.subtype!=='Basic');
  const e1=inst(EID.Lightning), e2=inst(EID.Lightning), e3=inst(special.id);
  const A=inst(em.id); A.energyAttached=[e1,e2,e3];
  const st=mk({ players:[{name:'P1',active:A,bench:[],hand:[],deck:[],discard:[],prizes:[]},
                         {name:'P2',active:inst(em.id),bench:[],hand:[],deck:[],discard:[],prizes:[]}] });
  const fn=ATTACK_PRE.get('電擊魔獸|電壓錘');
  chk('電壓錘 有 regPre', typeof fn==='function');
  if (typeof fn==='function') {
    const r=fn(st,0,pool,{ discardedEnergyIids:[e1.iid,e2.iid] });
    chk('電壓錘 選 2 張基本 → 120', r.damage===120, String(r.damage));
    chk('電壓錘 丟掉的 2 張進棄牌', r.state.players[0].discard.length===2, String(r.state.players[0].discard.length));
    // ⭐ 否定對照：特殊能量的 iid 不該被計入 / 不該被丟
    const r2=fn(st,0,pool,{ discardedEnergyIids:[e3.iid] });
    chk('否定對照：特殊能量不算基本能量 → 0 傷', r2.damage===0, String(r2.damage));
    chk('否定對照：特殊能量沒被丟掉', r2.state.players[0].discard.length===0, String(r2.state.players[0].discard.length));
  }
}

// ══ 2. hand-reveal：變隱龍｜鮮豔鞭打（屬性種類 × 30）══
{
  const spec = SPECS.get('變隱龍|鮮豔鞭打');
  chk('鮮豔鞭打 spec scope=hand-reveal', spec?.scope==='hand-reveal', spec?.scope);
  chk('鮮豔鞭打 verb=reveal（只給看不丟）', spec?.verb==='reveal', spec?.verb);
  chk('鮮豔鞭打 限寶可夢卡', spec?.handRevealSupertype==='Pokemon', spec?.handRevealSupertype);

  const dr=byName('變隱龍', c=>(c.attacks||[]).some(a=>a.name==='鮮豔鞭打'));
  const grass=[...pool.values()].find(c=>c.supertype==='Pokemon'&&c.pokemonType==='Grass');
  const grass2=[...pool.values()].find(c=>c.supertype==='Pokemon'&&c.pokemonType==='Grass'&&c.id!==grass.id);
  const fire=[...pool.values()].find(c=>c.supertype==='Pokemon'&&c.pokemonType==='Fire');
  const h1=inst(grass.id), h2=inst(grass2.id), h3=inst(fire.id), h4=inst(EID.Water);
  const st=mk({ players:[{name:'P1',active:inst(dr.id),bench:[],hand:[h1,h2,h3,h4],deck:[],discard:[],prizes:[]},
                         {name:'P2',active:inst(dr.id),bench:[],hand:[],deck:[],discard:[],prizes:[]}] });
  const fn=ATTACK_PRE.get('變隱龍|鮮豔鞭打');
  chk('鮮豔鞭打 有 regPre', typeof fn==='function');
  if (typeof fn==='function') {
    const r=fn(st,0,pool,{ discardedEnergyIids:[h1.iid,h2.iid,h3.iid] });
    chk('鮮豔鞭打 草草火 = 2 種屬性 → 60', r.damage===60, String(r.damage));
    chk('鮮豔鞭打 不移動手牌', r.state.players[0].hand.length===4, String(r.state.players[0].hand.length));
    const r2=fn(st,0,pool,{ discardedEnergyIids:[h1.iid,h2.iid] });
    chk('鮮豔鞭打 兩張同屬性 = 1 種 → 30', r2.damage===30, String(r2.damage));
    // ⭐ 否定對照：能量卡的 iid 不得計入（限寶可夢卡）
    const r3=fn(st,0,pool,{ discardedEnergyIids:[h4.iid] });
    chk('否定對照：能量卡不算寶可夢卡 → 0 傷', r3.damage===0, String(r3.damage));
    // ⭐ 公開揭示：log 必須列出展示的卡名
    chk('鮮豔鞭打 公開揭示卡名', r.state.log.map(logText).some(t=>t.includes('給對手看')), '');
  }
}

// ══ 3. hand-reveal：雙劍鞘｜劍武備（張數 × 60）—— 本版由自動全展示改為玩家挑 ══
{
  const spec = SPECS.get('雙劍鞘|劍武備');
  chk('劍武備 spec scope=hand-reveal（本版新增 picker）', spec?.scope==='hand-reveal', spec?.scope);
  chk('劍武備 限三個指名卡名', JSON.stringify(spec?.handRevealNames)===JSON.stringify(['獨劍鞘','雙劍鞘','堅盾劍怪']),
      JSON.stringify(spec?.handRevealNames));

  const ds=byName('雙劍鞘', c=>(c.attacks||[]).some(a=>a.name==='劍武備'));
  const one=byName('獨劍鞘'), shield=byName('堅盾劍怪');
  const h1=inst(one.id), h2=inst(ds.id), h3=inst(shield.id), h4=inst(EID.Water);
  const st=mk({ players:[{name:'P1',active:inst(ds.id),bench:[],hand:[h1,h2,h3,h4],deck:[],discard:[],prizes:[]},
                         {name:'P2',active:inst(ds.id),bench:[],hand:[],deck:[],discard:[],prizes:[]}] });
  const fn=ATTACK_PRE.get('雙劍鞘|劍武備');
  if (typeof fn==='function') {
    const r=fn(st,0,pool,{ discardedEnergyIids:[h1.iid,h2.iid,h3.iid] });
    chk('劍武備 展示 3 張 → 180', r.damage===180, String(r.damage));
    // ⭐ 核心修正：玩家「少展示」時傷害就該少（原本自動全展示 → 恆 180）
    const r2=fn(st,0,pool,{ discardedEnergyIids:[h1.iid] });
    chk('劍武備 只展示 1 張 → 60（玩家可少展示）', r2.damage===60, String(r2.damage));
    chk('劍武備 不移動手牌', r2.state.players[0].hand.length===4, String(r2.state.players[0].hand.length));
    // ⭐ 否定對照：不在三個指名卡名內的 iid 不得計入
    const r3=fn(st,0,pool,{ discardedEnergyIids:[h4.iid] });
    chk('否定對照：非指名卡不計 → 0 傷', r3.damage===0, String(r3.damage));
  } else { chk('劍武備 有 regPre', false); }
}

console.log(`test-m6-wave12: ${pass} passed, ${fail} failed`);
if (fail>0) process.exit(1);
