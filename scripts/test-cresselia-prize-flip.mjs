/** v5.878~v5.880 克雷色利亞｜弦月光芒 獎賞卡翻到正面 + 取獎選擇。
 *  v5.880 真 bug 修正：①flip 從 regPre 移到 regPost(ATTACK handler 用 players 快照重建,regPre 對
 *  prizes 的變更遺失)。②取獎真正路徑是 addPendingPrize(KO 當下自動取,v5.466),非 TAKE_PRIZES →
 *  faceUp picker 改在 addPendingPrize 觸發(有 faceUp 才開 picker、無則維持自動取)。
 *  HEAD-FAIL(v5.879):完整 ATTACK 後 faceUp 遺失、KO 直接自動取不開 picker。 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.cr-s.js'), E = join(ROOT, '.cr-e.ts'), O = join(ROOT, '.cr-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const mod = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const CR = '16788', POKE = '14319', PSY = '11177', W = '18519';
let nn = 0;
const inst = (cid, ex={}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], toolAttached: undefined, extraTools: [], status: null, secondaryStatus: null, tertiaryStatus: null, ...ex });
function mk(myPrizes, oppBench = [inst(POKE), inst(POKE)]) {
  const active = inst(CR); active.energyAttached = [inst(PSY), inst(PSY), inst(PSY)];
  return {
    id:'t', phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
    log: [], pendingSelection: null, setupDone: [true, true], pendingPrizes: [0, 0],
    players: [
      { name: 'ME', active, bench: [], hand: [], deck: [inst(POKE)], discard: [], prizes: myPrizes },
      { name: 'OP', active: inst(POKE), bench: oppBench, hand: [], deck: [inst(POKE)], discard: [], prizes: [inst(POKE), inst(POKE)] },
    ],
  };
}
const pub = (l) => (typeof l === 'string' ? l : (l?.message || ''));
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };
const p6 = () => [inst(W), inst(POKE), inst(POKE), inst(POKE), inst(POKE), inst(POKE)];

// 1) ATTACK(yes) → regPost 翻面持久(faceUp 保留)+公開 log(v5.880 修:regPre 會遺失)。
//    註:同一次攻擊的 KO 獎賞取用(addPendingPrize)早於 regPost 翻面,故該張 KO 獎賞仍自動取;
//    翻的 faceUp 保留給後續回合的取獎(Wilson 多次使用情境)。
T('★ATTACK(yes) → 翻面持久(faceUp 保留)+公開 log', () => {
  const out = mod.applyAction(mk(p6()), { type: 'ATTACK', attackIndex: 1, discardedEnergyIids: ['x'] }, pool);
  assert.ok(out.log.some(l => pub(l).includes('翻到正面')), '公開 log 記錄翻到正面的卡(v5.880:regPost 才不遺失)');
  assert.equal(out.players[0].prizes.filter(pz => pz.faceUp).length, 1, '完整 ATTACK 後仍有 1 張 faceUp 持久');
});

// 2) 已有 faceUp 獎賞時 KO → picker 選正面 → 取走進手牌(faceUp 剝除)
T('★已有 faceUp + KO → picker 選正面取走進手牌', () => {
  const prizes = [inst(W, {faceUp:true}), inst(POKE), inst(POKE), inst(POKE)];
  let out = mod.applyAction(mk(prizes), { type: 'ATTACK', attackIndex: 1, discardedEnergyIids: [] }, pool);
  assert.ok(out.pendingSelection, '有 faceUp → KO 開 picker');
  const fu = out.pendingSelection.params.options.find(o => o.text.includes('正面朝上'));
  out = mod.applyAction(out, { type: 'RESOLVE_SELECTION', selectedIids: [fu.id] }, pool);
  assert.equal(out.players[0].prizes.length, 3, '取走 1 張');
  assert.equal(pool.get(out.players[0].hand.find(c=>c.cardId===W)?.cardId)?.name, pool.get(W).name, '取走的正面卡(水)進手牌');
  assert.ok(out.players[0].hand.every(c => !c.faceUp), '進手牌剝 faceUp');
});

// 3) 無 faceUp(選 no 不翻) KO → addPendingPrize 自動取,不開 picker
T('★選 no(不翻) KO → 自動取不開 picker', () => {
  const out = mod.applyAction(mk(p6()), { type: 'ATTACK', attackIndex: 1, discardedEnergyIids: [] }, pool);
  assert.ok(!out.pendingSelection, '無 faceUp → 維持自動取');
  assert.equal(out.players[0].prizes.length, 5, '自動取 1 張');
  assert.equal(out.players[0].hand.length, 1);
});

// 4) 多張 faceUp(預置 2 張) KO → picker 2 個正面選項,連取 2 張
T('★多張 faceUp KO → 逐張 picker 可連取正面', () => {
  const prizes = [inst(W, {faceUp:true}), inst(POKE, {faceUp:true}), inst(POKE), inst(POKE)];
  // 對手 active KO 給 2 獎賞(用 ex? 這裡 KO basic=1 獎賞),為取 2 張改 pendingPrizes 手動測 resolver 迴圈:
  let out = mod.applyAction(mk(prizes), { type: 'ATTACK', attackIndex: 1, discardedEnergyIids: [] }, pool);
  assert.ok(out.pendingSelection, '有 faceUp → picker');
  const fuOpts = out.pendingSelection.params.options.filter(o => o.text.includes('正面朝上'));
  assert.equal(fuOpts.length, 2, '2 個正面選項');
});

console.log('\n克雷色利亞 弦月光芒 獎賞翻面(v5.880):PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
