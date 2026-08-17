// ⭐⭐⭐ v6.204 — passive 特性消費點沒接「特性是否被消除」中央閘：**改函式簽名**的那一組
//
// 背景：特性會被消除（【傳說的熔岩洞】＝進化寶可夢特性全消／【火箭隊的監視塔】＝【無】寶可夢
//   特性全消／鐵荊棘ex｜初始化＝擁有規則的寶可夢（「未來」除外）特性全消／招式版暗夜羽擊
//   abilityNullifiedThisTurn／passive 振翼髮｜暗夜羽擊＝對手戰鬥寶可夢特性全消／
//   海兔獸｜黏著束縛＝雙方備戰區【2階進化】特性全消）。中央述詞 isAbilityHolderEffective /
//   hasEffectiveAbilityByInst 早就寫好，但**每個消費點都要自己去問它**。
//   v6.202 清掉「不必改簽名」的那組；本版把 C 段（要改函式簽名＋所有呼叫端）**整段做完**。
//
// ⚠ 最優先的一項是「兩份免疫實作已經在漂」：engine.ts 主傷害管線（戰鬥位）v5.471 起就逐個
//   特性過 isAbilityHolderEffective，而 effects.ts 的 passiveImmunityDamageBlock /
//   passiveCoinImmunity（resolveBenchGuard／狙擊／多目標／UI 預覽共用）只手刻了
//   「初始化」＋「監視塔」兩個來源（擲幣那份連初始化都沒有）⇒ 同一張卡在兩條路徑上
//   對「特性還在不在」給出不同答案。這條直接影響傷害結算與勝負。
//
// 本檔五件事：
//   ① 卡面逐字錨（stage / pokemonType / subtype 逐一釘住 —— 那正是「哪些消除來源打得到它」的依據）
//      ＋ 下限斷言（卡池抓不到卡就紅，不做安慰劑綠燈）
//   ② 行為端逐項：特性被消除 ⇒ 效果失效；**且每一條都配正對照**（特性正常 ⇒ 仍生效）
//   ③ 差分實跑：舊述詞逐字轉錄自 BASE(201cdec9)，數千組盤面比對；
//      **沒有任何消除來源在場的盤面必須 0 mismatch**（證明沒有改過頭）
//   ④ hasAbilityOnBench 的**刻意無 gate 例外**未被破壞（黏著束縛偵測走它，加了會無窮遞迴）
//   ⑤ 靜態：兩份免疫實作不得再各自手刻消除來源；每個呼叫端都要真的傳場上實體
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.x6204-s.js'),E=join(ROOT,'.x6204-e.ts'),O=join(ROOT,'.x6204-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O])try{unlinkSync(p)}catch{}});
writeFileSync(S,'export const base="";');
writeFileSync(E,
  "export { applyAction, getEvolvableTargets } from './src/lib/game/engine';\n"
+ "export { resolveBenchGuard, passiveImmunityDamageBlock, passiveCoinImmunity,\n"
+ "         getAttackerEffectiveTypes, applyStatusToOppActive, applyStatusToSelfActive,\n"
+ "         dealAttackDamageToTarget, fireDefenderOnKO,\n"
+ "         PASSIVE_IMMUNITY, DAMAGE_AMOUNT_DEPENDENT_IMMUNITY } from './src/lib/game/effects';\n"
+ "export { isImmuneToOppTrainer } from './src/lib/game/effects/cards/v3060_deferred_wave_b';\n"
+ "export { hasArchaeoglobinDiveMemory, isImmuneToOppSupporter } from './src/lib/game/effects/cards/v3080_deferred_wave_c';\n"
+ "export { hasMeloettaExDebut } from './src/lib/game/effects/cards/v3000_g3_wave2';\n"
+ "export { isAbilityHolderEffective, isInitializeNullified, isAbilityNullifiedBySticky } from './src/lib/game/effects/cards/v3001_g3_wave3';\n"
+ "export { hasEffectiveAbilityByInst, canApplyEffectToTarget } from './src/lib/game/defense';\n"
+ "export { TRAINER_GUARDS } from './src/lib/game/effects/_shared';\n"
+ "import './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const mod=await import(pathToFileURL(O).href);

const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}

let pass=0,fail=0;const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};
let _n=0;
const I=(id,extra={})=>({iid:'i'+(++_n),cardId:String(id),damage:0,energyAttached:[],extraTools:[],...extra});
const ST=(p0,p1,extra={})=>({phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,
  isFirstTurn:false,log:[],pendingSelection:null,setupDone:[true,true],
  players:[{name:'A',active:null,bench:[],hand:[],deck:[],discard:[],prizes:[],...p0},
           {name:'B',active:null,bench:[],hand:[],deck:[],discard:[],prizes:[],...p1}],...extra});
const ab=n=>c=>c.abilities?.some(a=>a.name===n);
const findId=(name,pred)=>{for(const [id,c] of pool) if(c.name===name && (!pred||pred(c))) return id; return null;};

// ── 消除來源 ────────────────────────────────────────────────────────────────
const CAVE  = findId('傳說的熔岩洞');
const WATCH = findId('火箭隊的監視塔');
const IRON  = findId('鐵荊棘ex', ab('初始化'));
const MOON  = findId('振翼髮', ab('暗夜羽擊'));
const STICKY= findId('海兔獸', ab('黏著束縛'));
// ── 本版標的持有者 ──────────────────────────────────────────────────────────
const KABU  = findId('岩殿居蟹', ab('神秘石居'));
const OMA   = findId('肋骨海龜', ab('全能硬殼'));
const CINC  = findId('奇諾栗鼠ex', ab('順滑大衣'));
const MENAS = findId('美納斯ex', ab('璀璨鱗片'));
const KENA  = findId('小碎鑽', ab('雙重屬性'));
const TRACK = findId('鐵轍跡', ab('二重核心'));
const DRIVE = findId('驅勁能量 未來');
const SLOW  = findId('呆呆獸', ab('憨憨臉'));
const HOOT  = findId('咕咕', ab('不眠'));
const AXE   = findId('斧牙龍', ab('緊張感'));
const WHALE = findId('浩大鯨ex', ab('融合為雪'));
const COEL  = findId('古空棘魚', ab('潛入記憶'));
const MELO  = findId('美洛耶塔ex', ab('出道演出'));
const GENGAR= findId('耿鬼', ab('無限之影'));
const SHELL = findId('小嘴蝸', ab('刺激進化'));
const SHELM = findId('蓋蓋蟲', ab('刺激進化'));
const SHELL_EVO = (()=>{for(const [id,c] of pool) if(c.evolvesFrom==='小嘴蝸') return id; return null;})();
const DIVER = findId('獵斑魚', ab('潛者捕捉'));
const BWATER= findId('基本【水】能量');
const SPECIAL_E=(()=>{for(const [id,c] of pool) if(c.supertype==='Energy'&&c.subtype==='Special') return id; return null;})();
const EXATK =(()=>{for(const [id,c] of pool) if(c.subtype==='ex'&&c.stage==='Basic'&&!c.abilities) return id; return null;})();
// 對照用「無特性、非規則、非太晶、非進化」的基礎寶可夢（不做任何免疫）
const PLAIN =(()=>{for(const [id,c] of pool)
  if(c.supertype==='Pokemon'&&c.stage==='Basic'&&!c.abilities&&c.subtype==='Basic'&&!(c.tags??[]).length&&!c.evolvesFrom) return id;
  return null;})();
