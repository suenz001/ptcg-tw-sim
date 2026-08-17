// ⭐ v6.202 — passive 特性消費點沒接「特性是否被消除」中央閘（v6.196 那一族的第三批）
//
// 背景：特性可以被消除（傳說的熔岩洞＝雙方場上所有**進化**寶可夢的特性全消／火箭隊的監視塔＝
//   雙方場上所有【無】寶可夢的特性全消／鐵荊棘ex｜初始化＝雙方「擁有規則的寶可夢」全消／
//   招式版暗夜羽擊 abilityNullifiedThisTurn／passive 振翼髮｜暗夜羽擊／海兔獸｜黏著束縛）。
//   中央述詞 isAbilityHolderEffective / hasEffectiveAbilityByInst 早就寫好，
//   但**每一個讀 passive 特性的消費點都要自己去問它** —— 這一族已經三度出包
//   （v6.196 太古防壁玩家回報、v6.201 ACE消弭／濕氣）。本版清掉「不必改函式簽名」的那組。
//
// 本檔四件事：
//   ①卡面逐字錨（含下限斷言，卡池抓不到卡要紅而不是靜默全綠）
//   ②行為端：每個修好的消費點 ×（特性被消除 ⇒ 效果失效｜特性正常 ⇒ 仍生效＝正對照）
//   ③hasAbilityOnBench 的**刻意不加 gate** 例外未被破壞（黏著束縛偵測走它，加了會無窮遞迴）
//   ④枚舉守衛：全站 `abilities…name === '…'` 消費點凍結表 —— 新增/搬動的消費點若沒接閘
//     且沒進豁免表就 FAIL（含掃描器自我驗證正對照 + 下限斷言）
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.x6202-s.js'),E=join(ROOT,'.x6202-e.ts'),O=join(ROOT,'.x6202-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O])try{unlinkSync(p)}catch{}});
writeFileSync(S,'export const base="";');
writeFileSync(E,
  "export { applyAction, getUsableAbilities, getEvolvableTargets } from './src/lib/game/engine';\n"
+ "export { hasEffectiveAbilityByInst } from './src/lib/game/defense';\n"
+ "export { hasOakEye, isAbilityBlockedByOakEye, hasMultiToolRelay, reconcileMultiToolRelay,\n"
+ "         MOVE_DAMAGE_COUNTER_ABILITIES, tryPromptPromoteActive, getAbilityFn } from './src/lib/game/effects/_shared';\n"
+ "export { hasFairyZoneField } from './src/lib/game/effects';\n"
+ "export { curlWallReduce } from './src/lib/game/effects/cards/v2999_g3_wave1';\n"
+ "export { hasBroadFortressOnActive, isImmuneToOppSupporter } from './src/lib/game/effects/cards/v3080_deferred_wave_c';\n"
+ "export { isAbilityHolderEffective, isAbilityNullifiedBySticky } from './src/lib/game/effects/cards/v3001_g3_wave3';\n"
+ "export { applyAttackerActiveDamageBonuses } from './src/lib/game/effects';\n"
+ "import './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const mod=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const ab=n=>c=>c.abilities?.some(a=>a.name===n);
const findId=(name,pred)=>{for(const [id,c] of pool) if(c.name===name && (!pred||pred(c))) return id; return null;};

let pass=0,fail=0;const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};
let _n=0;
const I=(id,extra={})=>({iid:'i'+(++_n),cardId:String(id),damage:0,energyAttached:[],extraTools:[],...extra});
const ST=(p0,p1,extra={})=>({phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,
  isFirstTurn:false,log:[],pendingSelection:null,setupDone:[true,true],
  players:[{name:'A',active:null,bench:[],hand:[],deck:[],discard:[],prizes:[],...p0},
           {name:'B',active:null,bench:[],hand:[],deck:[],discard:[],prizes:[],...p1}],...extra});

// ── 消除來源 ────────────────────────────────────────────────────────────────
const CAVE   = findId('傳說的熔岩洞');        // 進化寶可夢特性全消
const WATCH  = findId('火箭隊的監視塔');      // 【無】寶可夢特性全消
const IRONTH = findId('鐵荊棘ex', ab('初始化'));
// ── 本版修好的消費點所需卡 ─────────────────────────────────────────────────
const FEST   = findId('祭典會場');
const CATER  = findId('裹蜜蟲', ab('祭典樂舞'));   // Stage1
const PAN    = findId('啪咚猴', ab('衝衝鼓'));     // Stage1（備戰）
const EEVEE  = findId('伊布',  ab('提升進化'));    // Basic / Colorless
const LEAFEON= findId('葉伊布', c=>c.evolvesFrom==='伊布' && !c.abilities);
const AMPH   = findId('電龍',  ab('同步脈衝'));    // Stage2
const OAK    = findId('探探鼠', ab('監視之眼'));   // Basic / Colorless
const APE    = findId('願增猿', ab('腎上腺腦力'));
const ROTOM  = findId('洛托姆ex', ab('多重轉接')); // Basic / Lightning / ex
const BUFF   = findId('爆炸頭水牛', ab('捲牆'));   // Basic / Colorless
const RHYPER = findId('超甲狂犀', ab('廣域堡壘')); // Stage2
const SHELL  = findId('海兔獸', ab('黏著束縛'));   // Stage1（備戰）
const DARKE  = findId('基本【惡】能量');
const LIGHTE = findId('基本【雷】能量');
const GRASSE = findId('基本【草】能量');
const PSYE   = findId('基本【超】能量');
const WATERE = findId('基本【水】能量');
const FILLER = findId('咕咕');                     // 中性 Basic 當對手/填充
// ── 子代理審查補抓的第二批（多行 for-of / registry map 查表，原掃描器看不到）──
const MOONS  = findId('振翼髮', ab('暗夜羽擊'));    // passive 特性消除來源
const LATIAS = findId('超級拉帝亞斯ex');            // 上場 → 觸發備戰持有者的潔淨支援
const LATIOS = findId('拉帝歐斯', ab('潔淨支援'));  // Basic / Dragon / 非規則（**備戰**持有者）
const BODO   = findId('波盪水ex', ab('藏青浪濤'));  // Basic + ex
const SCALE  = findId('渾厚鱗片');                  // 道具：【龍】持有者受草火水雷招式 -50
const DRAGON = findId('黏美龍');                    // 【龍】、無弱點
const CRAB   = findId('岩殿居蟹', ab('結實'));      // Stage1（PASSIVE_PREVENT_KO）
const CLEF   = findId('莉莉艾的皮皮ex', ab('妖精領域')); // Basic + ex
const GENG   = findId('耿鬼ex', ab('侵蝕詛咒'));    // Stage2 + ex
const OLIVA  = findId('奧利瓦ex', c=>c.attacks?.some(a=>a.name==='油之機關槍')); // Stage2 / Grass
const SKIRT  = findId('裙兒小姐', ab('大晴天'));    // Stage1 / Grass（PASSIVE_ATTACK_BONUS）

