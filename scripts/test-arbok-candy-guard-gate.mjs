// v5.911 火箭隊的阿柏怪|瞪眼效用 下,神奇糖果「可用性 guard(regG)」也要排除被擋的特性 Stage2：
//   手牌只有『被瞪眼擋的特性進化寶可夢』→ 糖果不可打出(regG=false),不被白白丟棄。
//   手牌另有『無特性可進化目標』→ 糖果可打出(regG=true),picker 排除特性S2。
//   HEAD-FAIL:HEAD regG 不理瞪眼→只有特性S2 時仍回 true(糖果被打出丟棄)。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.ag-s.js'), E = join(ROOT, '.ag-e.ts'), O = join(ROOT, '.ag-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { TRAINER_GUARDS, TRAINER_EFFECTS } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const ARBOK='12807', LOMBRE_BASE='14323'/*蓮葉童子(樂天河童基礎)*/, LUDICOLO='14325'/*樂天河童 有特性*/, ODDISH='14319'/*走路草*/, VILEPLUME='14321'/*霸王花 無特性*/, W='18519';
assert((pool.get(LUDICOLO)?.abilities?.length??0)>=1,'樂天河童應有特性');
assert((pool.get(VILEPLUME)?.abilities?.length??0)===0,'霸王花應無特性');
let nn=0; const inst=(cid,ex={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],toolAttached:undefined,extraTools:[],status:null,secondaryStatus:null,tertiaryStatus:null,...ex});
let pass=0,fail=0; const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};
const guard = mod.TRAINER_GUARDS.get('神奇糖果');
// 對手 active=阿柏怪(瞪眼);玩家場上 active/bench 基礎;手牌 = hand S2 陣列
function mk(activeBasic, benchBasics, handS2s, oppActive=ARBOK) {
  return { id:'t', phase:'playing', turnPhase:'main', activePlayerIndex:0, turn:5, isFirstTurn:false, log:[], pendingSelection:null, setupDone:[true,true], pendingPrizes:[0,0],
    players:[{name:'ME',active:inst(activeBasic),bench:benchBasics.map(inst),hand:handS2s.map(inst),deck:[],discard:[],prizes:[inst(W)]},
             {name:'OP',active:inst(oppActive),bench:[],hand:[],deck:[],discard:[],prizes:[inst(W)]}] };
}
T('★瞪眼下手牌只有特性S2(樂天河童)+其基礎在場 → regG=false(糖果不可打出,不被棄)', () => {
  assert.equal(guard(mk(LOMBRE_BASE, [], [LUDICOLO]), 0, pool), false, '只有被擋特性S2 → 糖果不可用');
});
T('★瞪眼下手牌有特性S2樂天河童 + 無特性S2霸王花(各有基礎) → regG=true(糖果可用)', () => {
  assert.equal(guard(mk(LOMBRE_BASE, [ODDISH], [LUDICOLO, VILEPLUME]), 0, pool), true, '有無特性目標 → 糖果可用');
  // 且 effect picker 排除樂天河童、只列霸王花對應目標
  const out = mod.TRAINER_EFFECTS.get('神奇糖果')(mk(LOMBRE_BASE, [ODDISH], [LUDICOLO, VILEPLUME]), 0, pool);
  const valid = out.pendingSelection?.params?.validIids ?? [];
  assert.equal(valid.length, 1, 'picker 只列 1 張(霸王花),排除被擋的樂天河童;實際 '+valid.length);
});
T('對照:對手非阿柏怪(無瞪眼) → 只有樂天河童也可用 regG=true', () => {
  assert.equal(guard(mk(LOMBRE_BASE, [], [LUDICOLO], ODDISH), 0, pool), true, '無瞪眼→樂天河童(特性S2)可用');
});
console.log(`\n=== 阿柏怪瞪眼×神奇糖果 regG gate(v5.911): ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail?1:0);
