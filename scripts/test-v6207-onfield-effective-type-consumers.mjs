// ⭐⭐⭐ v6.207 —— 站長裁定三件（2026-08-18）
//   ① v6.206 ⑦ 段那份「全站仍直讀印刷 pokemonType 的**場上**消費點」清單，逐處判讀後
//      把「主詞是場上寶可夢」的那一批收斂到中央述詞 getEffectivePokemonTypes /
//      hasEffectivePokemonType；「主詞是牌庫/手牌/棄牌區的卡」一律**不動**（那讀印刷屬性才對）。
//   ② 逆境保險改看「當下實際的弱點」——與傷害引擎**共用同一份** getEffectiveWeaknessType。
//   ③ 陳舊的顎之化石｜威嚇之顎 -30 接上特性消除閘（沿用中央 isAbilityHolderEffective）。
//
// ⚠ 一律**行為端**驅動（applyAction / TRAINER_GUARDS / getAbilityFn / SPECIAL_ENERGY_ATTACH）。
//   「字串在不在」只證明有接線，不證明接對了（v6.154 教訓）。
// ⚠ 每一條修正都配**正對照**（沒有雙屬性特性的寶可夢必須完全不變）＋ ⑦ 段全卡池差分實跑。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.x6207-s.js'),E=join(ROOT,'.x6207-e.ts'),O=join(ROOT,'.x6207-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O])try{unlinkSync(p)}catch{}});
writeFileSync(S,'export const base="";export const assets="";');
// ⚠ namespace import：把 src 還原成 BASE 做 HEAD-FAIL 時，「新符號不存在」只會讓那幾條紅，
//   不會整個 bundle build 不起來而看不出是哪幾條。
writeFileSync(E,"import * as ENG from './src/lib/game/engine';\nimport * as EFF from './src/lib/game/effects';\n"
+"import * as SH from './src/lib/game/effects/_shared';\nexport { ENG, EFF, SH };\n");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const m=await import(pathToFileURL(O).href);
const ENG=m.ENG, EFF=m.EFF, SH=m.SH;

const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))) if(c?.id!=null) pool.set(String(c.id),c);}

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

const KENA=findId('小碎鑽',ab('雙重屬性'));          // Basic /【鬥】/ 非規則 ⇒ 效果上多一個【超】
const CHILI=findId('狠辣椒ex',ab('雙重屬性'));       // Stage1 /【火】/ ex ⇒ 效果上多一個【草】
const TRACK=findId('鐵轍跡',ab('二重核心'));
const YUZI=findId('由紫'), GARDEN=findId('神秘花園'), CODEC=findId('奇跡修正檔'), CLOCK=findId('奇異時鐘');
const SENSE=findId('感應【超】能量'), MELO=findId('美洛耶塔',c=>c.attacks?.some(a=>a.name==='治癒旋律'));
const METAG=findId('大吾的巨金怪ex',ab('X啟動')), WIND=findId('風妖精',ab('柔柔治癒'));
const FOREST=findId('活力森林');
const PLUM=findId('福祿果'), INSUR=findId('逆境保險');
const JAW=findId('陳舊的顎之化石'), SHIELD=findId('陳舊的盾甲化石');
const WATCH=findId('火箭隊的監視塔'), CAVE=findId('傳說的熔岩洞');
const IRON=findId('鐵荊棘ex',ab('初始化')), MOON=findId('振翼髮',ab('暗夜羽擊'));
const FAIRY=findId('莉莉艾的皮皮ex',ab('妖精領域'));
const PSYE=findId('基本【超】能量'), METE=findId('基本【鋼】能量'),
      FIGHTE=findId('基本【鬥】能量'), FIREE=findId('基本【火】能量');
// 對照用「乾淨」寶可夢：無特性、基礎、【無】、HP 夠高不會被打死
const PLAIN=(()=>{for(const [id,c] of pool) if(c.supertype==='Pokemon'&&c.stage==='Basic'&&!c.abilities
  &&c.subtype==='Basic'&&!c.evolvesFrom&&(c.hp??0)>=120&&c.pokemonType==='Colorless') return id; return null;})();
const PSYBASIC=(()=>{for(const [id,c] of pool) if(c.supertype==='Pokemon'&&c.pokemonType==='Psychic'
  &&!c.evolvesFrom&&c.stage==='Basic') return id; return null;})();
const deck5=()=>[I(PLAIN),I(PLAIN),I(PLAIN),I(PLAIN),I(PLAIN)];

console.log('① 卡面逐字錨 ＋ 下限斷言（抓不到卡就紅，不做安慰劑綠燈）');
T('1a. 本檔依賴的卡全部抓得到',()=>{
  const NEED={KENA,CHILI,TRACK,YUZI,GARDEN,CODEC,CLOCK,SENSE,MELO,METAG,WIND,FOREST,PLUM,INSUR,
              JAW,SHIELD,WATCH,CAVE,IRON,MOON,FAIRY,PSYE,METE,FIGHTE,FIREE,PLAIN,PSYBASIC};
  const bad=Object.entries(NEED).filter(([,v])=>!v).map(([k])=>k);
  assert.equal(bad.length,0,'抓不到：'+bad.join(','));
});
T('1b. 三張雙屬性卡的 dual 都**包含**印刷屬性 ⇒ 本輪收斂相對印刷屬性是純新增',()=>{
  assert.equal(eff(KENA,'雙重屬性'),'只要這隻寶可夢在場上，改為【鬥】與【超】2種屬性。');
  assert.equal(eff(CHILI,'雙重屬性'),'只要這隻寶可夢在場上，改為【草】與【火】2種屬性。');
  assert.equal(pool.get(KENA).pokemonType,'Fighting');
  assert.equal(pool.get(CHILI).pokemonType,'Fire');
  assert.equal(pool.get(TRACK).pokemonType,'Metal');
});
T('1c. 本輪換掉的消費點，卡面主詞都是「**場上**的寶可夢」（逐字）',()=>{
  assert.equal(pool.get(YUZI).rulesText,'將自己的1隻【超】寶可夢恢復「150」HP。');
  assert.ok(/自己場上【超】寶可夢的數量/.test(pool.get(GARDEN).rulesText??''),pool.get(GARDEN).rulesText);
  assert.equal(pool.get(CODEC).rulesText,'從自己的棄牌區選擇1張「基本【超】能量」卡，附於備戰區的【超】寶可夢身上。');
  assert.ok(/選擇1隻自己的進化的【超】寶可夢/.test(pool.get(CLOCK).rulesText??''),pool.get(CLOCK).rulesText);
  assert.ok(/從手牌將這張卡附於【超】寶可夢身上時/.test(pool.get(SENSE).rulesText??''),pool.get(SENSE).rulesText);
  assert.equal(pool.get(MELO).attacks.find(a=>a.name==='治癒旋律').effect,'將自己的備戰區的1隻【超】寶可夢恢復「120」HP。');
  assert.ok(/以任意方式附於自己的【超】或者【鋼】寶可夢身上/.test(eff(METAG,'X啟動')),eff(METAG,'X啟動'));
  assert.ok(/將自己的戰鬥場的【草】寶可夢的HP全部恢復/.test(eff(WIND,'柔柔治癒')),eff(WIND,'柔柔治癒'));
  assert.equal(pool.get(PLUM).rulesText,'附有這張卡的寶可夢受到對手的【超】寶可夢招式的傷害時，那個傷害「-60」點，將這張卡丟棄。');
  assert.equal(eff(JAW,'威嚇之顎'),'只要這隻寶可夢在戰鬥場上，對手的戰鬥寶可夢使用的招式的傷害「-30」點。');
  assert.equal(pool.get(INSUR).rulesText,
    '若附有這張卡的寶可夢的弱點屬性與對手戰鬥寶可夢的屬性相同，則附有這張卡的寶可夢在戰鬥場受到對手的寶可夢招式的傷害時，從自己的牌庫抽出3張卡。');
});
T('1d.〔不換的那一側・行為端〕感應【超】能量的**牌庫**搜尋條件仍是印刷屬性',()=>{
  // ⚠ 第二輪 opus 審查抓到：舊版寫成 `EFF.evaluateSelectionFilter?.(...) ?? (印刷比對)`，
  //   而 evaluateSelectionFilter **根本沒有從 effects.ts export**（在 selection-filter.ts）
  //   ⇒ 整條退化成「'Fighting'==='Psychic' === false」的恆真式，零程式覆蓋。改成行為端：
  //   牌庫裡**只有小碎鑽**（印刷【鬥】）時，卡面「【超】屬性的【基礎】寶可夢卡」找不到 ⇒
  //   走 openDeckViewReshuffle（檢視+重洗），而不是開放備戰搜尋。
  assert.ok(/從自己的牌庫選擇最多2張【超】屬性的【基礎】寶可夢卡/.test(pool.get(SENSE).rulesText??''));
  const t=I(KENA);
  const s=ST({active:I(PLAIN),bench:[t],deck:[I(KENA),I(KENA)]},{active:I(PLAIN)});
  const r=EFF.SPECIAL_ENERGY_ATTACH.get('感應【超】能量')(s,0,t.iid,pool);
  assert.notEqual(r.pendingSelection?.effectKey,'bench-basic-from-deck',
    '牌庫端把小碎鑽當成【超】基礎寶可夢了 ⇒ 不該換的那一側被換掉');
  // 正對照：牌庫換成真的基本【超】基礎寶可夢 ⇒ 才會開放備戰搜尋（證明上面的 notEqual 不是恆真）
  const t2=I(KENA);
  const s2=ST({active:I(PLAIN),bench:[t2],deck:[I(PSYBASIC),I(PLAIN)]},{active:I(PLAIN)});
  assert.equal(EFF.SPECIAL_ENERGY_ATTACH.get('感應【超】能量')(s2,0,t2.iid,pool).pendingSelection?.effectKey,
    'bench-basic-from-deck');
});

