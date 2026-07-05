/** v5.884 修 3 張真簡化(玩家選/對手選,非自動隨機):
 *  ①焰后蜥|突然炙烤 對手選自己手牌棄(非隨機)+evolvedThisTurn從夜盜火蜥進化才再棄2
 *  ②優雅貓|能量攪拌 選自己場上能量以任意方式改附自己寶可夢(原僅log未實作)
 *  ③塗標客|惡作劇作畫 從對手棄牌選≤3能量逐張選對手寶可夢附加(原自動附對手戰鬥)
 *  HEAD-FAIL:HEAD 隨機/未實作/自動附。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.sf-s.js'), E = join(ROOT, '.sf-e.ts'), O = join(ROOT, '.sf-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { ATTACK_POST } from './src/lib/game/effects/_shared';\nexport { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const YANHOU='16606', NIGHT='16605', ELEGANT='17057', PRANK='11254', POKE='14319', W='18519';
let nn = 0;
const inst = (cid, ex={}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], toolAttached: undefined, extraTools: [], status: null, secondaryStatus: null, tertiaryStatus: null, ...ex });
const base = (p0, p1) => ({ id:'t', phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:0, turn:5, isFirstTurn:false, log:[], pendingSelection:null, setupDone:[true,true], pendingPrizes:[0,0], players:[p0,p1] });
const pub = l => (typeof l==='string'?l:(l?.message||''));
let pass=0, fail=0;
const T=(n,f)=>{try{f();console.log('  OK',n);pass++;}catch(e){console.log('  FAIL',n,'::',e.message);fail++;}};

// 1) 突然炙烤:開對手 hand-discard picker(actorIdx=對手),非隨機
T('★突然炙烤 → 對手 hand-discard picker(對手自選,非隨機)', () => {
  const fn = mod.ATTACK_POST.get('焰后蜥|突然炙烤');
  const st = base(
    { name:'ME', active:inst(YANHOU), bench:[], hand:[], deck:[], discard:[], prizes:[inst(POKE)] },
    { name:'OP', active:inst(POKE), bench:[], hand:[inst(W),inst(POKE),inst(W)], deck:[], discard:[], prizes:[inst(POKE)] });
  const out = fn(st, 0, pool, {});
  assert.ok(out.pendingSelection, '開 picker(非直接隨機棄)');
  assert.equal(out.pendingSelection.type, 'hand-discard');
  assert.equal(out.pendingSelection.actorIdx, 1, '對手選(actorIdx=1)');
  assert.equal(out.pendingSelection.minCount, 1, '非進化→棄1');
  assert.equal(out.players[1].hand.length, 3, '尚未棄(等對手選)');
});
T('★突然炙烤 本回合從夜盜火蜥進化 → 棄3', () => {
  const fn = mod.ATTACK_POST.get('焰后蜥|突然炙烤');
  const yh = inst(YANHOU, { evolvedThisTurn:true, evolvedFromStack:[inst(NIGHT)] });
  const st = base(
    { name:'ME', active:yh, bench:[], hand:[], deck:[], discard:[], prizes:[inst(POKE)] },
    { name:'OP', active:inst(POKE), bench:[], hand:[inst(W),inst(POKE),inst(W),inst(POKE)], deck:[], discard:[], prizes:[inst(POKE)] });
  const out = fn(st, 0, pool, {});
  assert.equal(out.pendingSelection.minCount, 3, '進化→棄3');
});

// 2) 能量攪拌:開 active-energy-discard(all-own) picker
T('★能量攪拌 → active-energy-discard(all-own) picker(非僅log)', () => {
  const fn = mod.ATTACK_POST.get('優雅貓|能量攪拌');
  const active = inst(ELEGANT, { energyAttached:[inst(W),inst(W)] });
  const st = base(
    { name:'ME', active, bench:[inst(POKE,{energyAttached:[inst(W)]})], hand:[], deck:[], discard:[], prizes:[inst(POKE)] },
    { name:'OP', active:inst(POKE), bench:[], hand:[], deck:[], discard:[], prizes:[inst(POKE)] });
  const out = fn(st, 0, pool, {});
  assert.ok(out.pendingSelection, '開 picker(非僅 log)');
  assert.equal(out.pendingSelection.type, 'active-energy-discard');
  assert.equal(out.pendingSelection.params.scope, 'all-own');
  assert.equal(out.pendingSelection.params.validIids.length, 3, '3 張場上能量可選');
});

// 3) 惡作劇作畫:開對手棄牌能量 discard-search(非自動附)
T('★惡作劇作畫 → 對手棄牌 discard-search picker(玩家選,非自動)', () => {
  const fn = mod.ATTACK_POST.get('塗標客|惡作劇作畫');
  const st = base(
    { name:'ME', active:inst(PRANK), bench:[], hand:[], deck:[], discard:[], prizes:[inst(POKE)] },
    { name:'OP', active:inst(POKE), bench:[inst(POKE)], hand:[], deck:[], discard:[inst(W),inst(W),inst(W),inst(POKE)], prizes:[inst(POKE)] });
  const out = fn(st, 0, pool, {});
  assert.ok(out.pendingSelection, '開 picker(非自動附)');
  assert.equal(out.pendingSelection.type, 'discard-search');
  assert.equal(out.pendingSelection.sourcePlayerIdx, 1, '從對手棄牌區選');
  assert.equal(out.pendingSelection.effectKey, 'prank-paint-pick-energy');
  // 對手戰鬥位尚未被自動附能量
  assert.equal(out.players[1].active.energyAttached.length, 0, '未自動附(等玩家選)');
  // 解鏈:選 1 能量 → opp-poke-choose → 附到對手備戰
  let out2 = mod.applyAction(out, { type:'RESOLVE_SELECTION', selectedIids:[out.players[1].discard[0].iid] }, pool);
  assert.equal(out2.pendingSelection?.type, 'opp-poke-choose', '逐張選對手寶可夢');
  const benchIid = out2.players[1].bench[0].iid;
  out2 = mod.applyAction(out2, { type:'RESOLVE_SELECTION', selectedIids:[benchIid] }, pool);
  assert.equal(out2.players[1].bench[0].energyAttached.length, 1, '能量附到玩家選的對手備戰');
});

console.log('\n真簡化修正(v5.884):PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
