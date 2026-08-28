// ⭐⭐⭐ v6.205 — ① 狠辣椒ex｜雙重屬性「完全沒實裝」補實作（含特性消除中央閘）
//                ② 卡庫 tag 缺漏（「未來」／「古代」）與**永久 tag 一致性守衛**
//
// ① 背景：getAttackerEffectiveTypes 只認【小碎鑽】那一張，狠辣椒ex（H）卡面
//    「只要這隻寶可夢在場上，改為【草】與【火】2種屬性。」**從未被實作** —— 不會報錯，
//    只是弱點/抵抗力永遠照印刷的【火】算。v6.204 剛把此函式的簽名補上 state/attackerIdx
//    並接上中央述詞 hasEffectiveAbilityByInst ⇒ 本版沿用**同一份**，不新建第五份。
//    ⚠ 狠辣椒ex = Stage1（進化）/ ex（擁有規則的寶可夢）⇒ 熔岩洞・初始化・兩型暗夜羽擊
//      都打得到它（比小碎鑽多兩個來源），所以每一條消除都要有行為端測試＋正對照。
//
// ② 台灣官方卡牌檢索的 tag（古代105／未來106／ACE SPEC104）只存在於 list filter，
//    單張 detail 頁**看不到**（scripts/scrape/tag-filters.js 開頭已載明）。
//    ⇒ 離線守衛用兩把尺：
//      (a) 官方 tag 快照（scripts/data/official-tag-manifest.json，用 refresh 腳本 --tags 重抓）
//          ：快照說某 id 有 tag、我方卡庫有那張卡 ⇒ 必須有那個 tag。
//      (b) **印刷平權**（純離線、不需網路、覆蓋率最高）：同 supertype＋同卡名＋同 HP＋
//          同特性集合＋同招式集合＋同 rulesText 的不同印刷，tags 必須完全一致。
//          官方 filter 對合集重印（MC）與部分重複 id 覆蓋不完整，(b) 正是補這個洞的那把尺。
//
// ⚠ 掃描器自我驗證：兩把尺都配下限斷言＋正對照（餵違規樣本確認判準抓得到）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.x6205-s.js'),E=join(ROOT,'.x6205-e.ts'),O=join(ROOT,'.x6205-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O])try{unlinkSync(p)}catch{}});
writeFileSync(S,'export const base="";export const assets="";');
writeFileSync(E,
  "export { applyAction } from './src/lib/game/engine';\n"
+ "export { getAttackerEffectiveTypes, applyWeakRes } from './src/lib/game/effects';\n"
+ "import './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const mod=await import(pathToFileURL(O).href);

const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();           // id -> card（live only）
const byFile=[];                // [file, card]
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))) if(c?.id!=null){pool.set(String(c.id),c);byFile.push([f,c]);}}

let pass=0,fail=0;const T=(n,fn)=>{try{fn();console.log('  ✓ '+n);pass++;}catch(e){console.log('  ✗ '+n+'\n      '+(e&&e.message));fail++;}};
let _n=0;
const I=(id,extra={})=>({iid:'i'+(++_n),cardId:String(id),damage:0,energyAttached:[],extraTools:[],...extra});
const ST=(p0,p1,extra={})=>({phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,
  isFirstTurn:false,log:[],pendingSelection:null,setupDone:[true,true],
  players:[{name:'A',active:null,bench:[],hand:[],deck:[],discard:[],prizes:[],...p0},
           {name:'B',active:null,bench:[],hand:[],deck:[],discard:[],prizes:[],...p1}],...extra});
const ab=n=>c=>c.abilities?.some(a=>a.name===n);
const findId=(name,pred)=>{for(const [id,c] of pool) if(c.name===name&&(!pred||pred(c))) return id; return null;};
const eff=(id,an)=>pool.get(id).abilities.find(a=>a.name===an).effect;

