/**
 * 整招「不計算弱點・抵抗力與身上附加效果」的多目標狙擊(雙刃劍/出奇一擊)打對手戰鬥位時，
 * 不應套弱點×2 也不套防守方減傷(v5.784)。HEAD:multiSnipePost 對 active 一律套 applyWeakRes→誤×2。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.fm-s.js'), E = join(ROOT, '.fm-e.ts'), O = join(ROOT, '.fm-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { applyAction } from './src/lib/game/engine';\nexport { ATTACK_POST } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { applyAction, ATTACK_POST } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const UMBREON='12387', JOLTIK_DUSKULL='14353' /*夢妖 弱惡*/, DURALUDON='16832', SWINUB='14341' /*小山豬 弱鋼*/, ENERGY='18519';
let nn=0;
const inst=(cid,e={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...e});
const prize=n=>Array.from({length:n},()=>inst(ENERGY));
function mk(attackerCid, defActiveCid) {
  return { phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],pendingSelection:null,
    players:[
      {name:'P1',active:inst(attackerCid),bench:[],hand:[],deck:[inst(ENERGY)],discard:[],prizes:prize(6)},
      {name:'P2',active:inst(defActiveCid),bench:[inst(ENERGY===ENERGY?SWINUB:SWINUB)],hand:[],deck:[inst(ENERGY)],discard:[],prizes:prize(6)},
    ]};
}
const RESOLVE=(iids)=>({type:'RESOLVE_SELECTION',selectedIids:iids});
let pass=0,fail=0;
const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};

T('★出奇一擊(惡)打弱惡 夢妖 active → flat 50(非弱點100)', () => {
  const st=mk(UMBREON, JOLTIK_DUSKULL);
  const activeIid=st.players[1].active.iid;
  // 透過 regPost 開 pending(驗註冊有傳 flat),再 RESOLVE
  const opened=ATTACK_POST.get('月亮伊布|出奇一擊')(st,0,pool,{});
  assert.ok(opened.pendingSelection,'應開 picker');
  assert.equal(opened.pendingSelection.params.flat, true, '出奇一擊應傳 flat:true');
  const out=applyAction(opened, RESOLVE([activeIid]), pool);
  const def=out.players[1].active;
  assert.ok(def && def.cardId===JOLTIK_DUSKULL, '夢妖(70HP)受 flat50 應存活(HEAD 弱點×2=100→KO)');
  assert.equal(def.damage, 50, '應 flat 50(HEAD=100)');
});

T('★雙刃劍(鋼)打弱鋼 小山豬 active → flat 50(非100)', () => {
  const st=mk(DURALUDON, SWINUB);
  const activeIid=st.players[1].active.iid;
  const opened=ATTACK_POST.get('鐵頭殼ex|雙刃劍')(st,0,pool,{});
  assert.equal(opened.pendingSelection.params.flat, true, '雙刃劍應傳 flat:true');
  const out=applyAction(opened, RESOLVE([activeIid]), pool);
  const def=out.players[1].active;
  assert.ok(def && def.cardId===SWINUB, '小山豬(70HP)受 flat50 應存活(HEAD×2=100→KO)');
  assert.equal(def.damage, 50, '應 flat 50(HEAD=100)');
});

console.log('\nflat 多目標狙擊不計弱抗(v5.784):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
