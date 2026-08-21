// ⭐ v6.203 — 進化來源比對被過度放寬（玩家實際打得出來的違規進化）
//
// 玩家/站長回報：伊布ex 可以直接進化成葉伊布 —— 連**沒有**特性【虹色DNA】的
//   「伊布ex（M-P-J · 172/M-P · J 標）」也可以。
//
// 真因：中央 helper `sameEvoName()` 會把卡名尾端的「ex」與開頭的「超級」strip 掉
//   （v2.35 引入 stripEx，註解宣稱「ex 和非 ex 同名卡是同一進化階級」——**那句是錯的**；
//    v5.307 為了超級進化再加 strip '超級'）。它同時被拿來當「進化合法性 gate」，
//   於是 sameEvoName('伊布','伊布ex') === true ⇒ 標準路徑直接放行，
//   而卡面【虹色DNA】那條例外分支因此永遠走不到（v6.202 曾把它記成死碼）。
//
// 官方依據（PTCG RULES/PTCG_RULES.md）：
//   §6 L305/L307/L315「將進化卡重合至與左上方記載的進化前寶可夢**相同名稱**的寶可夢身上」
//   §17.45.I「『達摩狒狒』和『N的達摩狒狒』視為兩種不同名稱的寶可夢」⇒ 名稱逐字比對。
// 站長裁定（2026-08-17）：伊布ex **有**【虹色DNA】才可以進化；**沒有**（M-P-J 172/M-P）就不行。
//
// 修法：進化合法性收斂成**一份**述詞
//   `canEvolveOnto(evolvesFromName, baseCardName)`（_shared.ts，逐字）
//   ＋ 手牌路徑的唯一例外 `canEvolveFromHandOnto()`（engine.ts，含虹色DNA 且會問特性是否被消除）。
//   `sameEvoName` **保留原樣**（超級進化的同階變體同名判定仍靠它），只是不再被當 gate。
//
// 本檔六件事：
//   ①核心行為（有/無虹色DNA、ex/非ex、特性被消除）
//   ②⭐正對照：**全站**每一條 evolvesFrom 進化線都仍打得通（防止修過頭 = 玩家進化不了）
//   ③⭐正對照：所有「超級XXXex」超級進化仍正常
//   ④違規枚舉（由卡池 data-driven 算出所有 normalize 撞名組）全部必須被擋
//   ⑤其他進化管線（神奇糖果 / 細胞進化 牌庫路徑）同步收斂
//   ⑥靜態守衛：sameEvoName 呼叫點凍結（第一參數必須是 .name ＝ stage 分類）＋ 掃描器正對照
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.x6203-s.js'),E=join(ROOT,'.x6203-e.ts'),O=join(ROOT,'.x6203-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O])try{unlinkSync(p)}catch{}});
writeFileSync(S,'export const base="";');
writeFileSync(E,
  "export { applyAction, getEvolvableTargets, canEvolveOnto, canEvolveFromHandOnto } from './src/lib/game/engine';\n"
+ "export { TRAINER_GUARDS, TRAINER_EFFECTS, ATTACK_POST, sameEvoName } from './src/lib/game/effects/_shared';\n"
+ "import './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const mod=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const HIJ=new Set(['H','I','J']);
const hij=[...pool.entries()].filter(([,c])=>HIJ.has(c.regulationMark));
const ab=n=>c=>c.abilities?.some(a=>a.name===n);
const findId=(name,pred)=>{for(const [id,c] of hij) if(c.name===name && (!pred||pred(c))) return id; return null;};

let pass=0,fail=0;const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};
let _n=0;
const I=(id,extra={})=>({iid:'i'+(++_n),cardId:String(id),damage:0,energyAttached:[],extraTools:[],...extra});
const ST=(p0,p1,extra={})=>({phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,
  isFirstTurn:false,log:[],pendingSelection:null,setupDone:[true,true],
  players:[{name:'A',active:null,bench:[],hand:[],deck:[],discard:[],prizes:[],...p0},
           {name:'B',active:null,bench:[],hand:[],deck:[],discard:[],prizes:[],...p1}],...extra});