const TERA  =(()=>{for(const [id,c] of pool) if(c.supertype==='Pokemon'&&(c.tags??[]).includes('太晶')) return id; return null;})();

// ══════════════ ① 卡面逐字錨 ＋ 下限斷言 ══════════════
const NEED={CAVE,WATCH,IRON,MOON,STICKY,KABU,OMA,CINC,MENAS,KENA,TRACK,DRIVE,SLOW,HOOT,AXE,WHALE,
  COEL,MELO,GENGAR,SHELL,SHELM,SHELL_EVO,DIVER,BWATER,SPECIAL_E,EXATK,PLAIN,TERA};
T('0a. 掃描器下限：本檔依賴的 28 張卡全部抓得到（抓不到＝安慰劑綠燈）',()=>{
  const miss=Object.entries(NEED).filter(([,v])=>!v).map(([k])=>k);
  assert.equal(miss.length,0,'卡池找不到：'+miss.join(','));
  assert.ok(Object.keys(NEED).length>=28,'依賴卡張數下限');
});
T('0a-2. 對照卡 PLAIN 真的沒有任何特性、也不是規則/太晶/進化（否則整份對照組失去意義）',()=>{
  const c=pool.get(PLAIN);
  assert.ok(!c.abilities); assert.equal(c.subtype,'Basic'); assert.equal(c.stage,'Basic');
  assert.equal((c.tags??[]).length,0); assert.ok(!c.evolvesFrom);
});
// 「哪些消除來源打得到它」完全取決於 stage / pokemonType / subtype ⇒ 逐一釘死
const PIN=[
  ['岩殿居蟹',KABU,'Stage1','Grass',undefined],   ['肋骨海龜',OMA,'Stage2','Water',undefined],
  ['奇諾栗鼠ex',CINC,'Stage1','Colorless','ex'],  ['美納斯ex',MENAS,'Stage1','Water','ex'],
  ['小碎鑽',KENA,'Basic','Fighting',undefined],   ['鐵轍跡',TRACK,'Basic','Metal',undefined],
  ['呆呆獸',SLOW,'Basic','Psychic',undefined],    ['咕咕',HOOT,'Basic','Colorless',undefined],
  ['斧牙龍',AXE,'Stage1','Dragon',undefined],     ['浩大鯨ex',WHALE,'Stage1','Water','ex'],
  ['古空棘魚',COEL,'Basic','Fighting',undefined], ['美洛耶塔ex',MELO,'Basic','Psychic','ex'],
  ['耿鬼',GENGAR,'Stage2','Darkness',undefined],  ['小嘴蝸',SHELL,'Basic','Grass',undefined],
  ['蓋蓋蟲',SHELM,'Basic','Grass',undefined],     ['獵斑魚',DIVER,'Stage1','Water',undefined],
];
T('0b. 卡面錨：每個持有者的 stage / pokemonType / subtype 逐一釘住（16 張）',()=>{
  for(const [nm,id,stage,type,sub] of PIN){
    const c=pool.get(id);
    assert.equal(c.name,nm); assert.equal(c.stage,stage,nm+' stage'); assert.equal(c.pokemonType,type,nm+' type');
    if(sub) assert.equal(c.subtype,sub,nm+' subtype');
  }
  assert.equal(PIN.length,16);
});
T('0c. 卡面錨：鐵轍跡是 Basic 非規則寶可夢（⇒ 初始化打不到它，二重核心只能靠暗夜羽擊）',()=>{
  // ⚠ 這裡**不能**用「tags 含『未來』」當理由：真正讓初始化打不到它的是
  //   「它不是擁有規則的寶可夢」（isInitializeNullified 第一道就擋掉）——三張印刷都成立。
  //   ⭐ v6.205：原本的資料缺口（SV8a 11641／12405 沒有 tags 欄位）已補齊，
  //     所以下面那條從「至少一張缺 tag」反轉成「三張都要有」——**理由不變**，
  //     tag 只在「擁有規則的寶可夢」那一支上才影響裁定。
  const all=[...pool.values()].filter(c=>c.name==='鐵轍跡'&&c.abilities?.some(a=>a.name==='二重核心'));
  assert.ok(all.length>=3,'鐵轍跡（二重核心）印刷數下限，實得 '+all.length);
  for(const c of all){
    assert.equal(c.stage,'Basic'); assert.equal(c.subtype,'Basic'); assert.equal(c.pokemonType,'Metal');
    assert.ok(['H','I','J'].includes(c.regulationMark));
  }
  assert.ok(all.every(c=>(c.tags??[]).includes('未來')),
    '鐵轍跡三張印刷都應有「未來」tag（v6.205 補齊）：'+all.map(c=>c.id+'='+JSON.stringify(c.tags??[])).join(' / '));
});
T('0d. 卡面錨：五個消除來源的 rulesText / effect 逐字',()=>{
  assert.equal(pool.get(CAVE).rulesText,'雙方場上所有進化寶可夢的特性全部消除。');
  assert.equal(pool.get(WATCH).rulesText,'雙方場上所有【無】寶可夢的特性全部消除。');
  assert.equal(pool.get(IRON).abilities.find(a=>a.name==='初始化').effect,
    '只要這隻寶可夢在戰鬥場上，雙方場上「擁有規則的寶可夢」（「未來」寶可夢除外）的特性全部消除。');
  assert.equal(pool.get(MOON).abilities.find(a=>a.name==='暗夜羽擊').effect,
    '只要這隻寶可夢在戰鬥場上，對手的戰鬥寶可夢的特性（「暗夜羽擊」除外）全部消除。');
  assert.equal(pool.get(STICKY).abilities.find(a=>a.name==='黏著束縛').effect,
    '只要這隻寶可夢在備戰區，雙方的備戰區的【2階進化】寶可夢的特性全部消除。');
});
T('0e. 卡面錨：本版每個 passive 特性的 effect 逐字（特性讀 effect 不是 text）',()=>{
  const eff=(id,n)=>pool.get(id).abilities.find(a=>a.name===n).effect;
  assert.equal(eff(KABU,'神秘石居'),'這隻寶可夢不會受到對手的「寶可夢【ex】」招式的傷害。');
  assert.equal(eff(OMA,'全能硬殼'),'這隻寶可夢不會受到對手的身上附有特殊能量卡的寶可夢招式的傷害與效果的影響。');
  assert.equal(eff(CINC,'順滑大衣'),'這隻寶可夢受到招式的傷害時，自己擲1次硬幣。若為正面，則這隻寶可夢不會受到那個傷害。');
  assert.equal(eff(KENA,'雙重屬性'),'只要這隻寶可夢在場上，改為【鬥】與【超】2種屬性。');
  assert.equal(eff(TRACK,'二重核心'),'只要這隻寶可夢身上附有「驅勁能量 未來」，這隻寶可夢改為【鬥】與【鋼】2種屬性。');
  assert.equal(eff(SLOW,'憨憨臉'),'這隻寶可夢不會【混亂】。');
  assert.equal(eff(HOOT,'不眠'),'這隻寶可夢不會【睡眠】。');
  assert.equal(eff(AXE,'緊張感'),'對手從手牌使出物品卡或者支援者卡時，這隻寶可夢不會受到那個效果的影響。');
  assert.equal(eff(WHALE,'融合為雪'),'對手從手牌使出物品卡或者支援者卡時，這隻寶可夢不會受到那個效果的影響。');
  assert.equal(eff(COEL,'潛入記憶'),'只要這隻寶可夢在場上，自己的所有進化寶可夢，可使用進化前持有的所有招式。[需要有足夠使用招式的能量。]');
  assert.equal(eff(MELO,'出道演出'),'這隻寶可夢在先攻玩家的最初回合也可使用招式。');
  assert.equal(eff(GENGAR,'無限之影'),'這隻寶可夢受到對手的寶可夢招式的傷害而【昏厥】時，不丟棄這隻寶可夢，而是放回手牌。（寶可夢以外的卡全部丟棄。）');
  assert.equal(eff(SHELL,'刺激進化'),'若自己的場上有「蓋蓋蟲」，則這隻寶可夢就算在自己的最初回合或者剛使出的回合，也可進化。');
  assert.equal(eff(DIVER,'潛者捕捉'),'每次當自己的【水】寶可夢受到對手的寶可夢招式的傷害而【昏厥】時，可使用1次。【昏厥】的寶可夢身上附加的「基本【水】能量」卡不丟棄，而是全部放回手牌。');
});