console.log('②【超】家族消費點（小碎鑽在場上是【鬥】＋【超】）—— 正對照 ＋ 負對照');
T('2a. 由紫：gate 與 validIids 都認得備戰的小碎鑽（v6.206 已實跑證明「現在就打不出來」）',()=>{
  const kena=I(KENA,{damage:50});
  const s=ST({active:I(PLAIN),bench:[kena],hand:[I(YUZI)],deck:[I(PLAIN)]},{active:I(PLAIN)});
  assert.equal(EFF.TRAINER_GUARDS.get('由紫')(s,0,pool),true,'gate 不認得小碎鑽');
  const r=EFF.TRAINER_EFFECTS.get('由紫')(s,0,pool);
  assert.deepEqual(r.pendingSelection?.params?.validIids,[kena.iid],'validIids 不含小碎鑽 ⇒ 看得到勾不動');
});
T('2b. 由紫 負對照：小碎鑽在**戰鬥場**時被 passive 振翼髮｜暗夜羽擊 消除 ⇒ 退回印刷【鬥】、選不到',()=>{
  // ⚠ 卡面逐字：暗夜羽擊「只要這隻寶可夢在**戰鬥場**上，對手的**戰鬥**寶可夢的特性全部消除」
  //   ⇒ 只打得到對手的戰鬥位。小碎鑽在**備戰**時全站沒有任何消除來源打得到它
  //   （Basic ⇒ 熔岩洞不行；【鬥】⇒ 監視塔不行；非規則 ⇒ 初始化不行；非 Stage2 ⇒ 黏著束縛不行），
  //   所以備戰型消費點（奇跡修正檔/治癒旋律）的負對照只能用「非【超】寶可夢」，不是漏寫。
  const kena=I(KENA,{damage:50});
  const s=ST({active:kena,bench:[],hand:[I(YUZI)],deck:[I(PLAIN)]},{active:I(MOON)});
  assert.equal(EFF.TRAINER_GUARDS.get('由紫')(s,0,pool),false,'特性被消除後仍認得＝閘沒接上');
  const r=EFF.TRAINER_EFFECTS.get('由紫')(s,0,pool);
  assert.deepEqual(r.pendingSelection?.params?.validIids,[],'消除後 validIids 應為空');
  // 正對照：同一盤面把對手戰鬥場換成沒有暗夜羽擊的 ⇒ 又選得到（證明紅不是因為別的原因）
  const k2=I(KENA,{damage:50});
  const s2=ST({active:k2,bench:[],hand:[I(YUZI)],deck:[I(PLAIN)]},{active:I(PLAIN)});
  assert.equal(EFF.TRAINER_GUARDS.get('由紫')(s2,0,pool),true);
});
T('2b2. 備戰的小碎鑽：全站沒有任何消除來源打得到（不變式，日後出新消除卡會紅）',()=>{
  const kena=I(KENA);
  for(const stad of [null,CAVE,WATCH]){
    const s=ST({active:I(PLAIN),bench:[kena]},{active:I(MOON),bench:[I(IRON)]},stad?{activeStadium:I(stad)}:{});
    assert.deepEqual(EFF.getEffectivePokemonTypes(s,0,kena,pool.get(KENA),pool),['Fighting','Psychic'],
      '備戰的小碎鑽被消除了（stadium='+stad+'）⇒ 上面幾條負對照的推理要重寫');
  }
});
T('2c. 由紫 正對照：印刷就是【超】的寶可夢，有沒有這次改動都選得到',()=>{
  const p=I(PSYBASIC,{damage:50});
  const s=ST({active:I(PLAIN),bench:[p],hand:[I(YUZI)],deck:[I(PLAIN)]},{active:I(MOON)});
  assert.equal(EFF.TRAINER_GUARDS.get('由紫')(s,0,pool),true);
  const r=EFF.TRAINER_EFFECTS.get('由紫')(s,0,pool);
  assert.deepEqual(r.pendingSelection?.params?.validIids,[p.iid]);
});
const gardenRun=(fieldIds,stad)=>{
  const st=ST({active:I(fieldIds[0]),bench:fieldIds.slice(1).map(x=>I(x)),hand:[I(PSYE)],deck:deck5()},
              {active:stad===MOON?I(MOON):I(PLAIN)},{activeStadium:I(GARDEN),stadiumUsedThisTurn:[false,false]});
  const r=ENG.applyAction(st,{type:'USE_STADIUM',actorIdx:0},pool);
  if(!r.pendingSelection) return {blocked:true,msg:r.log.slice(-1)[0]?.message};
  const pick=r.players[0].hand.find(h=>pool.get(h.cardId)?.supertype==='Energy');
  const r2=ENG.applyAction(r,{type:'RESOLVE_SELECTION',selectedIids:[pick.iid],actorIdx:0},pool);
  return {blocked:false,hand:r2.players[0].hand.length};
};
T('2d. 神秘花園：gate（engine）與抽牌 resolver（stadiums）**兩端**都要認得小碎鑽',()=>{
  const a=gardenRun([KENA],null);
  assert.equal(a.blocked,false,'gate 擋下了：'+a.msg);
  assert.equal(a.hand,1,'丟 1 張能量後手牌應抽到＝場上【超】數 1');
  // 負對照：同一盤面把場上換成非【超】⇒ gate 必須擋下（否則是 gate 放太寬）
  const b=gardenRun([PLAIN],null);
  assert.equal(b.blocked,true,'場上沒有【超】卻放行');
});
T('2e. 神秘花園 負對照：小碎鑽的特性被消除 ⇒ gate 回到「擋下」',()=>{
  const c=gardenRun([KENA],MOON);
  assert.equal(c.blocked,true,'消除閘沒接上：'+JSON.stringify(c));
});
T('2f. 奇跡修正檔：gate 與 step2 的 validIids 都認得備戰的小碎鑽',()=>{
  const kena=I(KENA);
  const s=ST({active:I(PLAIN),bench:[kena],hand:[I(CODEC)],discard:[I(PSYE)],deck:[]},{active:I(PLAIN)});
  assert.equal(EFF.TRAINER_GUARDS.get('奇跡修正檔')(s,0,pool),true);
  const r=EFF.TRAINER_EFFECTS.get('奇跡修正檔')(s,0,pool);
  const r2=ENG.applyAction(r,{type:'RESOLVE_SELECTION',selectedIids:[s.players[0].discard[0].iid],actorIdx:0},pool);
  assert.deepEqual(r2.pendingSelection?.params?.validIids,[kena.iid]);
  // 負對照：備戰沒有【超】（含有效屬性）⇒ gate 必須擋下（見 2b 註：備戰小碎鑽無消除來源）
  const s2=ST({active:I(PLAIN),bench:[I(PLAIN)],hand:[I(CODEC)],discard:[I(PSYE)],deck:[]},{active:I(PLAIN)});
  assert.equal(EFF.TRAINER_GUARDS.get('奇跡修正檔')(s2,0,pool),false);
});
T('2g. 奇異時鐘：小碎鑽是【基礎】⇒ 仍不可選（本次改動不得把「進化」這個條件也放寬）',()=>{
  const s=ST({active:I(PLAIN),bench:[I(KENA)],hand:[I(CLOCK)],deck:[]},{active:I(PLAIN)});
  assert.equal(EFF.TRAINER_GUARDS.get('奇異時鐘')(s,0,pool),false,'誤把基礎寶可夢當進化');
});
T('2h. 感應【超】能量：附到小碎鑽會觸發搜索（舊碼直接 return st ⇒ 靜靜地不生效）',()=>{
  const kena=I(KENA);
  const s=ST({active:I(PLAIN),bench:[kena],deck:[I(PSYBASIC),I(PLAIN)]},{active:I(PLAIN)});
  const r=EFF.SPECIAL_ENERGY_ATTACH.get('感應【超】能量')(s,0,kena.iid,pool);
  assert.equal(r.pendingSelection?.effectKey,'bench-basic-from-deck','附到小碎鑽沒有觸發搜索');
  // 負對照①：附到非【超】⇒ 不觸發
  const other=I(PLAIN);
  const s2=ST({active:I(PLAIN),bench:[other],deck:[I(PSYBASIC),I(PLAIN)]},{active:I(PLAIN)});
  assert.equal(EFF.SPECIAL_ENERGY_ATTACH.get('感應【超】能量')(s2,0,other.iid,pool).pendingSelection,null);
  // 負對照②：小碎鑽在**戰鬥場**被暗夜羽擊消除 ⇒ 不觸發（備戰位無消除來源，見 2b 註）
  const k3=I(KENA);
  const s3=ST({active:k3,bench:[],deck:[I(PSYBASIC),I(PLAIN)]},{active:I(MOON)});
  assert.equal(EFF.SPECIAL_ENERGY_ATTACH.get('感應【超】能量')(s3,0,k3.iid,pool).pendingSelection,null);
  // 正對照：同一盤面換掉暗夜羽擊 ⇒ 又觸發
  const k4=I(KENA);
  const s4=ST({active:k4,bench:[],deck:[I(PSYBASIC),I(PLAIN)]},{active:I(PLAIN)});
  assert.equal(EFF.SPECIAL_ENERGY_ATTACH.get('感應【超】能量')(s4,0,k4.iid,pool).pendingSelection?.effectKey,'bench-basic-from-deck');
});
T('2i. 美洛耶塔｜治癒旋律：備戰的小碎鑽進得了 validIids',()=>{
  const kena=I(KENA,{damage:50});
  const s=ST({active:I(MELO,{energyAttached:[I(PSYE),I(PSYE),I(PSYE)]}),bench:[kena],deck:[I(PLAIN)]},
             {active:I(PLAIN),deck:[I(PLAIN)]});
  const r=ENG.applyAction(s,{type:'ATTACK',attackIndex:0,actorIdx:0},pool);
  assert.deepEqual(r.pendingSelection?.params?.validIids,[kena.iid]);
});
T('2j. 大吾的巨金怪ex｜X啟動：gate（lopunny…）與**能量鏈的合法目標**（v158_energy_chain）兩端同時認得小碎鑽',()=>{
  const kena=I(KENA), other=I(PLAIN);
  const s=ST({active:I(METAG),bench:[kena,other],deck:[I(PSYE),I(METE),I(PLAIN)]},{active:I(PLAIN)});
  const r=ENG.applyAction(s,{type:'USE_ABILITY',abilityIndex:0,iid:s.players[0].active.iid},pool);
  assert.ok(r.pendingSelection,'gate 擋下了 ⇒ 場上有小碎鑽卻不認');
  const psyInDeck=s.players[0].deck.find(d=>pool.get(d.cardId)?.name?.includes('【超】'));
  const r2=ENG.applyAction(r,{type:'RESOLVE_SELECTION',selectedIids:[psyInDeck.iid],actorIdx:0},pool);
  const metInDeck=s.players[0].deck.find(d=>pool.get(d.cardId)?.name?.includes('【鋼】'));
  const r3=ENG.applyAction(r2,{type:'RESOLVE_SELECTION',selectedIids:[metInDeck.iid],actorIdx:0},pool);
  const vi=r3.pendingSelection?.params?.validIids ?? [];
  assert.ok(vi.includes(kena.iid),'能量鏈的合法目標不含小碎鑽（看得到勾不動）：'+JSON.stringify(vi));
  assert.equal(vi.includes(other.iid),false,'把非【超】非【鋼】的寶可夢也放進來 ⇒ 放太寬');
  assert.ok(vi.includes(s.players[0].active.iid),'巨金怪ex 自己（【鋼】）本來就該在');
});

