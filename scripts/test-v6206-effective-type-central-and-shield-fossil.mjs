// ⭐⭐⭐ v6.206
//   ① tag 三把尺：站長 2026-08-18 裁定「不用補標籤，卡圖上沒有古代/未來 ⇒ 現況是對的」
//      ⇒ 尺 (c)「同名平權」**移除**；尺 (a)(b) 逐一查證沒有同樣問題 ⇒ 保留 ＋ 永久回歸測試。
//   ② 「屬性改變」從**只有弱點/抵抗力一維**擴大成中央述詞 getEffectivePokemonTypes：
//      卡面寫「只要這隻寶可夢**在場上**」⇒ 備戰也要生效；場上屬性計數／附能 HP 加成／
//      道具弱點比對全部收斂到同一支（含 v6.204 的特性消除中央閘，不新建第五份述詞）。
//   ③ 逆境保險（tools.ts）原本自己手刻弱點比對 ⇒ 改走中央述詞。
//   ④ 陳舊的盾甲化石｜盾之守護（M5 19216，J）補實裝 —— v6.205 查出的全站最後一張未實裝卡。
//
// ⚠ 本檔一律**行為端**驅動（applyAction / ATTACK_PRE / getEffectiveHP），
//   不用「字串在不在」當結論 —— 那只證明有接線，不證明接對了。
// ⚠ 每一條修正都配**正對照**（沒有這類特性的寶可夢必須完全不變）＋ ⑦ 段全卡池差分實跑。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.x6206-s.js'),E=join(ROOT,'.x6206-e.ts'),O=join(ROOT,'.x6206-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O])try{unlinkSync(p)}catch{}});
writeFileSync(S,'export const base="";export const assets="";');
// ⚠ 用 namespace import（不是具名 re-export）—— 這樣把 src 還原成 BASE 做 HEAD-FAIL 時，
//   「新函式還不存在」只會讓那一條斷言紅，不會整個 bundle build 不起來而看不出是哪幾條。
writeFileSync(E,
  "import * as ENG from './src/lib/game/engine';\n"
+ "import * as EFF from './src/lib/game/effects';\n"
+ "export { ENG, EFF };\n");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const m=await import(pathToFileURL(O).href);
const ENG=m.ENG, EFF=m.EFF;

const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map(); const byFile=[];
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

const CHILI=findId('狠辣椒ex',ab('雙重屬性'));
const KENA =findId('小碎鑽',ab('雙重屬性'));
const TRACK=findId('鐵轍跡',ab('二重核心'));
const DRIVE=findId('驅勁能量 未來');
const TORT =findId('土台龜ex',c=>c.attacks?.some(a=>a.name==='森林行進'));
const BOOST=findId('增強【草】能量');
const MAGNET=findId('磁鐵【鋼】能量');   // 差分用對照能量：同樣是「1 張特殊能量」但沒有 HP hook
const INSUR=findId('逆境保險');
const SHIELD=findId('陳舊的盾甲化石');
const BRONZE=findId('青銅鐘',ab('守護之鐘'));
const FLYSQ=findId('電飛鼠',c=>c.attacks?.some(a=>a.name==='天空波'));
const CAVE =findId('傳說的熔岩洞');
const WATCH=findId('火箭隊的監視塔');
const IRON =findId('鐵荊棘ex',ab('初始化'));
const MOON =findId('振翼髮',ab('暗夜羽擊'));
const FIREE=findId('基本【火】能量');
const LIGHTE=findId('基本【雷】能量');
const GRASSE=findId('基本【草】能量');
const PLAIN=(()=>{for(const [id,c] of pool) if(c.supertype==='Pokemon'&&c.stage==='Basic'&&!c.abilities&&c.subtype==='Basic'&&!(c.tags??[]).length&&!c.evolvesFrom&&c.pokemonType!=='Grass') return id; return null;})();
const pickWeak=(w)=>{for(const [id,c] of pool) if(c.supertype==='Pokemon'&&c.weakness?.type===w&&!c.abilities&&(c.hp??0)>=200&&!c.resistance) return id; return null;};
const WGRASS=pickWeak('Grass'), WFIRE=pickWeak('Fire');
const deck5=()=>[I(PLAIN),I(PLAIN),I(PLAIN),I(PLAIN),I(PLAIN)];
const types=(s,idx,inst)=>EFF.getAttackerEffectiveTypes(s,idx,inst,pool.get(inst.cardId),pool);