// ══════════════ ② 行為端：消除 ⇒ 失效 / 正對照：正常 ⇒ 仍生效 ══════════════

// ── A. passiveImmunityDamageBlock（bench 路徑走 resolveBenchGuard）────────────
const benchGuard=(s,inst)=>mod.resolveBenchGuard(s,pool,0,pool.get(inst.cardId),'attack-damage',{targetInst:inst});
T('1a.〔核心 bug〕神秘石居（岩殿居蟹 Stage1）在備戰：熔岩洞在場 ⇒ 不再免疫 ex 招式傷害',()=>{
  const k=I(KABU); const s=ST({active:I(EXATK)},{active:I(PLAIN),bench:[k]},{activeStadium:I(CAVE)});
  assert.equal(benchGuard(s,k).blocked,false);
});
T('1b.【正對照】沒有熔岩洞 ⇒ 神秘石居照常免疫（不得改過頭）',()=>{
  const k=I(KABU); const s=ST({active:I(EXATK)},{active:I(PLAIN),bench:[k]});
  const r=benchGuard(s,k); assert.equal(r.blocked,true); assert.ok(/神秘石居/.test(r.reason));
});
T('1c. 全能硬殼（肋骨海龜 **Stage2**）在備戰：對手備戰的海兔獸｜黏著束縛 ⇒ 不再免疫',()=>{
  const o=I(OMA); const s=ST({active:I(PLAIN,{energyAttached:[I(SPECIAL_E)]})},{active:I(PLAIN),bench:[o,I(STICKY)]});
  assert.equal(benchGuard(s,o).blocked,false);
});
T('1d.【正對照】沒有海兔獸 ⇒ 全能硬殼照常免疫（攻擊方帶特殊能量）',()=>{
  const o=I(OMA); const s=ST({active:I(PLAIN,{energyAttached:[I(SPECIAL_E)]})},{active:I(PLAIN),bench:[o]});
  assert.equal(benchGuard(s,o).blocked,true);
});
T('1e.【正對照】攻擊方沒有特殊能量 ⇒ 全能硬殼本來就不成立（判準沒被一刀切）',()=>{
  const o=I(OMA); const s=ST({active:I(PLAIN)},{active:I(PLAIN),bench:[o]});
  assert.equal(benchGuard(s,o).blocked,false);
});
T('1f. 全能硬殼 ＋ 熔岩洞（Stage2 也是進化寶可夢）⇒ 不再免疫',()=>{
  const o=I(OMA); const s=ST({active:I(PLAIN,{energyAttached:[I(SPECIAL_E)]})},{active:I(PLAIN),bench:[o]},{activeStadium:I(CAVE)});
  assert.equal(benchGuard(s,o).blocked,false);
});
T('1g. 璀璨鱗片（美納斯ex Stage1+ex）：初始化 ⇒ 失效（⚠ 攻擊方**必須是太晶**，否則這條測不到東西）',()=>{
  // ⚠ 這裡踩過一次坑：把「鐵荊棘ex」放成攻擊方 ⇒ 攻擊方不是太晶，璀璨鱗片本來就不成立，
  //   兩邊都回 false，斷言變成恆真式。正確做法：攻擊方保持太晶，把鐵荊棘ex 放在**防守方戰鬥場**
  //   （初始化卡面「只要這隻寶可夢在戰鬥場上，**雙方**場上…」），美納斯ex 放防守方備戰。
  const m=I(MENAS); const s0=ST({active:I(TERA)},{active:I(PLAIN),bench:[m]});
  assert.equal(mod.passiveImmunityDamageBlock(s0,0,m,pool.get(MENAS),pool).blocked,true,'【正對照】乾淨盤面仍免疫');
  const m2=I(MENAS); const s1=ST({active:I(TERA)},{active:I(IRON),bench:[m2]});
  assert.equal(mod.passiveImmunityDamageBlock(s1,0,m2,pool.get(MENAS),pool).blocked,false,
    '初始化在場（美納斯ex 是規則寶可夢）⇒ 璀璨鱗片失效');
  const m3=I(MENAS); const s2=ST({active:I(TERA)},{active:I(PLAIN),bench:[m3]},{activeStadium:I(WATCH)});
  assert.equal(mod.passiveImmunityDamageBlock(s2,0,m3,pool.get(MENAS),pool).blocked,true,
    '【正對照】監視塔只消除【無】寶可夢，美納斯ex 是【水】⇒ 仍免疫');
});
// ── A-2. passiveCoinImmunity（擲幣型；奇諾栗鼠ex = Stage1 + ex +【無】⇒ 四種來源全打得到）
const coinImmuneRate=(s,inst)=>{let n=0;for(let i=0;i<80;i++){if(mod.passiveCoinImmunity(s,0,inst,pool.get(CINC),pool).immune)n++;}return n;};
T('2a.【正對照】乾淨盤面：順滑大衣照常擲幣，80 次裡必須有免疫也有不免疫',()=>{
  const c=I(CINC); const n=coinImmuneRate(ST({active:I(PLAIN)},{active:c}),c);
  assert.ok(n>0&&n<80,'擲幣型免疫應該有正反面，實得 '+n+'/80');
});
T('2b. 順滑大衣 ＋ 熔岩洞（Stage1 是進化寶可夢）⇒ 完全不免疫（0/80）',()=>{
  const c=I(CINC); assert.equal(coinImmuneRate(ST({active:I(PLAIN)},{active:c},{activeStadium:I(CAVE)}),c),0);
});
T('2c. 順滑大衣 ＋ 鐵荊棘ex｜初始化（ex＝規則寶可夢）⇒ 0/80（**這一份原本連初始化都沒查**）',()=>{
  const c=I(CINC); assert.equal(coinImmuneRate(ST({active:I(IRON)},{active:c}),c),0);
});
T('2d. 順滑大衣 ＋ passive 振翼髮｜暗夜羽擊 ⇒ 0/80',()=>{
  const c=I(CINC); assert.equal(coinImmuneRate(ST({active:I(MOON)},{active:c}),c),0);
});
T('2e. 順滑大衣 ＋ 監視塔（【無】）⇒ 0/80（BASE 已正確，回歸）',()=>{
  const c=I(CINC); assert.equal(coinImmuneRate(ST({active:I(PLAIN)},{active:c},{activeStadium:I(WATCH)}),c),0);
});