// ══════════════ ① 卡面逐字錨 ══════════════
T('0a. 下限斷言：本檔依賴的每一張卡都抓得到（抓不到＝安慰劑綠燈）',()=>{
  const need={CAVE,WATCH,IRONTH,FEST,CATER,PAN,EEVEE,LEAFEON,AMPH,OAK,APE,ROTOM,BUFF,RHYPER,SHELL,DARKE,LIGHTE,GRASSE,PSYE,WATERE,FILLER,
    MOONS,LATIAS,LATIOS,BODO,SCALE,DRAGON,CRAB,CLEF,GENG,OLIVA,SKIRT};
  const miss=Object.entries(need).filter(([,v])=>!v).map(([k])=>k);
  assert.equal(miss.length,0,'抓不到：'+miss.join(','));
});
T('0b. 消除來源 rulesText 逐字（static/cards 台灣官方卡面）',()=>{
  assert.equal(pool.get(CAVE).rulesText,'雙方場上所有進化寶可夢的特性全部消除。');
  assert.equal(pool.get(WATCH).rulesText,'雙方場上所有【無】寶可夢的特性全部消除。');
  assert.equal(pool.get(IRONTH).abilities.find(a=>a.name==='初始化').effect,
    '只要這隻寶可夢在戰鬥場上，雙方場上「擁有規則的寶可夢」（「未來」寶可夢除外）的特性全部消除。');
});
T('0c. 持有者 stage / pokemonType 決定哪些消除來源打得到（本版每一張的可達性依據）',()=>{
  // 祭典樂舞（裹蜜蟲 Stage1）：⚠ 熔岩洞打不到 —— 祭典樂舞要「祭典會場」在場，
  //   兩張都是競技場卡、唯一場地槽 ⇒ 只有暗夜羽擊兩型（active）打得到。
  assert.equal(pool.get(CATER).stage,'Stage1');
  assert.equal(pool.get(CATER).abilities.find(a=>a.name==='祭典樂舞').effect,
    '若場上有「祭典會場」，則這隻寶可夢可使用持有的招式2次。（若對手的戰鬥寶可夢因第1次的招式而【昏厥】了，則在下一隻寶可夢放置後，使用第2次的招式。）');
  // 提升進化（伊布 Basic + Colorless）⇒ 火箭隊的監視塔打得到
  assert.equal(pool.get(EEVEE).stage,'Basic');
  assert.equal(pool.get(EEVEE).pokemonType,'Colorless');
  assert.equal(pool.get(EEVEE).abilities.find(a=>a.name==='提升進化').effect,
    '只要這隻寶可夢在戰鬥場上，就算在自己的最初回合或者剛使出的回合，也可進化。');
  // 同步脈衝（電龍 Stage2）⇒ 傳說的熔岩洞打得到
  assert.equal(pool.get(AMPH).stage,'Stage2');
  assert.equal(pool.get(AMPH).abilities.find(a=>a.name==='同步脈衝').effect,
    '若自己的手牌與對手的手牌張數相同，則這隻寶可夢使用的招式，對對手的戰鬥寶可夢造成的傷害「+80」點。');
  // 監視之眼（探探鼠 Basic + Colorless）／捲牆（爆炸頭水牛 Basic + Colorless）
  assert.equal(pool.get(OAK).stage,'Basic'); assert.equal(pool.get(OAK).pokemonType,'Colorless');
  assert.equal(pool.get(BUFF).stage,'Basic'); assert.equal(pool.get(BUFF).pokemonType,'Colorless');
  // 多重轉接（洛托姆ex＝擁有規則的寶可夢）⇒ 初始化打得到
  assert.equal(pool.get(ROTOM).subtype,'ex');
  assert.equal(pool.get(ROTOM).abilities.find(a=>a.name==='多重轉接').effect,
    '只要這隻寶可夢在場上，名稱中有「洛托姆」的自己的所有寶可夢，各自身上最多可附有2張「寶可夢道具」卡。（這個特性消除時，將身上多附的「寶可夢道具」卡丟棄。）');
  // 廣域堡壘（超甲狂犀 Stage2）⇒ 傳說的熔岩洞打得到
  assert.equal(pool.get(RHYPER).stage,'Stage2');
  assert.equal(pool.get(RHYPER).abilities.find(a=>a.name==='廣域堡壘').effect,
    '只要這隻寶可夢在戰鬥場上，對手從手牌使出支援者卡時，自己的所有寶可夢不會受到那個效果的影響。');
});

// ══════════════ ② 行為端：被消除 ⇒ 失效；正常 ⇒ 仍生效 ══════════════

// ── 祭典樂舞（engine hasFestivalDanceActive / _isFestivalDanceFirstAttack）──
const festAttack = nullified => {
  const bug=I(CATER,{energyAttached:[I(GRASSE)], ...(nullified?{abilityNullifiedThisTurn:true}:{})});
  let st=ST({active:bug,bench:[I(FILLER)],deck:[I(FILLER)]},
            {active:I(FILLER),bench:[I(FILLER)],deck:[I(FILLER)]},{activeStadium:I(FEST)});
  return mod.applyAction(st,{type:'ATTACK',attackIndex:0,actorIdx:0},pool);
};
T('1a. 祭典樂舞【正對照】特性正常 ⇒ 打完第1次後真的開出「第2次招式」pending',()=>{
  const s=festAttack(false);
  assert.ok(s.festivalDancePendingSecondAttack,'應該要有第2次招式 pending');
  assert.equal(s.festivalDancePendingSecondAttack.idx,0);
});
T('1b. 祭典樂舞：特性被招式版暗夜羽擊消除 ⇒ 沒有第2次招式',()=>{
  const s=festAttack(true);
  assert.ok(!s.festivalDancePendingSecondAttack,'特性被消除卻還是給了第2次招式');
  assert.equal(!!s.festivalDanceUsedThisTurn?.[0],false);
});

// ── 祭典樂舞（effects.ts _isFestivalDanceFirstAttackLocal：首擊不消耗一次性旗標）──
const festBonusConsume = nullified => {
  const bug=I(CATER,{energyAttached:[I(GRASSE)],damageBonusThisTurn:50,
    ...(nullified?{abilityNullifiedThisTurn:true}:{})});
  const st=ST({active:bug},{active:I(FILLER)},{activeStadium:I(FEST)});
  const r=mod.applyAttackerActiveDamageBonuses(st,0,100,pool);
  return r.state.players[0].active.damageBonusThisTurn;
};
T('2a. 祭典樂舞（effects 那份）【正對照】特性正常＝首擊 ⇒ 回合加傷旗標不被消耗',()=>{
  assert.equal(festBonusConsume(false),50,'首擊不該消耗 damageBonusThisTurn');
});
T('2b. 祭典樂舞（effects 那份）：特性被消除 ⇒ 不算首擊，旗標照常消耗',()=>{
  assert.equal(festBonusConsume(true),undefined,'特性被消除卻仍當成祭典樂舞首擊而保留旗標');
});