const CHILI = findId('狠辣椒ex', ab('雙重屬性'));
const KENA  = findId('小碎鑽',   ab('雙重屬性'));
const CAVE  = findId('傳說的熔岩洞');
const WATCH = findId('火箭隊的監視塔');
const IRON  = findId('鐵荊棘ex', ab('初始化'));
const MOON  = findId('振翼髮',   ab('暗夜羽擊'));
const FIREE = findId('基本【火】能量');
// 弱點【草】/【火】/ 抵抗力【草】的對照靶（逐張釘住，換卡池會在下限斷言紅）
const WGRASS=(()=>{for(const [id,c] of pool) if(c.supertype==='Pokemon'&&c.weakness?.type==='Grass'&&!c.resistance&&!c.abilities&&(c.hp??0)>=200) return id; return null;})();
const WFIRE =(()=>{for(const [id,c] of pool) if(c.supertype==='Pokemon'&&c.weakness?.type==='Fire' &&!c.resistance&&!c.abilities&&(c.hp??0)>=200) return id; return null;})();
const RGRASS=(()=>{for(const [id,c] of pool) if(c.supertype==='Pokemon'&&c.resistance?.type==='Grass'&&!c.abilities&&(c.hp??0)>=100) return id; return null;})();
const PLAIN =(()=>{for(const [id,c] of pool) if(c.supertype==='Pokemon'&&c.stage==='Basic'&&!c.abilities&&c.subtype==='Basic'&&!(c.tags??[]).length&&!c.evolvesFrom&&!c.weakness) return id;
  for(const [id,c] of pool) if(c.supertype==='Pokemon'&&c.stage==='Basic'&&!c.abilities&&c.subtype==='Basic'&&!(c.tags??[]).length&&!c.evolvesFrom) return id; return null;})();

console.log('① 卡面逐字錨 ＋ 下限斷言（抓不到卡就紅，不做安慰劑綠燈）');
T('1a. 本檔依賴的卡全部抓得到',()=>{
  const NEED={CHILI,KENA,CAVE,WATCH,IRON,MOON,FIREE,WGRASS,WFIRE,RGRASS,PLAIN};
  const bad=Object.entries(NEED).filter(([,v])=>!v).map(([k])=>k);
  assert.equal(bad.length,0,'抓不到：'+bad.join(','));
});
T('1b. 狠辣椒ex 卡面逐字（特性讀 effect、不是 text）',()=>{
  assert.equal(eff(CHILI,'雙重屬性'),'只要這隻寶可夢在場上，改為【草】與【火】2種屬性。');
  const c=pool.get(CHILI);
  assert.equal(c.pokemonType,'Fire');   assert.equal(c.stage,'Stage1');
  assert.equal(c.subtype,'ex');         assert.equal(c.regulationMark,'H');
  assert.equal(c.attacks[0].name,'香料激怒');
  assert.deepEqual(c.attacks[0].cost,['Fire','Fire']);
  assert.equal(c.attacks[0].damage,'10+');
});
T('1c. 小碎鑽卡面逐字（同名特性、不同屬性組 ⇒ 兩條分支不得互相污染）',()=>{
  assert.equal(eff(KENA,'雙重屬性'),'只要這隻寶可夢在場上，改為【鬥】與【超】2種屬性。');
  assert.equal(pool.get(KENA).pokemonType,'Fighting');
  assert.equal(pool.get(KENA).stage,'Basic');
  assert.notEqual(pool.get(KENA).subtype,'ex');
});
T('1d. 消除來源卡面逐字（決定「哪些來源打得到狠辣椒ex」的依據）',()=>{
  assert.equal(pool.get(CAVE).rulesText,'雙方場上所有進化寶可夢的特性全部消除。');
  assert.equal(pool.get(WATCH).rulesText,'雙方場上所有【無】寶可夢的特性全部消除。');
  assert.equal(eff(IRON,'初始化'),'只要這隻寶可夢在戰鬥場上，雙方場上「擁有規則的寶可夢」（「未來」寶可夢除外）的特性全部消除。');
  assert.equal(eff(MOON,'暗夜羽擊'),pool.get(MOON).abilities.find(a=>a.name==='暗夜羽擊').effect);
});

