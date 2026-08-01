// v6.082 守衛：「兩張合一」競技場（M6 傳說的海溝／山頂／熔岩洞）牌組層規則
//   ⭐ 兩份名單（牌組驗證層 / 對戰引擎層）必須一致 —— 分開是為了不讓牌組頁 import 整個引擎。
//   ⭐ 否定對照：一般卡不受偶數限制、偶數張數不報錯。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S=join(ROOT,'.tcs-s.js'),E=join(ROOT,'.tcs-e.ts'),O=join(ROOT,'.tcs-o.mjs');
process.on('exit',()=>{for(const p of[S,E,O]){try{unlinkSync(p)}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { validateDeck, isTwoCardStadium, TWO_CARD_STADIUM_NAMES } from './src/lib/decks/validation';\n"
              +"export { LEGEND_STADIUM_NAMES, twoCardStadiumHalfIndex, twoCardStadiumPartnerCardId } from './src/lib/game/effects/_shared';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',
  alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const M = await import(pathToFileURL(O).href);
const { validateDeck } = M;
const isTwoCardStadium = M.isTwoCardStadium ?? (() => false);           // HEAD-FAIL 安全
const TWO_CARD = M.TWO_CARD_STADIUM_NAMES ?? new Set();
const LEGEND = M.LEGEND_STADIUM_NAMES ?? new Set();

const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const byId=new Map();
for(const f of readdirSync(dir)){ if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;
  for(const c of JSON.parse(readFileSync(join(dir,f),'utf8'))) if(c?.id!=null) byId.set(String(c.id), c); }
const byName=(n,p2)=>[...byId.values()].find(c=>c.name===n && (!p2||p2(c)));
let pass=0,fail=0; const chk=(t,c,extra='')=>{ if(c){pass++;} else {fail++;console.log('  ❌',t,extra);} };

// ⭐ 兩份清單一致性（新增卡時漏改一邊 → 牌組能放單數張但引擎當它是雙張卡）
chk('兩份「傳說競技場」清單一致',
    [...TWO_CARD].sort().join(',') === [...LEGEND].sort().join(','),
    `deck=${[...TWO_CARD]} engine=${[...LEGEND]}`);
chk('清單非空', TWO_CARD.size === 3, String(TWO_CARD.size));

// 述詞：三張都算、一般競技場不算
for (const n of ['傳說的海溝','傳說的山頂','傳說的熔岩洞']) {
  const c = byName(n);
  chk(`${n} 在 DB 內`, !!c);
  chk(`${n} 判為兩張合一`, isTwoCardStadium(c));
}
{
  const normal = [...byId.values()].find(c=>c.subtype==='Stadium' && !TWO_CARD.has(c.name));
  chk('否定對照：一般競技場不算兩張合一', !isTwoCardStadium(normal), normal?.name);
  const basic = [...byId.values()].find(c=>c.supertype==='Pokemon');
  chk('否定對照：寶可夢不算兩張合一', !isTwoCardStadium(basic));
  chk('否定對照：undefined 不會爆', isTwoCardStadium(undefined)===false);
}

// validateDeck：v6.093 起左右是兩張獨立的卡 → 檢查「左右張數必須相等」（原本是「同 cardId 偶數」）
{
  const trench = byName('傳說的海溝', c => c.collectorNumber === '071/076');
  const trenchR = byName('傳說的海溝', c => c.collectorNumber === '072/076');
  const basicPoke = [...byId.values()].find(c=>c.supertype==='Pokemon' && (c.stage==='Basic'||c.subtype==='Basic') && ['H','I','J'].includes(c.regulationMark));
  const water = [...byId.values()].find(c=>c.name==='基本【水】能量');
  // mk(l, r)：左半 l 張、右半 r 張
  const mk=(l, r=0)=>({ id:'t', name:'t', entries:[
    ...(l>0 ? [{ cardId:String(trench.id), count:l }] : []),
    ...(r>0 ? [{ cardId:String(trenchR.id), count:r }] : []),
    { cardId:String(basicPoke.id), count:4 },
    { cardId:String(water.id), count:60-4-l-r },
  ]});
  const HINT = '要成套';
  const onlyLeft = validateDeck(mk(1, 0), byId);
  chk('⭐ 只有左半 1 張 → 報「左右要成套」', onlyLeft.issues.some(s=>s.includes(HINT)), JSON.stringify(onlyLeft.issues));
  const onlyRight = validateDeck(mk(0, 1), byId);
  chk('⭐ 只有右半 1 張 → 報「左右要成套」', onlyRight.issues.some(s=>s.includes(HINT)), JSON.stringify(onlyRight.issues));
  const lopsided = validateDeck(mk(3, 1), byId);
  chk('⭐ 左 3 右 1（張數不等）→ 報「左右要成套」', lopsided.issues.some(s=>s.includes(HINT)));
  const ok1 = validateDeck(mk(1, 1), byId);
  chk('否定對照：左 1 右 1（1 套）→ 不報成套問題', !ok1.issues.some(s=>s.includes(HINT)), JSON.stringify(ok1.issues));
  const ok2 = validateDeck(mk(2, 2), byId);
  chk('否定對照：左 2 右 2（2 套、合計 4 張）→ 不報成套問題', !ok2.issues.some(s=>s.includes(HINT)));
  // ⭐ Wilson 裁定：左右合計最多 4 張（＝2 套）—— 由既有「同名 4 張」規則涵蓋（兩張同名）
  const over = validateDeck(mk(3, 3), byId);
  chk('⭐ 左 3 右 3（合計 6 張）→ 被同名 4 張上限擋下', over.issues.some(s=>s.includes('4')), JSON.stringify(over.issues));
  // ⭐ 否定對照：一般卡放單數張不該報成套問題
  const normalOdd = validateDeck({ id:'t',name:'t',entries:[
    { cardId:String(basicPoke.id), count:3 },
    { cardId:String(water.id), count:57 },
  ]}, byId);
  chk('否定對照：一般卡 3 張不報成套問題', !normalOdd.issues.some(s=>s.includes(HINT)), JSON.stringify(normalOdd.issues));
}

// ⭐ v6.085（Fable 5 審 v6.084 指出的潛伏雷）：對戰層用 **cardId** 聚合手牌（同 cardId ≥2 才算一套），
//   牌組層用 **卡名** 判偶數。目前三張各只有一個印刷 id 所以一致；但本站有「補收秘密稀有印刷」的慣例，
//   一旦同名出現第二個 cardId，玩家放「A 印刷 1 張 + B 印刷 1 張」會**過牌組驗證（偶數 2）卻永遠打不出**
//   （每個 cardId 都只有 1 張）—— 靜默軟鎖，玩家講不清楚。
//   這個守衛讓那一天在上線前就 FAIL，逼我們把對戰層改成卡名聚合。
{
  const idsByName = new Map();
  for (const c of byId.values()) {
    if (!TWO_CARD.has(c.name)) continue;
    if (!idsByName.has(c.name)) idsByName.set(c.name, new Set());
    idsByName.get(c.name).add(String(c.id));
  }
  // ⭐ v6.093：左右已經是兩張獨立的卡 → 每個名字**恰好兩個 id**，而且必須互為對照表的一對。
  //   （原本的守衛是「只有一個 id」，那是拆卡之前的模型；拆卡後反過來要求恰好兩個。）
  for (const [name, ids] of idsByName) {
    chk(`⭐「${name}」恰好兩個 cardId（左右各一張）`, ids.size === 2, `ids=${[...ids].join(',')}`);
    const [a, b] = [...ids];
    chk(`⭐「${name}」兩個 id 在左右對照表中互為一對`,
        M.twoCardStadiumPartnerCardId?.(a) === b && M.twoCardStadiumPartnerCardId?.(b) === a,
        `${a}<->${M.twoCardStadiumPartnerCardId?.(a)} / ${b}<->${M.twoCardStadiumPartnerCardId?.(b)}`);
  }
  chk('三張兩張合一競技場都在 DB 內', idsByName.size === 3, String(idsByName.size));
}

// ⭐ v6.086 手牌裁半（左半／右半）判定 —— 桌機／手機兩端共用這一份
{
  const half = M.twoCardStadiumHalfIndex ?? (() => null);   // HEAD-FAIL 安全
  const trench = byName('傳說的海溝', c => c.collectorNumber === '071/076');
  const trenchR = byName('傳說的海溝', c => c.collectorNumber === '072/076');
  const normal = [...byId.values()].find(c=>c.subtype==='Stadium' && !TWO_CARD.has(c.name));
  const mk=(cid,iid)=>({iid,cardId:String(cid)});
  // ⭐ v6.093：左右由 cardId 決定，**與手上的排列順序無關**
  const hand=[mk(trench.id,'a'), mk(normal.id,'n1'), mk(trenchR.id,'b'), mk(trench.id,'c'), mk(trenchR.id,'d')];
  chk('裁半：071 那張 → 左半(0)', half(hand,'a',byId)===0, String(half(hand,'a',byId)));
  chk('裁半：072 那張 → 右半(1)', half(hand,'b',byId)===1, String(half(hand,'b',byId)));
  chk('裁半：第二套的 071 → 仍是左半(0)', half(hand,'c',byId)===0, String(half(hand,'c',byId)));
  chk('裁半：第二套的 072 → 仍是右半(1)', half(hand,'d',byId)===1, String(half(hand,'d',byId)));
  chk('否定對照：普通競技場 → null（整張顯示）', half(hand,'n1',byId)===null, String(half(hand,'n1',byId)));
  chk('否定對照：找不到 iid → null', half(hand,'zzz',byId)===null);
  chk('否定對照：zone/pool 缺 → null（fail-safe）', half(undefined,'a',byId)===null && half(hand,'a',undefined)===null);
}

console.log(`test-two-card-stadium: ${pass} passed, ${fail} failed`);
if (fail>0) process.exit(1);