const FILLER = findId('伊布', c=>!c.abilities);   // 對手戰鬥場填充（基本、無特性）
assert.ok(FILLER,'找不到 FILLER（伊布）— 卡池載入壞了');

// 從手牌進化：回傳 {ui(黃框), engine(真的進化了)}
function evolve(baseId, evoId, stadiumId){
  const base=I(baseId), evo=I(evoId);
  const st=ST({active:base, hand:[evo]}, {active:I(FILLER)},
              stadiumId?{activeStadium:I(stadiumId)}:{});
  const ui=mod.getEvolvableTargets(st,pool).some(o=>o.fromIid===base.iid&&o.toIids.includes(evo.iid));
  const after=mod.applyAction(st,{type:'EVOLVE',fromIid:base.iid,toIid:evo.iid},pool);
  const engine=after.players[0].active?.cardId===String(evoId);
  return {ui,engine};
}
const nm=id=>pool.get(String(id))?.name;

// ══════════════ ①卡面逐字錨（含下限斷言）══════════════
const EEVEE_DNA = findId('伊布ex', ab('虹色DNA'));            // SV8a 126 等，H 標
const EEVEE_NODNA = findId('伊布ex', c=>!c.abilities);        // M-P-J 172/M-P，J 標
const LEAFEON = findId('葉伊布', c=>c.subtype==='Stage1');
const LEAFEON_EX = findId('葉伊布ex');
const EEVEE = findId('伊布', c=>!c.abilities);
T('1a. 卡池錨：有虹色DNA 的伊布ex / 沒有的伊布ex / 葉伊布 / 葉伊布ex 都抓得到',()=>{
  for(const [k,v] of Object.entries({EEVEE_DNA,EEVEE_NODNA,LEAFEON,LEAFEON_EX,EEVEE}))
    assert.ok(v,'卡池抓不到 '+k);
});
T('1b. 卡面逐字：【虹色DNA】effect 明文只開放「從『伊布』進化而來的『寶可夢【ex】』」且限「從手牌」',()=>{
  const eff=pool.get(EEVEE_DNA).abilities.find(a=>a.name==='虹色DNA').effect;
  assert.ok(eff.includes('可從手牌使出'),'卡面逐字變了：'+eff);
  assert.ok(eff.includes('從「伊布」進化而來的「寶可夢【ex】」'),'卡面逐字變了：'+eff);
});
T('1c. 卡面逐字：M-P-J 172/M-P 的伊布ex **沒有任何特性**（站長點名的那張）',()=>{
  const c=pool.get(EEVEE_NODNA);
  assert.equal(c.collectorNumber,'172/M-P');
  assert.equal(c.regulationMark,'J');
  assert.ok(!c.abilities||c.abilities.length===0,'它其實有特性：'+JSON.stringify(c.abilities));
});
T('1d. 卡面逐字：葉伊布 / 葉伊布ex 的 evolvesFrom 都是「伊布」（不是「伊布ex」）',()=>{
  assert.equal(pool.get(LEAFEON).evolvesFrom,'伊布');
  assert.equal(pool.get(LEAFEON_EX).evolvesFrom,'伊布');
});