console.log('② 行為端：中央 getAttackerEffectiveTypes');
const types=(s,idx)=>mod.getAttackerEffectiveTypes(s,idx,s.players[idx].active,pool.get(s.players[idx].active.cardId),pool);
T('2a.〔核心〕狠辣椒ex 乾淨盤面 ⇒ 【草】＋【火】（HEAD 只會回 [Fire]）',()=>{
  assert.deepEqual(types(ST({active:I(CHILI)},{active:I(PLAIN)}),0),['Grass','Fire']);
});
T('2b. 消除① 傳說的熔岩洞（進化寶可夢特性全消；狠辣椒ex 是 Stage1）⇒ 只剩【火】',()=>{
  assert.deepEqual(types(ST({active:I(CHILI)},{active:I(PLAIN)},{activeStadium:I(CAVE)}),0),['Fire']);
});
T('2c. 消除② 鐵荊棘ex｜初始化（對手戰鬥場；狠辣椒ex 是「擁有規則的寶可夢」）⇒ 只剩【火】',()=>{
  assert.deepEqual(types(ST({active:I(CHILI)},{active:I(IRON)}),0),['Fire']);
});
T('2d. 消除③ passive 振翼髮｜暗夜羽擊（對手戰鬥場）⇒ 只剩【火】',()=>{
  assert.deepEqual(types(ST({active:I(CHILI)},{active:I(MOON)}),0),['Fire']);
});
T('2e. 消除④ 招式版暗夜羽擊 abilityNullifiedThisTurn ⇒ 只剩【火】',()=>{
  assert.deepEqual(types(ST({active:I(CHILI,{abilityNullifiedThisTurn:true})},{active:I(PLAIN)}),0),['Fire']);
});
T('2f.【正對照】火箭隊的監視塔只消【無】寶可夢 ⇒ 狠辣椒ex（【火】）不受影響，仍【草】＋【火】',()=>{
  assert.deepEqual(types(ST({active:I(CHILI)},{active:I(PLAIN)},{activeStadium:I(WATCH)}),0),['Grass','Fire']);
});
T('2g.【正對照】改過頭檢查：小碎鑽仍是【鬥】＋【超】、熔岩洞打不到它（Basic 非進化）',()=>{
  assert.deepEqual(types(ST({active:I(KENA)},{active:I(PLAIN)}),0),['Fighting','Psychic']);
  assert.deepEqual(types(ST({active:I(KENA)},{active:I(PLAIN)},{activeStadium:I(CAVE)}),0),['Fighting','Psychic']);
});

console.log('③ 行為端：弱點／抵抗力真的算出差異（applyWeakRes ＋ engine 完整 ATTACK 流程）');
T('3a.〔核心〕對手弱點【草】：狠辣椒ex 打出去 ×2（HEAD 不會 ×2）',()=>{
  const s=ST({active:I(CHILI)},{active:I(WGRASS)});
  assert.equal(mod.applyWeakRes(s,0,s.players[1].active,pool.get(WGRASS),50,pool),100);
});
T('3b.【正對照】對手弱點【火】：本來就 ×2，補完仍 ×2（沒有把本色弄丟）',()=>{
  const s=ST({active:I(CHILI)},{active:I(WFIRE)});
  assert.equal(mod.applyWeakRes(s,0,s.players[1].active,pool.get(WFIRE),50,pool),100);
});
T('3c. 對手抵抗力【草】：狠辣椒ex 也吃到抵抗（屬性改變是雙面的，不是只挑好處）',()=>{
  // ⚠ 期望值**釘死字面量**，不用公式回算 —— 用同一份公式算期望＝自證（審查抓到的坑）。
  //   RGRASS 這一張的卡面必須是「弱點【火】×2、抵抗力【草】-30」：100 → ×2=200 → -30 = 170。
  const rc=pool.get(RGRASS);
  assert.equal(rc.weakness?.type,'Fire','對照靶換卡了：期望值 170 的推導前提不成立');
  assert.equal(rc.resistance?.type,'Grass');
  assert.equal(String(rc.resistance?.value).replace(/[^-\d]/g,''),'-30');
  const s=ST({active:I(CHILI)},{active:I(RGRASS)});
  assert.equal(mod.applyWeakRes(s,0,s.players[1].active,rc,100,pool),170);
});
T('3d. 消除後弱點【草】不再 ×2（熔岩洞）＋【正對照】無場地時 ×2',()=>{
  const mk=(stad)=>{const s=ST({active:I(CHILI)},{active:I(WGRASS)},stad?{activeStadium:I(stad)}:{});
    return mod.applyWeakRes(s,0,s.players[1].active,pool.get(WGRASS),50,pool);};
  assert.equal(mk(CAVE),50); assert.equal(mk(null),100);
});
T('3e.〔完整 ATTACK 流程〕香料激怒 10 傷害 → 弱點【草】⇒ 對手實際扣 20',()=>{
  const atk=I(CHILI,{energyAttached:[I(FIREE),I(FIREE)]});
  const def=I(WGRASS);
  const s=ST({active:atk},{active:def});
  const r=mod.applyAction(s,{type:'ATTACK',attackIndex:0,actorIdx:0},pool);
  assert.equal(r.players[1].active.damage,20,'log:\n'+(r.log||[]).slice(-6).map(x=>x&&(x.text??x)).join('\n'));
});
T('3f.〔完整 ATTACK 流程・正對照〕熔岩洞在場 ⇒ 特性消除 ⇒ 只扣 10',()=>{
  const atk=I(CHILI,{energyAttached:[I(FIREE),I(FIREE)]});
  const s=ST({active:atk},{active:I(WGRASS)},{activeStadium:I(CAVE)});
  const r=mod.applyAction(s,{type:'ATTACK',attackIndex:0,actorIdx:0},pool);
  assert.equal(r.players[1].active.damage,10);
});