// ── 衝衝鼓（跨隻讀戰鬥位的祭典樂舞；判定端 getUsableAbilities + 動作端 USE_ABILITY）──
const drum = nullified => {
  const bug=I(CATER, nullified?{abilityNullifiedThisTurn:true}:{});
  const pan=I(PAN);
  const st=ST({active:bug,bench:[pan],deck:[I(FILLER),I(FILLER)]},{active:I(FILLER)});
  const idx=pool.get(PAN).abilities.findIndex(a=>a.name==='衝衝鼓');
  const usable=mod.getUsableAbilities(st,pool).filter(u=>u.abilityName==='衝衝鼓').length;
  const after=mod.applyAction(st,{type:'USE_ABILITY',iid:pan.iid,abilityIndex:idx,actorIdx:0},pool);
  return {usable,opened:!!after.pendingSelection};
};
T('3a. 衝衝鼓【正對照】戰鬥位祭典樂舞正常 ⇒ 判定端亮 + 動作端真的開 picker',()=>{
  const r=drum(false); assert.equal(r.usable,1); assert.equal(r.opened,true);
});
T('3b. 衝衝鼓：戰鬥位祭典樂舞被消除 ⇒ 判定端不亮、動作端也不執行（兩端同 commit）',()=>{
  const r=drum(true); assert.equal(r.usable,0,'判定端仍亮'); assert.equal(r.opened,false,'動作端仍執行');
});

// ── 提升進化（EVOLVE handler + getEvolvableTargets UI 鏡射）──
const pushEvo = stadium => {
  const ee=I(EEVEE,{justPlaced:true}); const leaf=I(LEAFEON);
  const st=ST({active:ee,hand:[leaf],deck:[I(FILLER)]},{active:I(FILLER)},
    stadium?{activeStadium:I(stadium)}:{});
  const ui=mod.getEvolvableTargets(st,pool).some(r=>r.fromIid===ee.iid);
  const after=mod.applyAction(st,{type:'EVOLVE',fromIid:ee.iid,toIid:leaf.iid,actorIdx:0},pool);
  return {ui, done: after.players[0].active?.cardId===String(LEAFEON)};
};
T('4a. 提升進化【正對照】無競技場 ⇒ 剛使出的伊布 UI 亮 + 真的能進化',()=>{
  const r=pushEvo(null); assert.equal(r.ui,true); assert.equal(r.done,true);
});
T('4b. 提升進化：火箭隊的監視塔（伊布=【無】）⇒ UI 不亮、EVOLVE 也被擋',()=>{
  const r=pushEvo(WATCH); assert.equal(r.ui,false,'UI 仍亮'); assert.equal(r.done,false,'仍能進化');
});

// ── 同步脈衝（電龍 Stage2 ＋ 傳說的熔岩洞）──
const pulse = stadium => {
  const dr=I(AMPH,{energyAttached:[I(LIGHTE),I(LIGHTE)]});
  const st=ST({active:dr,hand:[I(FILLER)],deck:[I(FILLER)]},
              {active:I(FILLER),hand:[I(FILLER)],deck:[I(FILLER)]},
              stadium?{activeStadium:I(stadium)}:{});
  const s=mod.applyAction(st,{type:'ATTACK',attackIndex:0,actorIdx:0},pool);
  return s.log.some(l=>/同步脈衝/.test(l.message));
};
T('5a. 同步脈衝【正對照】無競技場 + 雙方手牌張數相同 ⇒ +80 有生效',()=>{
  assert.equal(pulse(null),true,'正常盤面卻沒 +80，fixture 可能不成立');
});
T('5b. 同步脈衝：傳說的熔岩洞（電龍 Stage2＝進化寶可夢）⇒ +80 應失效',()=>{
  assert.equal(pulse(CAVE),false,'熔岩洞在場仍 +80');
});

// ── 監視之眼（_shared hasOakEye / isAbilityBlockedByOakEye；ai.ts 那份已收斂到中央）──
const oakeye = nullified => {
  const oak=I(OAK, nullified?{abilityNullifiedThisTurn:true}:{});
  const st=ST({active:I(FILLER)},{active:oak});
  return {has:mod.hasOakEye(st,pool),
          blocked:mod.isAbilityBlockedByOakEye(st,'腎上腺腦力',pool)};
};
T('6a. 監視之眼【正對照】特性正常 ⇒ 仍擋住「改放傷害指示物」',()=>{
  const r=oakeye(false); assert.equal(r.has,true); assert.equal(r.blocked,true);
});
T('6b. 監視之眼：特性被招式版暗夜羽擊消除 ⇒ 不再擋（原本只擋了監視塔一種來源）',()=>{
  const r=oakeye(true); assert.equal(r.has,false); assert.equal(r.blocked,false);
});
T('6c. 監視之眼：願增猿｜腎上腺腦力 行為端 —— 特性被消除後改放指示物恢復可用',()=>{
  const mk=nullified=>{
    const oak=I(OAK, nullified?{abilityNullifiedThisTurn:true}:{});
    const ape=I(APE,{damage:30,energyAttached:[I(DARKE)]});
    const st=ST({active:ape,bench:[]},{active:oak});
    const idx=pool.get(APE).abilities.findIndex(a=>a.name==='腎上腺腦力');
    const s=mod.applyAction(st,{type:'USE_ABILITY',iid:ape.iid,abilityIndex:idx,actorIdx:0},pool);
    return s.log.map(l=>l.message).join('\n');
  };
  assert.ok(/監視之眼/.test(mk(false)),'特性正常時應該被監視之眼擋下並 log');
  assert.ok(!/監視之眼/.test(mk(true)),'特性被消除後仍被監視之眼擋：'+mk(true));
});

// ── 多重轉接（洛托姆ex ex ＋ 對手鐵荊棘ex｜初始化）──
const relay = withIronThorns => {
  const tool={iid:'tool1',cardId:String(FILLER)};
  const rot=I(ROTOM,{extraTools:[tool]});
  const st=ST({active:rot},{active:I(withIronThorns?IRONTH:FILLER)});
  const s=mod.reconcileMultiToolRelay(st,pool);
  return {relay:mod.hasMultiToolRelay(st,0,pool), extra:s.players[0].active.extraTools.length,
          discarded:s.players[0].discard.length};
};
T('7a. 多重轉接【正對照】沒有消除來源 ⇒ 第2張道具留在場上',()=>{
  const r=relay(false); assert.equal(r.relay,true); assert.equal(r.extra,1); assert.equal(r.discarded,0);
});
T('7b. 多重轉接：對手戰鬥場鐵荊棘ex｜初始化（洛托姆ex＝規則寶可夢）⇒ 卡面「這個特性消除時，將身上多附的道具丟棄」真的執行',()=>{
  const r=relay(true); assert.equal(r.relay,false,'初始化在場仍判定多重轉接生效');
  assert.equal(r.extra,0,'多附的道具沒被丟棄'); assert.equal(r.discarded,1);
});

