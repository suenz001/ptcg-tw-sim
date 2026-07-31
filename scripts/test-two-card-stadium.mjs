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
              +"export { LEGEND_STADIUM_NAMES } from './src/lib/game/effects/_shared';");
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
const byName=(n)=>[...byId.values()].find(c=>c.name===n);
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

// validateDeck：單數張 → 報錯；偶數張 → 這條不報錯
{
  const trench = byName('傳說的海溝');
  const basicPoke = [...byId.values()].find(c=>c.supertype==='Pokemon' && (c.stage==='Basic'||c.subtype==='Basic') && ['H','I','J'].includes(c.regulationMark));
  const water = [...byId.values()].find(c=>c.name==='基本【水】能量');
  const mk=(n)=>({ id:'t', name:'t', entries:[
    { cardId:String(trench.id), count:n },
    { cardId:String(basicPoke.id), count:4 },
    { cardId:String(water.id), count:60-4-n },
  ]});
  const odd = validateDeck(mk(1), byId);
  chk('單數張（1）→ 報「必須是偶數」', odd.issues.some(s=>s.includes('偶數')), JSON.stringify(odd.issues));
  const odd3 = validateDeck(mk(3), byId);
  chk('單數張（3）→ 報「必須是偶數」', odd3.issues.some(s=>s.includes('偶數')));
  const even2 = validateDeck(mk(2), byId);
  chk('否定對照：2 張 → 不報偶數問題', !even2.issues.some(s=>s.includes('偶數')), JSON.stringify(even2.issues));
  const even4 = validateDeck(mk(4), byId);
  chk('否定對照：4 張（2 套）→ 不報偶數問題', !even4.issues.some(s=>s.includes('偶數')));
  // ⭐ 否定對照：一般卡放單數張不該報偶數
  const normalOdd = validateDeck({ id:'t',name:'t',entries:[
    { cardId:String(basicPoke.id), count:3 },
    { cardId:String(water.id), count:57 },
  ]}, byId);
  chk('否定對照：一般卡 3 張不報偶數問題', !normalOdd.issues.some(s=>s.includes('偶數')), JSON.stringify(normalOdd.issues));
}

console.log(`test-two-card-stadium: ${pass} passed, ${fail} failed`);
if (fail>0) process.exit(1);