console.log('③【草】家族（狠辣椒ex 在場上是【草】＋【火】）');
T('3a. 風妖精｜柔柔治癒：戰鬥場是狠辣椒ex 時可發動（舊碼讀印刷【火】⇒ 直接拒絕）',()=>{
  const ch=I(CHILI,{damage:80,energyAttached:[I(FIREE)]}); const wf=I(WIND);
  const s=ST({active:ch,bench:[wf],deck:[]},{active:I(PLAIN)});
  const fn=SH.getAbilityFn('風妖精','柔柔治癒',0);
  assert.equal(typeof fn,'function','抓不到柔柔治癒的實作');
  const r=fn(s,0,pool,wf);
  assert.equal(r.players[0].active.damage,0,'狠辣椒ex 沒被恢復 ⇒ 還在讀印刷屬性');
  assert.equal(r.players[0].active.energyAttached.length,0,'卡面「然後丟棄能量」也要照做');
});
T('3b. 柔柔治癒 負對照①：戰鬥場是非【草】⇒ 仍然拒絕',()=>{
  const wf=I(WIND); const s=ST({active:I(PLAIN,{damage:80}),bench:[wf],deck:[]},{active:I(PLAIN)});
  const r=SH.getAbilityFn('風妖精','柔柔治癒',0)(s,0,pool,wf);
  assert.equal(r.players[0].active.damage,80,'非【草】卻被恢復');
});
T('3c. 柔柔治癒 負對照②：狠辣椒ex 是 Stage1 ⇒【傳說的熔岩洞】消得掉它的雙重屬性 ⇒ 回到拒絕',()=>{
  const ch=I(CHILI,{damage:80}); const wf=I(WIND);
  const s=ST({active:ch,bench:[wf],deck:[]},{active:I(PLAIN)},{activeStadium:I(CAVE)});
  const r=SH.getAbilityFn('風妖精','柔柔治癒',0)(s,0,pool,wf);
  assert.equal(r.players[0].active.damage,80,'消除閘沒接上');
});

console.log('③b 第一輪 opus 審查補抓到的三處（同一份判準，v6.206 清單漏列）');
T('3d. 銅鏡怪｜鏡面攻擊（SV5K【超】版）「若對手的戰鬥寶可夢為【超】寶可夢 +30」⇒ 小碎鑽要算【超】',()=>{
  const MIRROR=findId('銅鏡怪',c=>c.pokemonType==='Psychic'&&c.attacks?.some(a=>a.name==='鏡面攻擊'));
  assert.ok(MIRROR,'抓不到【超】版銅鏡怪');
  assert.equal(pool.get(MIRROR).attacks.find(a=>a.name==='鏡面攻擊').effect,
    '若對手的戰鬥寶可夢為【超】寶可夢，則增加30點傷害。');
  const pre=EFF.ATTACK_PRE.get('銅鏡怪|鏡面攻擊');
  const hit=(defId,extra={})=>{
    const s=ST({active:I(MIRROR)},{active:I(defId)},extra);
    return pre(s,0,pool,{}).damage;
  };
  assert.equal(hit(KENA),40,'小碎鑽在場上是【鬥】＋【超】⇒ 應 10+30=40');
  assert.equal(hit(PSYBASIC),40,'正對照：印刷【超】本來就 40');
  assert.equal(hit(PLAIN),10,'負對照：【無】不加');
  // 負對照②：小碎鑽的雙重屬性被【傳說的熔岩洞】打不到（它是【基礎】）⇒ 仍 40，
  //   證明 40 不是靠「任何場地都放行」矇到的；真正打得到它的暗夜羽擊只消**對手戰鬥位**的特性，
  //   而這裡小碎鑽本身就是防守方戰鬥位 ⇒ 攻擊方戰鬥場放振翼髮即可消掉。
  assert.equal(hit(KENA,{activeStadium:I(CAVE)}),40,'熔岩洞不該打到【基礎】的小碎鑽');
  const s3=ST({active:I(MOON)},{active:I(KENA)});   // 攻擊方是振翼髮（消對手戰鬥位特性）
  assert.deepEqual(EFF.getEffectivePokemonTypes(s3,1,s3.players[1].active,pool.get(KENA),pool),['Fighting'],
    '暗夜羽擊沒有消掉防守方戰鬥位小碎鑽的雙重屬性 ⇒ 3d 的消除閘推理要重寫');
});
T('3e. 眷戀雲｜愛之同感「自己場上有與對手場上寶可夢相同屬性」⇒ 兩側都吃有效屬性',()=>{
  const CLOUD=findId('眷戀雲',c=>c.attacks?.some(a=>a.name==='愛之同感'));
  assert.ok(CLOUD,'抓不到眷戀雲');
  assert.equal(pool.get(CLOUD).attacks.find(a=>a.name==='愛之同感').effect,
    '若自己的場上有與對手的場上寶可夢相同屬性的寶可夢，則增加120點傷害。');
  const pre=EFF.ATTACK_PRE.get('眷戀雲|愛之同感');
  // 攻擊方是【超】眷戀雲；對手備戰放小碎鑽（場上【鬥】＋【超】）⇒ 應匹配 +120
  const s=ST({active:I(CLOUD)},{active:I(PLAIN),bench:[I(KENA)]});
  assert.equal(pre(s,0,pool,{}).damage,200,'對手側沒吃有效屬性');
  // 負對照：對手備戰換成【無】⇒ 不匹配
  const s2=ST({active:I(CLOUD)},{active:I(PLAIN),bench:[I(PLAIN)]});
  assert.equal(pre(s2,0,pool,{}).damage,80);
  // ⚠ 自己側**不能**用小碎鑽驗：它新增的是【超】，而眷戀雲自己就是【超】⇒ 恆真（第二輪審查抓到）。
  //   改用狠辣椒ex（新增【草】）＋ 對手是【草】：眷戀雲自己配不上，只有備戰的狠辣椒ex 能配。
  const GRASSOPP=(()=>{for(const [id,c] of pool) if(c.supertype==='Pokemon'&&c.pokemonType==='Grass'&&!c.abilities) return id; return null;})();
  assert.ok(GRASSOPP,'抓不到【草】對照卡');
  const s3=ST({active:I(CLOUD),bench:[I(CHILI)]},{active:I(GRASSOPP)});
  assert.equal(pre(s3,0,pool,{}).damage,200,'自己側沒吃有效屬性');
  const s4=ST({active:I(CLOUD),bench:[I(PLAIN)]},{active:I(GRASSOPP)});
  assert.equal(pre(s4,0,pool,{}).damage,80,'負對照：備戰換成【無】就不該匹配');
  // 負對照②：熔岩洞消掉狠辣椒ex（Stage1）的雙重屬性 ⇒ 回到不匹配
  const s5=ST({active:I(CLOUD),bench:[I(CHILI)]},{active:I(GRASSOPP)},{activeStadium:I(CAVE)});
  assert.equal(pre(s5,0,pool,{}).damage,80,'消除閘沒接上');
});
T('3f. 謝米｜親送花朵「附於備戰區的【草】寶可夢身上」⇒ 狠辣椒ex 在備戰要選得到',()=>{
  const SHAY=findId('謝米',c=>c.attacks?.some(a=>a.name==='親送花朵'));
  assert.ok(SHAY,'抓不到謝米');
  assert.equal(pool.get(SHAY).attacks.find(a=>a.name==='親送花朵').effect,
    '從自己的牌庫選擇1張能量卡，附於備戰區的【草】寶可夢身上。並且重洗牌庫。');
  const post=EFF.ATTACK_POST.get('謝米|親送花朵');
  assert.equal(typeof post,'function');
  const ch=I(CHILI);
  const s=ST({active:I(SHAY),bench:[ch],deck:[I(FIREE)]},{active:I(PLAIN)});
  const r=post(s,0,pool,{});
  assert.deepEqual(r.pendingSelection?.params?.benchTargets,[ch.iid],
    '狠辣椒ex 沒進 benchTargets ⇒ 整招白打（log「備戰區沒有可附加能量的寶可夢」）');
  // 負對照①：備戰是【無】⇒ 沒有目標
  const s2=ST({active:I(SHAY),bench:[I(PLAIN)],deck:[I(FIREE)]},{active:I(PLAIN)});
  assert.equal(post(s2,0,pool,{}).pendingSelection,null);
  // 負對照②：狠辣椒ex 是 Stage1 ⇒ 熔岩洞消得掉雙重屬性 ⇒ 回到沒有目標
  const ch2=I(CHILI);
  const s3=ST({active:I(SHAY),bench:[ch2],deck:[I(FIREE)]},{active:I(PLAIN)},{activeStadium:I(CAVE)});
  assert.equal(post(s3,0,pool,{}).pendingSelection,null,'消除閘沒接上');
});
T('3g. 露力麗｜蹦蹦充能（同一個 factory 但 targetType=null）行為完全不變',()=>{
  const post=EFF.ATTACK_POST.get('露力麗|蹦蹦充能');
  assert.equal(typeof post,'function');
  const b=I(PLAIN);
  const s=ST({active:I(findId('露力麗',c=>c.attacks?.some(a=>a.name==='蹦蹦充能'))),bench:[b],deck:[I(FIREE)]},{active:I(PLAIN)});
  assert.deepEqual(post(s,0,pool,{}).pendingSelection?.params?.benchTargets,[b.iid],
    '無屬性限制的那一支被誤加了屬性過濾');
});