// ── 捲牆（爆炸頭水牛 ×2；active 那隻被消除時不得計入「有捲牆特性」）──
T('8a. 捲牆【正對照】兩隻爆炸頭水牛都正常 ⇒ 減傷 60',()=>{
  const b1=I(BUFF),b2=I(BUFF);
  const st=ST({active:b1,bench:[b2]},{active:I(FILLER)});
  assert.equal(mod.curlWallReduce(st,0,pool.get(BUFF),pool),60);
});
T('8b. 捲牆：唯一有捲牆特性的那隻在戰鬥場且被消除 ⇒ 減傷 0（數量仍 ≥2）',()=>{
  const noWall=findId('爆炸頭水牛', c=>!c.abilities?.some(a=>a.name==='捲牆'));
  assert.ok(noWall,'找不到「無捲牆的爆炸頭水牛印刷」（v5.614 的 fixture 前提）');
  const b1=I(BUFF,{abilityNullifiedThisTurn:true}),b2=I(noWall);
  const st=ST({active:b1,bench:[b2]},{active:I(FILLER)});
  assert.equal(mod.curlWallReduce(st,0,pool.get(BUFF),pool),0,'捲牆被消除卻仍減傷');
});
T('8c. 捲牆回歸：備戰那隻仍有生效的捲牆時 ⇒ 照樣 60（不可修過頭）',()=>{
  const b1=I(BUFF,{abilityNullifiedThisTurn:true}),b2=I(BUFF);
  const st=ST({active:b1,bench:[b2]},{active:I(FILLER)});
  assert.equal(mod.curlWallReduce(st,0,pool.get(BUFF),pool),60);
});

// ── 廣域堡壘（超甲狂犀 Stage2 ＋ 傳說的熔岩洞）──
const fortress = stadium => {
  const rhy=I(RHYPER); const benchMate=I(FILLER);
  const st=ST({active:rhy,bench:[benchMate]},{active:I(FILLER)},stadium?{activeStadium:I(stadium)}:{});
  return {onActive:mod.hasBroadFortressOnActive(st,0,pool),
          immune:mod.isImmuneToOppSupporter(st,0,benchMate,pool)};
};
T('9a. 廣域堡壘【正對照】無競技場 ⇒ 自方寶可夢對對手支援者免疫',()=>{
  const r=fortress(null); assert.equal(r.onActive,true); assert.equal(r.immune,true);
});
T('9b. 廣域堡壘：傳說的熔岩洞（超甲狂犀 Stage2）⇒ 免疫失效',()=>{
  const r=fortress(CAVE); assert.equal(r.onActive,false,'熔岩洞在場仍生效');
  assert.equal(r.immune,false);
});

// ══════════════ ③ hasAbilityOnBench 例外未被破壞 ══════════════
T('10a. 黏著束縛偵測（hasAbilityOnBench 無 gate 版）仍生效，且不會無窮遞迴',()=>{
  const shell=I(SHELL);              // 海兔獸 Stage1（在備戰）
  const victim=I(AMPH);              // 電龍 Stage2（在備戰）→ 應被黏著束縛消除
  const st=ST({active:I(FILLER),bench:[victim]},{active:I(FILLER),bench:[shell]});
  let blew=false;
  try { assert.equal(mod.isAbilityNullifiedBySticky(st,victim,pool.get(AMPH),true,pool),true); }
  catch(e){ if(/Maximum call stack/.test(String(e))) blew=true; throw e; }
  assert.equal(blew,false);
  assert.equal(mod.hasEffectiveAbilityByInst(st,0,victim,pool,'同步脈衝'),false,'備戰 Stage2 的特性應被黏著束縛消除');
});
T('10b. hasAbilityOnBench 靜態：它必須**維持沒有 gate**（加了會無窮遞迴，v6.196 刻意例外）',()=>{
  const src=readFileSync(join(ROOT,'src/lib/game/effects/cards/v3001_g3_wave3.ts'),'utf8');
  const i=src.indexOf('function hasAbilityOnBench(');
  assert.ok(i>0,'找不到 hasAbilityOnBench（anchor 失效）');
  const blk=src.slice(i, src.indexOf('\n}\n', i));
  assert.ok(blk.length<1200,'anchor 可能失效，切出來的區塊太大：'+blk.length);
  assert.ok(!/isAbilityHolderEffective|hasEffectiveAbilityByInst|_abilityHolderEffectiveFn/.test(blk),
    'hasAbilityOnBench 被加上 gate ⇒ 黏著束縛偵測會無窮遞迴');
});
T('10c. 正對照：10b 的判準抓得到違規（把 gate 塞進樣本要被抓到）',()=>{
  const bad='function hasAbilityOnBench(a){ return isAbilityHolderEffective(a); }';
  assert.ok(/isAbilityHolderEffective|hasEffectiveAbilityByInst|_abilityHolderEffectiveFn/.test(bad));
});

// ══════════════ ②-2 子代理審查補抓的第二批 ══════════════

// ── 12. 注入點 location 自動推導：潔淨支援的持有者在**備戰**（拉帝歐斯）──
//   BASE 的注入寫死 location='active' ⇒ 備戰持有者被誤套「對手戰鬥場振翼髮消除我方 active 特性」，
//   拉帝歐斯在備戰卻發不動潔淨支援。這一條是本版風險最高的 hunk 的唯一行為覆蓋。
const cleansing = oppMoonsenne => {
  const latias=I(LATIAS,{movedToActiveThisTurn:true});
  const latios=I(LATIOS,{energyAttached:[I(PSYE)]});
  const st=ST({active:latias,bench:[latios]},{active:I(oppMoonsenne?MOONS:FILLER)});
  const s=mod.tryPromptPromoteActive(st,0,pool);
  return !!s.pendingSelection;
};
T('12a. 潔淨支援【正對照】對手沒有振翼髮 ⇒ 備戰的拉帝歐斯照樣彈出使用提示',()=>{
  assert.equal(cleansing(false),true,'fixture 不成立：正常盤面就沒彈提示');
});
T('12b. 潔淨支援：對手戰鬥場有振翼髮 ⇒ 持有者在**備戰**，暗夜羽擊只消除 active，仍應彈提示',()=>{
  assert.equal(cleansing(true),true,
    '注入點把 location 寫死成 active ⇒ 備戰持有者被誤判成被暗夜羽擊消除');
});

