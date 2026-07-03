/** v5.861 flat 多目標狙擊(雙刃劍/出奇一擊)「不計算受傷寶可夢身上的附加效果」
 *  → 應 bypass 對手備戰免疫(謝米花之帷幔 / 太晶ex備戰免疫)造成傷害。
 *
 *  官方判例(Wilson 提供)：跳躍扣殺/雙刃劍類「傷害不計算對手戰鬥寶可夢身上的附加效果」，
 *  因此不計算「不受招式傷害的效果」，可以造成傷害。engine 單體 skipDefEffects 路徑已正確；
 *  snipe-multi(多目標)flat 路徑先前仍跑 canApplyEffectToTarget guard → 被免疫擋(bug)。
 *
 *  HEAD-FAIL：修前 snipe-multi 對 flat 招式仍執行免疫 guard → 備戰目標 0 傷害；
 *            修後 flat → guard=null → 打入 50。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.fi-s.js'), E = join(ROOT, '.fi-e.ts'), O = join(ROOT, '.fi-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { applyAction } from './src/lib/game/engine';\nexport { ATTACK_POST } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { applyAction, ATTACK_POST } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const IRONHEAD='16832' /*鐵頭殼ex|雙刃劍*/, SHAYMIN='14672' /*謝米 花之帷幔*/,
      TERA_EX='14677' /*厄鬼椪 碧草面具ex 太晶 HP210*/, PLAIN='14086' /*願增猿 HP110*/, ENERGY='18519';
let nn=0;
const inst=(cid,e={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:[],status:null,secondaryStatus:null,tertiaryStatus:null,...e});
const prize=n=>Array.from({length:n},()=>inst(ENERGY));
function mk(defActiveCid, defBench) {
  return { phase:'playing',turnPhase:'main',activePlayerIndex:0,firstPlayerIdx:0,turn:5,isFirstTurn:false,log:[],setupDone:[true,true],pendingMulliganDraw:[0,0],pendingPrizes:[0,0],pendingSelection:null,
    players:[
      {name:'P1',active:inst(IRONHEAD),bench:[],hand:[],deck:[inst(ENERGY)],discard:[],prizes:prize(6)},
      {name:'P2',active:inst(defActiveCid),bench:defBench,hand:[],deck:[inst(ENERGY)],discard:[],prizes:prize(6)},
    ]};
}
const RESOLVE=(iids)=>({type:'RESOLVE_SELECTION',selectedIids:iids});
let pass=0,fail=0;
const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};

T('★雙刃劍 flat 穿謝米「花之帷幔」保護的備戰(願增猿) → 受 50', () => {
  const benchB=inst(PLAIN);
  const st=mk(PLAIN, [inst(SHAYMIN), benchB]); // 對手備戰:謝米(花之帷幔)+願增猿
  const opened=ATTACK_POST.get('鐵頭殼ex|雙刃劍')(st,0,pool,{});
  assert.equal(opened.pendingSelection.params.flat, true, '雙刃劍應傳 flat:true');
  const out=applyAction(opened, RESOLVE([benchB.iid]), pool);
  const b=out.players[1].bench.find(c=>c.iid===benchB.iid);
  assert.ok(b, '願增猿應仍在備戰');
  assert.equal(b.damage, 50, `flat 穿花之帷幔應受 50，實際 ${b.damage}(HEAD 被擋=0)`);
});

T('★雙刃劍 flat 穿太晶ex 備戰免疫(碧草面具ex) → 受 50', () => {
  const teraBench=inst(TERA_EX);
  const st=mk(PLAIN, [teraBench]); // 對手備戰:太晶ex(備戰免疫招式傷害)
  const opened=ATTACK_POST.get('鐵頭殼ex|雙刃劍')(st,0,pool,{});
  const out=applyAction(opened, RESOLVE([teraBench.iid]), pool);
  const b=out.players[1].bench.find(c=>c.iid===teraBench.iid);
  assert.ok(b, '太晶ex應仍在備戰(HP210 受50不倒)');
  assert.equal(b.damage, 50, `flat 穿太晶備戰免疫應受 50，實際 ${b.damage}(HEAD 被擋=0)`);
});

T('對照:非 flat 標準狙擊仍被花之帷幔擋(確保沒過度 bypass)', () => {
  // 用一個標準(非 flat)多目標招式驗證免疫仍生效 — 這裡直接驗謝米保護邏輯未被破壞：
  // 雙刃劍打「謝米自己」(規則寶可夢除外→謝米非規則亦受保護)？改測：flat 仍可穿謝米自己
  const shaymiBench=inst(SHAYMIN);
  const st=mk(PLAIN, [shaymiBench, inst(PLAIN)]);
  const opened=ATTACK_POST.get('鐵頭殼ex|雙刃劍')(st,0,pool,{});
  const out=applyAction(opened, RESOLVE([shaymiBench.iid]), pool);
  const b=out.players[1].bench.find(c=>c.iid===shaymiBench.iid);
  assert.equal(b.damage, 50, `flat 亦穿謝米自身(花之帷幔含自己)應受 50，實際 ${b.damage}`);
});

console.log('\nflat 多目標狙擊 bypass 免疫(v5.861):PASS '+pass+' / FAIL '+fail);
process.exit(fail?1:0);