console.log('④ 全卡池掃描：只有雙屬性那三張會偏離「印刷屬性」，其餘一律回 [pokemonType]');
// ⚠ 誠實聲明（審查抓到的虛胖）：這一段**不是**與 BASE 對跑的差分——BASE 的舊述詞無法在同一個
//   bundle 內重現（它呼叫的是同一支被改掉的函式，接上去只會自證）。它證明的是：
//   「全卡池中會偏離印刷屬性的只有這三張，其餘 0 例外」，而三張的期望值**逐一釘死字面量**。
const DUAL_EXPECT=new Map([['小碎鑽',['Fighting','Psychic']],['狠辣椒ex',['Grass','Fire']]]);
T('4a. 全卡池 × 3 種場地：只有小碎鑽／狠辣椒ex 偏離印刷屬性，且值逐一釘死',()=>{
  const mons=[...pool.entries()].filter(([,c])=>c.supertype==='Pokemon');
  assert.ok(mons.length>=2000,'只掃到 '+mons.length+' 張寶可夢，掃描器壞了？');
  let n=0,bad=[],hitDual=new Set();
  for(const [id,c] of mons) for(const stad of [null,CAVE,WATCH]){
    const inst=I(id); const st=ST({active:inst},{active:I(PLAIN)},stad?{activeStadium:I(stad)}:{});
    const now=mod.getAttackerEffectiveTypes(st,0,inst,c,pool);
    // 鐵轍跡沒附「驅勁能量 未來」⇒ 二重核心不成立 ⇒ 也該回印刷屬性
    let exp=c.pokemonType?[c.pokemonType]:[];
    if(DUAL_EXPECT.has(c.name)){
      const dual=DUAL_EXPECT.get(c.name);
      // 熔岩洞消進化 ⇒ 狠辣椒ex(Stage1) 被消、小碎鑽(Basic) 不被消
      exp=(stad===CAVE&&c.stage!=='Basic')?[c.pokemonType]:dual;
      if(JSON.stringify(now)===JSON.stringify(dual)) hitDual.add(c.name);
    }
    n++; if(JSON.stringify(now)!==JSON.stringify(exp)) bad.push(c.name+'@'+(stad??'-')+' got '+JSON.stringify(now)+' want '+JSON.stringify(exp));
  }
  assert.equal(bad.length,0,n+' 組中 mismatch：'+bad.slice(0,8).join(' | '));
  assert.ok(n>=6000,'只跑了 '+n+' 組');
  assert.deepEqual([...hitDual].sort(),['小碎鑽','狠辣椒ex'],'兩張雙屬性卡都必須真的被走到（否則這條是零覆蓋）');
});
T('4b. 鐵轍跡｜二重核心：附「驅勁能量 未來」才變【鬥】＋【鋼】（釘死，不用現值當期望）',()=>{
  const TRACK=findId('鐵轍跡',ab('二重核心')), DRIVE=findId('驅勁能量 未來');
  assert.ok(TRACK&&DRIVE,'抓不到鐵轍跡／驅勁能量 未來');
  const bare=I(TRACK);
  assert.deepEqual(mod.getAttackerEffectiveTypes(ST({active:bare},{active:I(PLAIN)}),0,bare,pool.get(TRACK),pool),['Metal']);
  const armed=I(TRACK,{energyAttached:[I(DRIVE)]});
  assert.deepEqual(mod.getAttackerEffectiveTypes(ST({active:armed},{active:I(PLAIN)}),0,armed,pool.get(TRACK),pool),['Fighting','Metal']);
  const nulled=I(TRACK,{energyAttached:[I(DRIVE)],abilityNullifiedThisTurn:true});
  assert.deepEqual(mod.getAttackerEffectiveTypes(ST({active:nulled},{active:I(PLAIN)}),0,nulled,pool.get(TRACK),pool),['Metal']);
});