console.log('① 卡面逐字錨 ＋ 下限斷言（抓不到卡就紅，不做安慰劑綠燈）');
T('1a. 本檔依賴的卡全部抓得到',()=>{
  const NEED={CHILI,KENA,TRACK,DRIVE,TORT,BOOST,MAGNET,INSUR,SHIELD,BRONZE,FLYSQ,CAVE,WATCH,IRON,MOON,FIREE,LIGHTE,GRASSE,PLAIN,WGRASS,WFIRE};
  const bad=Object.entries(NEED).filter(([,v])=>!v).map(([k])=>k);
  assert.equal(bad.length,0,'抓不到：'+bad.join(','));
});
T('1b. 三張「屬性改變」卡的卡面逐字（特性讀 effect，不是 text）',()=>{
  assert.equal(eff(CHILI,'雙重屬性'),'只要這隻寶可夢在場上，改為【草】與【火】2種屬性。');
  assert.equal(eff(KENA ,'雙重屬性'),'只要這隻寶可夢在場上，改為【鬥】與【超】2種屬性。');
  assert.equal(eff(TRACK,'二重核心'),'只要這隻寶可夢身上附有「驅勁能量 未來」，這隻寶可夢改為【鬥】與【鋼】2種屬性。');
  // 三張的 dual 都**包含**自己的印刷屬性 ⇒ 本次收斂相對印刷屬性是純新增，不會弄丟本色
  assert.equal(pool.get(CHILI).pokemonType,'Fire');
  assert.equal(pool.get(KENA ).pokemonType,'Fighting');
  assert.equal(pool.get(TRACK).pokemonType,'Metal');
});
T('1c. 陳舊的盾甲化石卡面逐字 —— 條件是「在**戰鬥場**上」，不是青銅鐘的「在場上」',()=>{
  assert.equal(eff(SHIELD,'盾之守護'),
    '只要這隻寶可夢在戰鬥場上，自己的所有寶可夢受到對手的寶可夢招式的傷害「-10」點。');
  assert.equal(eff(BRONZE,'守護之鐘'),
    '只要這隻寶可夢在場上，自己的所有寶可夢受到對手的寶可夢招式的傷害「-10」點。');
  assert.notEqual(eff(SHIELD,'盾之守護'),eff(BRONZE,'守護之鐘'),'兩張卡面若相同就不該分兩支實作');
  const c=pool.get(SHIELD);
  assert.equal(c.supertype,'Trainer'); assert.equal(c.subtype,'Item'); assert.equal(c.regulationMark,'J');
  // rulesText 決定它在場上是【基礎】【無】HP60 ⇒ 決定哪些消除來源打得到它
  assert.ok(/可作為HP60的【無】屬性的【基礎】寶可夢放置於場上/.test(c.rulesText??''),c.rulesText);
});
T('1d. 消費點的卡面逐字（決定「有效屬性」該不該進去）',()=>{
  assert.equal(pool.get(TORT).attacks.find(a=>a.name==='森林行進').effect,'造成自己的場上【草】寶可夢的數量×30點傷害。');
  assert.ok(/附有這張卡的【草】寶可夢的最大HP「\+20」/.test(pool.get(BOOST).rulesText??''),pool.get(BOOST).rulesText);
  assert.equal(pool.get(INSUR).rulesText,
    '若附有這張卡的寶可夢的弱點屬性與對手戰鬥寶可夢的屬性相同，則附有這張卡的寶可夢在戰鬥場受到對手的寶可夢招式的傷害時，從自己的牌庫抽出3張卡。');
  assert.equal(pool.get(FLYSQ).attacks.find(a=>a.name==='天空波').effect,
    '雙方的所有備戰寶可夢也各受到10點傷害。\n [在備戰區不計算弱點・抵抗力。]');
});

// ⚠ 誠實聲明（第二輪 opus 審查抓到）：BASE 的 getAttackerEffectiveTypes **本來就**吃 inst、
//   備戰也回雙屬性 —— 全部還原 BASE 時第②段只有 2a 會紅。所以 2b~2f 是**回歸鎖**
//   （防止日後有人把 location 推導改壞），不是本版的 HEAD-FAIL 證據；
//   本版真正的缺口在**消費點**（③④⑤⑥ 段），標題不再寫〔核心〕。
console.log('② 中央述詞（回歸鎖，非 HEAD-FAIL）：卡面「在場上」⇒ 備戰與戰鬥場一體適用（含消除閘）');
T('2a. 中央述詞 getEffectivePokemonTypes 存在且與 getAttackerEffectiveTypes 同源',()=>{
  assert.equal(typeof EFF.getEffectivePokemonTypes,'function','中央述詞不存在 ⇒ 本版沒進去');
  assert.equal(typeof EFF.hasEffectivePokemonType,'function');
  const inst=I(CHILI); const s=ST({active:inst},{active:I(PLAIN)});
  assert.deepEqual(EFF.getEffectivePokemonTypes(s,0,inst,pool.get(CHILI),pool),['Grass','Fire']);
  assert.equal(EFF.hasEffectivePokemonType(s,0,inst,pool.get(CHILI),pool,'Grass'),true);
  assert.equal(EFF.hasEffectivePokemonType(s,0,inst,pool.get(CHILI),pool,'Water'),false);
});
T('2b. **備戰**的狠辣椒ex 也是【草】＋【火】（卡面「在場上」不限戰鬥場）',()=>{
  const b=I(CHILI); const s=ST({active:I(PLAIN),bench:[b]},{active:I(PLAIN)});
  assert.deepEqual(types(s,0,b),['Grass','Fire']);
});
T('2c. 備戰狠辣椒ex ＋ 傳說的熔岩洞（Stage1 進化）⇒ 退回印刷的【火】',()=>{
  const b=I(CHILI); const s=ST({active:I(PLAIN),bench:[b]},{active:I(PLAIN)},{activeStadium:I(CAVE)});
  assert.deepEqual(types(s,0,b),['Fire']);
});
T('2d. 備戰狠辣椒ex ＋ 鐵荊棘ex｜初始化（ex＝擁有規則的寶可夢）⇒ 退回【火】',()=>{
  const b=I(CHILI); const s=ST({active:I(PLAIN),bench:[b]},{active:I(IRON)});
  assert.deepEqual(types(s,0,b),['Fire']);
});
T('2e.【正對照】備戰狠辣椒ex ＋ 對手戰鬥場 振翼髮（暗夜羽擊只打 active）⇒ 備戰的仍是【草】＋【火】',()=>{
  const b=I(CHILI); const s=ST({active:I(PLAIN),bench:[b]},{active:I(MOON)});
  assert.deepEqual(types(s,0,b),['Grass','Fire']);
  // 同一盤面把它放到戰鬥場 ⇒ 就打得到（證明上面那條不是「閘沒接」）
  const a=I(CHILI); const s2=ST({active:a},{active:I(MOON)});
  assert.deepEqual(types(s2,0,a),['Fire']);
});
T('2f.【正對照】火箭隊的監視塔只消【無】⇒ 狠辣椒ex（【火】）不受影響',()=>{
  const b=I(CHILI); const s=ST({active:I(PLAIN),bench:[b]},{active:I(PLAIN)},{activeStadium:I(WATCH)});
  assert.deepEqual(types(s,0,b),['Grass','Fire']);
});