console.log('④ 屬性條件型防禦道具（攻擊方屬性＋holder 屬性）—— 戰鬥位(engine)與備戰(effects)兩條管線');
const kenaAtk=(defInst,benchInst,extra={})=>{
  const s=ST({active:I(KENA,{energyAttached:[I(FIGHTE),I(FIGHTE),I(FIGHTE)]}),deck:deck5()},
             {active:defInst,bench:benchInst?[benchInst]:[I(PLAIN)],deck:deck5()},extra);
  const r=ENG.applyAction(s,{type:'ATTACK',attackIndex:0,actorIdx:0},pool);
  return r;
};
const WPSY=(()=>{for(const [id,c] of pool) if(c.supertype==='Pokemon'&&c.weakness?.type==='Psychic'
  &&!c.abilities&&(c.hp??0)>=200&&!c.resistance) return id; return null;})();
T('4a. 福祿果（對【超】攻擊者 -60）：小碎鑽在場上是【超】⇒ 現在會觸發並丟棄',()=>{
  assert.ok(WPSY,'找不到弱點【超】的高 HP 對照卡');
  const base=kenaAtk(I(WPSY));
  const withPlum=kenaAtk(I(WPSY,{toolAttached:I(PLUM)}));
  assert.equal(withPlum.players[1].active.damage, base.players[1].active.damage-60,
    '福祿果沒有 -60 ⇒ 攻擊方屬性還在讀印刷【鬥】');
  assert.equal(withPlum.players[1].active.toolAttached,undefined,'觸發後必須丟棄');
});
T('4b. 福祿果 負對照：小碎鑽在對手的暗夜羽擊下失去雙重屬性 ⇒ 不觸發（用 log 判，KO 也測得到）',()=>{
  // 防守方戰鬥場放 振翼髮（暗夜羽擊消對手戰鬥位特性）＝ 唯一打得到攻擊位小碎鑽的來源
  const s2=ST({active:I(KENA,{energyAttached:[I(FIGHTE),I(FIGHTE),I(FIGHTE)]}),deck:deck5()},
              {active:I(MOON,{toolAttached:I(PLUM)}),bench:[I(PLAIN)],deck:deck5()});
  const r=ENG.applyAction(s2,{type:'ATTACK',attackIndex:0,actorIdx:0},pool);
  assert.equal(/福祿果/.test(JSON.stringify(r.log)),false,'特性被消除後福祿果仍觸發 ⇒ 消除閘沒接上');
  // 正對照：同一盤面把 振翼髮 換成沒有特性的【超】寶可夢 ⇒ 福祿果必須觸發（否則上面是安慰劑）
  const PSYNOAB=(()=>{for(const [id,c] of pool) if(c.supertype==='Pokemon'&&c.pokemonType==='Psychic'
    &&!c.abilities&&(c.hp??0)>=90) return id; return null;})();
  assert.ok(PSYNOAB,'找不到無特性【超】對照卡');
  const s3=ST({active:I(KENA,{energyAttached:[I(FIGHTE),I(FIGHTE),I(FIGHTE)]}),deck:deck5()},
              {active:I(PSYNOAB,{toolAttached:I(PLUM)}),bench:[I(PLAIN)],deck:deck5()});
  const r3=ENG.applyAction(s3,{type:'ATTACK',attackIndex:0,actorIdx:0},pool);
  assert.equal(/福祿果：招式傷害/.test(JSON.stringify(r3.log)),true,'正對照沒觸發 ⇒ 負對照沒有證明力');
});

T('4c. 備戰傷害管線（effects.ts dealAttackDamageToTarget，狙擊/多目標走這條）也要吃有效屬性',()=>{
  // ⚠ engine 戰鬥位管線與 effects 備戰管線是**兩份獨立實作**，兩邊都要接（v6.049 教訓）。
  const victim=I(WPSY,{toolAttached:I(PLUM)});
  const s=ST({active:I(KENA)},{active:I(PLAIN),bench:[victim],deck:deck5()});
  const r=EFF.dealAttackDamageToTarget(s,0,victim.iid,100,pool);
  const got=r.players[1].bench[0].damage;
  // ⚠ 備戰不計算弱點（官方規則）⇒ 期望 100 -60(福祿果) = 40，不是 ×2 後再減。
  assert.equal(got,40,'期望 100 -60(福祿果) = 40，實得 '+got+' ⇒ 備戰管線沒吃有效屬性');
  assert.equal(r.players[1].bench[0].toolAttached,undefined,'觸發後必須丟棄');
});
T('4d. 備戰管線 負對照：攻擊方是印刷【鬥】且**沒有**雙重屬性 ⇒ 不 ×2、福祿果不觸發',()=>{
  const FIGHTNOAB=(()=>{for(const [id,c] of pool) if(c.supertype==='Pokemon'&&c.pokemonType==='Fighting'
    &&!c.abilities) return id; return null;})();
  assert.ok(FIGHTNOAB,'找不到無特性【鬥】對照卡');
  const victim=I(WPSY,{toolAttached:I(PLUM)});
  const s=ST({active:I(FIGHTNOAB)},{active:I(PLAIN),bench:[victim],deck:deck5()});
  const r=EFF.dealAttackDamageToTarget(s,0,victim.iid,100,pool);
  assert.equal(r.players[1].bench[0].damage,100);
  assert.ok(r.players[1].bench[0].toolAttached,'不該觸發卻丟棄了');
});