console.log('⑤ tag 尺 (a)：官方 tag 快照 ⇒ 我方必須有那個 tag');
const TAGMAN=join(ROOT,'scripts/data/official-tag-manifest.json');
T('5a. 快照存在且健康（下限斷言：抓壞／截斷會在這裡紅）',()=>{
  assert.ok(existsSync(TAGMAN),'缺 scripts/data/official-tag-manifest.json —— 跑 refresh-official-set-manifest.mjs --tags --write');
  const M=JSON.parse(readFileSync(TAGMAN,'utf8'));
  assert.ok(M.tags&&typeof M.tags==='object','快照格式壞了');
  for(const [t,ids] of Object.entries(M.tags)) assert.ok(Array.isArray(ids)&&ids.length>=50,t+' 只有 '+(ids||[]).length+' 個 id —— 抓取多半失敗了');
  assert.deepEqual(Object.keys(M.tags).sort(),['ACE SPEC','古代','未來']);
});
// ⚠ 判準抽成函式並吃「注入的 pool」——正對照才有辦法餵壞資料進去真的跑一次判準。
//   （審查抓到：原本的正對照只是在自己 local 重做一次比對，判準改成 if(false) 也不會紅。）
function checkTagManifest(poolLike){
  const M=JSON.parse(readFileSync(TAGMAN,'utf8'));
  const bad=[]; let compared=0;
  for(const [t,ids] of Object.entries(M.tags)) for(const id of ids){
    const c=poolLike.get(String(id)); if(!c) continue;
    compared++;
    if(!(c.tags??[]).includes(t)) bad.push(id+' '+c.name+' 缺「'+t+'」');
  }
  return {bad,compared};
}
T('5b.⭐ 官方說有 tag、我方有那張卡 ⇒ 我方必須也有那個 tag（含比對筆數下限）',()=>{
  const r=checkTagManifest(pool);
  assert.ok(r.compared>=200,'只比對到 '+r.compared+' 對（tag,id）—— 卡池載入壞了會靜默全綠');
  assert.equal(r.bad.length,0,r.bad.join('\n      '));
});
T('5c.【正對照・真 mutation】把某張卡的 tag 拿掉 ⇒ 5b 的判準必須真的抓到它',()=>{
  const M=JSON.parse(readFileSync(TAGMAN,'utf8'));
  let hit=0;
  for(const [t,ids] of Object.entries(M.tags)){
    const id=ids.map(String).find(i=>pool.has(i)&&(pool.get(i).tags??[]).includes(t));
    assert.ok(id,'tag「'+t+'」找不到可用樣本');
    const mutated=new Map(pool);
    mutated.set(id,{...pool.get(id),tags:(pool.get(id).tags??[]).filter(x=>x!==t)});
    const r=checkTagManifest(mutated);
    assert.equal(r.bad.length,1,'tag「'+t+'」的 mutation 沒被抓到（判準是恆真式）：'+JSON.stringify(r.bad));
    assert.ok(r.bad[0].includes(id),r.bad[0]);
    hit++;
  }
  assert.equal(hit,3);
});

console.log('⑥ tag 尺 (b)：印刷平權 —— 同一張卡的不同印刷 tags 必須一致（純離線，補官方 filter 的洞）');
const sig=c=>JSON.stringify([c.supertype,c.name,c.hp??null,c.pokemonType??null,
  (c.abilities??[]).map(a=>[a.name,a.effect]),
  (c.attacks??[]).map(a=>[a.name,a.cost??[],a.damage??null,a.effect??null]),
  c.rulesText??null]);