console.log('③ 消費點一：土台龜ex｜森林行進（自己場上【草】寶可夢數 ×30）');
const forest=(benchIds,stad)=>{
  const s=ST({active:I(TORT,{energyAttached:[I(GRASSE)]}),bench:benchIds.map(x=>I(x))},{active:I(PLAIN)},
    stad?{activeStadium:I(stad)}:{});
  return EFF.ATTACK_PRE.get('土台龜ex|森林行進')(s,0,pool,{}).damage;
};
T('3a.【正對照】fixture 成立：只有土台龜ex 自己（【草】）⇒ 30',()=>{
  assert.equal(pool.get(TORT).pokemonType,'Grass');
  assert.equal(pool.get(PLAIN).pokemonType!=='Grass',true,'PLAIN 不能是【草】否則差分沒意義');
  assert.equal(forest([],null),30);
  assert.equal(forest([PLAIN,PLAIN],null),30,'非【草】的備戰不該被算進來');
});
T('3b.〔核心〕**備戰**放 1 隻狠辣椒ex ⇒ 60（BASE 只有 30：印刷屬性是【火】）',()=>{
  assert.equal(forest([CHILI],null),60);
});
T('3c. 備戰狠辣椒ex ＋ 熔岩洞 ⇒ 特性被消除，退回 30',()=>{
  assert.equal(forest([CHILI],CAVE),30);
});
T('3d.【正對照】備戰狠辣椒ex ＋ 監視塔（只消【無】）⇒ 仍 60',()=>{
  assert.equal(forest([CHILI],WATCH),60);
});
T('3e.【正對照】備戰小碎鑽（【鬥】＋【超】，沒有【草】）⇒ 仍 30，沒有被改過頭',()=>{
  assert.equal(forest([KENA],null),30);
});

console.log('④ 消費點二：增強【草】能量（附於【草】寶可夢 ⇒ 最大 HP +20）');
const hpOf=(cardId,attachBoost,stad,onBench,energyOverride)=>{
  const inst=I(cardId,{energyAttached:energyOverride!==undefined?[I(energyOverride)]:(attachBoost?[I(BOOST)]:[])});
  const s=onBench?ST({active:I(PLAIN),bench:[inst]},{active:I(PLAIN)},stad?{activeStadium:I(stad)}:{})
                 :ST({active:inst},{active:I(PLAIN)},stad?{activeStadium:I(stad)}:{});
  return ENG.getEffectiveHP(inst,pool,s);
};
T('4a.【正對照】fixture：狠辣椒ex 卡面 HP 260；沒附增強【草】能量 ⇒ 260',()=>{
  assert.equal(pool.get(CHILI).hp,260);
  assert.equal(hpOf(CHILI,false,null,false),260);
});
T('4b.〔核心〕狠辣椒ex 附增強【草】能量 ⇒ 280（BASE 是 260：印刷屬性【火】拿不到 +20）',()=>{
  assert.equal(hpOf(CHILI,true,null,false),280);
});
T('4c. 備戰的狠辣椒ex 一樣 +20（卡面「在場上」）',()=>{
  assert.equal(hpOf(CHILI,true,null,true),280);
});
T('4d. ＋熔岩洞 ⇒ 特性被消除，退回 260；【正對照】＋監視塔仍 280',()=>{
  assert.equal(hpOf(CHILI,true,CAVE,false),260);
  assert.equal(hpOf(CHILI,true,WATCH,false),280);
});
T('4e.【正對照】土台龜ex（印刷就是【草】）附增強【草】能量 ⇒ 照舊 +20，沒有被弄壞',()=>{
  assert.equal(hpOf(TORT,true,null,false),(pool.get(TORT).hp??0)+20);
  assert.equal(hpOf(TORT,true,CAVE,false),(pool.get(TORT).hp??0)+20,'印刷【草】不該被特性消除影響');
});
T('4f.【正對照】小碎鑽（【鬥】＋【超】）附增強【草】能量 ⇒ 不加，維持卡面 HP',()=>{
  assert.equal(hpOf(KENA,true,null,false),pool.get(KENA).hp);
});

