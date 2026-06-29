/**
 * 超級赫拉克羅斯ex|重裝角擊 = 100 + 上個對手回合此寶可夢受到的招式傷害（v5.780, §17.44.E）
 * 引擎主管線只記 active 主傷害;狙擊/多目標傷害(走中央 dealAttackDamageToTarget,含『備戰』)過去漏記。
 *   驗 HEAD FAIL:未修版 dealAttackDamageToTarget 不寫 damageTakenLastOppTurn。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url'; import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT,'.hi-s.js'),E=join(ROOT,'.hi-e.ts'),O=join(ROOT,'.hi-o.mjs');
process.on('exit',()=>{for(const p of[S,E,O]){try{unlinkSync(p)}catch{}}});
writeFileSync(S,'export const base="";');
writeFileSync(E,"export { dealAttackDamageToTarget, ATTACK_PRE } from './src/lib/game/effects';\nimport './src/lib/game/effects';");
await build({entryPoints:[E],outfile:O,bundle:true,format:'esm',platform:'node',target:'node20',alias:{'$lib':join(ROOT,'src/lib'),'$app/paths':S},logLevel:'error'});
const { dealAttackDamageToTarget, ATTACK_PRE } = await import(pathToFileURL(O).href);
const dir=join(ROOT,'static/cards');const live=new Set(JSON.parse(readFileSync(join(dir,'index.json'),'utf8')).map(e=>e.code));const pool=new Map();
for(const f of readdirSync(dir)){if(!f.endsWith('.json')||f==='index.json'||!live.has(f.slice(0,-5)))continue;for(const c of JSON.parse(readFileSync(join(dir,f),'utf8')))if(c?.id!=null)pool.set(String(c.id),c);}
const HERA='14322', WILLDUN='14086', ENERGY='14102';
let nn=0;const inst=(cid,e={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...e});
const prize=n=>Array.from({length:n},()=>inst(ENERGY));
const mk=(p1active,p1bench=[])=>({phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],pendingSelection:null,
  players:[{name:'P1',active:inst(WILLDUN,{energyAttached:[inst(ENERGY)]}),bench:[],hand:[],deck:[inst(ENERGY)],discard:[],prizes:prize(6)},
           {name:'P2',active:p1active,bench:p1bench,hand:[],deck:[inst(ENERGY)],discard:[],prizes:prize(6)}]});
let pass=0,fail=0;
const T=(n,f)=>{try{f();console.log('  OK',n);pass++}catch(e){console.log('  FAIL',n,'::',e.message);fail++}};

T('★中央helper:備戰受招式傷害→記錄 damageTakenLastOppTurn', () => {
  const benchHera = inst(HERA);
  const st = mk(inst(WILLDUN), [benchHera]);
  const out = dealAttackDamageToTarget(st, 0, benchHera.iid, 50, pool, { kind: 'attack-damage', label: '狙擊' });
  const b = out.players[1].bench.find(c => c.iid === benchHera.iid);
  assert.equal(b.damageTakenLastOppTurn, 50, '備戰受傷應記錄50(HEAD為undefined)');
});
T('★中央helper:戰鬥位受狙擊傷害→記錄', () => {
  const a = inst(HERA);
  const st = mk(a);
  const out = dealAttackDamageToTarget(st, 0, a.iid, 30, pool, { kind: 'attack-damage', label: '狙擊' });
  assert.equal(out.players[1].active.damageTakenLastOppTurn, 30);
});
T('放傷害指示物(attack-effect)不計入', () => {
  const a = inst(HERA);
  const st = mk(a);
  const out = dealAttackDamageToTarget(st, 0, a.iid, 20, pool, { kind: 'attack-effect', label: '飛來橫禍' });
  assert.equal(out.players[1].active.damageTakenLastOppTurn, undefined, 'attack-effect 放指示物不算受傷');
});
T('整合:重裝角擊 = 100 + 記錄傷害', () => {
  const a = inst(HERA, { energyAttached: [inst(ENERGY), inst(ENERGY)], damageTakenLastOppTurn: 100 });
  const st = mk(inst(WILLDUN)); st.players[0].active = a; // 攻擊方 = 重裝角擊
  const r = ATTACK_PRE.get('超級赫拉克羅斯ex|重裝角擊')(st, 0, pool, {});
  assert.equal(r.damage, 200, '100+100=200');
});
console.log('\n重裝角擊受傷記錄(v5.780):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