// ── B. 雙重屬性 / 二重核心 ────────────────────────────────────────────────
const types=(s,idx)=>mod.getAttackerEffectiveTypes(s,idx,s.players[idx].active,pool.get(s.players[idx].active.cardId),pool);
T('3a.【正對照】小碎鑽｜雙重屬性 乾淨盤面 ⇒ 【鬥】＋【超】',()=>{
  assert.deepEqual(types(ST({active:I(KENA)},{active:I(PLAIN)}),0),['Fighting','Psychic']);
});
T('3b. 雙重屬性 ＋ 對手 passive 振翼髮 ⇒ 只剩卡面本色【鬥】',()=>{
  assert.deepEqual(types(ST({active:I(KENA)},{active:I(MOON)}),0),['Fighting']);
});
T('3c. 雙重屬性 ＋ 招式版暗夜羽擊（abilityNullifiedThisTurn）⇒ 只剩【鬥】',()=>{
  assert.deepEqual(types(ST({active:I(KENA,{abilityNullifiedThisTurn:true})},{active:I(PLAIN)}),0),['Fighting']);
});
T('3d.【正對照】鐵轍跡｜二重核心（附驅勁能量 未來）乾淨盤面 ⇒【鬥】＋【鋼】',()=>{
  assert.deepEqual(types(ST({active:I(TRACK,{energyAttached:[I(DRIVE)]})},{active:I(PLAIN)}),0),['Fighting','Metal']);
});
T('3e. 二重核心 ＋ 振翼髮 ⇒ 只剩【鋼】',()=>{
  assert.deepEqual(types(ST({active:I(TRACK,{energyAttached:[I(DRIVE)]})},{active:I(MOON)}),0),['Metal']);
});
T('3f.【正對照】二重核心 ＋ 初始化：鐵轍跡非規則寶可夢 ⇒ 初始化打不到，仍是【鬥】＋【鋼】',()=>{
  assert.deepEqual(types(ST({active:I(TRACK,{energyAttached:[I(DRIVE)]})},{active:I(IRON)}),0),['Fighting','Metal']);
  // 逐印刷跑一次：SV8a 那兩張沒有「未來」tag，結論必須一樣（證明結論不是靠 tag 撐的）
  for(const c of [...pool.values()].filter(x=>x.name==='鐵轍跡'&&x.abilities?.some(a=>a.name==='二重核心'))){
    assert.deepEqual(types(ST({active:I(c.id,{energyAttached:[I(DRIVE)]})},{active:I(IRON)}),0),['Fighting','Metal'],
      '印刷 '+c.id+' 在初始化下應仍是雙屬性');
    assert.deepEqual(types(ST({active:I(c.id,{energyAttached:[I(DRIVE)]})},{active:I(MOON)}),0),['Metal'],
      '印刷 '+c.id+' 在振翼髮下應只剩【鋼】');
  }
});

// ── C. 憨憨臉 / 不眠 ──────────────────────────────────────────────────────
const oppStatus=(s,st)=>{const o=mod.applyStatusToOppActive(s,0,st,pool,{kind:'attack-effect'});
  const a=o.players[1].active; return a.status||a.secondaryStatus||a.tertiaryStatus||'none';};
T('4a.【正對照】呆呆獸｜憨憨臉 乾淨盤面 ⇒ 仍免疫【混亂】',()=>{
  assert.equal(oppStatus(ST({active:I(PLAIN)},{active:I(SLOW)}),'confused'),'none');
});
T('4b. 憨憨臉 ＋ 對手（我方）振翼髮 ⇒ 中【混亂】',()=>{
  assert.equal(oppStatus(ST({active:I(MOON)},{active:I(SLOW)}),'confused'),'confused');
});
T('4c.【正對照】咕咕｜不眠 乾淨盤面 ⇒ 仍免疫【睡眠】',()=>{
  assert.equal(oppStatus(ST({active:I(PLAIN)},{active:I(HOOT)}),'asleep'),'none');
});
T('4d. 不眠 ＋ 火箭隊的監視塔（咕咕是【無】）⇒ 中【睡眠】',()=>{
  assert.equal(oppStatus(ST({active:I(PLAIN)},{active:I(HOOT)},{activeStadium:I(WATCH)}),'asleep'),'asleep');
});
T('4e. 自身施加狀態（applyStatusToSelfActive）同樣接上閘：振翼髮在對面 ⇒ 自身混亂成立',()=>{
  const clean=mod.applyStatusToSelfActive(ST({active:I(SLOW)},{active:I(PLAIN)}),0,'confused',pool,{});
  assert.equal(clean.players[0].active.status??'none','none','【正對照】乾淨盤面仍免疫');
  const gone=mod.applyStatusToSelfActive(ST({active:I(SLOW)},{active:I(MOON)}),0,'confused',pool,{});
  assert.equal(gone.players[0].active.status,'confused');
});