console.log('⑤ 消費點三：逆境保險（tools.ts 原本自己手刻弱點比對）');
const insurance=(defId,stad,atkId=CHILI,atkE=[FIREE,FIREE])=>{
  const holder=I(defId,{toolAttached:I(INSUR)});
  const s=ST({active:I(atkId,{energyAttached:atkE.map(x=>I(x))}),deck:deck5()},
             {active:holder,deck:deck5()},stad?{activeStadium:I(stad)}:{});
  const r=ENG.applyAction(s,{type:'ATTACK',attackIndex:0,actorIdx:0},pool);
  return {hand:r.players[1].hand.length,dmg:r.players[1].active?.damage};
};
T('5a.【正對照】fixture：holder 弱點【火】⇒ 攻擊者本色就命中，本來就抽 3（BASE 也一樣）',()=>{
  assert.equal(pool.get(WFIRE).weakness?.type,'Fire');
  assert.equal(insurance(WFIRE,null).hand,3);
});
T('5b.〔核心〕holder 弱點【草】＋ 狠辣椒ex（在場上是【草】＋【火】）⇒ 抽 3（BASE 抽 0）',()=>{
  assert.equal(pool.get(WGRASS).weakness?.type,'Grass');
  const r=insurance(WGRASS,null);
  assert.equal(r.hand,3,'逆境保險沒觸發（BASE 手刻 aCard.pokemonType==="Fire" 會漏）');
  assert.equal(r.dmg,20,'弱點 ×2 也要成立（10 → 20）');
});
T('5c. ＋熔岩洞 ⇒ 雙重屬性被消除 ⇒ 不再抽（0）',()=>{
  const r=insurance(WGRASS,CAVE);
  assert.equal(r.hand,0); assert.equal(r.dmg,10);
});
T('5d.【正對照】＋監視塔（只消【無】）⇒ 仍抽 3',()=>{
  assert.equal(insurance(WGRASS,WATCH).hand,3);
});
T('5e.【正對照】holder 弱點【草】＋ 一般【火】攻擊者 ⇒ 不抽（沒有把 gate 拆掉）',()=>{
  // 找一張沒有特性的【火】基礎寶可夢當攻擊者
  let plainFire=null;
  for(const [id,c] of pool) if(c.supertype==='Pokemon'&&c.pokemonType==='Fire'&&!c.abilities
      &&c.stage==='Basic'&&(c.attacks??[]).some(a=>(a.cost??[]).length<=2&&!a.effect)) {plainFire=id;break;}
  assert.ok(plainFire,'找不到乾淨的【火】攻擊者樣本');
  const r=insurance(WGRASS,null,plainFire,[FIREE,FIREE]);
  // ⚠ 篩選條件是「**存在某個**招式便宜且無 effect」，實跑卻固定 attackIndex:0 ——
  //   卡池順序一漂移就可能選到打不出去的卡，那時 hand===0 是因為招式沒發動，這條會靜默恆真。
  //   （第二輪 opus 審查抓到）⇒ 先斷言招式真的打出去了。
  assert.ok((r.dmg??0)>0,'fixture 不成立：attackIndex:0 沒打出傷害 ⇒ hand===0 不具意義');
  assert.equal(r.hand,0);
});

console.log('⑥ 陳舊的盾甲化石｜盾之守護 —— v6.205 查出的全站最後一張未實裝卡');
const shield=({stad=null,onBench=false,nullFlag=false,noFossilFlag=false}={})=>{
  const fossil=I(SHIELD,{fossilOnField:!noFossilFlag,...(nullFlag?{abilityNullifiedThisTurn:true}:{})});
  const other=I(PLAIN);
  const defSide=onBench?{active:other,bench:[fossil],deck:deck5()}:{active:fossil,bench:[other],deck:deck5()};
  const s=ST({active:I(CHILI,{energyAttached:[I(FIREE),I(FIREE)]}),deck:deck5()},defSide,
    stad?{activeStadium:I(stad)}:{});
  const r=ENG.applyAction(s,{type:'ATTACK',attackIndex:0,actorIdx:0},pool);
  return r.players[1].active?.damage;
};
T('6a.〔核心〕化石在**戰鬥場** ⇒ 香料激怒 10 傷害被 -10 吃光（BASE 會扣 10）',()=>{
  assert.equal(shield(),0);
});
T('6b.〔卡面逐字〕化石在**備戰** ⇒ 不生效（條件是「在戰鬥場上」，不是青銅鐘的「在場上」）',()=>{
  // ⚠ 不硬寫傷害數字（PLAIN 換卡就會假紅/假綠）—— 與「同一盤面但備戰放一般寶可夢」對照。
  const withFossilOnBench=(()=>{
    const s=ST({active:I(CHILI,{energyAttached:[I(FIREE),I(FIREE)]}),deck:deck5()},
               {active:I(PLAIN),bench:[I(SHIELD,{fossilOnField:true})],deck:deck5()});
    return ENG.applyAction(s,{type:'ATTACK',attackIndex:0,actorIdx:0},pool).players[1].active?.damage;
  })();
  const control=(()=>{
    const s=ST({active:I(CHILI,{energyAttached:[I(FIREE),I(FIREE)]}),deck:deck5()},
               {active:I(PLAIN),bench:[I(PLAIN)],deck:deck5()});
    return ENG.applyAction(s,{type:'ATTACK',attackIndex:0,actorIdx:0},pool).players[1].active?.damage;
  })();
  assert.ok(control>0,'fixture 不成立：對照組本來就 0 傷害');
  assert.equal(withFossilOnBench,control,'備戰的化石給了減傷（＝把卡面條件抄成守護之鐘的「在場上」）');
  // 正對照：同一張化石移到戰鬥場就必須有 -10（證明上面那條不是因為整支 helper 沒接線）
  assert.equal(shield(),0);
});
T('6c. 消除① 火箭隊的監視塔（化石在場上是【無】⇒ 打得到）⇒ 減傷失效',()=>{
  assert.equal(shield({stad:WATCH}),10);
});
T('6d. 消除② 招式版暗夜羽擊（abilityNullifiedThisTurn，戰鬥場）⇒ 減傷失效',()=>{
  assert.equal(shield({nullFlag:true}),10);
});
T('6e.【正對照】傳說的熔岩洞只消**進化** —— 化石在場上是【基礎】⇒ 打不到，仍 -10',()=>{
  assert.equal(shield({stad:CAVE}),0,'熔岩洞不該消化石特性（v6.145 的教訓：fossilOnField）');
});
T('6f.【正對照】鐵荊棘ex｜初始化只消「擁有規則的寶可夢」—— 化石不是 ⇒ 仍 -10',()=>{
  // ⚠ 鐵荊棘ex｜伏特旋風 cost =【雷】+2【無】—— 餵錯能量招式根本不會發動（fixture 陷阱）。
  assert.deepEqual(pool.get(IRON).attacks[0].cost,['Lightning','Colorless','Colorless']);
  const run=(defActive)=>{
    const s=ST({active:I(IRON,{energyAttached:[I(LIGHTE),I(LIGHTE),I(LIGHTE)]}),deck:deck5()},
               {active:defActive,bench:[I(PLAIN)],deck:deck5()});
    const r=ENG.applyAction(s,{type:'ATTACK',attackIndex:0,actorIdx:0},pool);
    return r.log.map(l=>l.message||'').join('\n');
  };
  const withFossil=run(I(SHIELD,{fossilOnField:true}));
  assert.ok(/伏特旋風/.test(withFossil),'fixture 不成立：招式沒發動\n'+withFossil.slice(-400));
  assert.ok(/盾之守護/.test(withFossil),'初始化在場時盾之守護被誤消除了\n'+withFossil.slice(-400));
  // 正對照：換成一般寶可夢 ⇒ 不該出現盾之守護（證明上面那條不是恆真）
  assert.ok(!/盾之守護/.test(run(I(PLAIN))),'沒有化石卻出現盾之守護');
});
T('6g. 受惠對象是「自己的**所有**寶可夢」⇒ 備戰也 -10（電飛鼠｜天空波 打雙方備戰 10）',()=>{
  const fossil=I(SHIELD,{fossilOnField:true}); const benchMon=I(PLAIN);
  const s=ST({active:I(FLYSQ,{energyAttached:[I(FIREE)]}),deck:deck5()},
             {active:fossil,bench:[benchMon],deck:deck5()});
  const r=ENG.applyAction(s,{type:'ATTACK',attackIndex:0,actorIdx:0},pool);
  assert.equal(r.players[1].bench[0].damage,0,'備戰的自方寶可夢沒吃到 -10');
  // 正對照：同一招式、把化石換成一般寶可夢 ⇒ 備戰確實會扣 10（證明 fixture 成立）
  const s2=ST({active:I(FLYSQ,{energyAttached:[I(FIREE)]}),deck:deck5()},
              {active:I(PLAIN),bench:[I(PLAIN)],deck:deck5()});
  const r2=ENG.applyAction(s2,{type:'ATTACK',attackIndex:0,actorIdx:0},pool);
  assert.equal(r2.players[1].bench[0].damage,10,'fixture 不成立：天空波本來就沒打到備戰');
});
T('6h. 沒有 fossilOnField 旗標（＝不是放在場上的化石）⇒ 不生效',()=>{
  assert.equal(shield({noFossilFlag:true}),10);
});

