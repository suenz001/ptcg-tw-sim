#!/usr/bin/env node
/** J 標 Batch A3 focused regression. Source: static/cards/M4.json / MC.json */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(REPO_ROOT, '.tmp-j-batch-a3-bundle.mjs');
const ENTRY = join(REPO_ROOT, '.tmp-j-batch-a3-entry.ts');
function safeUnlink(p) { try { unlinkSync(p); } catch {} }
process.on('exit', () => { safeUnlink(ENTRY); safeUnlink(OUT); });
writeFileSync(ENTRY, `export { createGame, applyAction } from './src/lib/game/engine';\n`);
await build({ entryPoints:[ENTRY], outfile:OUT, bundle:true, format:'esm', platform:'node', target:'node20', alias:{'$lib':join(REPO_ROOT,'src/lib'),'$app/paths':join(REPO_ROOT,'scripts/shim-app-paths.mjs')}, logLevel:'warning' });
safeUnlink(ENTRY);
const { createGame, applyAction } = await import(pathToFileURL(OUT).href);

const pool = new Map();
for (const f of readdirSync(join(REPO_ROOT,'static/cards'))) if (f.endsWith('.json') && f !== 'index.json') for (const c of JSON.parse(readFileSync(join(REPO_ROOT,'static/cards',f),'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
const CID = {
  raichu:'16697', miraidon:'16755', chesnaught:'18427', pyroarMega:'18435', baltoy:'18466', ferrothorn:'18481',
  defender:'11252', grassSafeDefender:'13163', nonExDefender:'14426',
  grassE:'18382', fireE:'18518', lightningE:'18520', fightingE:'17215', metalE:'17219', colorlessE:'13443', magnetMetalE:'18503'
};
let iid = 0;
const inst = (cardId, extra={}) => ({ iid:`a3_${++iid}`, cardId:String(cardId), damage:0, energyAttached:[], ...extra });
const e = id => inst(id);
const energies = (...ids) => ids.map(e);
const atkIdx = (cid,name) => pool.get(String(cid))?.attacks?.findIndex(a=>a.name===name) ?? -1;
function baseState(active, extraP0={}, extraP1={}) {
  const state = createGame({name:'P1',entries:[{cardId:CID.defender,count:1}]},{name:'P2',entries:[{cardId:CID.defender,count:1}]},pool);
  return { ...state, phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:1, isFirstTurn:false, setupDone:[true,true], pendingMulliganDraw:[0,0], pendingPrizes:0,
    players:[
      { ...state.players[0], name:'P1', hand:[], deck:[], discard:[], prizes:Array(6).fill(null).map(()=>inst(CID.colorlessE)), bench:[], active, ...extraP0 },
      { ...state.players[1], name:'P2', hand:[], deck:[], discard:[], prizes:Array(6).fill(null).map(()=>inst(CID.colorlessE)), bench:[], active:inst(CID.defender), ...extraP1 },
    ] };
}
function attack(st,cid,name){ const idx=atkIdx(cid,name); assert.notEqual(idx,-1, `${pool.get(String(cid))?.name} should have ${name}`); return applyAction(st,{type:'ATTACK',attackIndex:idx},pool); }
function withRandom(values, fn){ const old=Math.random; let i=0; Math.random=()=>values[Math.min(i++, values.length-1)]; try{return fn();} finally{Math.random=old;} }
let passed=0, failed=0;
function test(name, fn){ try{ fn(); console.log(`  ✅ ${name}`); passed++; } catch(err){ console.log(`  ❌ ${name}: ${err.stack||err.message}`); failed++; } }

test('雷丘｜快速攻擊 adds 50 on heads only', () => {
  const headsState = baseState(inst(CID.raichu,{energyAttached:energies(CID.lightningE)}));
  assert.equal(withRandom([0.1],()=>attack(headsState,CID.raichu,'快速攻擊')).players[1].active?.damage, 70);
  const tailsState = baseState(inst(CID.raichu,{energyAttached:energies(CID.lightningE)}));
  assert.equal(withRandom([0.9],()=>attack(tailsState,CID.raichu,'快速攻擊')).players[1].active?.damage, 20);
});

test('密勒頓ex｜強子電光 adds 120 against ex only', () => {
  const active = () => inst(CID.miraidon,{energyAttached:energies(CID.lightningE,CID.lightningE,CID.colorlessE)});
  assert.equal(attack(baseState(active()),CID.miraidon,'強子電光').players[1].active?.damage, 240);
  assert.equal(attack(baseState(active(),{}, {active:inst(CID.nonExDefender)}),CID.miraidon,'強子電光').players[1].active?.damage, 120);
});

test('布里卡隆｜圍困 marks defender unable to retreat next turn', () => {
  const st = baseState(inst(CID.chesnaught,{energyAttached:energies(CID.grassE,CID.grassE,CID.colorlessE)}), {}, {active:inst(CID.grassSafeDefender)});
  const next = attack(st,CID.chesnaught,'圍困');
  assert.equal(next.players[1].active?.damage, 160);
  assert.equal(next.players[1].active?.cantRetreatNextTurn, true);
});

test('超級火炎獅ex｜大爆炸之火 subtracts own damage counters ×10 from 290', () => {
  const st = baseState(inst(CID.pyroarMega,{damage:50, energyAttached:energies(CID.fireE,CID.fireE,CID.colorlessE)}));
  assert.equal(attack(st,CID.pyroarMega,'大爆炸之火').players[1].active?.damage, 240);
});

test('天秤偶｜連續旋轉 flips until tails and deals heads ×30', () => {
  const st = baseState(inst(CID.baltoy,{energyAttached:energies(CID.fightingE)}));
  assert.equal(withRandom([0.1,0.1,0.9],()=>attack(st,CID.baltoy,'連續旋轉')).players[1].active?.damage, 60);
});

test('堅果啞鈴｜特殊鞭打 adds 70 if attached special energy', () => {
  const special = baseState(inst(CID.ferrothorn,{energyAttached:energies(CID.metalE,CID.magnetMetalE)}));
  assert.equal(attack(special,CID.ferrothorn,'特殊鞭打').players[1].active?.damage, 140);
  const basicOnly = baseState(inst(CID.ferrothorn,{energyAttached:energies(CID.metalE,CID.metalE)}));
  assert.equal(attack(basicOnly,CID.ferrothorn,'特殊鞭打').players[1].active?.damage, 70);
});

console.log(`\nJ Batch A3: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