// ── D. 緊張感 / 融合為雪 ──────────────────────────────────────────────────
T('5a.【正對照】斧牙龍｜緊張感 在備戰 乾淨盤面 ⇒ 免疫對手物品',()=>{
  const a=I(AXE); assert.equal(mod.isImmuneToOppTrainer(ST({active:I(PLAIN)},{active:I(PLAIN),bench:[a]}),1,a,pool),true);
});
T('5b. 緊張感（斧牙龍 Stage1）＋ 熔岩洞 ⇒ 不再免疫',()=>{
  const a=I(AXE); assert.equal(mod.isImmuneToOppTrainer(ST({active:I(PLAIN)},{active:I(PLAIN),bench:[a]},{activeStadium:I(CAVE)}),1,a,pool),false);
});
T('5c. 融合為雪（浩大鯨ex Stage1+ex）＋ 初始化 ⇒ 不再免疫；正對照乾淨盤面仍免疫',()=>{
  const w=I(WHALE); assert.equal(mod.isImmuneToOppTrainer(ST({active:I(PLAIN)},{active:I(PLAIN),bench:[w]}),1,w,pool),true);
  const w2=I(WHALE); assert.equal(mod.isImmuneToOppTrainer(ST({active:I(IRON)},{active:I(PLAIN),bench:[w2]}),1,w2,pool),false);
});
T('5d. 上游 isImmuneToOppSupporter 一併受惠（同一支述詞）',()=>{
  const a=I(AXE);
  assert.equal(mod.isImmuneToOppSupporter(ST({active:I(PLAIN)},{active:I(PLAIN),bench:[a]}),1,a,pool),true);
  const a2=I(AXE);
  assert.equal(mod.isImmuneToOppSupporter(ST({active:I(PLAIN)},{active:I(PLAIN),bench:[a2]},{activeStadium:I(CAVE)}),1,a2,pool),false);
});
T('5e.〔接線覆蓋〕真的呼叫「頂尖捕捉器」的 regG —— 熔岩洞在場 ⇒ 從不可使用變成可使用',()=>{
  // ⚠ 這一條的重點是**接線**：items_misc 的 regG 必須把「對手」的 idx 傳給 isImmuneToOppTrainer。
  //   傳成自己那一側時仍會全綠（子代理第二輪抓到的零覆蓋洞），所以這裡走真正的 TRAINER_GUARDS。
  const g=mod.TRAINER_GUARDS.get('頂尖捕捉器');
  assert.ok(typeof g==='function','找不到頂尖捕捉器的 regG（anchor 失效）');
  const mkS=(stad)=>ST({active:I(PLAIN)},{active:I(PLAIN),bench:[I(AXE)]},stad?{activeStadium:I(stad)}:{});
  assert.equal(g(mkS(null),0,pool),false,'【正對照】緊張感有效 ⇒ 對手備戰沒有可呼叫目標 ⇒ 不可使用');
  assert.equal(g(mkS(CAVE),0,pool),true,'熔岩洞消除緊張感 ⇒ 變成可使用');
  const mine=ST({active:I(PLAIN),bench:[I(AXE)]},{active:I(PLAIN),bench:[I(AXE)]});
  assert.equal(g(mine,0,pool),false,'看的必須是對手側（把 idx 傳錯這條會紅）');
});
T('5h.〔接線覆蓋〕「除蟲噴霧」regG 打的是對手**戰鬥場** —— ownerIdx 傳錯會讓振翼髮判不到',()=>{
  // ⚠ 備戰目標那三張（頂尖捕捉器/寶可夢捕捉器/反擊捕捉器）就算 ownerIdx 傳錯也測不出差異：
  //   斧牙龍/浩大鯨ex 可達的來源（熔岩洞・初始化）都與持有者屬於哪一方無關，
  //   而備戰 inst 永遠推不出 'active'。**戰鬥場**目標才驗得到，所以用除蟲噴霧補這個洞。
  const g=mod.TRAINER_GUARDS.get('除蟲噴霧');
  assert.ok(typeof g==='function','找不到除蟲噴霧的 regG（anchor 失效）');
  const mk=(myActive)=>ST({active:I(myActive)},{active:I(WHALE),bench:[I(PLAIN)]});
  assert.equal(g(mk(PLAIN),0,pool),false,'【正對照】融合為雪有效 ⇒ 對手戰鬥寶可夢不受物品 ⇒ 不可使用');
  assert.equal(g(mk(MOON),0,pool),true,'我方戰鬥場振翼髮 ⇒ 對手戰鬥場的融合為雪被消除 ⇒ 可使用');
  assert.equal(g(ST({active:I(PLAIN)},{active:I(PLAIN),bench:[I(PLAIN)]}),0,pool),true,
    '【正對照】對手戰鬥場沒有這兩個特性時本來就可以使用');
});
T('5f.〔接線覆蓋〕location 必須由 inst 推導：斧牙龍在**備戰** ＋ 對手振翼髮 ⇒ 仍免疫',()=>{
  // 暗夜羽擊只作用於戰鬥場。若把 location 硬寫成 'active'，備戰的緊張感會被誤消除（改過頭）。
  const a=I(AXE);
  assert.equal(mod.isImmuneToOppTrainer(ST({active:I(PLAIN)},{active:I(PLAIN),bench:[a]}),1,a,pool),true);
  const a2=I(AXE);
  assert.equal(mod.isImmuneToOppTrainer(ST({active:I(MOON)},{active:I(PLAIN),bench:[a2]}),1,a2,pool),true,
    '備戰的斧牙龍不該被對手戰鬥場的振翼髮消除');
  const a3=I(AXE);
  assert.equal(mod.isImmuneToOppTrainer(ST({active:I(MOON)},{active:a3}),1,a3,pool),false,
    '**戰鬥場**的斧牙龍才會被振翼髮消除');
});
T('5g.〔接線覆蓋〕defense.canApplyEffectToTarget 必須把「這一隻」傳給備戰免疫判定',()=>{
  // 傳錯 inst（例如傳成攻擊方 active）時，神秘石居會整個失效卻沒有任何行為端斷言會紅
  //   —— 這一條就是補那個洞：同一個盤面上兩隻備戰，只有岩殿居蟹該免疫。
  const kabu=I(KABU), plain=I(PLAIN);
  const s=ST({active:I(EXATK)},{active:I(PLAIN),bench:[plain,kabu]});
  assert.equal(mod.canApplyEffectToTarget(s,0,kabu,pool.get(KABU),'attack-damage',pool,{isBench:true}).blocked,true,
    '岩殿居蟹（神秘石居 vs ex 攻擊者）應被擋');
  assert.equal(mod.canApplyEffectToTarget(s,0,plain,pool.get(PLAIN),'attack-damage',pool,{isBench:true}).blocked,false,
    '【正對照】同一盤面上沒有特性的那一隻不得被擋');
  const s2=ST({active:I(EXATK)},{active:I(PLAIN),bench:[plain,kabu]},{activeStadium:I(CAVE)});
  assert.equal(mod.canApplyEffectToTarget(s2,0,kabu,pool.get(KABU),'attack-damage',pool,{isBench:true}).blocked,false,
    '熔岩洞在場 ⇒ 神秘石居失效');
});