console.log('⑦ 差分實跑：「應該不變」的必須 0 mismatch');
const DUAL_EXPECT=new Map([['小碎鑽',['Fighting','Psychic']],['狠辣椒ex',['Grass','Fire']]]);
// ⚠ 本條**沒有**替任何實體附「驅勁能量 未來」⇒ 鐵轍跡｜二重核心那條路徑在這裡是零覆蓋
//   （第二輪 opus 審查抓到）。三張雙屬性卡裡它由 v6.205 守衛 4b 負責，本條只涵蓋
//   「無條件成立」的兩張。標題已照實寫。
T('7a. 全卡池 × {戰鬥場,備戰} × 3 場地：兩張無條件雙屬性卡（小碎鑽／狠辣椒ex）以外一律＝印刷屬性',()=>{
  const mons=[...pool.entries()].filter(([,c])=>c.supertype==='Pokemon');
  assert.ok(mons.length>=2000,'只掃到 '+mons.length+' 張寶可夢，掃描器壞了？');
  let n=0,bad=[],hit=new Set();
  for(const [id,c] of mons) for(const stad of [null,CAVE,WATCH]) for(const onBench of [false,true]){
    const inst=I(id);
    const st=onBench?ST({active:I(PLAIN),bench:[inst]},{active:I(PLAIN)},stad?{activeStadium:I(stad)}:{})
                    :ST({active:inst},{active:I(PLAIN)},stad?{activeStadium:I(stad)}:{});
    const now=EFF.getEffectivePokemonTypes(st,0,inst,c,pool);
    let exp=c.pokemonType?[c.pokemonType]:[];
    if(DUAL_EXPECT.has(c.name)){
      const dual=DUAL_EXPECT.get(c.name);
      // 熔岩洞消進化 ⇒ 狠辣椒ex(Stage1) 被消、小碎鑽(Basic) 不被消（備戰/戰鬥場都一樣）
      exp=(stad===CAVE&&c.stage!=='Basic')?[c.pokemonType]:dual;
      if(JSON.stringify(now)===JSON.stringify(dual)) hit.add(c.name);
    }
    n++; if(JSON.stringify(now)!==JSON.stringify(exp))
      bad.push(c.name+'@'+(stad??'-')+(onBench?'/備戰':'/戰鬥場')+' got '+JSON.stringify(now)+' want '+JSON.stringify(exp));
  }
  assert.equal(bad.length,0,n+' 組中 mismatch：'+bad.slice(0,8).join(' | '));
  assert.ok(n>=12000,'只跑了 '+n+' 組');
  assert.deepEqual([...hit].sort(),['小碎鑽','狠辣椒ex'],'兩張雙屬性卡都必須真的被走到（否則這條零覆蓋）');
});
T('7b. 森林行進差分：全卡池逐一當備戰第 1 隻，舊（印刷屬性）vs 新（實跑）—— 只有狠辣椒ex 差 30',()=>{
  const mons=[...pool.entries()].filter(([,c])=>c.supertype==='Pokemon');
  let n=0,diff=[];
  for(const [id,c] of mons){
    const old=30+((c.pokemonType==='Grass')?30:0);   // 舊實作：土台龜ex 自己 + 印刷【草】的備戰
    const now=forest([id],null);
    n++; if(old!==now) diff.push(c.name+' '+old+'→'+now);
  }
  assert.ok(n>=2000,'只跑了 '+n+' 組');
  const names=[...new Set(diff.map(x=>x.split(' ')[0]))].sort();
  assert.deepEqual(names,['狠辣椒ex'],'差異卡名應只有狠辣椒ex，實得：'+JSON.stringify(names.slice(0,10)));
  assert.ok(diff.every(x=>/30→60$/.test(x)),'差異必須恰好是 +30（1 隻）：'+diff.slice(0,3));
  console.log('    差分：'+n+' 組，mismatch '+diff.length+' 筆（全部是狠辣椒ex 30→60）');
});
T('7c. 增強【草】能量差分：全卡池逐一當 holder，舊（印刷 Grass ⇒ +20）vs 新 —— 只有狠辣椒ex 差 20',()=>{
  // ⚠ 舊模型**不可**寫成 (card.hp + 20)：怖納噬草｜雜草魂 這類「最大HP 特性」會讓基準值本來就不是
  //   card.hp（第一版就是這樣誤報 3 張）。正確的差分＝同一盤面「附 / 不附」增強【草】能量的**差值**。
  const mons=[...pool.entries()].filter(([,c])=>c.supertype==='Pokemon'&&(c.hp??0)>0);
  let n=0,diff=[];
  for(const [id,c] of mons){
    // ⚠ 對照組必須是**另一張特殊能量**（磁鐵【鋼】能量，沒有 HP hook）而不是「不附能量」——
    //   怪顎龍｜暴龍根性「身上附有特殊能量卡 ⇒ 最大HP +150」會讓「不附」的基準整個歪掉（第二版誤報）。
    // ⚠ 選磁鐵【鋼】能量當對照的**前提**：全卡池「最大HP × 能量條件」的特性只有三個
    //   （修建老匠｜大師工藝【鬥】、夠讚狗｜腎上腺力量【惡】、怪顎龍｜暴龍根性＝任何特殊能量），
    //   沒有一張掛在【鋼】能量上。日後若出現「附【鋼】能量 ⇒ 最大HP +N」的卡，這條會**假紅**
    //   （不是假綠），回來換一張對照能量即可。（第二輪 opus 審查要求記錄）
    const oldDelta=(c.pokemonType==='Grass')?20:0;        // 舊實作：只看印刷屬性
    const nowDelta=hpOf(id,true,null,false)-hpOf(id,false,null,false,MAGNET);
    n++; if(oldDelta!==nowDelta) diff.push(c.name+' Δ'+oldDelta+'→Δ'+nowDelta);
  }
  assert.ok(n>=2000,'只跑了 '+n+' 組');
  const names=[...new Set(diff.map(x=>x.split(' ')[0]))].sort();
  assert.deepEqual(names,['狠辣椒ex'],'差異卡名應只有狠辣椒ex，實得：'+JSON.stringify(names.slice(0,10)));
  assert.ok(diff.every(x=>/Δ0→Δ20$/.test(x)),diff.slice(0,3).join(','));
  console.log('    差分：'+n+' 組，mismatch '+diff.length+' 筆（全部是狠辣椒ex Δ0→Δ20）');
});
T('7d. 盾之守護差分：沒有這張化石在戰鬥場的盤面，傷害必須完全不變',()=>{
  // 把「戰鬥場的化石」換成同樣 fossilOnField 的其他化石 ⇒ 一律無減傷
  let n=0,bad=[];
  for(const [id,c] of pool){
    if(c.supertype!=='Trainer'||c.subtype!=='Item'||!/^陳舊的.*化石$/.test(c.name)) continue;
    const f=I(id,{fossilOnField:true});
    const s=ST({active:I(CHILI,{energyAttached:[I(FIREE),I(FIREE)]}),deck:deck5()},
               {active:f,bench:[I(PLAIN)],deck:deck5()});
    const r=ENG.applyAction(s,{type:'ATTACK',attackIndex:0,actorIdx:0},pool);
    const d=r.players[1].active?.damage;
    const expect=(c.name==='陳舊的盾甲化石')?0:(c.name==='陳舊的顎之化石'?0:10);
    n++; if(d!==expect) bad.push(c.name+' got '+d+' want '+expect);
  }
  assert.ok(n>=6,'只掃到 '+n+' 張化石');
  assert.equal(bad.length,0,bad.join(' | '));
});