// ══════════════ ②核心行為 ══════════════
T('2a. ⭐正對照：伊布（基本）→ 葉伊布 / 葉伊布ex 都仍可進化',()=>{
  for(const e of [LEAFEON,LEAFEON_EX]){
    const r=evolve(EEVEE,e);
    assert.ok(r.ui&&r.engine,`伊布 → ${nm(e)} 進化不了 ${JSON.stringify(r)}`);
  }
});
T('2b. ⭐有【虹色DNA】的伊布ex → 葉伊布ex（卡面例外）可以進化',()=>{
  const r=evolve(EEVEE_DNA,LEAFEON_EX);
  assert.ok(r.ui&&r.engine,'虹色DNA 例外失效 '+JSON.stringify(r));
});
T('2c. ⭐⭐⭐【沒有】虹色DNA 的伊布ex（M-P-J 172/M-P）→ 葉伊布ex **不可**（站長裁定）',()=>{
  const r=evolve(EEVEE_NODNA,LEAFEON_EX);
  assert.equal(r.engine,false,'engine 仍放行違規進化');
  assert.equal(r.ui,false,'UI 仍亮黃框（會誤導玩家）');
});
T('2d. ⭐⭐⭐【沒有】虹色DNA 的伊布ex → 葉伊布（非 ex）**不可**',()=>{
  const r=evolve(EEVEE_NODNA,LEAFEON);
  assert.equal(r.engine,false,'engine 仍放行違規進化');
  assert.equal(r.ui,false,'UI 仍亮黃框');
});
T('2e. 有虹色DNA 的伊布ex → 葉伊布（**非 ex**）不可（卡面只寫「寶可夢【ex】」）',()=>{
  const r=evolve(EEVEE_DNA,LEAFEON);
  assert.equal(r.engine,false,'非 ex 也被放行了');
  assert.equal(r.ui,false,'UI 仍亮黃框');
});
const WATCH=findId('火箭隊的監視塔');
T('2f. 虹色DNA 被消除（火箭隊的監視塔＝【無】寶可夢特性全消，伊布ex 正是【無】）⇒ 不可進化',()=>{
  assert.ok(WATCH,'卡池抓不到火箭隊的監視塔');
  assert.equal(pool.get(EEVEE_DNA).pokemonType,'Colorless');
  const off=evolve(EEVEE_DNA,LEAFEON_EX);              // 正對照：沒有競技場時可以
  assert.ok(off.engine,'正對照壞了：無競技場時應可進化');
  const on=evolve(EEVEE_DNA,LEAFEON_EX,WATCH);
  assert.equal(on.engine,false,'特性被消除了卻仍可進化');
  assert.equal(on.ui,false,'特性被消除了 UI 仍亮黃框');
});

// ══════════════ ③⭐正對照：全站進化線都還打得通（防止修過頭）══════════════
// 對每一張 H/I/J 進化寶可夢，找一張**逐字同名**的前階卡當底，斷言仍可進化。
const nameToIds=new Map();
for(const [id,c] of hij){ if(!nameToIds.has(c.name)) nameToIds.set(c.name,[]); nameToIds.get(c.name).push(id); }
const evoCards=hij.filter(([,c])=>c.supertype==='Pokemon'&&c.evolvesFrom);
// 每個 (evolvesFrom → 進化卡名) 組合只測一次，避免同名重印重複跑
const seenPair=new Set(); const chainCases=[];
for(const [id,c] of evoCards){
  const key=c.evolvesFrom+'>'+c.name; if(seenPair.has(key)) continue; seenPair.add(key);
  const baseIds=nameToIds.get(c.evolvesFrom); if(!baseIds) continue;   // 化石等由 3c 另外顧
  // v5.342 海豚俠ex｜全能靈魂：卡面「只能由『全能變身』放上場」⇒ 一般進化本來就不可，不是本版擋的
  if((c.abilities??[]).some(a=>a.name==='全能靈魂')) continue;
  chainCases.push({evoId:id, baseId:baseIds[0], evoName:c.name, baseName:c.evolvesFrom});
}
T('3a. 掃描器下限：全站進化線樣本 ≥ 250 組（掃不到＝枚舉壞了，會變安慰劑）',()=>{
  assert.ok(chainCases.length>=250,'只列出 '+chainCases.length+' 組');
});
T('3b. ⭐⭐⭐正對照：全站每一條進化線都仍可進化（修過頭的話這條會爆一大片）',()=>{
  const bad=[];
  for(const c of chainCases){
    const r=evolve(c.baseId,c.evoId);
    if(!(r.ui&&r.engine)) bad.push(`${c.baseName} → ${c.evoName} ${JSON.stringify(r)}`);
  }
  assert.equal(bad.length,0,'這些進化線被擋住了（修過頭）：\n  '+bad.slice(0,25).join('\n  '));
});
T('3c. 進化來源資料完整性：每個 evolvesFrom 都逐字對得到某張實卡的 name（對不到 ⇒ 逐字比對會誤擋整條線）',()=>{
  const allNames=new Set([...pool.values()].map(c=>c.name));
  const miss=[...new Set(evoCards.map(([,c])=>c.evolvesFrom))].filter(n=>!allNames.has(n));
  assert.equal(miss.length,0,'找不到同名前階卡：'+miss.join(', '));
});