const groups=new Map();
for(const [f,c] of byFile){const k=sig(c);if(!groups.has(k))groups.set(k,[]);groups.get(k).push([f,c]);}
// ⚠ 已知且**尚未取得官方裁定**的例外（站長裁定後應清空，不得無限擴充）
const TAG_PARITY_EXEMPT=new Map(Object.entries({
  '驅勁能量 未來':'G 標（站規只維護 H/I/J）；SV8a 12436 缺「未來」，待站長裁定是否連 G 標資料一起補',
  '弗圖博士的劇本':'G 標（同上）；SV8a 12452 缺「未來」',
}));
T('6a. 掃描器下限：指紋分組數與 live 卡數合理（分組壞掉會全綠）',()=>{
  assert.ok(byFile.length>=4500,'只掃到 '+byFile.length+' 張 live 卡');
  assert.ok(groups.size>=1500&&groups.size<byFile.length,'分組數異常：'+groups.size);
  const multi=[...groups.values()].filter(g=>g.length>1).length;
  assert.ok(multi>=300,'只有 '+multi+' 組是多印刷 —— 指紋太嚴，這把尺等於沒作用');
});
function checkParity(groupsLike){
  const bad=[];
  for(const g of groupsLike.values()){
    if(g.length<2) continue;
    if(TAG_PARITY_EXEMPT.has(g[0][1].name)) continue;
    const sets=new Set(g.map(([,c])=>JSON.stringify([...(c.tags??[])].sort())));
    if(sets.size>1) bad.push(g[0][1].name+'：'+g.map(([f,c])=>c.id+'('+f.slice(0,-5)+')='+JSON.stringify(c.tags??[])).join(' / '));
  }
  return bad;
}
T('6b.⭐ 同一張卡的不同印刷 tags 必須完全一致',()=>{
  assert.equal(checkParity(groups).length,0,checkParity(groups).join('\n      '));
});
T('6c.【正對照・真 mutation】拿掉某一印刷的 tag ⇒ 6b 的判準必須真的抓到',()=>{
  const key=[...groups.entries()].find(([,x])=>x.length>1&&(x[0][1].tags??[]).length>0
    &&!TAG_PARITY_EXEMPT.has(x[0][1].name))?.[0];
  assert.ok(key,'找不到可用樣本');
  const mutated=new Map(groups);
  const g=groups.get(key);
  mutated.set(key,[g[0],[g[1][0],{...g[1][1],tags:[]}],...g.slice(2)]);
  const bad=checkParity(mutated);
  assert.equal(bad.length,1,'mutation 沒被抓到 ⇒ 6b 是恆真式：'+JSON.stringify(bad));
  assert.ok(bad[0].startsWith(g[0][1].name),bad[0]);
});
T('6d. 例外表不得有死條目（卡名已不在 live ⇒ 該清掉）',()=>{
  const names=new Set(byFile.map(([,c])=>c.name));
  const dead=[...TAG_PARITY_EXEMPT.keys()].filter(n=>!names.has(n));
  assert.equal(dead.length,0,'死條目：'+dead.join(','));
});