T('7e.〔凍結・待站長裁定〕「驅勁能量 未來」是**寶可夢道具**不是能量卡 ⇒ 二重核心的容器判定有問題',()=>{
  // ⭐ 第一輪 opus 審查抓到、我方複驗屬實：卡池裡「驅勁能量 未來」的**全部 3 個印刷**
  //   （svhm 10091 / SV8a 12436 / SV5M 9906）都是 supertype=Trainer / subtype=PokemonTool、**G 標**。
  //   但 hasIronTracksDualCore（v2999_g3_wave1.ts）只掃 inst.energyAttached ⇒ 真實牌局掛在
  //   toolAttached 時特性不會發動；v6.204/v6.205 的 fixture 也是用 energyAttached，所以綠燈沒有證明力。
  //   ⚠ **本版刻意不修**：這張卡全部印刷都是 G 標，站規只維護 H/I/J ⇒ 合法牌組打不出來。
  //   這條當**絆線**：哪天出了 H/I/J 印刷、或它變成 Energy，這裡會紅，逼人回來重判。
  const all=[...pool.values()].filter(c=>c.name==='驅勁能量 未來');
  assert.ok(all.length>=3,'只找到 '+all.length+' 個印刷，掃描器壞了？');
  const bad=all.filter(c=>!(c.supertype==='Trainer'&&c.subtype==='PokemonTool'&&c.regulationMark==='G'));
  assert.equal(bad.length,0,
    '「驅勁能量 未來」的印刷型態變了（'+bad.map(c=>c.id+':'+c.supertype+'/'+c.subtype+'/'+c.regulationMark).join(',')
    +'）⇒ hasIronTracksDualCore 只讀 energyAttached 這件事必須回頭重判');
});

