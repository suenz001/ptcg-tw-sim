/** v5.878 克雷色利亞｜弦月光芒：將自己 1 張反面獎賞翻到正面(+80 傷害、維持到對戰結束、公開 log 卡名);
 *  取獎賞時若有正面朝上的獎賞→開 modal-choice 讓玩家選要不要取那張已知卡。
 *  HEAD-FAIL:HEAD 的弦月光芒不 set faceUp(只 +80)、TAKE_PRIZES 不理 faceUp(直接前端取,不開 modal-choice)。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.cr-s.js'), E = join(ROOT, '.cr-e.ts'), O = join(ROOT, '.cr-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { ATTACK_PRE } from './src/lib/game/effects/_shared';\nexport { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const CRESSELIA = '16788', POKE = '14319', WATER_E = '18519', GRASS_E = '18518';
let nn = 0;
const inst = (cid, extra={}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], toolAttached: undefined, extraTools: [], status: null, secondaryStatus: null, tertiaryStatus: null, ...extra });
function mk(p0prizes, pendingPrizes=[0,0]) {
  return {
    id:'t', phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
    log: [], pendingSelection: null, setupDone: [true, true], pendingPrizes,
    players: [
      { name: 'ATK', active: inst(CRESSELIA), bench: [], hand: [], deck: [], discard: [], prizes: p0prizes },
      { name: 'OPP', active: inst(POKE), bench: [], hand: [], deck: [], discard: [], prizes: [inst(POKE),inst(POKE)] },
    ],
  };
}
const pub = (l) => (typeof l === 'string' ? l : (l?.message || ''));
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };
const waterName = pool.get(WATER_E)?.name ?? '水';

// 1) 弦月光芒 選「是」→ 翻 1 張反面獎賞成 faceUp + damage 160 + 公開 log 含卡名
T('★弦月光芒 yes → faceUp 翻獎賞 + 160 傷 + 公開 log 卡名', () => {
  const st = mk([inst(WATER_E), inst(GRASS_E)]);
  const pre = mod.ATTACK_PRE.get('克雷色利亞|弦月光芒');
  assert.ok(pre, '應有 regPre');
  const out = pre(st, 0, pool, { discardedEnergyIids: ['dummy'] });  // yes
  assert.equal(out.damage, 160, 'yes → 160');
  const flipped = out.state.players[0].prizes.filter(p => p.faceUp);
  assert.equal(flipped.length, 1, '恰翻 1 張成 faceUp');
  assert.ok(out.state.log.some(l => pub(l).includes('翻到正面') && pub(l).includes(waterName)), '公開 log 揭示翻到正面的卡名');
});

// 2) 弦月光芒 選「否」→ 不翻 + 80 傷
T('弦月光芒 no → 不翻 + 80 傷', () => {
  const out = mod.ATTACK_PRE.get('克雷色利亞|弦月光芒')(mk([inst(WATER_E)]), 0, pool, { discardedEnergyIids: [] });
  assert.equal(out.damage, 80);
  assert.equal(out.state.players[0].prizes.filter(p=>p.faceUp).length, 0, '沒翻');
});

// 3) TAKE_PRIZES 有 faceUp 獎賞 → 開 modal-choice(take-prize-choose)
T('★TAKE_PRIZES 有正面獎賞 → 開 modal-choice', () => {
  const st = mk([inst(WATER_E, {faceUp:true}), inst(GRASS_E)], [1,0]);
  const out = mod.applyAction(st, { type: 'TAKE_PRIZES', count: 1, playerIdx: 0 }, pool);
  assert.ok(out.pendingSelection, 'HEAD 直接取不開 picker → 修後開 modal-choice');
  assert.equal(out.pendingSelection.type, 'modal-choice');
  assert.equal(out.pendingSelection.effectKey, 'take-prize-choose');
  assert.equal(out.players[0].prizes.length, 2, '尚未取走');
});

// 4) take-faceup → 取走正面那張(進手牌,faceUp 剝除)
T('★take-faceup → 取走正面卡進手牌', () => {
  const st = mk([inst(WATER_E, {faceUp:true}), inst(GRASS_E)], [1,0]);
  let out = mod.applyAction(st, { type: 'TAKE_PRIZES', count: 1, playerIdx: 0 }, pool);
  out = mod.applyAction(out, { type: 'RESOLVE_SELECTION', selectedIids: ['take-faceup'] }, pool);
  assert.equal(out.players[0].prizes.length, 1, '取走 1 張');
  assert.equal(out.players[0].hand.length, 1, '1 張進手牌');
  assert.equal(pool.get(out.players[0].hand[0].cardId)?.name, waterName, '進手牌的是正面那張(水)');
  assert.ok(!out.players[0].hand[0].faceUp, '手牌卡剝除 faceUp');
});

// 5) take-facedown → 取蓋著的,保留正面在獎賞區
T('★take-facedown → 取蓋著,保留正面獎賞', () => {
  const st = mk([inst(WATER_E, {faceUp:true}), inst(GRASS_E)], [1,0]);
  let out = mod.applyAction(st, { type: 'TAKE_PRIZES', count: 1, playerIdx: 0 }, pool);
  out = mod.applyAction(out, { type: 'RESOLVE_SELECTION', selectedIids: ['take-facedown'] }, pool);
  assert.equal(out.players[0].prizes.length, 1, '取走 1 張');
  assert.ok(out.players[0].prizes[0].faceUp, '保留的是正面那張');
  assert.equal(pool.get(out.players[0].hand[0].cardId)?.name, pool.get(GRASS_E)?.name, '進手牌的是蓋著(草)');
});

// 6) 無 faceUp → TAKE_PRIZES 維持前端直接取(不開 picker)
T('無正面獎賞 → 直接前端取(不開 picker)', () => {
  const st = mk([inst(WATER_E), inst(GRASS_E)], [1,0]);
  const out = mod.applyAction(st, { type: 'TAKE_PRIZES', count: 1, playerIdx: 0 }, pool);
  assert.ok(!out.pendingSelection, '無 faceUp 不開 picker');
  assert.equal(out.players[0].prizes.length, 1, '直接取 1 張');
  assert.equal(out.players[0].hand.length, 1);
});

console.log('\n克雷色利亞 弦月光芒 獎賞翻面(v5.878):PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