console.log('⑦ 維度 A 凍結表：「卡面有效果但完全沒實裝」的 H/I/J 卡（新增一張要紅）');
// 判準：某特性名在 src/lib 全部出現點都被硬綁到**別的卡名**（＝被別張卡壟斷），
//   或該特性名根本不出現。狠辣椒ex 正是前者（被「小碎鑽」壟斷）。
//
// ⚠⚠ **這把尺的能力邊界（審查實測量化，寫在這裡免得日後有人以為它保證了更多）**：
//   抓得到：① 特性名在全 src 完全不出現；② 特性名的所有出現點都硬綁別張卡名（＝壟斷）。
//   抓不到：③ 有接線但實作被改壞／變成死碼；④ 特性名同時出現在 log 訊息或 ai.ts 之類
//           「非實作」的位置（那會被當成通用比對而放行）。實測 291 個「已實裝」中約 69%
//           有 ≥2 個無卡名綁定的出現點 ⇒ 把實作刪掉本尺也不會紅。
//   ⇒ 它負責的是「**完全沒接線**」這一類（本輪狠辣椒ex 正是），行為正確性由 ②③ 段負責。
// ⚠ 判準會抓到兩類，**都必須逐一人工判讀**後放進下面兩張表之一（表本身不得有死條目）：
//   (i) 特性名根本不出現 —— 可能是「按卡名實作」（化石那一族就是），也可能真的沒做；
//   (ii) 特性名的每個出現點都硬綁到**別的卡名** —— 狠辣椒ex 被「小碎鑽」壟斷正是這型。
const ADJUDICATED_IMPLEMENTED=new Map(Object.entries({
  '伊布ex|虹色DNA':'engine.ts canEvolveFromHandOnto → hasEffectiveAbilityByInst(…,\'虹色DNA\')（v6.203 逐字化）',
  // ⭐ v6.257 移除：鬥志戰吼改走中央閘 getEvolveTimingBypass →
  //   hasEffectiveAbilityByInst(…,'鬥志戰吼')，engine.ts 那段同時出現特性名與
  //   **不再**綁死卡名 ⇒ 候選判準不再把它列為候選，留在表裡就是 7e 的死條目。
  //   （站長回報：勒克貓【MC 245/742】沒有這個特性卻也能剛使出就進化。）
  '陳舊的羽毛化石|羽毛守護':'defense.ts / effects.ts 按卡名「陳舊的羽毛化石」做備戰免疫（v5.852）',
  '陳舊的背蓋化石|背蓋守護':'engine.ts / defense.ts 按卡名做「不受招式效果影響」',
  '陳舊的頭蓋化石|頭蓋尖刺':'effects.ts 受傷反擊表 [\'陳舊的頭蓋化石\', 3]（v5.494，按卡名）',
  // ⭐ v6.207 移除：威嚇之顎接上特性消除閘後，engine.ts 那段同時出現
  //   `defenderCard.name === '陳舊的顎之化石'` 與 `a.name === '威嚇之顎'`
  //   ⇒ 候選判準（「特性名的出現點有沒有綁到自己的卡名」）不再把它列為候選，
  //   留在表裡就是 7e 的死條目。這正是 7e 想逼出來的同步清理。
  '陳舊的鰭之化石|鰭之守護':'v3080_deferred_wave_c.ts isImmuneToOppSupporter 按卡名（v3.21）',
}));
// ⭐⭐ v6.206：**陳舊的盾甲化石｜盾之守護 已補實裝**（M5 19216，J）——
//   shieldFossilGuardReduce（v2999_g3_wave1.ts）＋ engine 戰鬥位管線 ＋ effects 備戰管線。
//   ⇒ 從本表移除（7e 的死條目守衛會逼人做這件事）。本表現在是空的：
//   「全站沒有任何一張 H/I/J 卡是『卡面有效果但完全沒實裝』」是**現行不變式**，
//   新卡帶進新的未實裝會在 7d 紅。
const KNOWN_UNIMPLEMENTED=new Map(Object.entries({}));
const stripC=s=>s.replace(/\/\*[\s\S]*?\*\//g,m=>m.replace(/[^\n]/g,' ')).replace(/\/\/.*$/gm,'').replace(/[\u200b-\u200d\ufeff]/g,'');
function walkTs(d,out=[]){for(const e of readdirSync(d,{withFileTypes:true})){const p=join(d,e.name);
  if(e.isDirectory())walkTs(p,out); else if(e.name.endsWith('.ts')||e.name.endsWith('.svelte'))out.push(p);}return out;}
const srcFiles=[...walkTs(join(ROOT,'src/lib')),...walkTs(join(ROOT,'src/routes'))]
  .map(p=>stripC(readFileSync(p,'utf8')).split('\n'));
const allCardNames=new Set(byFile.map(([,c])=>c.name));
const LIT=/'([^'\n]{1,20})'/g;
const boundNamesNear=(lines,i,self)=>new Set([...lines.slice(Math.max(0,i-4),i+5).join('\n').matchAll(LIT)]
  .map(m=>m[1]).filter(x=>allCardNames.has(x)&&x!==self));