// ══════════════ ④⭐正對照：超級進化（Mega ex）仍正常 ══════════════
const megaCases=chainCases.filter(c=>c.evoName.startsWith('超級'));
T('4a. 掃描器下限：超級進化樣本 ≥ 20 組',()=>{
  assert.ok(megaCases.length>=20,'只列出 '+megaCases.length+' 組超級進化');
});
T('4b. ⭐⭐⭐正對照：每一張「超級XXXex」都仍能從卡面記載的前階進化（最怕修過頭的一條）',()=>{
  const bad=[];
  for(const c of megaCases){
    const r=evolve(c.baseId,c.evoId);
    if(!(r.ui&&r.engine)) bad.push(`${c.baseName} → ${c.evoName} ${JSON.stringify(r)}`);
  }
  assert.equal(bad.length,0,'超級進化被打壞了：\n  '+bad.join('\n  '));
});

// ══════════════ ⑤違規枚舉：所有 normalize 撞名組都必須被擋 ══════════════
// 這裡刻意重寫一份 sameEvoName 的正規化，把「舊 gate 會放行、卡面不允許」的組合全算出來。
const normalize=s=>{let r=s; if(r.endsWith('ex'))r=r.slice(0,-2); if(r.startsWith('超級'))r=r.slice(2); return r;};
const baseNames=[...nameToIds.keys()];
const violations=[];
for(const ef of new Set(evoCards.map(([,c])=>c.evolvesFrom))){
  for(const bn of baseNames){
    if(ef===bn||normalize(ef)!==normalize(bn)) continue;
    // ⚠ 必須枚舉**同名的每一張印刷**：伊布ex 的第一張是 M-P-J 19383（沒有虹色DNA），
    //   只取 [0] 會讓下面 5b 的「放行」正向分支永遠跑不到（審查子代理實測 dnaOk 命中 0 筆）。
    for(const bid of nameToIds.get(bn))
      for(const [id,c] of evoCards){ if(c.evolvesFrom!==ef) continue;
        violations.push({baseId:bid, baseName:bn, evoId:id, evoName:c.name}); }
  }
}
T('5a. 掃描器下限：撞名違規組合 ≥ 4 個 evolvesFrom key（算不出來＝枚舉器壞了）',()=>{
  const keys=new Set(violations.map(v=>v.baseName));
  assert.ok(keys.size>=4,'只算出 '+keys.size+' 組：'+[...keys].join(','));
});
T('5a2. 5b 的**兩支**分支都要真的跑到（只有否定分支＝正對照是死碼）',()=>{
  let allow=0,deny=0;
  for(const v of violations){
    const b=pool.get(String(v.baseId)), e=pool.get(String(v.evoId));
    if((b.abilities??[]).some(a=>a.name==='虹色DNA')&&e.evolvesFrom==='伊布'&&e.subtype==='ex') allow++; else deny++;
  }
  assert.ok(allow>=4,'「應放行」樣本只有 '+allow+' 筆 ⇒ 5b 的正對照是死碼');
  assert.ok(deny>=20,'「應擋下」樣本只有 '+deny+' 筆');
});
T('5b. ⭐每一組「ex/超級 撞名」進化都必須被擋（唯一例外＝虹色DNA 持有者 + 進化卡是【ex】）',()=>{
  const bad=[];
  for(const v of violations){
    const baseCard=pool.get(String(v.baseId));
    const evoCard=pool.get(String(v.evoId));
    const dnaOk=(baseCard.abilities??[]).some(a=>a.name==='虹色DNA')
             && evoCard.evolvesFrom==='伊布' && evoCard.subtype==='ex';
    const r=evolve(v.baseId,v.evoId);
    const expect=dnaOk;
    if(r.engine!==expect||r.ui!==expect)
      bad.push(`${v.baseName} → ${v.evoName} 期望${expect?'放行':'擋下'} 實得${JSON.stringify(r)}`);
  }
  assert.equal(bad.length,0,'違規進化仍打得出來（或例外被誤擋）：\n  '+bad.slice(0,20).join('\n  '));
});