console.log('⑧ 站長裁定（2026-08-18）：11 筆「缺古代/未來 tag」是**正確**的，任何一把尺都不得再點名');
// 站長逐字：「我判定，不用補標籤，這些卡片的卡圖上面都沒有古代和未來的標籤，所以都是正確的，
//            你如果改了反而是錯的。」
const RULED_CORRECT_NO_TAG={
  '19235':['密勒頓','未來'],'19171':['密勒頓','未來'],'16754':['密勒頓','未來'],'18373':['密勒頓','未來'],
  '16755':['密勒頓ex','未來'],'18259':['密勒頓ex','未來'],
  '19189':['故勒頓','古代'],
  '16896':['故勒頓ex','古代'],'18272':['故勒頓ex','古代'],'12142':['故勒頓ex','古代'],
  '12419':['鐵脖頸','未來'],
};
T('8a. 這 11 張卡都還在卡池、卡名對得上、且**確實沒有**那個 tag（現況＝站長認定的正確狀態）',()=>{
  const bad=[];
  for(const [id,[name,tag]] of Object.entries(RULED_CORRECT_NO_TAG)){
    const c=pool.get(id);
    if(!c){bad.push(id+' 不在卡池');continue;}
    if(c.name!==name) bad.push(id+' 卡名變成 '+c.name);
    if((c.tags??[]).includes(tag)) bad.push(id+' '+c.name+' 被補上了「'+tag+'」—— 站長裁定「改了反而是錯的」');
  }
  assert.equal(bad.length,0,bad.join('\n      '));
});
// ⚠ 誠實聲明（第二輪 opus 審查抓到的 over-claim，已降級）：
//   「官方沒列」**不等於**「官方認為沒有」—— 官方 tag filter 只涵蓋部分卡包。實測：
//   MC 45 筆、SV8a 53 筆有涵蓋；**SVM / M5 / MJ / M-P-J 是 0 筆（完全沒涵蓋）**。
//   ⇒ 11 筆裡的 12142(SVM) / 19171,19189(M5) / 18373(MJ) / 19235(M-P-J) 這 5 筆，
//     「官方沒列」對它們是**結構性恆真、零資訊量**，不能拿來當「官方與站長一致」的證據。
//   ⇒ 真正有資訊量的是 MC 那 4 筆（16754/16755/16896/18272）＋ SV8a 的 12419：
//     那兩個卡包官方**有**涵蓋，而且官方明確列了**同名的另一種印刷**（17023 密勒頓【龍】有「未來」、
//     17022 故勒頓ex【龍】有「古代」）卻沒列這幾筆 ⇒ 這幾筆才是官方資料與站長裁定一致的實證。
T('8b. 尺 (a)「官方說有 ⇒ 我方必須有」不會點名這 11 筆（含卡包涵蓋率的誠實界定）',()=>{
  const TAGMAN=join(ROOT,'scripts/data/official-tag-manifest.json');
  assert.ok(existsSync(TAGMAN),'缺官方 tag 快照');
  const M=JSON.parse(readFileSync(TAGMAN,'utf8'));
  const listed=new Set(); for(const ids of Object.values(M.tags)) for(const i of ids) listed.add(String(i));
  assert.ok(listed.size>=200,'快照只有 '+listed.size+' 筆 —— 抓壞了，這條會變安慰劑');
  const hit=Object.keys(RULED_CORRECT_NO_TAG).filter(id=>listed.has(id));
  assert.equal(hit.length,0,'官方 filter 列了這幾筆 ⇒ 與站長裁定衝突，必須回報站長：'+hit.join(','));
  // ⭐ 真的去驗「MC 卡包有被官方涵蓋」（原本那行 mcListed 其實是 listed∩全卡池，與 MC 無關）
  const setOf=new Map(byFile.map(([f,c])=>[String(c.id),f.slice(0,-5)]));
  const cov=(code)=>[...listed].filter(id=>setOf.get(id)===code).length;
  assert.ok(cov('MC')>=40,'MC 只被官方涵蓋 '+cov('MC')+' 筆 —— 「MC 有涵蓋」這個論據不成立了');
  // 而 MC 的密勒頓／故勒頓ex：官方列了【龍】那一種印刷、沒列【雷】/【鬥】那一種
  assert.ok(listed.has('17023')&&listed.has('17022'),'官方快照裡的對照樣本不見了');
  for(const id of ['16754','16755','16896','18272'])
    assert.equal(setOf.get(id),'MC',id+' 不在 MC ⇒ 上面那段推論的前提變了');
  // 誠實標記：這幾個卡包官方零涵蓋 ⇒ 本條對那 5 筆沒有資訊量
  for(const code of ['SVM','M5','MJ','M-P-J'])
    assert.equal(cov(code),0,code+' 現在有官方涵蓋了（'+cov(code)+' 筆）⇒ 檔頭那段「零資訊量」的說明要改寫');
});
// ⚠ 判準抽成 checkPrintParityFlags(poolLike)，正對照才有辦法**餵壞資料進去真的跑判準**。
//   （第二輪 opus 審查實證：原本的 8d 只在 local 重做一次比對，把 8c 的判準改成恆假仍 43 全綠。）
const sigOf=c=>JSON.stringify([c.supertype,c.name,c.hp??null,c.pokemonType??null,
  (c.abilities??[]).map(a=>[a.name,a.effect]),
  (c.attacks??[]).map(a=>[a.name,a.cost??[],a.damage??null,a.effect??null]),c.rulesText??null]);