console.log('④b 第二輪 opus 審查抓到的四個零覆蓋路徑（改壞了原本仍全綠）');
T('4e. 渾厚鱗片 holderTypes【龍】：戰鬥位管線（engine）—— holder 側屬性判斷真的有在用',()=>{
  // ⚠ 福祿果沒有 holderTypes ⇒ 那個分支永遠短路。必須另外用有 holderTypes 的卡驗。
  const SCALE=findId('渾厚鱗片');
  assert.ok(SCALE,'抓不到渾厚鱗片');
  assert.equal(pool.get(SCALE).rulesText,'附有這張卡的【龍】寶可夢，受到對手的【草】【火】【水】【雷】寶可夢招式的傷害「-50」點。');
  const GRASSATT=(()=>{for(const [id,c] of pool){ if(c.supertype!=='Pokemon'||c.abilities||c.pokemonType!=='Grass') continue;
    const a=(c.attacks||[])[0]; if(!a||a.effect) continue; const d=parseInt(a.damage||'0'); if(d<60||d>90) continue;
    if((a.cost||[]).some(x=>x!=='Grass'&&x!=='Colorless')||(a.cost||[]).length>3) continue; return id;} return null;})();
  const DRAG=(()=>{for(const [id,c] of pool) if(c.supertype==='Pokemon'&&c.pokemonType==='Dragon'
    &&!c.abilities&&(c.hp??0)>=200&&!c.weakness) return id; return null;})();
  const NONDRAG=(()=>{for(const [id,c] of pool) if(c.supertype==='Pokemon'&&c.pokemonType==='Colorless'
    &&!c.abilities&&(c.hp??0)>=200&&c.weakness?.type!=='Grass') return id; return null;})();
  assert.ok(GRASSATT&&DRAG&&NONDRAG,'fixture 抓不到 '+JSON.stringify([GRASSATT,DRAG,NONDRAG]));
  const GE=findId('基本【草】能量');
  const hit=(defId)=>{
    const s=ST({active:I(GRASSATT,{energyAttached:[I(GE),I(GE),I(GE)]}),deck:deck5()},
               {active:I(defId,{toolAttached:I(SCALE)}),bench:[I(PLAIN)],deck:deck5()});
    const r=ENG.applyAction(s,{type:'ATTACK',attackIndex:0,actorIdx:0},pool);
    return /渾厚鱗片/.test(JSON.stringify(r.log));
  };
  assert.equal(hit(DRAG),true,'holder 是【龍】卻沒減傷 ⇒ holderTypes 分支壞了');
  assert.equal(hit(NONDRAG),false,'holder 不是【龍】卻減傷 ⇒ holderTypes 分支被短路（永遠 true）');
});
T('4f. 渾厚鱗片 holderTypes【龍】：備戰管線（effects.dealAttackDamageToTarget）',()=>{
  const SCALE=findId('渾厚鱗片');
  const GRASSATT=(()=>{for(const [id,c] of pool) if(c.supertype==='Pokemon'&&c.pokemonType==='Grass'&&!c.abilities) return id; return null;})();
  const DRAG=(()=>{for(const [id,c] of pool) if(c.supertype==='Pokemon'&&c.pokemonType==='Dragon'
    &&!c.abilities&&(c.hp??0)>=200) return id; return null;})();
  const NONDRAG=(()=>{for(const [id,c] of pool) if(c.supertype==='Pokemon'&&c.pokemonType==='Colorless'
    &&!c.abilities&&(c.hp??0)>=200) return id; return null;})();
  const dmg=(defId)=>{ const v=I(defId,{toolAttached:I(SCALE)});
    const s=ST({active:I(GRASSATT)},{active:I(PLAIN),bench:[v],deck:deck5()});
    return EFF.dealAttackDamageToTarget(s,0,v.iid,100,pool).players[1].bench[0].damage; };
  assert.equal(dmg(DRAG),50,'備戰管線 holder【龍】沒 -50');
  assert.equal(dmg(NONDRAG),100,'備戰管線 holder 非【龍】卻減傷 ⇒ 分支被短路');
});
T('4g. 奇異時鐘 psychicEvoIids **正對照**：進化的【超】寶可夢必須選得到（原本只有負斷言）',()=>{
  const PSYEVO=(()=>{for(const [id,c] of pool) if(c.supertype==='Pokemon'&&c.pokemonType==='Psychic'
    &&(c.stage==='Stage1'||c.subtype==='Stage1')&&c.evolvesFrom) return id; return null;})();
  assert.ok(PSYEVO,'抓不到【超】Stage1');
  const t=I(PSYEVO,{evolvedFromStack:[{cardId:'x',iid:'x'}]});
  const s=ST({active:I(PLAIN),bench:[t],hand:[I(CLOCK)],deck:[]},{active:I(PLAIN)});
  assert.equal(EFF.TRAINER_GUARDS.get('奇異時鐘')(s,0,pool),true,'gate 認不出進化的【超】⇒ psychicEvoIids 變死碼也沒人知道');
  const r=EFF.TRAINER_EFFECTS.get('奇異時鐘')(s,0,pool);
  assert.deepEqual(r.pendingSelection?.params?.validIids,[t.iid]);
  // 負對照：換成【無】Stage1 ⇒ 不可選
  const NONPSYEVO=(()=>{for(const [id,c] of pool) if(c.supertype==='Pokemon'&&c.pokemonType==='Colorless'
    &&(c.stage==='Stage1'||c.subtype==='Stage1')&&c.evolvesFrom) return id; return null;})();
  const s2=ST({active:I(PLAIN),bench:[I(NONPSYEVO)],hand:[I(CLOCK)],deck:[]},{active:I(PLAIN)});
  assert.equal(EFF.TRAINER_GUARDS.get('奇異時鐘')(s2,0,pool),false);
});
T('4h. 能量鏈**走到底**：能量真的附到小碎鑽身上（涵蓋 v158 後兩個 call site 的逐張再驗）',()=>{
  const kena=I(KENA), other=I(PLAIN);
  const s=ST({active:I(METAG),bench:[kena,other],deck:[I(PSYE),I(METE),I(PLAIN)]},{active:I(PLAIN)});
  const r=ENG.applyAction(s,{type:'USE_ABILITY',abilityIndex:0,iid:s.players[0].active.iid},pool);
  const psyInDeck=s.players[0].deck.find(d=>pool.get(d.cardId)?.name?.includes('【超】'));
  const r2=ENG.applyAction(r,{type:'RESOLVE_SELECTION',selectedIids:[psyInDeck.iid],actorIdx:0},pool);
  const metInDeck=s.players[0].deck.find(d=>pool.get(d.cardId)?.name?.includes('【鋼】'));
  let st=ENG.applyAction(r2,{type:'RESOLVE_SELECTION',selectedIids:[metInDeck.iid],actorIdx:0},pool);
  // 兩波（【超】→【鋼】）各選小碎鑽當目標，走完整條鏈
  let guard=0;
  while(st.pendingSelection && guard++<6){
    const need=st.pendingSelection.minCount ?? 1;
    st=ENG.applyAction(st,{type:'RESOLVE_SELECTION',selectedIids:Array(need).fill(kena.iid),actorIdx:0},pool);
  }
  assert.equal(st.pendingSelection,null,'鏈沒走完（guard 用盡）');
  const k=st.players[0].bench.find(c=>c.iid===kena.iid);
  assert.ok(k,'小碎鑽不在備戰了？');
  // 兩波（【超】＋【鋼】）都指定給小碎鑽 ⇒ 應附到 2 張；舊碼在逐張再驗會擋掉【超】那張
  //   （log「不符屬性 filter，略過此張」）⇒ 只會剩 1 張或 0 張。
  assert.equal(k.energyAttached.length,2,
    '小碎鑽身上應附到 2 張能量（實得 '+k.energyAttached.length+' 張）⇒ 鏈的逐張再驗仍在讀印刷屬性');
  assert.ok(!/不符屬性 filter/.test(JSON.stringify(st.log)),'逐張再驗把小碎鑽擋掉了：'+JSON.stringify(st.log.slice(-2)));
});
T('4i. 活力森林：base 走中央述詞後，一般【草】寶可夢的既有行為必須完全不變（回歸鎖）',()=>{
  // ⚠ 卡池沒有從狠辣椒ex 進化的卡 ⇒ 這兩處改動實測 0 行為差異；
  //   但把它們寫死成 false 原本不會有任何測試變紅（第二輪審查抓到）。這條補上回歸鎖。
  const pair=(()=>{for(const [id,c] of pool){ if(c.supertype!=='Pokemon'||c.pokemonType!=='Grass'||c.evolvesFrom) continue;
    for(const [i2,c2] of pool) if(c2.supertype==='Pokemon'&&c2.pokemonType==='Grass'&&c2.evolvesFrom===c.name) return [id,i2];
  } return null;})();
  assert.ok(pair,'抓不到【草】→【草】進化對');
  const base=I(pair[0],{justPlaced:true}); const evo=I(pair[1]);
  const mk=(stad)=>ST({active:I(PLAIN),bench:[base],hand:[evo],deck:[]},{active:I(PLAIN)},
                      stad?{activeStadium:I(stad)}:{});
  const canEvo=(stad)=>{const t=ENG.getEvolvableTargets(mk(stad),pool);
    return (t.find(x=>x.fromIid===base.iid)?.toIids??[]).includes(evo.iid);};
  assert.equal(canEvo(FOREST),true,'活力森林在場、草→草、剛放上場 ⇒ 應可進化（bypass 被寫死成 false 了？）');
  assert.equal(canEvo(null),false,'沒有活力森林時 justPlaced 必須擋下（正對照）');
  // EVOLVE handler 端同樣要放行（兩端同 commit）
  const r=ENG.applyAction(mk(FOREST),{type:'EVOLVE',fromIid:base.iid,toIid:evo.iid,actorIdx:0},pool);
  const nowBench=r.players[0].bench.find(c=>c.iid===base.iid);
  assert.equal(nowBench?.cardId,String(pair[1]),'EVOLVE handler 沒放行 ⇒ UI 黃框與實際行為分岔');
});
T('4j. 能量鏈**逐張 picker** 路徑（v158-energy-chain-attach）：逐張再驗＋附完後重算目標都要吃有效屬性',()=>{
  // ⚠ 第二輪 opus 審查抓到：4h 走的是 energy-distribute（計數器 UI），
  //   `v158-energy-chain-attach` 那條「一張一張選目標」的路徑（含 resolver 內的逐張再驗
  //   與附完後重算 validTargets）**零覆蓋** —— 把 inst 傳成 null 仍全綠。這條補上。
  const kena=I(KENA), other=I(PLAIN);
  const e1=I(PSYE), e2=I(PSYE);
  const s=ST({active:I(PLAIN),bench:[kena,other],discard:[e1,e2],deck:[]},{active:I(PLAIN)},{
    pendingSelection:{ type:'bench-choose', actorIdx:0, sourcePlayerIdx:0, minCount:1, maxCount:1,
      effectKey:'v158-energy-chain-attach',
      params:{ label:'測試鏈', scope:'any-own', filterType:['Psychic','Metal'],
               currentEnergy:e1.iid, remainingEnergies:[e2.iid], validIids:[kena.iid] } },
  });
  const r=ENG.applyAction(s,{type:'RESOLVE_SELECTION',selectedIids:[kena.iid],actorIdx:0},pool);
  const k=r.players[0].bench.find(c=>c.iid===kena.iid);
  const logs=JSON.stringify(r.log.map(l=>l.message));
  assert.ok(!/不符屬性 filter/.test(logs),'逐張再驗把小碎鑽擋掉了：'+logs);
  // 附完第 1 張後會**重算合法目標**：場上只有小碎鑽符合 ⇒ 走「僅剩 1 個合法目標 → 全附」那條
  //   （這正是第二個 call site；若它仍讀印刷屬性會變成「場上已無合法目標，剩 N 張留在棄牌區」）。
  assert.ok(!/場上已無合法目標/.test(logs),'重算合法目標時把小碎鑽漏掉了：'+logs);
  assert.equal(k?.energyAttached.length,2,
    '兩張能量都該附到小碎鑽（實得 '+(k?.energyAttached.length)+'）：'+logs);
  // 負對照：把 filterType 換成場上沒有的屬性 ⇒ 必須被擋下、能量留在棄牌區
  const k2=I(KENA), f1=I(PSYE);
  const s2=ST({active:I(PLAIN),bench:[k2],discard:[f1],deck:[]},{active:I(PLAIN)},{
    pendingSelection:{ type:'bench-choose', actorIdx:0, sourcePlayerIdx:0, minCount:1, maxCount:1,
      effectKey:'v158-energy-chain-attach',
      params:{ label:'測試鏈', scope:'any-own', filterType:['Water'],
               currentEnergy:f1.iid, remainingEnergies:[], validIids:[k2.iid] } },
  });
  const r2=ENG.applyAction(s2,{type:'RESOLVE_SELECTION',selectedIids:[k2.iid],actorIdx:0},pool);
  assert.equal(r2.players[0].bench.find(c=>c.iid===k2.iid)?.energyAttached.length,0,
    '不符 filter 卻附上去了 ⇒ 再驗變成擺設');
});