// ── E. 潛入記憶 ──────────────────────────────────────────────────────────
T('6a.【正對照】古空棘魚在戰鬥場 乾淨盤面 ⇒ 潛入記憶生效',()=>{
  assert.equal(mod.hasArchaeoglobinDiveMemory(ST({active:I(COEL)},{active:I(PLAIN)}),0,pool),true);
});
T('6b. 古空棘魚在戰鬥場 ＋ 對手振翼髮 ⇒ 失效（BASE 只擋招式版旗標，漏 passive 振翼髮）',()=>{
  assert.equal(mod.hasArchaeoglobinDiveMemory(ST({active:I(COEL)},{active:I(MOON)}),0,pool),false);
});
T('6c.【正對照】古空棘魚在**備戰** ＋ 對手振翼髮 ⇒ 仍生效（暗夜羽擊只打戰鬥位）',()=>{
  assert.equal(mod.hasArchaeoglobinDiveMemory(ST({active:I(PLAIN),bench:[I(COEL)]},{active:I(MOON)}),0,pool),true);
});

// ── F. 出道演出 ──────────────────────────────────────────────────────────
T('7a.【正對照】美洛耶塔ex 乾淨盤面 ⇒ 先攻第一回合可攻擊',()=>{
  assert.equal(mod.hasMeloettaExDebut(ST({active:I(MELO)},{active:I(PLAIN)},{isFirstTurn:true}),0,pool),true);
});
T('7b. 出道演出 ＋ 初始化（美洛耶塔ex 是 ex）⇒ 失效',()=>{
  assert.equal(mod.hasMeloettaExDebut(ST({active:I(MELO)},{active:I(IRON)},{isFirstTurn:true}),0,pool),false);
});
T('7c. 出道演出 ＋ 振翼髮 ⇒ 失效',()=>{
  assert.equal(mod.hasMeloettaExDebut(ST({active:I(MELO)},{active:I(MOON)},{isFirstTurn:true}),0,pool),false);
});

// ── G. 無限之影 ──────────────────────────────────────────────────────────
const koGengar=(s,g)=>{const o=mod.dealAttackDamageToTarget(s,0,g.iid,400,pool,{kind:'attack-damage',label:'狙擊',noWeakness:true});
  return {hand:o.players[1].hand.length,discard:o.players[1].discard.length};};
T('8a.【正對照】耿鬼在備戰被狙擊 KO（乾淨盤面）⇒ 本體回手',()=>{
  const g=I(GENGAR); const r=koGengar(ST({active:I(PLAIN)},{active:I(PLAIN),bench:[g]}),g);
  assert.equal(r.hand,1); assert.equal(r.discard,0);
});
T('8b. 耿鬼（Stage2）在備戰 ＋ 熔岩洞 ⇒ 正常進棄牌區（不回手）',()=>{
  const g=I(GENGAR); const r=koGengar(ST({active:I(PLAIN)},{active:I(PLAIN),bench:[g]},{activeStadium:I(CAVE)}),g);
  assert.equal(r.hand,0); assert.equal(r.discard,1);
});
T('8c. 耿鬼在備戰 ＋ 同側備戰有海兔獸｜黏著束縛（備戰2階特性全消）⇒ 進棄牌區',()=>{
  const g=I(GENGAR); const r=koGengar(ST({active:I(PLAIN)},{active:I(PLAIN),bench:[g,I(STICKY)]}),g);
  assert.equal(r.hand,0);
});
T('8d. 耿鬼在**戰鬥場** ＋ 對手振翼髮 ⇒ 進棄牌區；正對照乾淨盤面回手',()=>{
  const g=I(GENGAR); assert.equal(koGengar(ST({active:I(PLAIN)},{active:g}),g).hand,1);
  const g2=I(GENGAR); assert.equal(koGengar(ST({active:I(MOON)},{active:g2}),g2).hand,0);
});
T('8e.【正對照】耿鬼在**戰鬥場** ＋ 海兔獸在對手備戰 ⇒ 黏著束縛只打備戰 ⇒ 仍回手',()=>{
  const g=I(GENGAR); const s=ST({active:I(PLAIN)},{active:g,bench:[I(STICKY)]});
  assert.equal(koGengar(s,g).hand,1);
});

// ── H. 刺激進化 ──────────────────────────────────────────────────────────
const tryEvolve=(oppActive)=>{
  const base=I(SHELL,{justPlaced:true});
  const s=ST({active:base,bench:[I(SHELM)],hand:[I(SHELL_EVO)]},{active:I(oppActive)},{isFirstTurn:true});
  const targets=mod.getEvolvableTargets(s,pool);
  const out=mod.applyAction(s,{type:'EVOLVE',fromIid:base.iid,toIid:s.players[0].hand[0].iid},pool);
  return {targets:targets.length, evolved: out.players[0].active.cardId===String(SHELL_EVO)};
};
T('9a.【正對照】小嘴蝸（剛使出 ＋ 最初回合）＋ 場上有蓋蓋蟲 ⇒ 可進化（UI 黃框也給）',()=>{
  const r=tryEvolve(PLAIN); assert.equal(r.targets,1); assert.equal(r.evolved,true);
});
T('9b. 刺激進化 ＋ 對手振翼髮 ⇒ 不可進化（UI 與 EVOLVE handler 同 commit，兩端一致）',()=>{
  const r=tryEvolve(MOON); assert.equal(r.targets,0); assert.equal(r.evolved,false);
});

// ── I. 潛者捕捉（獵斑魚自身昏厥那條）────────────────────────────────────
const diverQueue=(stad,isActive=true)=>{
  const e=I(BWATER); const d=I(DIVER,{energyAttached:[e]});
  const s=ST({active:I(PLAIN)},isActive?{active:d,discard:[e]}:{active:I(PLAIN),bench:[d],discard:[e]},
    stad?{activeStadium:I(stad)}:{});
  return (mod.fireDefenderOnKO(s,1,0,pool,d,isActive,true)._diverCatchQueue??[]).length;
};
T('10a.【正對照】獵斑魚自身被 KO（乾淨盤面）⇒ 基本【水】能量排進確認佇列',()=>{
  assert.equal(diverQueue(null),1);
});
T('10b. 獵斑魚（Stage1）自身被 KO ＋ 熔岩洞 ⇒ 潛者捕捉早就被消除，不觸發',()=>{
  assert.equal(diverQueue(CAVE),0);
});
T('10c.【正對照】備戰的獵斑魚被 KO（乾淨盤面）⇒ 仍觸發',()=>{
  assert.equal(diverQueue(null,false),1);
});
T('10d.〔接線覆蓋〕location 必須用 fireDefenderOnKO 的 isActive：振翼髮只擋戰鬥場那一隻',()=>{
  // 硬寫 'bench' ⇒ 戰鬥場那隻不會被振翼髮消除（漏擋）；硬寫 'active' ⇒ 備戰那隻被誤消除（改過頭）。
  const mk=(isActive)=>{
    const e=I(BWATER); const d=I(DIVER,{energyAttached:[e]});
    const s=ST({active:I(MOON)},isActive?{active:d,discard:[e]}:{active:I(PLAIN),bench:[d],discard:[e]});
    return (mod.fireDefenderOnKO(s,1,0,pool,d,isActive,true)._diverCatchQueue??[]).length;
  };
  assert.equal(mk(true),0,'戰鬥場的獵斑魚 ＋ 對手振翼髮 ⇒ 潛者捕捉被消除');
  assert.equal(mk(false),1,'【正對照】備戰的獵斑魚不受暗夜羽擊影響 ⇒ 仍觸發');
});