// ══════════════ ⑥其他進化管線 ══════════════
const CANDY=findId('神奇糖果');
const SPRIGATITO=findId('新葉喵',c=>c.subtype==='Basic'), SPRIG_EX=findId('新葉喵ex');
const MEOWSCARADA=findId('魔幻假面喵');
T('6a. 神奇糖果：場上是「新葉喵ex」時，不可把 Stage2「魔幻假面喵」放上去（進化來源不同名）',()=>{
  for(const [k,v] of Object.entries({CANDY,SPRIGATITO,SPRIG_EX,MEOWSCARADA})) assert.ok(v,'卡池抓不到 '+k);
  const g=mod.TRAINER_GUARDS.get('神奇糖果');
  assert.ok(g,'神奇糖果沒有 regG');
  const bad=ST({active:I(SPRIG_EX), hand:[I(MEOWSCARADA),I(CANDY)]},{active:I(FILLER)});
  assert.equal(g(bad,0,pool),false,'新葉喵ex 仍可吃神奇糖果');
  const good=ST({active:I(SPRIGATITO), hand:[I(MEOWSCARADA),I(CANDY)]},{active:I(FILLER)});
  assert.equal(g(good,0,pool),true,'正對照壞了：新葉喵 應可吃神奇糖果');
});
const TWINCELL=findId('雙卵細胞球'), PIKA=findId('皮卡丘',c=>c.subtype==='Basic'), PIKA_EX=findId('皮卡丘ex'), RAICHU=findId('雷丘');
T('6b. 雙卵細胞球｜細胞進化（牌庫路徑）：備戰是「皮卡丘ex」時，牌庫的「雷丘」不算可進化對象',()=>{
  for(const [k,v] of Object.entries({TWINCELL,PIKA,PIKA_EX,RAICHU})) assert.ok(v,'卡池抓不到 '+k);
  const fn=mod.ATTACK_POST.get('雙卵細胞球|細胞進化');
  assert.ok(fn,'細胞進化沒有 regPost');
  const mk=baseId=>ST({active:I(TWINCELL),bench:[I(baseId)],deck:[I(RAICHU)]},{active:I(FILLER)});
  const badS=fn(mk(PIKA_EX),0,pool,{});
  assert.ok(!badS.pendingSelection,'皮卡丘ex 仍被列為可進化對象');
  const okS=fn(mk(PIKA),0,pool,{});
  assert.ok(okS.pendingSelection,'正對照壞了：皮卡丘 應被列為可進化對象');
});

// ══════════════ ⑦靜態守衛：進化合法性只有一份述詞 ══════════════
const walk=(d,out=[])=>{for(const f of readdirSync(d)){const p=join(d,f);const s=statSync(p);
  if(s.isDirectory())walk(p,out); else if(f.endsWith('.ts')||f.endsWith('.svelte'))out.push(p);} return out;};