console.log('⑤ 逆境保險吃「弱點改寫」（站長裁定）—— 與傷害引擎共用 getEffectiveWeaknessType');
const FATT=(()=>{for(const [id,c] of pool){ if(c.supertype!=='Pokemon'||c.abilities||c.pokemonType!=='Fighting') continue;
  const a=(c.attacks||[])[0]; if(!a||a.effect) continue; const d=parseInt(a.damage||'0'); if(d<30||d>60) continue;
  if((a.cost||[]).some(x=>x!=='Fighting'&&x!=='Colorless')||(a.cost||[]).length>3) continue; return id;} return null;})();
const DEFG=(()=>{for(const [id,c] of pool) if(c.supertype==='Pokemon'&&c.weakness?.type==='Grass'
  &&!c.abilities&&(c.hp??0)>=250&&!c.resistance) return id; return null;})();
const insurRun=(defExtra,p0extra={})=>{
  const s=ST({active:I(FATT,{energyAttached:[I(FIGHTE),I(FIGHTE),I(FIGHTE)]}),deck:deck5(),...p0extra},
             {active:I(DEFG,{toolAttached:I(INSUR),...defExtra}),bench:[I(PLAIN)],deck:deck5()});
  const r=ENG.applyAction(s,{type:'ATTACK',attackIndex:0,actorIdx:0},pool);
  return {dmg:r.players[1].active?.damage, hand:r.players[1].hand.length,
          x2:/×2\(弱點\)/.test((r.log.find(l=>/使出/.test(l.message))||{}).message??'')};
};
T('5a. fixture 成立：印刷弱點【草】vs【鬥】攻擊者 ⇒ 不 ×2、不抽',()=>{
  assert.ok(FATT&&DEFG,'fixture 抓不到');
  const a=insurRun({});
  assert.equal(a.x2,false); assert.equal(a.hand,0);
});
T('5b. 掌握弱點覆寫（weaknessOverrideTypeThisTurn=Fighting）⇒ 傷害 ×2 **且**逆境保險抽 3 張',()=>{
  const b=insurRun({weaknessOverrideTypeThisTurn:'Fighting'});
  assert.equal(b.x2,true,'fixture 不成立：引擎沒吃覆寫');
  assert.equal(b.hand,3,'引擎已 ×2 但逆境保險不抽 ⇒ 兩邊對「弱點是什麼」認知不一致');
});
T('5c. 弱點失效（金屬防禦強化「弱點全部消除」）⇒ 不 ×2 **且**不抽（與傷害引擎同一判準）',()=>{
  const c=insurRun({weaknessOverrideTypeThisTurn:'Fighting',weaknessDisabledThisTurn:true});
  assert.equal(c.x2,false); assert.equal(c.hand,0,'弱點已消除卻仍抽 3 張');
});
const DRAGONH=(()=>{for(const [id,c] of pool) if(c.supertype==='Pokemon'&&c.pokemonType==='Dragon'
  &&!c.abilities&&(c.hp??0)>=250) return id; return null;})();
const PATT=(()=>{for(const [id,c] of pool){ if(c.supertype!=='Pokemon'||c.abilities||c.pokemonType!=='Psychic') continue;
  const a=(c.attacks||[])[0]; if(!a||a.effect) continue; const d=parseInt(a.damage||'0'); if(d<30||d>60) continue;
  if((a.cost||[]).some(x=>x!=='Psychic'&&x!=='Colorless')) continue; return id;} return null;})();
const dragonRun=(withFairy)=>{
  const s=ST({active:I(PATT,{energyAttached:[I(PSYE),I(PSYE),I(PSYE)]}),bench:withFairy?[I(FAIRY)]:[],deck:deck5()},
             {active:I(DRAGONH,{toolAttached:I(INSUR)}),bench:[I(PLAIN)],deck:deck5()});
  const r=ENG.applyAction(s,{type:'ATTACK',attackIndex:0,actorIdx:0},pool);
  return {hand:r.players[1].hand.length,x2:/×2\(弱點\)/.test((r.log.find(l=>/使出/.test(l.message))||{}).message??'')};
};
T('5d. 妖精領域（對手【龍】弱點改【超】）⇒【超】攻擊者 ×2 **且**抽 3 張；沒有皮皮ex 則兩者都不發生',()=>{
  assert.ok(DRAGONH&&PATT,'fixture 抓不到');
  const off=dragonRun(false), on=dragonRun(true);
  assert.equal(off.x2,false); assert.equal(off.hand,0);
  assert.equal(on.x2,true,'fixture 不成立：引擎沒吃妖精領域');
  assert.equal(on.hand,3,'引擎已 ×2 但逆境保險不抽');
});

console.log('⑥ 威嚇之顎接特性消除閘（站長裁定）');
const JATT=(()=>{for(const [id,c] of pool){ if(c.supertype!=='Pokemon'||c.abilities||c.pokemonType!=='Colorless') continue;
  const a=(c.attacks||[])[0]; if(!a||a.effect) continue; const d=parseInt(a.damage||'0'); if(d!==50) continue;
  if((a.cost||[]).some(x=>x!=='Colorless')||(a.cost||[]).length>2) continue; return id;} return null;})();
const fossilRun=(fid,extra={},oppActive=null)=>{
  const s=ST({active:I(JATT,{energyAttached:[I(FIREE),I(FIREE)]}),deck:deck5()},
             {active:I(fid,{fossilOnField:true}),bench:[I(PLAIN)],deck:deck5()},extra);
  if(oppActive){s.players[0].bench=[I(oppActive)];}
  const r=ENG.applyAction(s,{type:'ATTACK',attackIndex:0,actorIdx:0},pool);
  return r.players[1].active?.damage;
};
T('6a. fixture 成立：50 傷害攻擊者',()=>{ assert.ok(JATT,'找不到 50 點無效果【無】攻擊者'); });
T('6b. 顎之化石基準：50-30=20',()=>{ assert.equal(fossilRun(JAW),20); });
T('6c.〔核心〕火箭隊的監視塔（消【無】）⇒ 化石在場上是【無】⇒ 威嚇之顎被消除 ⇒ 不減傷（50）',()=>{
  assert.equal(fossilRun(JAW,{activeStadium:I(WATCH)}),50,'消除閘沒接上');
});
T('6d. 傳說的熔岩洞（消進化）⇒ 化石在場上是【基礎】⇒ 打不到 ⇒ 仍 -30（20）',()=>{
  assert.equal(fossilRun(JAW,{activeStadium:I(CAVE)}),20,'把化石誤判成進化寶可夢');
});
T('6e. 攻擊方戰鬥場是 振翼髮｜暗夜羽擊（passive，location=active）⇒ 打得到 ⇒ 不減傷（用 log 判）',()=>{
  const s=ST({active:I(MOON,{energyAttached:[I(FIREE),I(FIREE),I(FIREE)]}),deck:deck5()},
             {active:I(JAW,{fossilOnField:true}),bench:[I(PLAIN)],deck:deck5()});
  const r=ENG.applyAction(s,{type:'ATTACK',attackIndex:0,actorIdx:0},pool);
  assert.equal(/陳舊的顎之化石：受到的傷害 -30/.test(JSON.stringify(r.log)),false,
    '威嚇之顎仍生效 ⇒ 消除閘沒接上');
  // 正對照：同一 90 傷害招式、把攻擊者換成沒有特性的 ⇒ -30 必須出現（否則上面是安慰劑）
  const NOAB90=(()=>{for(const [id,c] of pool){ if(c.supertype!=='Pokemon'||c.abilities) continue;
    const a=(c.attacks||[])[0]; if(!a||a.effect) continue; if(parseInt(a.damage||'0')<60) continue;
    if((a.cost||[]).some(x=>x!=='Colorless')||(a.cost||[]).length>3) continue; return id;} return null;})();
  assert.ok(NOAB90,'找不到無特性【無】費攻擊者');
  const s2=ST({active:I(NOAB90,{energyAttached:[I(FIREE),I(FIREE),I(FIREE)]}),deck:deck5()},
              {active:I(JAW,{fossilOnField:true}),bench:[I(PLAIN)],deck:deck5()});
  const r2=ENG.applyAction(s2,{type:'ATTACK',attackIndex:0,actorIdx:0},pool);
  assert.equal(/陳舊的顎之化石：受到的傷害 -30/.test(JSON.stringify(r2.log)),true,'正對照沒減傷 ⇒ 6e 沒有證明力');
});
T('6f. 同族對照：盾之守護（v6.206 已接閘）在監視塔下同樣失效 —— 兩張化石行為一致',()=>{
  assert.equal(fossilRun(SHIELD),40);
  assert.equal(fossilRun(SHIELD,{activeStadium:I(WATCH)}),50);
});