function occurrences(abilityName){
  const occ=[];
  for(const lines of srcFiles) lines.forEach((ln,i)=>{ if(ln.includes(abilityName)) occ.push(boundNamesNear(lines,i,abilityName)); });
  return occ;
}
function candidates(){
  const hij=byFile.filter(([,c])=>['H','I','J'].includes(c.regulationMark));
  const seen=new Set(); const out=[];
  for(const [,c] of hij) for(const a of (c.abilities??[])){
    const key=c.name+'|'+a.name; if(seen.has(key))continue; seen.add(key);
    const occ=occurrences(a.name);
    if(occ.length===0){ out.push(key); continue; }
    // 有任何一個出現點「沒綁任何卡名」＝通用比對（中央實作）⇒ 涵蓋所有同名特性的卡 ⇒ 放行
    if(occ.some(b=>b.size===0)) continue;
    if(!occ.some(b=>b.has(c.name))) out.push(key);
  }
  return out;
}
const found=candidates();
T('7a. 掃描器自我驗證 ①：下限＋正對照（「雙重屬性」的兩條分支都要掃得到）',()=>{
  const occ=occurrences('雙重屬性');
  assert.ok(occ.length>=2,'「雙重屬性」只掃到 '+occ.length+' 個出現點 —— 掃描器壞了');
  assert.ok(occ.some(b=>b.has('小碎鑽')),'掃不到小碎鑽那條分支');
  assert.ok(occ.some(b=>b.has('狠辣椒ex')),'⚠ 掃不到狠辣椒ex 分支 ⇒ 本版修正沒進去，或掃描器壞了');
  assert.ok(!occ.some(b=>b.size===0),'「雙重屬性」有通用出現點 ⇒ 這條判準對它失效，要重寫');
});
T('7b. 掃描器自我驗證 ②：下限 —— H/I/J 特性總數與候選數都要在合理區間',()=>{
  const seen=new Set();
  for(const [,c] of byFile.filter(([,x])=>['H','I','J'].includes(x.regulationMark)))
    for(const a of (c.abilities??[])) seen.add(c.name+'|'+a.name);
  assert.ok(seen.size>=250,'只枚舉到 '+seen.size+' 個 H/I/J 特性 —— 枚舉壞了');
  assert.ok(found.length>=1&&found.length<=30,'候選數 '+found.length+' 異常（判準可能失效或炸開）');
});
T('7c.⭐ 狠辣椒ex｜雙重屬性 已補實作 ⇒ 不得再是候選（HEAD 會在這裡紅）',()=>{
  assert.ok(!found.includes('狠辣椒ex|雙重屬性'),'狠辣椒ex 仍被判為未實裝');
  // ⚠ 字串共現只證明「有接線」，不證明「接對了」⇒ 這裡再用**行為端**複核一次
  //   （把分支改成死碼時，上面那條仍會綠，這一條會紅）。
  const inst=I(CHILI);
  assert.deepEqual(mod.getAttackerEffectiveTypes(ST({active:inst},{active:I(PLAIN)}),0,inst,pool.get(CHILI),pool),
    ['Grass','Fire'],'字串在、行為不在 ⇒ 接線是死碼');
});
T('7d.⭐ 候選必須全部已判讀（新卡帶來新的「完全沒實裝」會在這裡紅）',()=>{
  const extra=found.filter(k=>!ADJUDICATED_IMPLEMENTED.has(k)&&!KNOWN_UNIMPLEMENTED.has(k));
  assert.equal(extra.length,0,'未判讀的候選：\n      '+extra.join('\n      '));
});
T('7e. 兩張判讀表都不得有死條目（判準改動或補了實作就要同步清理）',()=>{
  const dead=[...ADJUDICATED_IMPLEMENTED.keys(),...KNOWN_UNIMPLEMENTED.keys()].filter(k=>!found.includes(k));
  assert.equal(dead.length,0,'死條目：'+dead.join(', '));
});

// ⭐⭐⭐ v6.206 —— ⑧ tag 尺 (c)「同名平權」**已整段移除**（站長 2026-08-18 裁定）
//
// 原本這裡有第三把尺：「同一隻寶可夢（supertype=Pokemon＋同 name）的所有卡，
// 『古代／未來』必須一致（物種固有屬性）」，並凍結了 5 組／11 筆「缺口」。
//
// **站長裁定（逐字）**：「我判定，不用補標籤，這些卡片的卡圖上面都沒有古代和未來的標籤，
//   所以都是正確的，你如果改了反而是錯的。」
//
// ⇒ 這把尺的前提「同名 ⇒ 同物種 ⇒ tag 必一致」在**資料上就被否證**（v6.206 逐張核對）：
//   ・密勒頓 有兩種完全不同的卡 —— 【龍】110HP（SV5M 9893／SV8a 11648／MC 17023／SV-P-H 10102，
//     有「未來」、官方 filter 也列出）與【雷】120HP（MC 16754／MJ 18373／M5 19171／M-P-J 19235，
//     招式各不相同、卡圖沒有標籤）。同名，但根本不是同一張卡。
//   ・故勒頓ex 亦然：svhk 10061【龍】230「古代」 vs MC 16896／18272【鬥】230「太晶」，招式完全不同。
//   ⇒ 保留這把尺 ＝ 每一輪都在叫人去修**正確**的資料（站長明言「改了反而是錯的」）。
//
// ⚠ 另外兩把尺 v6.206 已逐一查證**沒有**同樣的問題，故保留（守衛在
//   scripts/test-v6206-effective-type-central-and-shield-fossil.mjs ⑧ 段有永久回歸測試）：
//   ・尺 (a) 官方快照：方向是單向的「官方說有 ⇒ 我方必須有」。11 筆被裁定為正確的卡，
//     **官方 filter 一筆都沒有列**；而且其中 4 筆（16754/16755/16896/18272）就在官方
//     filter **有涵蓋**的 MC 卡包裡 ⇒ 官方資料本身與站長裁定一致。
//   ・尺 (b) 印刷平權：指紋含 HP／屬性／特性／招式／rulesText，密勒頓/故勒頓那些「同名不同卡」
//     的指紋本來就不同 ⇒ 不會誤報。實測 31 組「跨世代（SV↔MC）同指紋且含古代/未來」全部一致。
console.log(`\nv6.205（v6.206 起：尺 (c) 已移除、盾之守護已實裝）: ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
