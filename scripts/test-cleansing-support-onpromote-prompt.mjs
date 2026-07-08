// v5.908 驗證：潔淨支援(拉帝歐斯,holder 在備戰)在「超級拉帝亞斯ex 主動上場(撤退/換場)」時 auto-prompt
//   詢問玩家用不用特性。原 tryPromptPromoteActive 只查 active 特性→備戰 holder 永不彈(且 active 無特性時
//   early return)。加 ON_ACTIVE_PROMOTE_BENCH_WATCHER 備戰觀察者。KO 補場(SEND_NEW_ACTIVE)不呼叫 helper→不觸發。
//   HEAD-FAIL：HEAD 潔淨支援 tryPromptPromoteActive 回無 pending。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.cop-s.js'), E = join(ROOT, '.cop-e.ts'), O = join(ROOT, '.cop-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, `export { tryPromptPromoteActive } from './src/lib/game/effects';\nexport { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';`);
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { tryPromptPromoteActive, applyAction } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const RADIAS='14069', LATIOS='14070', FIRE='18518', PSY='11177', GRASS='14319', COBALION='18482', METAL='19240';
let nn=0; const inst=(cid,ex={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],status:null,secondaryStatus:null,tertiaryStatus:null,...ex});
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  PASS',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
const base={id:'t',phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,setupDone:[true,true],pendingPrizes:[0,0]};

T('① 潔淨支援：超級拉帝亞斯ex 主動上場 → auto-prompt(holder=備戰拉帝歐斯) → yes 開能量 picker', () => {
  const latios=inst(LATIOS), em=inst(GRASS,{energyAttached:[inst(FIRE),inst(PSY)]});
  const st={...base,players:[
    {name:'P',active:inst(RADIAS,{movedToActiveThisTurn:true}),bench:[latios,em],hand:[],deck:[inst(GRASS)],discard:[],prizes:[inst(GRASS)]},
    {name:'O',active:inst(GRASS),bench:[],hand:[],deck:[inst(GRASS)],discard:[],prizes:[inst(GRASS)]}]};
  let r=tryPromptPromoteActive(st,0,pool);
  assert(r.pendingSelection,'應 auto-prompt(HEAD 無 pending→FAIL)');
  assert.equal(r.pendingSelection.effectKey,'resolve-promote-active-ability-prompt','應為上場特性詢問');
  assert.equal(r.pendingSelection.params.targetIid,latios.iid,'targetIid 應=備戰拉帝歐斯');
  assert.equal(r.pendingSelection.params.abilityName,'潔淨支援');
  // 選 yes → 開潔淨支援能量 picker
  r=applyAction(r,{type:'RESOLVE_SELECTION',selectedIids:['yes'],actorIdx:0},pool);
  assert.equal(r.pendingSelection?.type,'active-energy-discard','yes 後應開個別能量 picker');
  assert.equal(r.pendingSelection?.effectKey,'swiftcursor-energy-pick');
});

T('② 金屬之路：勾帕路翁ex 主動上場 → auto-prompt(regression)', () => {
  const st={...base,players:[
    {name:'P',active:inst(COBALION,{movedToActiveThisTurn:true}),bench:[inst(GRASS,{energyAttached:[inst(METAL),inst(METAL)]})],hand:[],deck:[inst(GRASS)],discard:[],prizes:[inst(GRASS)]},
    {name:'O',active:inst(GRASS),bench:[],hand:[],deck:[inst(GRASS)],discard:[],prizes:[inst(GRASS)]}]};
  const r=tryPromptPromoteActive(st,0,pool);
  assert.equal(r.pendingSelection?.effectKey,'resolve-promote-active-ability-prompt','金屬之路應 auto-prompt');
});

T('③ 潔淨支援：非超級拉帝亞斯ex 上場 → 不彈(卡面限定)', () => {
  const st={...base,players:[
    {name:'P',active:inst(GRASS,{movedToActiveThisTurn:true}),bench:[inst(LATIOS),inst(GRASS,{energyAttached:[inst(FIRE)]})],hand:[],deck:[inst(GRASS)],discard:[],prizes:[inst(GRASS)]},
    {name:'O',active:inst(GRASS),bench:[],hand:[],deck:[inst(GRASS)],discard:[],prizes:[inst(GRASS)]}]};
  const r=tryPromptPromoteActive(st,0,pool);
  assert(!r.pendingSelection,'非超級拉帝亞斯ex 上場不應彈');
});
console.log(`\n=== 潔淨支援上場auto-prompt(v5.908): ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