console.log('⑦ 差分實跑：「應該不變」的必須 0 mismatch');
T('7a. 由紫 gate 差分：全卡池逐一當備戰，舊（印刷 Psychic）vs 新（實跑）',()=>{
  const mons=[...pool.entries()].filter(([,c])=>c.supertype==='Pokemon');
  assert.ok(mons.length>=2000,'只掃到 '+mons.length+' 張，掃描器壞了？');
  let n=0,diff=[];
  for(const [id,c] of mons){
    const old=(c.pokemonType==='Psychic');
    const s=ST({active:I(PLAIN),bench:[I(id,{damage:10})],hand:[I(YUZI)],deck:[I(PLAIN)]},{active:I(PLAIN)});
    const now=EFF.TRAINER_GUARDS.get('由紫')(s,0,pool);
    n++; if(old!==now) diff.push(c.name+' '+old+'→'+now);
  }
  const names=[...new Set(diff.map(x=>x.split(' ')[0]))].sort();
  assert.deepEqual(names,['小碎鑽'],'差異卡名應只有小碎鑽，實得：'+JSON.stringify(names.slice(0,10)));
  assert.ok(diff.every(x=>/false→true$/.test(x)),'必須是純新增（false→true）：'+diff.slice(0,3));
  console.log('    差分：'+n+' 組，mismatch '+diff.length+' 筆（全部是小碎鑽 false→true）');
});
T('7b. 福祿果差分（**行為端**全流程 ATTACK）：印刷【超】的攻擊方全數 ＋ 非【超】對照 200 張，'
 +'「有沒有 -60」只應在小碎鑽身上改變',()=>{
  // ⚠ 舊模型**不可**只寫成「印刷是【超】」—— 福祿果卡面是「受到…招式的**傷害**時」，
  //   0 傷害招式（【超】卡裡很多）本來就不會觸發，第一版就是這樣誤報 40+ 張。
  //   正確舊模型＝「印刷是【超】**且**這一招在同一盤面真的打出 >0 傷害」。
  // ⚠ 擲幣招式把 Math.random 釘死，否則差分自己在說謊。
  // ⚠ 全流程 ATTACK 很慢（~25 次/秒）⇒ 覆蓋面取「所有可能 old=true 的（印刷【超】）
  //   ＋ 小碎鑽 ＋ 200 張非【超】對照」，而不是整池 1400 張（CI 時間）。下限斷言在下面。
  // 能量按**印刷屬性**配（小碎鑽印刷【鬥】、招式費【鬥】【鬥】【無】⇒ 4 張基本【鬥】付得起）
  const BASIC_BY_TYPE={};
  for(const [id,c] of pool) if(c.supertype==='Energy'&&c.subtype==='Basic'){
    const t=ENG.getBasicEnergyType?ENG.getBasicEnergyType(c):null; if(t&&!BASIC_BY_TYPE[t]) BASIC_BY_TYPE[t]=id; }
  const CE=BASIC_BY_TYPE['Colorless']??FIREE;
  const eOf=(c)=>BASIC_BY_TYPE[c.pokemonType]??CE;
  const cost0=([,c])=>c.supertype==='Pokemon'&&(c.attacks??[])[0]
    &&((c.attacks[0].cost??[]).every(x=>x===c.pokemonType||x==='Colorless'))&&(c.attacks[0].cost??[]).length<=4;
  const all=[...pool.entries()].filter(cost0);
  const psy=all.filter(([,c])=>c.pokemonType==='Psychic');
  const kena=[...pool.entries()].filter(([,c])=>c.name==='小碎鑽');
  const others=all.filter(([,c])=>c.pokemonType!=='Psychic').slice(0,200);
  const mons=[...psy,...kena,...others];
  assert.ok(psy.length>=100,'印刷【超】只掃到 '+psy.length+' 張，掃描器壞了？');
  assert.ok(kena.length>=2,'小碎鑽只掃到 '+kena.length+' 個印刷');
  assert.ok(mons.length>=300,'總樣本只有 '+mons.length+' 張');
  // ⚠ **不可**寫成 Math.random=()=>0.25（恆正面）—— flip-until-tails 型招式會無限迴圈，
  //   整個 test 掛住不會紅（第一版就是這樣跑不完）。改用固定種子 LCG：可重現且必定出反面。
  const rnd=Math.random; let _seed=12345;
  Math.random=()=>{ _seed=(_seed*1103515245+12345)&0x7fffffff; return _seed/0x7fffffff; };
  try{
    const dmgOf=(r)=>{const m=(r.log.find(l=>/造成 \d+ 點傷害/.test(l.message))||{}).message??'';
      const g=/造成 (\d+) 點傷害/.exec(m); return g?parseInt(g[1]):0;};
    let n=0,diff=[];
    for(const [id,c] of mons){
      const EE=eOf(c);
      const s=ST({active:I(id,{energyAttached:[I(EE),I(EE),I(EE),I(EE)]}),deck:deck5()},
                 {active:I(WPSY,{toolAttached:I(PLUM)}),bench:[I(PLAIN)],deck:deck5()});
      const r=ENG.applyAction(s,{type:'ATTACK',attackIndex:0,actorIdx:0},pool);
      const now=/福祿果：招式傷害/.test(JSON.stringify(r.log));
      const dealt=now||dmgOf(r)>0;
      const old=(c.pokemonType==='Psychic')&&dealt;
      n++; if(old!==now) diff.push(c.name+' '+old+'→'+now);
    }
    const names=[...new Set(diff.map(x=>x.split(' ')[0]))].sort();
    assert.deepEqual(names,['小碎鑽'],'實得：'+JSON.stringify(names.slice(0,10)));
    assert.ok(diff.every(x=>/false→true$/.test(x)),'必須是純新增：'+diff.slice(0,3));
    console.log('    差分：'+n+' 組（全流程 ATTACK），mismatch '+diff.length+' 筆');
  } finally { Math.random=rnd; }
});
T('7c. 威嚇之顎差分：全部化石逐一當戰鬥位，只有顎之化石 -30 / 盾甲化石 -10，其餘不變',()=>{
  let n=0,bad=[];
  for(const [id,c] of pool){
    if(c.supertype!=='Trainer'||c.subtype!=='Item'||!/^陳舊的.*化石$/.test(c.name)) continue;
    const d=fossilRun(id);
    const want=(c.name==='陳舊的顎之化石')?20:(c.name==='陳舊的盾甲化石'?40:50);
    n++; if(d!==want) bad.push(c.name+' got '+d+' want '+want);
  }
  assert.ok(n>=6,'只掃到 '+n+' 張化石');
  assert.equal(bad.length,0,bad.join(' | '));
  console.log('    差分：'+n+' 張化石，mismatch '+bad.length+' 筆');
});
T('7d. 逆境保險差分：沒有任何弱點改寫的盤面，抽不抽 3 張必須與「印刷弱點比對」完全一致',()=>{
  const mons=[...pool.entries()].filter(([,c])=>c.supertype==='Pokemon'&&(c.hp??0)>=200&&!c.abilities);
  assert.ok(mons.length>=200,'只掃到 '+mons.length+' 張，掃描器壞了？');
  let n=0,diff=[];
  for(const [id,c] of mons){
    const old=(c.weakness?.type==='Fighting');   // 攻擊者 FATT 是【鬥】、無雙屬性特性
    const s=ST({active:I(FATT,{energyAttached:[I(FIGHTE),I(FIGHTE),I(FIGHTE)]}),deck:deck5()},
               {active:I(id,{toolAttached:I(INSUR)}),bench:[I(PLAIN)],deck:deck5()});
    const r=ENG.applyAction(s,{type:'ATTACK',attackIndex:0,actorIdx:0},pool);
    const now=(r.players[1].hand.length===3);
    n++; if(old!==now) diff.push(c.name+' '+old+'→'+now);
  }
  assert.equal(diff.length,0,n+' 組中 mismatch '+diff.length+' 筆：'+diff.slice(0,8).join(' | '));
  console.log('    差分：'+n+' 組，mismatch 0 筆');
});
T('7e. 全卡池「有效屬性 ⊇ 印刷屬性」不變式 —— 本輪所有替換都是純新增，不得弄丟本色',()=>{
  const mons=[...pool.entries()].filter(([,c])=>c.supertype==='Pokemon'&&c.pokemonType);
  assert.ok(mons.length>=2000,'只掃到 '+mons.length+' 張');
  let n=0,bad=[];
  for(const [id,c] of mons) for(const onBench of [false,true]){
    const inst=I(id);
    const st=onBench?ST({active:I(PLAIN),bench:[inst]},{active:I(PLAIN)}):ST({active:inst},{active:I(PLAIN)});
    const t=EFF.getEffectivePokemonTypes(st,0,inst,c,pool);
    n++; if(!t.includes(c.pokemonType)) bad.push(c.name+(onBench?'/備戰':'/戰鬥場')+' '+JSON.stringify(t));
  }
  assert.equal(bad.length,0,bad.slice(0,5).join(' | '));
  assert.ok(n>=4000,'只跑了 '+n+' 組');
});