function checkPrintParityFlags(cards){
  const groups=new Map();
  for(const c of cards){const k=sigOf(c);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(c);}
  const multi=[...groups.values()].filter(g=>g.length>1).length;
  const flagged=[];
  for(const g of groups.values()){
    if(g.length<2) continue;
    const sets=new Set(g.map(c=>JSON.stringify([...(c.tags??[])].sort())));
    if(sets.size>1) for(const c of g) flagged.push(String(c.id));
  }
  return {multi,flagged};
}
T('8c. 尺 (b) 印刷平權**不會**點名這 11 筆（指紋含 HP/屬性/招式/rulesText ⇒ 同名不同卡不會誤配）',()=>{
  const r=checkPrintParityFlags(byFile.map(([,c])=>c));
  assert.ok(r.multi>=300,'指紋分組壞了（只有 '+r.multi+' 組多印刷），這條會變安慰劑');
  const hit=r.flagged.filter(id=>RULED_CORRECT_NO_TAG[id]);
  assert.equal(hit.length,0,'尺 (b) 點名了站長裁定為正確的卡：'+hit.join(','));
});
T('8d.【正對照・真 mutation】把密勒頓的兩種印刷硬湊成同指紋 ⇒ **8c 用的那支判準**必須抓到',()=>{
  const a=pool.get('16754'), b=pool.get('11224');
  assert.ok(a&&b,'樣本不在卡池');
  assert.ok(!(a.tags??[]).includes('未來')&&(b.tags??[]).includes('未來'),'樣本前提不成立');
  const forged={...a,hp:b.hp,pokemonType:b.pokemonType,attacks:b.attacks,abilities:b.abilities,rulesText:b.rulesText};
  assert.equal(sigOf(forged),sigOf(b),'偽造樣本沒有真的變成同指紋 ⇒ 這條正對照無效');
  const before=checkPrintParityFlags(byFile.map(([,c])=>c)).flagged;
  const after =checkPrintParityFlags(byFile.map(([,c])=>c.id===a.id?forged:c)).flagged;
  assert.ok(!before.includes('16754'),'乾淨卡池就已經點名 16754 ⇒ 前提不成立');
  assert.ok(after.includes('16754')&&after.includes('11224'),
    'mutation 沒被 8c 的判準抓到 ⇒ 8c 是恆真式（實得：'+JSON.stringify(after.slice(0,6))+'）');
});
T('8e.⭐ 尺 (c)「同名平權」必須已從 v6.205 守衛移除（HEAD 會在這裡紅）',()=>{
  const f=join(ROOT,'scripts/test-v6205-chilispice-dualtype-and-tag-parity.mjs');
  assert.ok(existsSync(f),'v6.205 守衛不見了');
  const src=readFileSync(f,'utf8');
  // ⚠ 先剝**字串字面量**再剝行註解 —— 否則 'https://…' 裡的 // 會把整行後面全當成註解砍掉，
  //   同一行後面的真碼就會隱形（第二輪 opus 審查實證的假綠洞）。
  const strip=s=>s.replace(/\/\*[\s\S]*?\*\//g,m=>m.replace(/[^\n]/g,' '))
                  .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g,m=>m.replace(/[^\n]/g,' '))
                  .replace(/\/\/.*$/gm,'')
                  .replace(/[​-‍﻿]/g,'');
  const code=strip(src);
  // ⚠ 正對照：先確認「剝註解」沒把整份檔剝空、而且判準抓得到真的實作
  assert.ok(code.includes('checkTagManifest'),'剝註解後連尺(a) 的判準都不見了 ⇒ 掃描器壞了');
  assert.ok(code.includes('checkParity'),'剝註解後連尺(b) 的判準都不見了 ⇒ 掃描器壞了');
  // ⚠ 能力邊界（誠實寫在這裡）：本條只認 checkNameParity / NAME_TAG_GAPS 兩個識別字，
  //   改名重寫一把同義的尺仍會全綠。它守的是「不要把 v6.205 那把尺原樣搬回來」。
  for(const needle of ['checkNameParity','NAME_TAG_GAPS'])
    assert.ok(!code.includes(needle),'尺 (c) 的「'+needle+'」還在（註解外的實作碼）⇒ 站長裁定沒落實');
  // 正對照①：判準確實會對「註解外的真碼」報紅
  assert.ok(strip("const NAME_TAG_GAPS = {};\n// NAME_TAG_GAPS in comment").includes('NAME_TAG_GAPS'),
    '判準對正樣本失效');
  // 正對照②：同一行先出現含「//」的字串再出現真碼 ⇒ 仍必須看得到真碼（原本的 strip 會漏）
  assert.ok(strip("const u='https://a.example/x'; const NAME_TAG_GAPS = {};").includes('NAME_TAG_GAPS'),
    'strip 把字串裡的 // 當成註解，同一行後面的真碼會隱形 ⇒ 假綠');
  // 正對照③：純註解不得誤判成紅
  assert.ok(!strip("// NAME_TAG_GAPS 只出現在註解\n/* checkNameParity */").includes('NAME_TAG_GAPS'),
    '註解裡的字串被誤判成實作 ⇒ 會逼人改註解');
});

console.log(`\nv6.206: ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