// ══════════════ ③ 差分實跑（舊述詞逐字轉錄自 BASE 201cdec9）══════════════
// 舊 passiveImmunityDamageBlock：只手刻「初始化」＋「監視塔」兩個來源
function OLD_pidb(state, actorIdx, targetCard, poolM){
  if(!targetCard?.abilities) return {blocked:false};
  if(mod.isInitializeNullified(state,targetCard,poolM)) return {blocked:false};
  if(targetCard.pokemonType==='Colorless'){
    const sd=state.activeStadium; const sdCard=sd?poolM.get(sd.cardId):undefined;
    if(sdCard && sdCard.name==='火箭隊的監視塔') return {blocked:false};
  }
  const atkInst=state.players[actorIdx].active;
  const atkCard=atkInst?poolM.get(atkInst.cardId):undefined;
  if(!atkCard) return {blocked:false};
  for(const abx of targetCard.abilities){
    if(abx.name==='順滑大衣') continue;
    if(mod.DAMAGE_AMOUNT_DEPENDENT_IMMUNITY.has(abx.name)) continue;
    const immune=mod.PASSIVE_IMMUNITY.get(abx.name);
    if(!immune) continue;
    if(immune(atkCard,1,state,actorIdx,poolM,targetCard.name)===true) return {blocked:true};
  }
  return {blocked:false};
}
// 舊 getAttackerEffectiveTypes（含舊 hasIronTracksDualCore）
function OLD_types(attackerActive, attackerCard, poolM){
  if(attackerCard?.name==='小碎鑽' && attackerCard.abilities?.some(a=>a.name==='雙重屬性')) return ['Fighting','Psychic'];
  if(attackerActive && attackerCard && attackerCard.name==='鐵轍跡'
     && attackerCard.abilities?.some(a=>a.name==='二重核心')
     && attackerActive.energyAttached.some(e=>poolM.get(e.cardId)?.name==='驅勁能量 未來')) return ['Fighting','Metal'];
  return attackerCard?.pokemonType?[attackerCard.pokemonType]:[];
}
const IMM_HOLDERS=[KABU,OMA,CINC,MENAS,findId('厄鬼椪 礎石面具ex',ab('礎石之勢')),findId('奇麒麟ex',ab('尾甲')),
  findId('仙子伊布',ab('神秘守護')),findId('暴噬龜',ab('鐵壁硬殼')),GENGAR,SLOW,PLAIN].filter(Boolean);
const ATTACKERS=[EXATK,PLAIN,MOON,IRON,TERA,findId('厄鬼椪 礎石面具ex',ab('礎石之勢'))].filter(Boolean);
const STADIUMS=[null,CAVE,WATCH];
T('11a. 差分實跑：passiveImmunityDamageBlock 舊 vs 新 —— **沒有任何消除來源在場的盤面必須 0 mismatch**',()=>{
  let total=0,mismatchClean=0,mismatchDirty=0;
  const dirtyBy={};
  for(const holder of IMM_HOLDERS) for(const atk of ATTACKERS) for(const stad of STADIUMS)
  for(const oppSpecial of [false,true]) for(const nullFlag of [false,true])
  for(const sticky of [false,true]) for(const isBench of [false,true]) {
    const h=I(holder);
    const attacker=I(atk, oppSpecial?{energyAttached:[I(SPECIAL_E)]}:{});
    const hInst=nullFlag?{...h,abilityNullifiedThisTurn:true}:h;
    const defSide=isBench?{active:I(PLAIN),bench:sticky?[hInst,I(STICKY)]:[hInst]}
                         :{active:hInst,bench:sticky?[I(STICKY)]:[]};
    const s=ST({active:attacker},defSide,stad?{activeStadium:I(stad)}:{});
    const card=pool.get(holder);
    const o=OLD_pidb(s,0,card,pool).blocked;
    const nw=mod.passiveImmunityDamageBlock(s,0,hInst,card,pool).blocked;
    total++;
    const atkCard=pool.get(atk);
    const cave = stad===CAVE;
    const watch= stad===WATCH;
    const moon = atkCard?.abilities?.some(a=>a.name==='暗夜羽擊');
    const init = atkCard?.abilities?.some(a=>a.name==='初始化');
    const anySource = cave||watch||moon||init||nullFlag||sticky;
    if(o!==nw){ if(anySource) { mismatchDirty++;
        const k=[cave&&'熔岩洞',watch&&'監視塔',moon&&'振翼髮',init&&'初始化',nullFlag&&'招式版暗夜羽擊',sticky&&'黏著束縛'].filter(Boolean).join('+');
        dirtyBy[k]=(dirtyBy[k]||0)+1;
      } else mismatchClean++; }
  }
  console.log('    差分：共 '+total+' 組；乾淨盤面 mismatch='+mismatchClean+'；帶消除來源 mismatch='+mismatchDirty);
  console.log('    帶來源的差異分佈：'+JSON.stringify(dirtyBy));
  assert.ok(total>=2000,'差分組數太少：'+total);
  assert.equal(mismatchClean,0,'沒有消除來源時行為必須完全不變（改過頭）');
  assert.ok(mismatchDirty>0,'一筆差異都沒有 ⇒ 這個修正是安慰劑');
});
T('11b. 差分實跑：getAttackerEffectiveTypes 舊 vs 新 —— 乾淨盤面 0 mismatch',()=>{
  let total=0,clean=0,dirty=0;
  const HOLD=[KENA,TRACK,PLAIN,MENAS];
  for(const h of HOLD) for(const opp of [PLAIN,MOON,IRON]) for(const drive of [false,true]) for(const nf of [false,true]){
    const a=I(h, drive?{energyAttached:[I(DRIVE)]}:{});
    const ai=nf?{...a,abilityNullifiedThisTurn:true}:a;
    const s=ST({active:ai},{active:I(opp)});
    const o=JSON.stringify(OLD_types(ai,pool.get(h),pool));
    const nw=JSON.stringify(mod.getAttackerEffectiveTypes(s,0,ai,pool.get(h),pool));
    total++;
    const oppCard=pool.get(opp);
    const any=nf||oppCard?.abilities?.some(x=>x.name==='暗夜羽擊')||oppCard?.abilities?.some(x=>x.name==='初始化');
    if(o!==nw){ if(any) dirty++; else clean++; }
  }
  console.log('    差分：共 '+total+' 組；乾淨 mismatch='+clean+'；帶來源 mismatch='+dirty);
  assert.equal(clean,0); assert.ok(dirty>0);
});