// ── 13. lopunny 衝衝鼓 regA 動作端（繞過 engine 的 getUsableAbilities 中央閘直呼）──
//   engine.ts v6.181 的「不在可用清單就 no-op」會遮蔽 regA，直呼才驗得到縱深防禦那一層。
const drumRegA = nullified => {
  const bug=I(CATER, nullified?{abilityNullifiedThisTurn:true}:{});
  const pan=I(PAN);
  const st=ST({active:bug,bench:[pan],deck:[I(FILLER),I(FILLER)]},{active:I(FILLER)});
  const idx=pool.get(PAN).abilities.findIndex(a=>a.name==='衝衝鼓');
  const fn=mod.getAbilityFn('啪咚猴','衝衝鼓',idx);
  assert.ok(fn,'找不到啪咚猴｜衝衝鼓 的 regA');
  const s=fn(st,0,pool,pan);
  return {opened:!!s.pendingSelection, log:s.log.map(l=>l.message).join('\n')};
};
T('13a. 衝衝鼓 regA【正對照】直呼且戰鬥位祭典樂舞正常 ⇒ 真的開 deck-search',()=>{
  assert.equal(drumRegA(false).opened,true);
});
T('13b. 衝衝鼓 regA：直呼且戰鬥位祭典樂舞被消除 ⇒ 不執行（engine 那道閘之外的縱深防禦）',()=>{
  const r=drumRegA(true);
  assert.equal(r.opened,false,'regA 自己的 gate 沒擋住');
  assert.ok(/不是有效的祭典樂舞/.test(r.log),'log 不符：'+r.log);
});

// ── 14. engine `_isFestivalDanceFirstAttack`（首擊不消耗一次性旗標）行為端 ──
const festEngineFlag = nullified => {
  const bug=I(CATER,{energyAttached:[I(GRASSE)],damageBonusThisTurn:50,
    ...(nullified?{abilityNullifiedThisTurn:true}:{})});
  let st=ST({active:bug,bench:[I(FILLER)],deck:[I(FILLER)]},
            {active:I(FILLER),bench:[I(FILLER)],deck:[I(FILLER)]},{activeStadium:I(FEST)});
  const s=mod.applyAction(st,{type:'ATTACK',attackIndex:0,actorIdx:0},pool);
  return s.players[0].active?.damageBonusThisTurn;
};
T('14a. 祭典樂舞（engine 首擊判定）【正對照】特性正常 ⇒ 回合加傷旗標留給第2次招式',()=>{
  assert.equal(festEngineFlag(false),50);
});
T('14b. 祭典樂舞（engine 首擊判定）：特性被消除 ⇒ 不算首擊，旗標照常消耗',()=>{
  assert.equal(festEngineFlag(true),undefined);
});

// ── 15. 藏青浪濤（PASSIVE_ATTACKER_BUFF；波盪水ex Basic + ex）──
//   skipDefEffects=true ⇒ 不計算防守方身上的附加效果（渾厚鱗片 -50）。
const nagi = nullified => {
  const atk=I(BODO,{energyAttached:[I(WATERE),I(WATERE),I(WATERE)],
    ...(nullified?{abilityNullifiedThisTurn:true}:{})});
  const def=I(DRAGON,{toolAttached:{iid:'tl1',cardId:String(SCALE)}});
  const st=ST({active:atk},{active:def});
  const s=mod.applyAction(st,{type:'ATTACK',attackIndex:0,actorIdx:0},pool);
  return {dmg:s.players[1].active?.damage, scale:s.log.some(l=>/渾厚鱗片/.test(l.message))};
};
T('15a. 藏青浪濤【正對照】特性正常 ⇒ 防守方渾厚鱗片 -50 被跳過（skipDefEffects）',()=>{
  const r=nagi(false); assert.equal(r.scale,false,'渾厚鱗片不該觸發');
});
T('15b. 藏青浪濤：特性被消除 ⇒ 渾厚鱗片 -50 恢復生效（傷害變低）',()=>{
  const a=nagi(false), b=nagi(true);
  assert.equal(b.scale,true,'特性被消除後渾厚鱗片仍沒觸發');
  assert.ok(b.dmg < a.dmg, `被消除後傷害沒變低：${a.dmg} vs ${b.dmg}`);
});

// ── 16. PASSIVE_PREVENT_KO（岩殿居蟹｜結實 Stage1 ＋ 傳說的熔岩洞）──
const sturdy = stadium => {
  const crab=I(CRAB);                                   // 滿血
  const atk=I(AMPH,{energyAttached:[I(LIGHTE),I(LIGHTE)]}); // 電龍 閃光伏特 140
  const st=ST({active:atk,hand:[],deck:[I(FILLER)]},{active:crab,bench:[I(FILLER)],deck:[I(FILLER)]},
    stadium?{activeStadium:I(stadium)}:{});
  const s=mod.applyAction(st,{type:'ATTACK',attackIndex:0,actorIdx:0},pool);
  return s.log.some(l=>/結實/.test(l.message));
};
T('16a. 結實【正對照】無競技場 ⇒ 滿血的岩殿居蟹避免昏厥（留 10 HP）',()=>{
  assert.equal(sturdy(null),true,'fixture 不成立：正常盤面就沒觸發結實');
});
T('16b. 結實：傳說的熔岩洞（岩殿居蟹 Stage1＝進化寶可夢）⇒ 不再避免昏厥',()=>{
  assert.equal(sturdy(CAVE),false,'熔岩洞在場仍觸發結實');
});

// ── 17. 妖精領域（莉莉艾的皮皮ex Basic + ex；對手【龍】弱點改【超】）──
const fairy = nullified => {
  const clef=I(CLEF,{energyAttached:[I(PSYE),I(PSYE)],
    ...(nullified?{abilityNullifiedThisTurn:true}:{})});
  const st=ST({active:clef},{active:I(DRAGON)});
  return {field:mod.hasFairyZoneField(st,0,pool),
          dmg:mod.applyAction(st,{type:'ATTACK',attackIndex:0,actorIdx:0},pool).players[1].active?.damage};
};
T('17a. 妖精領域【正對照】特性正常 ⇒ 對手【龍】弱點改【超】、受【超】招式 ×2',()=>{
  const r=fairy(false); assert.equal(r.field,true);
});
T('17b. 妖精領域：特性被消除 ⇒ 弱點覆寫失效，傷害不再 ×2',()=>{
  const a=fairy(false), b=fairy(true);
  assert.equal(b.field,false,'特性被消除卻仍回報妖精領域在場');
  assert.ok(b.dmg < a.dmg, `弱點覆寫沒有失效：${a.dmg} vs ${b.dmg}`);
});