console.log('⑧ 接線守衛（否定型一律配正對照，先剝註解＋字串字面量）');
// ⚠⚠ 破壞測試 E5 抓到：舊版 strip 先把字串字面量清成 ''，**判準要比對的 'Psychic' 也一起被清掉**
//   ⇒ 把違規樣本塞回去仍然全綠（假綠）。改成**逐字元掃描**：只砍註解，字串內容原樣保留，
//   且 // 在字串裡（如 'https://…'）不會被誤判成註解。
const strip=(src)=>{
  let out='',i=0,q=null;
  while(i<src.length){
    const ch=src[i], nx=src[i+1];
    if(q){ out+=ch; if(ch==='\\'){ out+=nx??''; i+=2; continue; } if(ch===q) q=null; i++; continue; }
    if(ch==='"'||ch==="'"||ch==='`'){ q=ch; out+=ch; i++; continue; }
    if(ch==='/'&&nx==='/'){ while(i<src.length&&src[i]!=='\n') i++; continue; }
    if(ch==='/'&&nx==='*'){ i+=2; while(i<src.length&&!(src[i]==='*'&&src[i+1]==='/')) i++; i+=2; continue; }
    out+=ch; i++;
  }
  return out.replace(/[​-‍﻿]/g,'');
};
const src=(p)=>readFileSync(join(ROOT,p),'utf8');
T('8a. strip 自我驗證（三個正對照 ＋ 一個「字串內容必須保留」—— E5 破壞測試抓到的假綠）',()=>{
  assert.ok(/KEEP/.test(strip("const u = 'https://a.b'; KEEP;")),'strip 把同一行真碼砍掉了（URL 裡的 //）');
  assert.ok(!/GONE/.test(strip('// GONE\nKEEP;')),'strip 沒有砍掉純註解');
  assert.ok(!/GONE/.test(strip('/* GONE */ KEEP;')),'strip 沒有砍掉區塊註解');
  assert.ok(/'Psychic'/.test(strip("x === 'Psychic'; // c")),'strip 把字串內容清掉了 ⇒ 下面的判準會恆假（假綠）');
  assert.ok(!/GONE/.test(strip("const s='// not a comment'; // GONE")),'字串裡的 // 被誤判成註解起點');
  assert.ok(/not a comment/.test(strip("const s='// not a comment'; // GONE")));
});
// ⚠⚠ 第二輪 opus 審查抓到：舊 8b 是**安慰劑** —— 它的 BAD regex 只認 inline 的
//   `pool.get(x.cardId)?.pokemonType === 'Psychic'`，但那幾個檔在 **BASE 也是 0 命中**
//   （原碼多半是 `const card = pool.get(...); card?.pokemonType === ...` 的區域變數形），
//   而且 FILES 還漏列了 items_misc.ts / tools.ts。⇒ 換成**凍結清單**型絆線：
//   把這 9 個檔剩下的每一行 pokemonType 比對逐字釘死＋寫明「為什麼留印刷屬性」，
//   任何新增/刪改都會紅，逼人回來重新判讀（純 regex 分不出牌庫端 vs 場上端，這是唯一誠實的做法）。
const FROZEN_PRINTED_READS = {
  'src/lib/game/effects/cards/items_misc.ts': [
    "return a.damage > 0 && pool.get(a.cardId)?.pokemonType === 'Dragon';",       // 龍之秘藥 gate（【龍】家族延後，見 changelog ①）
    "if (!target || pool.get(target.cardId)?.pokemonType !== 'Dragon') {",        // 龍之秘藥 resolver（同上，兩端一起延後）
    "return card?.supertype === 'Pokemon' && card.pokemonType === 'Water';",      // 牌庫/棄牌區搜尋條件 ⇒ 印刷屬性才對
    "return card?.supertype === 'Pokemon' && card.pokemonType === 'Water';",
    "if (card.supertype === 'Pokemon' && card.pokemonType === 'Water') return true;",
    "&& (card.pokemonType === 'Water' || card.name?.includes('【水】'))) return true;",
  ],
  'src/lib/game/effects/cards/energy_cards.ts': [
    "return cc?.supertype === 'Pokemon' && !cc.evolvesFrom && cc.pokemonType === 'Psychic';", // 卡面「從自己的**牌庫**選擇…」⇒ 印刷屬性
    "if (holder.pokemonType === 'Metal') return { zero: true };",                 // 磁鐵【鋼】能量：hook 只收 Card，需加必填 ctx ⇒ 延後
    "if (holder.pokemonType !== 'Water') return new Set<SpecialCondition>();",    // 泡沫水【水】能量：同上
  ],
  'src/lib/game/effects/cards/v158_energy_chain.ts': [
    "const t = (c.pokemonType as SingleType | undefined) ?? nameToType(c.name);", // **能量卡**的屬性，不是寶可夢
    "const enType = (card.pokemonType as SingleType | undefined);",               // 同上
  ],
  'src/lib/game/effects/cards/v168_supporters.ts': [],
  'src/lib/game/effects/cards/stadiums.ts': [],
  'src/lib/game/effects/cards/v2998_g2.ts': [],
  'src/lib/game/effects/cards/lopunny_serperior_flareon_festival.ts': [],
  'src/lib/game/effects/cards/tools.ts': [],
  'src/lib/game/effects/cards/abra_mawile_deck.ts': [],
};
const readsOf=(f)=>strip(src(f)).split('\n').map(l=>l.trim()).filter(l=>l.includes('pokemonType'));
T('8b.〔凍結清單〕本輪碰過的 9 個檔，剩下的印刷屬性讀取必須逐字等於凍結清單',()=>{
  const bad=[];
  for(const [f,exp] of Object.entries(FROZEN_PRINTED_READS)){
    const got=readsOf(f);
    if(JSON.stringify(got)!==JSON.stringify(exp))
      bad.push(f+'\n        got : '+JSON.stringify(got)+'\n        want: '+JSON.stringify(exp));
  }
  assert.equal(bad.length,0,'印刷屬性讀取清單變了（新增＝新技術債，刪除＝清單過期）：\n      '+bad.join('\n      '));
  // 下限：清單不得整個空掉（掃描器壞了會長這樣）
  assert.ok(Object.values(FROZEN_PRINTED_READS).flat().length>=10,'凍結清單只剩 '+
    Object.values(FROZEN_PRINTED_READS).flat().length+' 條 —— 掃描器壞了？');
  // 正對照：readsOf 真的抓得到（拿一個已知一定有的檔驗）
  assert.ok(readsOf('src/lib/game/effects/cards/energy_cards.ts').length>=3,'readsOf 抓不到東西');
});
T('8c. 每個改過的檔都真的 import 了中央述詞（漏 import＝runtime 炸彈，tsc -p 可能假綠）',()=>{
  const NEED={'src/lib/game/effects/cards/v168_supporters.ts':'hasEffectivePokemonType',
    'src/lib/game/effects/cards/stadiums.ts':'hasEffectivePokemonType',
    'src/lib/game/effects/cards/items_misc.ts':'hasEffectivePokemonType',
    'src/lib/game/effects/cards/energy_cards.ts':'hasEffectivePokemonType',
    'src/lib/game/effects/cards/v2998_g2.ts':'hasEffectivePokemonType',
    'src/lib/game/effects/cards/lopunny_serperior_flareon_festival.ts':'getEffectivePokemonTypes',
    'src/lib/game/effects/cards/v158_energy_chain.ts':'getEffectivePokemonTypes',
    'src/lib/game/effects/cards/tools.ts':'getEffectiveWeaknessType'};
  const bad=[];
  for(const [f,sym] of Object.entries(NEED)){
    const s=src(f);
    const ok=new RegExp('import\\s*\\{[^}]*\\b'+sym+'\\b[^}]*\\}\\s*from\\s*[\'"]\\.\\./\\.\\./effects[\'"]').test(s);
    if(!ok) bad.push(f+' 缺 '+sym);
  }
  assert.equal(bad.length,0,bad.join(' | '));
});
T('8d. v158_energy_chain 的 pokemonMatchesType 是**必填**場上脈絡（不得留下 1 參數的舊呼叫）',()=>{
  const s=strip(src('src/lib/game/effects/cards/v158_energy_chain.ts'));
  const calls=[...s.matchAll(/pokemonMatchesType\(/g)];
  assert.ok(calls.length>=5,'只掃到 '+calls.length+' 個呼叫（含定義），掃描器壞了？');
  // 舊簽名 = 兩個參數；新簽名 = 六個。用「呼叫括號內逗號數」粗篩後人工錨點：
  assert.ok(/pokemonMatchesType\(\s*\n?\s*st:/.test(src('src/lib/game/effects/cards/v158_energy_chain.ts')),
    '定義沒有改成收 st');
  assert.equal(/pokemonMatchesType\(pool\.get/.test(s),false,'還有舊的 2 參數呼叫');
});

console.log(`\n=== v6.207 ${pass} PASS / ${fail} FAIL ===`);
if(fail>0) process.exit(1);