// ══════════════ ④ hasAbilityOnBench 的刻意無 gate 例外未被破壞 ══════════════
T('12a. 行為端：黏著束縛偵測仍生效且不會無窮遞迴（備戰 Stage2 特性被消除）',()=>{
  const g=I(GENGAR); const st=ST({active:I(PLAIN),bench:[g]},{active:I(PLAIN),bench:[I(STICKY)]});
  let blew=false;
  try{ assert.equal(mod.isAbilityNullifiedBySticky(st,g,pool.get(GENGAR),true,pool),true); }
  catch(e){ if(/Maximum call stack/.test(String(e))) blew=true; throw e; }
  assert.equal(blew,false);
  assert.equal(mod.hasEffectiveAbilityByInst(st,0,g,pool,'無限之影'),false);
});
T('12b. 靜態：hasAbilityOnBench 必須維持沒有 gate（加了會無窮遞迴）＋正對照',()=>{
  const src=readFileSync(join(ROOT,'src/lib/game/effects/cards/v3001_g3_wave3.ts'),'utf8');
  const i=src.indexOf('function hasAbilityOnBench(');
  assert.ok(i>0,'anchor 失效');
  const blk=src.slice(i, src.indexOf('\n}\n', i));
  assert.ok(blk.length<1200,'切出來的區塊太大：'+blk.length);
  const RE=/isAbilityHolderEffective|hasEffectiveAbilityByInst|_v6196HasEffAbilByInst|_abilityHolderEffectiveFn/;
  assert.ok(!RE.test(blk),'hasAbilityOnBench 被加上 gate');
  assert.ok(RE.test('function hasAbilityOnBench(a){ return isAbilityHolderEffective(a); }'),'正對照：判準抓得到違規');
});

// ══════════════ ⑤ 靜態：兩份免疫實作不得再各自手刻消除來源 ══════════════
const readSrc=p=>readFileSync(join(ROOT,p),'utf8');
const cut=(src,anchor)=>{const i=src.indexOf(anchor); assert.ok(i>=0,'anchor 失效：'+anchor);
  const j=src.indexOf('\n}\n',i); assert.ok(j>i); return src.slice(i,j);};
T('13a. passiveImmunityDamageBlock / passiveCoinImmunity 都必須呼叫中央述詞，且不得再 inline 手刻來源',()=>{
  const eff=readSrc('src/lib/game/effects.ts');
  for(const anchor of ['export function passiveImmunityDamageBlock(','export function passiveCoinImmunity(']){
    const blk=cut(eff,anchor);
    assert.ok(/_v6196HasEffAbilByInst\s*\(/.test(blk), anchor+' 沒有呼叫中央述詞');
    assert.ok(!/ROCKET_WATCHTOWER_STADIUMS/.test(blk), anchor+' 仍在 inline 手刻監視塔（兩份會再漂）');
    assert.ok(!/isInitializeNullified\s*\(/.test(blk), anchor+' 仍在 inline 手刻初始化');
  }
});
T('13b.【正對照】13a 的判準抓得到違規樣本（不是恆真式）',()=>{
  const bad='export function passiveImmunityDamageBlock(a){\n  if (ROCKET_WATCHTOWER_STADIUMS.has(x)) return 1;\n}\n';
  const blk=cut(bad,'export function passiveImmunityDamageBlock(');
  assert.ok(/ROCKET_WATCHTOWER_STADIUMS/.test(blk));
  assert.ok(!/_v6196HasEffAbilByInst\s*\(/.test(blk));
});
T('13c. 全部呼叫端都真的傳了場上實體（沒有人偷傳 undefined / null）',()=>{
  const files=['src/lib/game/effects.ts','src/lib/game/defense.ts'];
  let n=0;
  for(const f of files){
    for(const line of readSrc(f).split('\n')){
      const m=line.match(/(passiveImmunityDamageBlock|passiveCoinImmunity)\((.*)/);
      if(!m || /^export function/.test(line.trim())) continue;
      n++;
      assert.ok(!/,\s*(undefined|null)\s*,/.test(m[2]), '有呼叫端傳了 undefined/null：'+line.trim());
    }
    for(const line of readSrc(f).split('\n')){
      if(!/resolveBenchGuard\(/.test(line) || /^export function/.test(line.trim())) continue;
      if(/\/\//.test(line.split('resolveBenchGuard(')[0])) continue;
      n++;
      assert.ok(/targetInst\s*:/.test(line)||/{\s*targetInst\s*}/.test(line),
        'resolveBenchGuard 呼叫端沒傳 targetInst：'+line.trim());
    }
  }
  assert.ok(n>=10,'掃到的呼叫端太少（'+n+'）⇒ 掃描器可能壞了');
});
T('13d. resolveInfiniteShadowKo 走中央注入點（_shared.ts 不得 import v3001/defense — Check O）',()=>{
  const sh=readSrc('src/lib/game/effects/_shared.ts');
  const blk=cut(sh,'export function resolveInfiniteShadowKo(');
  assert.ok(/_abilityHolderEffectiveFnLoc\s*\(/.test(blk),'沒有走注入點');
  assert.ok(!/from '\.\.\/defense'|from '\.\/cards\/v3001_g3_wave3'/.test(sh),'_shared.ts 反向 import 了 defense/v3001');
});
T('13e. 注入點真的被接上（`!fn ||` 是 fail-open 寫法 ⇒ 沒接就等於整個 gate 消失）',()=>{
  // ⚠ 沿用 _shared.ts 既有注入點的 fail-open 慣例（沒注入時退回舊行為，不會讓特性靜默失效），
  //   代價是「忘了注入」不會炸 ⇒ 用這條靜態 ＋ 8b/8c/8d 的行為端一起守住。
  const eff=readSrc('src/lib/game/effects.ts');
  assert.ok(/import \{[^}]*setAbilityHolderEffectiveAtFn/.test(eff),'setAbilityHolderEffectiveAtFn 沒有被 import');
  assert.ok(/setAbilityHolderEffectiveAtFn\(\(state, inst, card, ownerIdx, abilityName, location, pool\) =>/.test(eff),
    'effects.ts 沒有用完整六參數注入 setAbilityHolderEffectiveAtFn');
  assert.ok(!/setAbilityHolderEffectiveAtFn\s*\(\s*\)/.test(eff),'注入了空 callback');
});

console.log(`\n=== v6204 passive-ability-gate(簽名組): ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail?1:0);
