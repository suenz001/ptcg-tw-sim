// v6.025：火箭隊的瓦斯彈｜警備濁霧「特性沒發動」真根因守衛。
//   卡面：這隻寶可夢在戰鬥場受到對手的寶可夢招式的傷害時，從自己的牌庫選擇最多2張名稱中有「瓦斯彈」
//         的寶可夢卡，放置於備戰區。並且重洗牌庫。
//   根因：原 pending 用 filter 'NameContains:瓦斯彈'，但該 filter 是 v5.155 為【化石採掘場】設計的，
//   UI/AI 端硬性限定 Trainer+Item（只列物品卡）→ 要搜寶可夢卻一張都篩不出來＝空的選卡視窗，
//   玩家體感「特性沒發動」。引擎其實有正常觸發（本測試也一併鎖住觸發本身）。
//   修：改用中央三端都支援的 'Pokemon:NameContains='。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.gg-s.js'); const E=join(ROOT,'.gg-e.ts'); const O=join(ROOT,'.gg-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { applyAction } from './src/lib/game/engine';\nexport { evaluateSelectionFilter } from './src/lib/game/selection-filter';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { applyAction, evaluateSelectionFilter }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const guard=pool.get('12819');   // 火箭隊的瓦斯彈（特性 警備濁霧）
const plain=pool.get('12518');   // 瓦斯彈
assert.ok(guard && plain, '測試素材齊全');
// 費用全【無】的攻擊者，避免屬性不符被引擎 gate 擋掉
let atkPick=null;
for (const [,c] of pool) {
  if (c.supertype!=='Pokemon' || c.evolvesFrom) continue;
  const i=(c.attacks||[]).findIndex(a=>/^\d+$/.test(String(a.damage||''))&&Number(a.damage)>0&&(a.cost||[]).length>0&&(a.cost||[]).length<=2&&(a.cost||[]).every(x=>x==='Colorless'));
  if(i>=0){ atkPick={card:c,idx:i}; break; }
}
assert.ok(atkPick,'應找得到費用全無的攻擊者');
const energyCard=[...pool.values()].find(c=>c.supertype==='Energy'&&c.subtype==='Basic');
let nn=0; const inst=(c)=>({iid:'i'+(++nn),cardId:String(c.id),damage:0,energyAttached:[]});

let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

function attackOnce(){
  const atk=inst(atkPick.card);
  atk.energyAttached=(atkPick.card.attacks[atkPick.idx].cost||[]).map(()=>inst(energyCard));
  const st={phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],
    setupDone:[true,true],pendingPrizes:[0,0],pendingMulliganDraw:[0,0],pendingSelection:null,
    players:[
      {name:'P1',active:atk,bench:[],hand:[],deck:[inst(plain)],discard:[],prizes:[1,1,1,1,1,1]},
      {name:'P2',active:inst(guard),bench:[],hand:[],deck:[inst(plain),inst(plain)],discard:[],prizes:[1,1,1,1,1,1]},
    ]};
  return applyAction(st,{type:'ATTACK',attackIndex:atkPick.idx,actorIdx:0},pool);
}

T('警備濁霧：戰鬥場受招式傷害會觸發並開啟選卡（引擎層）',()=>{
  const a=attackOnce();
  assert.ok(String(JSON.stringify(a.log)).includes('警備濁霧'), '應有觸發 log');
  assert.ok(a.pendingSelection, '應開啟 pending');
  assert.equal(a.pendingSelection.type, 'deck-search');
  assert.equal(a.pendingSelection.effectKey, 'bench-named-basic-from-deck');
});

T('filter 必須用中央支援的 Pokemon:NameContains=（HEAD 用 NameContains: → picker 只列物品卡而篩不到寶可夢）',()=>{
  const a=attackOnce();
  const f=a.pendingSelection?.filter;
  assert.equal(f, 'Pokemon:NameContains=瓦斯彈', 'filter 應為 Pokemon:NameContains=瓦斯彈，實際=' + f);
});

T('中央求值器：該 filter 選得到兩張「瓦斯彈」寶可夢，且不會選到同名以外/物品卡',()=>{
  const f='Pokemon:NameContains=瓦斯彈';
  assert.equal(evaluateSelectionFilter('deck-search',f,{iid:'x'},guard,{}), true, '火箭隊的瓦斯彈應可選');
  assert.equal(evaluateSelectionFilter('deck-search',f,{iid:'x'},plain,{}), true, '瓦斯彈應可選');
  const someItem=[...pool.values()].find(c=>c.supertype==='Trainer'&&c.subtype==='Item');
  assert.equal(evaluateSelectionFilter('deck-search',f,{iid:'x'},someItem,{}), false, '物品卡不可選');
  const otherPoke=[...pool.values()].find(c=>c.supertype==='Pokemon'&&!c.name.includes('瓦斯彈'));
  assert.equal(evaluateSelectionFilter('deck-search',f,{iid:'x'},otherPoke,{}), false, '名稱不含瓦斯彈的寶可夢不可選');
});

T('回歸鎖：舊 filter 語義（Trainer+Item）確實篩不到任何瓦斯彈寶可夢 → 證明撞號會讓 picker 全空',()=>{
  const oldUiPredicate=(card,sub)=>!!card && card.supertype==='Trainer' && card.subtype==='Item' && card.name.includes(sub);
  assert.equal(oldUiPredicate(guard,'瓦斯彈'), false);
  assert.equal(oldUiPredicate(plain,'瓦斯彈'), false);
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