const stripComments=s=>s.replace(/\/\*[\s\S]*?\*\//g,m=>m.replace(/[^\n]/g,' '))
  .replace(/\/\/.*$/gm,'').replace(/[\u200b-\u200d\ufeff]/g,'');
// 掃 sameEvoName 呼叫點：抓「第一個實參」。合法用途（stage 分類 / 進化鏈推導）第一參數一定是 `X.name`；
// 拿它當進化 gate 的寫法第一參數是 `X.evolvesFrom`（或 evolvesFrom 變數）——那正是本版拆掉的 bug。
const scanSameEvo=(files)=>{
  const out=[];
  for(const [rel,text] of files){
    const src=stripComments(text);
    for(const m of src.matchAll(/(function\s+)?\bsameEvoName\s*\(\s*([^,]+?)\s*,/g)){
      if(m[1]) continue;                     // 函式**定義**本身不是呼叫點
      const first=m[2].trim();
      out.push({rel, first, ok:/\.name\s*$/.test(first)});
    }
  }
  return out;
};
const files=[...walk(join(ROOT,'src'))].map(p=>[relative(ROOT,p).split('\\').join('/'),readFileSync(p,'utf8')]);
const evoSites=scanSameEvo(files);
const fileOf0=rel=>files.find(f=>f[0]===rel)?.[1]??'';
// ⚠⚠ v6.213：呼叫點由 8 個變成 3 個 —— 那是**真的少了五個**，不是掃描器壞掉。
//   engine.ts `isStage2PokemonCard`、draw_supporters.ts `isStage2PokemonCardLocal`、
//   effects.ts ×3（勾魂眼｜動怒爪、神奇糖果的 regG 與 reg）原本各有一個
//   `sameEvoName(X.name, Y.evolvesFrom)` 的**全卡池線性掃描**迴圈，v6.213 五支都改走
//   `$lib/game/stage2-index` 的 per-pool 索引（判準逐字不變，有全卡池差分守衛）。
//   ⚠⚠⚠ 調低這個下限本身是危險動作（「把門檻放寬到放行破壞」是最常見的假綠手法），
//     所以底下釘一條 7a-2：那五處**必須**已經改走中央索引。若有人只是把 sameEvoName 的
//     呼叫刪掉、卻沒接上索引，7a-2 會紅；而「線性掃描有沒有真的消失」另有
//     scripts/test-v6213-stage2-index-memo.mjs 的全站掃描在管。
T('7a. 掃描器下限：sameEvoName 呼叫點掃到 ≥ 3 個（掃不到＝掃描器壞了）',()=>{
  assert.ok(evoSites.length>=3,'只掃到 '+evoSites.length+' 個');
});
T('7a-2. v6.213 少掉的那五個呼叫點是「改走中央索引」，不是被偷偷刪掉',()=>{
  const eng=fileOf0('src/lib/game/engine.ts'), dsup=fileOf0('src/lib/game/effects/cards/draw_supporters.ts'),
        eff=fileOf0('src/lib/game/effects.ts');
  assert.ok(/isStage2ByEvoVariant\(card, pool\)/.test(eng),'engine 沒改走 stage2-index');
  assert.ok(/from '\.\/stage2-index'/.test(eng),'engine 沒 import stage2-index');
  assert.ok(/isStage2ByEvoVariant\(card, pool\)/.test(dsup),'draw_supporters 沒改走 stage2-index');
  assert.ok(/from '\.\.\/\.\.\/stage2-index'/.test(dsup),'draw_supporters 沒 import stage2-index');
  assert.ok(/from '\.\/stage2-index'/.test(eff),'effects.ts 沒 import stage2-index');
  assert.strictEqual((eff.match(/isStage2ByEvoVariant\(/g)||[]).length,3,
    'effects.ts 應有 3 處改走中央索引（勾魂眼＋神奇糖果 regG／reg）');
});
T('7b. ⭐sameEvoName 不得再被當「進化合法性」gate（第一參數必須是 X.name ＝ stage 分類用途）',()=>{
  const bad=evoSites.filter(s=>!s.ok).map(s=>`${s.rel} → sameEvoName(${s.first}, …)`);
  assert.equal(bad.length,0,
    '進化來源比對又被 sameEvoName 放寬了 —— 請改用中央述詞 canEvolveOnto()：\n  '+bad.join('\n  '));
});
T('7c. 掃描器自我驗證【正對照】：違規樣本必須被 7b 抓到，合法樣本不得誤報',()=>{
  const bad=scanSameEvo([['fake/a.ts',"if (sameEvoName(evoCard.evolvesFrom, baseCard.name)) go();"]]);
  assert.equal(bad.length,1,'掃描器沒掃到違規樣本'); assert.equal(bad[0].ok,false);
  const ok=scanSameEvo([['fake/b.ts',"if (sameEvoName(c.name, card.evolvesFrom) && c.evolvesFrom) go();"]]);
  assert.equal(ok.length,1); assert.equal(ok[0].ok,true,'合法的 stage 分類用途被誤報');
  const cm=scanSameEvo([['fake/c.ts',"// sameEvoName(x.evolvesFrom, y.name)\n/* sameEvoName(a.evolvesFrom, b.name) */"]]);
  assert.equal(cm.length,0,'註解沒被剝乾淨');
});
const fileOf=rel=>files.find(f=>f[0]===rel)?.[1]??'';
T('7d. 中央述詞已接上每一個進化來源比對的消費點',()=>{
  const need=['src/lib/game/effects/_shared.ts','src/lib/game/engine.ts','src/lib/game/effects.ts',
    'src/lib/game/ai.ts','src/routes/game/+page.svelte',
    'src/lib/game/effects/cards/v2650_i_wave15_misc8.ts',
    'src/lib/game/effects/cards/v2360_j_mark_batch.ts',
    'src/lib/game/effects/cards/v172_hij_batch.ts',
    // v6.203 第二批（審查子代理指出：行為本來就逐字，但沒收斂 ⇒ 7b 掃描器管不到，日後容易寫回放寬）
    'src/lib/game/effects/cards/v2750_h_wave2_full.ts'];
  const miss=need.filter(r=>!/canEvolveOnto/.test(fileOf(r)));
  assert.equal(miss.length,0,'這些檔沒接中央述詞：'+miss.join(', '));
});
T('7d2. ⚠+page.svelte / ai.ts 用到 canEvolveOnto 就必須從 engine **import**（漏了 vite build 會直接紅，而完整 npm test 抓不到 .svelte 的 named import）',()=>{
  for(const rel of ['src/routes/game/+page.svelte','src/lib/game/ai.ts']){
    const src=fileOf(rel);
    if(!/canEvolveOnto\s*\(/.test(stripComments(src))) continue;
    const imp=src.match(/import\s*\{[\s\S]*?\}\s*from\s*['"][^'"]*game\/engine['"]/)
          ?? src.match(/import\s*\{[\s\S]*?\}\s*from\s*['"]\.\/engine['"]/);
    assert.ok(imp,rel+' 找不到從 engine 的具名 import 區塊');
    assert.ok(/\bcanEvolveOnto\b/.test(imp[0]),rel+' 用了 canEvolveOnto 卻沒 import 進來');
  }
  // engine.ts 必須真的 export 它（不然上面兩個 import 是空包彈）
  assert.ok(/export \{ sameEvoName, canEvolveOnto \}/.test(fileOf('src/lib/game/engine.ts')),
    'engine.ts 沒有 re-export canEvolveOnto');
});
T('7e. EVOLVE handler 與 getEvolvableTargets 走**同一份**述詞（兩端分岔＝黃框騙人）',()=>{
  const eng=stripComments(fileOf('src/lib/game/engine.ts'));
  const calls=[...eng.matchAll(/canEvolveFromHandOnto\s*\(/g)].length;
  assert.ok(calls>=3,'canEvolveFromHandOnto 只出現 '+calls+' 次（定義 1 + 兩個消費點 2）');
  assert.ok(!/prismaticDNAException/.test(eng),'舊的 inline 虹色DNA 分支還在（會與中央述詞漂移）');
});
T('7f. canEvolveOnto 是逐字比對（不得偷偷做正規化）',()=>{
  assert.equal(mod.canEvolveOnto('伊布','伊布ex'),false,'canEvolveOnto 竟然把 ex 正規化掉了');
  assert.equal(mod.canEvolveOnto('花葉蒂','超級花葉蒂ex'),false,'canEvolveOnto 竟然把「超級」正規化掉了');
  assert.equal(mod.canEvolveOnto('伊布','伊布'),true);
  assert.equal(mod.canEvolveOnto(undefined,'伊布'),false);
  // sameEvoName 本身**必須維持原樣**（超級進化的同階變體同名判定還靠它）
  assert.equal(mod.sameEvoName('伊布','伊布ex'),true,'sameEvoName 被改壞了（超級進化同階判定會連動）');
  assert.equal(mod.sameEvoName('龍頭地鼠','超級龍頭地鼠ex'),true,'sameEvoName 被改壞了');
});

console.log(`\n=== v6203 evolve-source-exact: ${pass} PASS / ${fail} FAIL ===`);
if(fail) process.exit(1);