// ── 18. 侵蝕詛咒（耿鬼ex Stage2 + ex；對手從手牌附能 → 放 2 個指示物）──
const curse = stadium => {
  const me=I(FILLER); const e=I(PSYE);
  const geng=I(GENG);
  const st=ST({active:me,hand:[e],deck:[I(FILLER)]},{active:geng},
    stadium?{activeStadium:I(stadium)}:{});
  const s=mod.applyAction(st,{type:'ATTACH_ENERGY',energyIid:e.iid,targetIid:me.iid,actorIdx:0},pool);
  return s.players[0].active?.damage ?? 0;
};
T('18a. 侵蝕詛咒【正對照】無競技場 ⇒ 對手從手牌附能被放 2 個指示物（20 傷害）',()=>{
  assert.equal(curse(null),20,'fixture 不成立：正常盤面就沒放指示物');
});
T('18b. 侵蝕詛咒：傳說的熔岩洞（耿鬼ex Stage2）⇒ 不再放指示物',()=>{
  assert.equal(curse(CAVE),0,'熔岩洞在場仍放指示物');
});

// ── 19. mega_decks 的 PASSIVE_ATTACK_BONUS 第二份（奧利瓦ex｜油之機關槍 ＋ 裙兒小姐｜大晴天）──
const oilBuff = stadium => {
  const oliva=I(OLIVA,{energyAttached:[I(GRASSE)]});
  const foe=I(FILLER);
  const st=ST({active:oliva,bench:[I(SKIRT)],deck:[I(FILLER)]},
              {active:foe,bench:[],deck:[I(FILLER)]},
              stadium?{activeStadium:I(stadium)}:{});
  let s=mod.applyAction(st,{type:'ATTACK',attackIndex:0,actorIdx:0},pool);
  // 油之機關槍開 damage-distribute picker：6 次全部指到對手戰鬥位
  assert.ok(s.pendingSelection,'油之機關槍沒開 picker');
  s=mod.applyAction(s,{type:'RESOLVE_SELECTION',selectedIids:[foe.iid,foe.iid,foe.iid,foe.iid,foe.iid,foe.iid],actorIdx:0},pool);
  return s.log.map(l=>l.message).join('\n');
};
T('19a. 大晴天（multi-target 路徑）【正對照】無競技場 ⇒ 油之機關槍每個目標 +20',()=>{
  assert.ok(/\+20=/.test(oilBuff(null)),'fixture 不成立：正常盤面就沒 +20\n'+oilBuff(null));
});
T('19b. 大晴天：傳說的熔岩洞（裙兒小姐 Stage1）⇒ +20 失效（effects.ts 那份早就有閘，這份原本漂了）',()=>{
  assert.ok(!/\+20=/.test(oilBuff(CAVE)),'熔岩洞在場仍 +20\n'+oilBuff(CAVE));
});

