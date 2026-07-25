// v6.018（Fable P1-1 批5）：engine RESOLVE_SELECTION 中央閘 sanitizeSelectedIids 的 Stage2
//   「deck-search filter 語義驗證」HEAD-FAIL 守衛（直打函式，與 v6.009 端到端 antifraud 各守一層）。
//   核心：client 送含「不符 filter 的 iid」（稜鏡充能塞入非基本能量卡）→ 閘層濾掉。
//   單項三態 fail-open：未收錄 filter → 不做語義過濾（維持 Stage1 結果）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const S=join(ROOT,'.sfs-s.js'); const E=join(ROOT,'.sfs-e.ts'); const O=join(ROOT,'.sfs-o.mjs');
process.on('exit',()=>{for(const p of [S,E,O]){try{unlinkSync(p);}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { sanitizeSelectedIids } from './src/lib/game/engine';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { sanitizeSelectedIids }=await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');
const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));
const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const find=(pred)=>{for(const[id,c]of pool)if(pred(c))return c;return null;};
const fireE=find(c=>c.supertype==='Energy'&&c.subtype==='Basic'&&c.name.includes('【火】'));
const waterE=find(c=>c.supertype==='Energy'&&c.subtype==='Basic'&&c.name.includes('【水】'));
const poke=find(c=>c.supertype==='Pokemon');
assert.ok(fireE&&waterE&&poke,'測試素材齊全');
// 牌庫 4 張：火 i1、火 i2、水 i3、寶可夢 i4
const deck=[{iid:'i1',cardId:String(fireE.id)},{iid:'i2',cardId:String(fireE.id)},{iid:'i3',cardId:String(waterE.id)},{iid:'i4',cardId:String(poke.id)}];
const state={players:[{deck},{deck:[]}]};
const mkPending=(filter,extra={})=>({type:'deck-search',actorIdx:0,sourcePlayerIdx:0,filter,minCount:0,maxCount:3,...extra});

let pass=0,fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++;}catch(e){console.log('FAIL',n,'::',e.message);fail++;}};

T('稜鏡塞非能量：BasicEnergy:DistinctTypes 送[火,寶可夢,水]→閘濾掉寶可夢(HEAD 只驗zone→含寶可夢)',()=>{
  const out=sanitizeSelectedIids(state, mkPending('BasicEnergy:DistinctTypes'), ['i1','i4','i3'], pool);
  assert.deepEqual(out, ['i1','i3'], '應濾掉非能量 i4，實際='+JSON.stringify(out));
});

T('DistinctTypes 同屬性去重：送[火,火,水]→火首見留、火重複濾(HEAD 只 iid 去重→保 3 張)',()=>{
  const out=sanitizeSelectedIids(state, mkPending('BasicEnergy:DistinctTypes'), ['i1','i2','i3'], pool);
  assert.deepEqual(out, ['i1','i3'], '應[i1,i3]，實際='+JSON.stringify(out));
});

T('fail-open：未收錄 filter(Pokemon:MatchOppName)不做語義過濾，維持 Stage1 結果',()=>{
  const out=sanitizeSelectedIids(state, mkPending('Pokemon:MatchOppName'), ['i1','i4','i3'], pool);
  assert.deepEqual(out, ['i1','i4','i3'], '未收錄 filter 應原樣(Stage1)，實際='+JSON.stringify(out));
});

T('pool 缺席（舊呼叫者）跳過 Stage2，不 crash',()=>{
  const out=sanitizeSelectedIids(state, mkPending('BasicEnergy:DistinctTypes'), ['i1','i4','i3']);
  assert.deepEqual(out, ['i1','i4','i3'], 'pool 缺席應只做 Stage1，實際='+JSON.stringify(out));
});

T('非 deck-search 型別原封放行（不受 Stage2 影響）',()=>{
  const out=sanitizeSelectedIids(state, {type:'hand-discard',actorIdx:0,sourcePlayerIdx:0,filter:'BasicEnergy',maxCount:3}, ['i1','i4','i3'], pool);
  assert.deepEqual(out, ['i1','i4','i3'], 'hand-discard 原封放行，實際='+JSON.stringify(out));
});

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
