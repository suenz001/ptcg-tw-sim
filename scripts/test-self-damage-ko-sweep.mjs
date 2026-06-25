// 鎖住:自傷招式(ATTACK_POST dealSelfDamage)致自身 KO 時,由 applyAction 末尾「每 action 無條件
//   雙邊 sanityKOSweep」(v4.4992) 處理 → 自身移棄牌 + 對手取獎賞 + 無 zombie(damage≥HP 仍在場)。
//   防未來改 sweep 邏輯破壞自傷 KO。帝牙海獅(16661 HP170)百萬噸墜落自傷50。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.stub-sk.js'); writeFileSync(S, 'export const base="";export const assets="";');
const E = join(ROOT, '.ent-sk.ts'); const O = join(ROOT, '.ent-sk.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(E, `export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';`);
await build({ entryPoints:[E], outfile:O, bundle:true, format:'esm', platform:'node', target:'node20', alias:{ '$lib':join(ROOT,'src/lib'), '$app/paths':S }, logLevel:'error' });
const { applyAction } = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const DEWGONG='16661', WATER='18519', BUD='14443', WAILORD='19159';  // 帝牙海獅 / 吼鯨王ex HP380(不被170 KO)
let nn=0;
const inst=(cid,e=[],x={})=>({iid:'i'+(++nn),cardId:String(cid),damage:0,energyAttached:e,...x});
const en=(cid)=>({iid:'e'+(++nn),cardId:String(cid),damage:0,energyAttached:[]});

let pass=0, fail=0;
const T=(n,fn)=>{try{fn();console.log('PASS',n);pass++}catch(e){console.log('FAIL',n,'::',e.message);fail++}};

T('帝牙海獅 damage130 百萬噸墜落(自傷50→180≥170)→自身KO移棄牌+對手取獎賞+無zombie', () => {
  const atk = inst(DEWGONG, [en(WATER), en(WATER)]); atk.damage = 130;
  const st = {
    phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:0, turn:3, isFirstTurn:false, log:[], pendingSelection:null,
    players:[
      { name:'P1', active:atk, bench:[inst(BUD)], hand:[], deck:[inst(BUD)], discard:[], prizes:[inst(BUD),inst(BUD)] },
      { name:'P2', active:inst(WAILORD), bench:[], hand:[], deck:[inst(BUD)], discard:[], prizes:[inst(BUD),inst(BUD)] },
    ],
  };
  const out = applyAction(st, { type:'ATTACK', attackIndex:1 }, pool);
  const p1 = out.players[0];
  // 無 zombie:帝牙海獅不應 damage≥170 仍在 active
  const zombie = p1.active && p1.active.cardId === DEWGONG && p1.active.damage >= 170;
  assert(!zombie, '不應留 zombie');
  // 帝牙海獅應進棄牌
  assert(p1.discard.some(c=>c.cardId===DEWGONG), '帝牙海獅應移棄牌');
  // 對手取 1 張獎賞(2→1)
  assert.equal(out.players[1].prizes.length, 1, `對手應取1獎賞(剩1),實剩 ${out.players[1].prizes.length}`);
  // 對手吼鯨王受170傷害存活
  assert.equal(out.players[1].active?.damage, 170, '對手吼鯨王應受170傷害存活');
});

T('帝牙海獅 damage0 百萬噸墜落(自傷50→50<170)→自身存活不KO', () => {
  const atk = inst(DEWGONG, [en(WATER), en(WATER)]); atk.damage = 0;
  const st = {
    phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:0, turn:3, isFirstTurn:false, log:[], pendingSelection:null,
    players:[
      { name:'P1', active:atk, bench:[inst(BUD)], hand:[], deck:[inst(BUD)], discard:[], prizes:[inst(BUD),inst(BUD)] },
      { name:'P2', active:inst(WAILORD), bench:[], hand:[], deck:[inst(BUD)], discard:[], prizes:[inst(BUD),inst(BUD)] },
    ],
  };
  const out = applyAction(st, { type:'ATTACK', attackIndex:1 }, pool);
  assert.equal(out.players[0].active?.cardId, DEWGONG, '帝牙海獅應存活在 active');
  assert.equal(out.players[0].active?.damage, 50, `自傷後 damage 應 50,實 ${out.players[0].active?.damage}`);
  assert.equal(out.players[1].prizes.length, 2, '對手未取獎賞(帝牙海獅沒KO)');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
