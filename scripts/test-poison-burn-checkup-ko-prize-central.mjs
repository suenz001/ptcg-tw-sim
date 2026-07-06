/** v5.889 中毒/灼傷「寶可夢檢查階段」致死取獎收斂到中央 addPendingPrize
 *  (與一般 KO / 冰冷之帳一致):有正面朝上獎賞 → 開逐張 take-prize-choose picker、
 *  無 faceUp → 自動取 + 私訊揭示。原 poison/burn 用 direct-slice 繞過 faceUp picker/私訊揭示。
 *  官方規則(PTCG RULES §11/§12):寶可夢檢查 KO = 一般 KO(棄→取獎→補位);補位延到狀態區結尾。
 *  HEAD-FAIL:HEAD direct-slice 直接自動取、faceUp 也不開 picker。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.pb-s.js'), E = join(ROOT, '.pb-e.ts'), O = join(ROOT, '.pb-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const CR = '16788', POKE = '14319', W = '18519';  // 克雷色利亞 HP120(非ex→1獎賞) / 普通寶可夢 / 水能量
let nn = 0;
const inst = (cid, ex={}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], toolAttached: undefined, extraTools: [], status: null, secondaryStatus: null, tertiaryStatus: null, ...ex });
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };
const forceTails = () => { const o = Math.random; Math.random = () => 0.9; return () => { Math.random = o; }; };  // 燒傷判定不解除

function state(activeStatus, oppPrizes, dmg = 115) {
  const active = inst(CR, { status: activeStatus, damage: dmg });
  return {
    id:'t', phase:'playing', turnPhase:'main', activePlayerIndex:0, firstPlayerIdx:0, turn:5, isFirstTurn:false,
    log:[], pendingSelection:null, setupDone:[true,true], pendingPrizes:[0,0],
    endTurnSkipCheckup:false, endTurnCheckupAbilitiesDone:false,
    players:[
      { name:'ME', active, bench:[inst(POKE)], hand:[], deck:[inst(POKE)], discard:[], prizes:[inst(POKE)] },
      { name:'OP', active:inst(POKE), bench:[inst(POKE)], hand:[], deck:[inst(POKE)], discard:[], prizes: oppPrizes },
    ],
  };
}

T('★中毒檢查致死 + 對手有 faceUp → 開 take-prize-choose picker(收斂 addPendingPrize)', () => {
  const out = mod.applyAction(state('poisoned', [inst(W, {faceUp:true}), inst(POKE)]), { type:'END_TURN' }, pool);
  assert.ok(out.players[0].active === null, '中毒方戰鬥位被 KO(active null)');
  assert.ok(out.pendingSelection, '對手有 faceUp → 開取獎 picker(不自動取)');
  assert.equal(out.pendingSelection.effectKey, 'take-prize-choose');
  assert.equal(out.pendingSelection.actorIdx, 1, 'picker 給對手(取獎方)');
  assert.equal(out.players[1].prizes.length, 2, '對手獎賞尚未取(等玩家選)');
  assert.equal(out.endTurnContinueAfterKO, 0, '仍帶 endTurnContinueAfterKO=aIdx → 解完 picker+補位後續跑 checkup');
});

T('中毒檢查致死 + 對手無 faceUp → 自動取(不開 picker),私訊揭示', () => {
  const out = mod.applyAction(state('poisoned', [inst(POKE), inst(POKE)]), { type:'END_TURN' }, pool);
  assert.ok(out.players[0].active === null, '中毒 KO');
  assert.ok(!out.pendingSelection, '無 faceUp → 自動取不開 picker');
  assert.equal(out.players[1].prizes.length, 1, '對手自動取 1 張');
  assert.equal(out.players[1].hand.length, 1, '取的進對手手牌');
  assert.equal(out.endTurnContinueAfterKO, 0, '設 endTurnContinueAfterKO 讓補位後續跑 checkup');
});

T('★灼傷檢查致死 + 對手有 faceUp → 開 picker(收斂,燒傷判定前先致死)', () => {
  const restore = forceTails();
  const out = mod.applyAction(state('burned', [inst(W, {faceUp:true}), inst(POKE)]), { type:'END_TURN' }, pool);
  restore();
  assert.ok(out.players[0].active === null, '灼傷方被 KO');
  assert.ok(out.pendingSelection, '對手有 faceUp → 開取獎 picker');
  assert.equal(out.pendingSelection.effectKey, 'take-prize-choose');
  assert.equal(out.pendingSelection.actorIdx, 1);
  assert.equal(out.players[1].prizes.length, 2, '獎賞尚未取');
});

T('灼傷檢查致死 + 對手無 faceUp → 自動取', () => {
  const restore = forceTails();
  const out = mod.applyAction(state('burned', [inst(POKE), inst(POKE)]), { type:'END_TURN' }, pool);
  restore();
  assert.ok(out.players[0].active === null, '灼傷 KO');
  assert.ok(!out.pendingSelection, '無 faceUp 自動取');
  assert.equal(out.players[1].prizes.length, 1, '對手自動取 1 張');
});

console.log('\n中毒/灼傷檢查 KO 取獎收斂(v5.889):PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