// ══════════════ ④ 枚舉守衛：全站 passive 消費點凍結表 ══════════════
//  ⚠ 掃描器本身要先被驗證會不會漏（本 skill 的鐵律）。v6.202 第一版的掃描器有兩個
//    系統性假陰性，是子代理審查才抓到的，兩個都補在下面：
//    (i)  只掃「`abilities` 與 `.name === '…'` 在**同一行**」⇒ 多行 for-of
//         （`for (const a of card.abilities) { if (a.name === 'X') … }`）完全隱形
//         —— 妖精領域 / 藏隱 / 深度下潛 就是這樣溜過去的。改成「往上 6 行內出現 abilities」。
//    (ii) 完全沒掃 registry 查表（`PASSIVE_XXX.get(ab.name)`），那一族根本沒有 `.name === `
//         —— 藏青浪濤 / prevent-KO / 侵蝕詛咒 就是這樣溜過去的。補 pattern 2。
//  ⚠ 判準也放寬了一個**假陽性**：gate 用變數傳特性名（`gate(..., ab.name, ...)`）是合法寫法
//    （engine.ts selfAttackPreconditionBlock 就是），不得被判成沒接閘。
const GATE_RE=/(isAbilityHolderEffective|hasEffectiveAbilityByInst|_v6196HasEffAbilByInst|_abilityHolderEffectiveFn|isAbilityNullifiedByPassive|hasAbilityOnSide|hasAbilityOnActive|countEffectiveAbilityOnSide|hpAbilityEffective|abilityEffective)\s*\(/;
//  pattern 2 只收「key 是特性名」的 registry（tool/stadium/energy 的 map 不算）。
const ABILITY_REGISTRY_RE=/\b(PASSIVE_[A-Z0-9_]+|OPP_ENERGY_ATTACH_PASSIVE|DAMAGE_AMOUNT_DEPENDENT_IMMUNITY|ABILITY_COLORLESS_COST_ZERO|ABILITY_RETREAT_MOD|FREE_RETREAT_BASIC_ABILITY_NAMES)\s*\.\s*(?:get|has)\s*\(\s*([A-Za-z_$][\w$]*)\.name\s*\)/g;
const EXEMPT=new Map(Object.entries({
  // ── 不是「場上的 passive 特性」──────────────────────────────────────────
  'src/lib/game/effects.ts|全能靈魂':'判的是**手牌**裡的海豚俠ex（PLAY_BASIC marker），不在場上',
  'src/lib/game/engine.ts|瞬間爆發力':'判的是手牌／setup 階段的卡，不在場上',
  'src/lib/game/engine.ts|緊急迴轉':'ON_HAND_ACTIVATE：判的是**手牌**裡的卡',
  'src/lib/game/engine.ts|激動俯衝':'ON_HAND_ACTIVATE：判的是**手牌**裡的卡',
  'src/lib/game/effects/cards/m5_preview.ts|化隱':'數的是自己**棄牌區**的卡（抹茶旋濺/魂之末/悔念錨），特性消除只作用於「雙方場上」',
  // ── 根本不是特性名（同一行/鄰近行剛好有 abilities 而被掃到）──────────────
  'src/lib/game/effects/cards/v2999_g3_wave1.ts|驅勁能量 未來':'比對的是**能量卡名**（二重核心的條件），不是特性名',
  'src/lib/game/effects.ts|小嘴蝸':'比對的是**卡名**（刺激進化的 partner 條件），與同函式的「刺激進化」同一條待辦',
  'src/lib/game/engine.ts|PASSIVE_KO_RETALIATION':'只用來組 log 文案（光之翼擋下時列出被無效的特性名），不驅動任何效果',
  // ── 消除來源本身 ────────────────────────────────────────────────────────
  'src/lib/game/effects/cards/v3001_g3_wave3.ts|初始化':'消除來源本身（鐵荊棘ex），加 gate 會自我遞迴',
  'src/lib/game/effects/cards/v3001_g3_wave3.ts|黏著束縛':'消除來源本身；hasAbilityOnBench 刻意無 gate（v6.196 例外，加了會無窮遞迴）',
  // ── 已在上游／下游過閘 ──────────────────────────────────────────────────
  'src/lib/game/effects/cards/m6_wave8.ts|大洋增輝':'regA 內對**同一隻**的自我複核（同名卡陷阱防護）；USE_ABILITY 先過 getUsableAbilities → isAbilityHolderEffective',
  'src/lib/game/effects/cards/m6_wave8.ts|深海抽出':'同上：regA 對同一隻的自我複核，上游 getUsableAbilities 已過中央閘',
  'src/lib/game/effects.ts|懶怠個性':'v6.113 起「特性有沒有被消除」交給 engine selfAttackPreconditionBlock → isAbilityHolderEffective',
  'src/lib/game/effects.ts|皇帝之勢':'hasEffectShield 全 src **零呼叫端＝死碼**；live 路徑是 ATTACK_EFFECT_IMMUNITY self-ability，已過中央閘',
  'src/lib/game/effects/_shared.ts|繁茂':'_bloomEffectiveFn 未注入時的 fallback；live 一律走 effects.ts 注入的有 gate 版（hasBloomOnField）',
  'src/lib/game/ai.ts|繁茂':'AI 評分啟發式（日光轉移的搬能量價值），不影響規則結算',
  // ── 結構上不可達（查證過，硬改也做不出行為差異 ⇒ 不改）──────────────────
  'src/lib/game/engine.ts|化隱':'v6.201 查證：同支 isFrosmothCheckupTarget 首行先過 hasAnyEffectiveAbility ⇒ 化隱一被消除就先在那裡被踢掉。⚠ 前提是「持有者只有這一個特性」（現行 4 張都是單特性卡）；日後若出現「化隱＋另一個特性」的印刷，本推論失效，要回來重判',
  'src/lib/game/effects/cards/v2999_g3_wave1.ts|岩石宮殿':'大吾的小碎鑽 Basic/Psychic/非規則，卡面要求持有者「在備戰區」⇒ 現行 6 個消除來源沒有一個打得到（熔岩洞只打進化、監視塔只打【無】、初始化只打規則、暗夜羽擊只打 active、黏著束縛只打備戰 Stage2）',
  'src/lib/game/effects/cards/v3060_deferred_wave_b.ts|藏隱':'斯魔茶 Basic/Grass/非規則，卡面「只要這隻寶可夢在備戰區」⇒ 同岩石宮殿，6 個來源都打不到',
  'src/lib/game/effects/cards/v3060_deferred_wave_b.ts|深度下潛':'小霞的鯉魚王 Basic/Water/非規則，卡面同樣限備戰區 ⇒ 結構上不可達',
  // v6.203：虹色DNA 已改走 hasEffectiveAbilityByInst（canEvolveFromHandOnto），不再是字面量消費點 ⇒ 豁免條目刪除
  // ── 需要改函式簽名 ＋ 全部呼叫端（站長裁定後再做，v6.202 不動）────────────
  'src/lib/game/effects.ts|憨憨臉':'TODO：isConfusionImmune(inst,pool) 簽名沒有 state（6 呼叫端）',
  'src/lib/game/effects.ts|不眠':'TODO：isSleepImmune(inst,pool) 簽名沒有 state（5 呼叫端）',
  'src/lib/game/effects.ts|雙重屬性':'TODO：getAttackerEffectiveTypes(inst,card,pool) 簽名沒有 state（只 2 呼叫端）',
  'src/lib/game/effects.ts|小碎鑽':'同上（同一行的卡名比對）',
  'src/lib/game/effects/cards/v2999_g3_wave1.ts|二重核心':'TODO：hasIronTracksDualCore(inst,card,pool) 簽名沒有 state；與雙重屬性同一個呼叫端',
  'src/lib/game/effects/cards/v3060_deferred_wave_b.ts|緊張感':'TODO：isImmuneToOppTrainer(targetInst,pool) 簽名沒有 state',
  'src/lib/game/effects/cards/v3060_deferred_wave_b.ts|融合為雪':'同上',
  'src/lib/game/effects/cards/v3080_deferred_wave_c.ts|潛入記憶':'TODO：hasArchaeoglobinDiveMemory(player,pool) 收 PlayerState、沒有 state/ownerIdx',
  'src/lib/game/effects/cards/v3000_g3_wave2.ts|出道演出':'TODO：hasMeloettaExDebut(inst,pool) 簽名沒有 state',
  'src/lib/game/effects/_shared.ts|無限之影':'TODO：resolveInfiniteShadowKo(koInst,pool,eligible) 簽名沒有 state；且 KO 當下持有者是否仍在場需先裁定',
  'src/lib/game/effects.ts|潛者捕捉':'TODO：_dcSelfDiver 判的是「剛被 KO 的那一隻」，此刻已離場、算不出 location，需站長裁定',
  'src/lib/game/effects.ts|刺激進化':'TODO：hasShellinkEvolveBypass 有 state 但缺 holder inst（3 呼叫端全在 engine.ts，成本低）',
  'src/lib/game/effects.ts|PASSIVE_IMMUNITY':'TODO：passiveImmunityDamageBlock / passiveCoinImmunity 只收 targetCard（無 inst/ownerIdx）；已 inline 擋初始化＋監視塔，仍漏熔岩洞／暗夜羽擊兩型／黏著束縛。engine 主管線那份有接、這份（中央/狙擊/UI 預覽）沒接 ⇒ 兩份會漂',
  'src/lib/game/effects.ts|DAMAGE_AMOUNT_DEPENDENT_IMMUNITY':'同上，同一支 passiveImmunityDamageBlock',
  'src/lib/game/effects.ts|順滑大衣':'同上：passiveImmunityDamageBlock 內的擲幣型 skip，與 PASSIVE_IMMUNITY 同一條待辦',
}));
const walk=(d,out=[])=>{for(const f of readdirSync(d)){const p=join(d,f);const s=statSync(p);
  if(s.isDirectory())walk(p,out); else if(f.endsWith('.ts'))out.push(p);} return out;};
const stripComments=s=>s.replace(/\/\*[\s\S]*?\*\//g,m=>m.replace(/[^\n]/g,' '))
  .replace(/\/\/.*$/gm,'').replace(/[\u200b-\u200d\ufeff]/g,'');
const scanSites=(files)=>{
  const sites=[];
  for(const [rel,text] of files){
    const lines=stripComments(text).split('\n');
    const gatedNear=(i,needles)=>{
      for(let k=Math.max(0,i-8);k<Math.min(lines.length,i+9);k++){
        if(!GATE_RE.test(lines[k])) continue;
        if(needles.some(n=>lines[k].includes(n))) return true;
      }
      return false;
    };
    lines.forEach((ln,i)=>{
      // ⚠「往上 6 行內出現 abilities」＝ 涵蓋多行 for-of（v6.202 補的假陰性）
      const near=lines.slice(Math.max(0,i-6),i+1).join('\n');
      if(!/abilities/.test(near)) return;
      // pattern 1：字面量特性名
      for(const m of ln.matchAll(/([A-Za-z_$][\w$]*)\s*\??\s*\.\s*name\s*===\s*'([^']+)'/g)){
        const recv=m[1], A=m[2];
        sites.push({rel,ability:A,line:i+1,kind:'lit',
          gated:gatedNear(i,[`'${A}'`,`${recv}.name`])});
      }
      // pattern 2：registry 查表（key 是特性名、以變數傳入）
      for(const m of ln.matchAll(ABILITY_REGISTRY_RE)){
        const R=m[1], v=m[2];
        sites.push({rel,ability:R,line:i+1,kind:'reg',
          gated:gatedNear(i,[`${v}.name`,'(state','(s,','(st,','(newState','(workingState'])});
      }
    });
  }
  return sites;
};
const realFiles=walk(join(ROOT,'src/lib/game')).map(p=>[relative(ROOT,p).split('\\').join('/'),readFileSync(p,'utf8')]);
const sites=scanSites(realFiles);
T('20a. 掃描器下限：全站 passive 消費點掃到 ≥90 個（掃不到＝掃描器壞了）',()=>{
  assert.ok(sites.length>=90,'只掃到 '+sites.length+' 個');
});
T('20b. 掃描器下限：兩種 pattern 都要抓得到東西（少一種＝那一族又隱形了）',()=>{
  const lit=sites.filter(s=>s.kind==='lit').length, reg=sites.filter(s=>s.kind==='reg').length;
  assert.ok(lit>=55,'pattern1 只 '+lit); assert.ok(reg>=30,'pattern2(registry 查表) 只 '+reg);
});
T('20c. 掃描器下限：其中「已接中央閘」的 ≥55 個',()=>{
  const g=sites.filter(s=>s.gated).length;
  assert.ok(g>=55,'只有 '+g+' 個接了閘');
});
T('20d. 枚舉守衛：每個沒接閘的消費點都必須在豁免表內並附理由',()=>{
  const bad=sites.filter(s=>!s.gated && !EXEMPT.has(`${s.rel}|${s.ability}`))
    .map(s=>`${s.rel}:${s.line} 「${s.ability}」(${s.kind})`);
  assert.equal(bad.length,0,
    '新增/搬動了沒接特性消除閘的 passive 消費點 —— 請接上 hasEffectiveAbilityByInst，'
    +'或加進本檔 EXEMPT 表並寫清楚理由：\n  '+bad.join('\n  '));
});
T('20e. 豁免表不得有死條目（該條目已修好／卡已下架 ⇒ 應該把它從表裡刪掉）',()=>{
  const seen=new Set(sites.filter(s=>!s.gated).map(s=>`${s.rel}|${s.ability}`));
  const dead=[...EXEMPT.keys()].filter(k=>!seen.has(k));
  assert.equal(dead.length,0,'豁免表死條目：'+dead.join(', '));
});
T('20f. 掃描器自我驗證【正對照】：沒接閘的樣本必須被 20d 抓到',()=>{
  const sample=[['fake/x.ts',
    "function f(){ if (card.abilities?.some(a => a.name === '假特性ABC')) return true; }"]];
  const r=scanSites(sample);
  assert.equal(r.length,1,'掃描器沒掃到違規樣本'); assert.equal(r[0].gated,false);
  assert.ok(!EXEMPT.has('fake/x.ts|假特性ABC'));
});
T('20g. 掃描器自我驗證【多行 for-of】：v6.202 補的假陰性不得回歸',()=>{
  const bad=[['fake/m.ts',
    "for (const a of card.abilities) {\n  if (a.name === '假特性DEF') return true;\n}"]];
  const r=scanSites(bad);
  assert.equal(r.length,1,'多行 for-of 又隱形了（妖精領域/藏隱就是這樣漏的）');
  assert.equal(r[0].gated,false);
  const ok=[['fake/m2.ts',
    "for (const a of card.abilities) {\n  if (a.name === '假特性DEF') {\n"
    +"    if (!isAbilityHolderEffective(state, inst, card, idx, '假特性DEF', 'active', pool)) continue;\n    return true;\n  }\n}"]];
  const ro=scanSites(ok);
  assert.equal(ro.length,1,'合規樣本沒被掃到（判準測試本身失效）');
  assert.equal(ro[0].gated,true,'接了閘的多行寫法被誤報');
});
T('20h. 掃描器自我驗證【registry 查表】：PASSIVE_* map 查表要被掃到，接閘的不得誤報',()=>{
  const bad=[['fake/r.ts',
    "for (const ab of card.abilities) {\n  const fn = PASSIVE_PREVENT_KO.get(ab.name);\n  if (!fn) continue;\n  go();\n}"]];
  const rb=scanSites(bad);
  assert.equal(rb.length,1,'registry 查表沒被掃到（藏青浪濤/prevent-KO 就是這樣漏的）');
  assert.equal(rb[0].gated,false);
  const ok=[['fake/r2.ts',
    "for (const ab of card.abilities) {\n  const fn = PASSIVE_PREVENT_KO.get(ab.name);\n  if (!fn) continue;\n"
    +"  if (!isAbilityHolderEffective(state, inst, card, idx, ab.name, 'active', pool)) continue;\n  go();\n}"]];
  assert.equal(scanSites(ok)[0].gated,true,'接了閘的 registry 寫法被誤報');
});
T('20i. 掃描器自我驗證【gate 用變數傳特性名】：合法寫法不得被誤報（假陽性）',()=>{
  const sample=[['fake/v.ts',
    "for (const ab of card.abilities) {\n  if (ab.name === '假特性GHI') {\n"
    +"    if (!isAbilityHolderEffective(state, act, card, idx, ab.name, 'active', pool)) continue;\n    go();\n  }\n}"]];
  assert.equal(scanSites(sample)[0].gated,true,'gate 用 ab.name 傳的合法寫法被誤判成沒接閘');
});
T('20j. 掃描器自我驗證：註解裡的假樣本不得被算進來（剝註解）',()=>{
  const sample=[['fake/z.ts',
    "card.abilities\n// if (a.name === '註解裡的特性') return true;\n"
    +"/* a.name === '區塊註解特性' */\n"]];
  assert.equal(scanSites(sample).length,0,'註解沒被剝乾淨');
});
T('20k. 掃描器自我驗證：零寬字元不得讓特性名逐字比對靜默失效（v6.117 事故）',()=>{
  const sample=[['fake/w.ts',
    "if (card.abilities?.some(a => a.name === '零\u200b寬')) return true;"]];
  const r=scanSites(sample);
  assert.equal(r.length,1); assert.equal(r[0].ability,'零寬','零寬字元沒被剝掉：'+r[0].ability);
});

console.log(`\n=== v6202 passive-ability-gate: ${pass} PASS / ${fail} FAIL ===`);
if(fail) process.exit(1);
