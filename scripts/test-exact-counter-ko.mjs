/**
 * 死亡終局(超級阿勃梭魯ex)/藍柱石(冰伊布ex) — 對手寶可夢「剛好 6 個傷害指示物」才昏厥(v5.785)
 * 卡面「為6個」「放置有6個」無「以上」→ 精確 6 個。HEAD 用 ≥6(>=60)→ 7 個(70)也誤 KO。
 * 驗:6個→KO；5個→不KO；7個→不KO(修正前 HEAD 會 KO)。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.ec-s.js'), E = join(ROOT, '.ec-e.ts'), O = join(ROOT, '.ec-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { applyAction } from './src/lib/game/engine';\nexport { ATTACK_POST } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { applyAction, ATTACK_POST } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const ABSOL='13995', GLACEON='16633', BIG='14335' /*萊希拉姆 130HP*/, ENERGY='18519';
let nn=0;
const inst=(cid,e={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],...e});
const prize=n=>Array.from({length:n},()=>inst(ENERGY));
function mk(attackerCid, defDamage) {
  return { phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],pendingSelection:null,
    players:[
      {name:'P1',active:inst(attackerCid),bench:[],hand:[],deck:[inst(ENERGY)],discard:[],prizes:prize(6)},
      {name:'P2',active:inst(BIG,{damage:defDamage}),bench:[],hand:[],deck:[inst(ENERGY)],discard:[],prizes:prize(6)},
    ]};
}
const koed=(out)=>out.players[1].active===null || out.players[1].discard.some(c=>c.cardId===BIG);
let pass=0,fail=0;
const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};

// 死亡終局
T('★死亡終局:剛好6個(60)→昏厥', () => {
  const out=ATTACK_POST.get('超級阿勃梭魯ex|死亡終局')(mk(ABSOL,60),0,pool,{});
  assert.ok(koed(out),'6個應昏厥');
});
T('死亡終局:5個(50)→不昏厥', () => {
  const out=ATTACK_POST.get('超級阿勃梭魯ex|死亡終局')(mk(ABSOL,50),0,pool,{});
  assert.ok(!koed(out),'5個不昏厥');
});
T('★死亡終局:7個(70)→不昏厥(HEAD≥6會誤KO)', () => {
  const out=ATTACK_POST.get('超級阿勃梭魯ex|死亡終局')(mk(ABSOL,70),0,pool,{});
  assert.ok(!koed(out) && out.players[1].active && out.players[1].active.cardId===BIG,'7個不應昏厥');
});

// 藍柱石(單一候選→直接KO)
T('★藍柱石:剛好6個(60)→昏厥', () => {
  const out=ATTACK_POST.get('冰伊布ex|藍柱石')(mk(GLACEON,60),0,pool,{});
  // 單候選直接 KO 或開 picker;檢查 KO 或 pending
  const done = koed(out) || (out.pendingSelection && out.pendingSelection.effectKey==='lanzhushi-ko');
  assert.ok(koed(out),'6個應直接昏厥');
});
T('★藍柱石:7個(70)→無效(HEAD≥6會誤KO)', () => {
  const out=ATTACK_POST.get('冰伊布ex|藍柱石')(mk(GLACEON,70),0,pool,{});
  assert.ok(!koed(out) && out.players[1].active && out.players[1].active.cardId===BIG,'7個不應昏厥');
});
T('藍柱石:5個(50)→無效', () => {
  const out=ATTACK_POST.get('冰伊布ex|藍柱石')(mk(GLACEON,50),0,pool,{});
  assert.ok(!koed(out),'5個不昏厥');
});

console.log('\n剛好6指示物才昏厥(v5.785):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
