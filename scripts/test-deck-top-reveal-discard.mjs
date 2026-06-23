/**
 * 岩狗狗|挖回 / 燭光靈|光照燃燒 — 查看牌庫頂可丟棄（v5.680）
 * 卡面：「查看自己的牌庫上方 1 張卡，回復原樣。若希望，將那張卡丟棄。」
 * 原本用 binary-yes-no 盲選（玩家看不到牌庫頂）→ 改用中央 openDeckTopRevealOptionalDiscard：
 *   開 deck-search picker（validIids=牌庫頂1，玩家看得到牌面）→ 選丟棄 or 不選(回復原樣，不重洗)。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.dt-s.mjs'), E = join(ROOT, '.dt-e.ts'), O = join(ROOT, '.dt-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { createGame, applyAction } from './src/lib/game/engine';\nexport { ATTACK_POST } from './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction, ATTACK_POST } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const ROCKRUFF = '12513' /*岩狗狗 挖回*/, CANDLE = '13705' /*燭光靈 光照燃燒*/,
      A = '11177' /*基本超(top)*/, B = '18519' /*基本水*/, C = '14705' /*小磁怪*/, DEF = '14705';
let nn = 0;
const inst = (cid, x = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...x });

function mk(attCid) {
  const s = createGame({ name: 'P1', entries: [{ cardId: attCid, count: 1 }] }, { name: 'P2', entries: [{ cardId: DEF, count: 1 }] }, pool);
  const top = inst(A), b = inst(B), c = inst(C);
  const st = { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0,
    players: [{ ...s.players[0], active: inst(attCid), deck: [top, b, c], discard: [] }, { ...s.players[1], active: inst(DEF) }] };
  return { st, topIid: top.iid, bIid: b.iid, cIid: c.iid };
}

let pass = 0, fail = 0;
const T = (nm, f) => { try { f(); console.log('  OK', nm); pass++; } catch (e) { console.log('  FAIL', nm, '::', e.message); fail++; } };

T('★挖回：開 deck-search picker 顯示牌庫頂 1 張（validIids=頂卡；HEAD 是 binary 無 picker → FAIL）', () => {
  const o = mk(ROCKRUFF);
  const out = ATTACK_POST.get('岩狗狗|挖回')(o.st, 0, pool);
  assert.equal(out.pendingSelection?.type, 'deck-search', '應開 deck-search picker（可看牌面）');
  assert.equal(out.pendingSelection?.effectKey, 'deck-top-reveal-discard');
  assert.deepEqual(out.pendingSelection?.params?.validIids, [o.topIid], '只揭示牌庫頂 1 張');
});

T('★挖回：選丟棄 → 牌庫頂進棄牌、其餘順序不變（不重洗）', () => {
  const o = mk(ROCKRUFF);
  let s = ATTACK_POST.get('岩狗狗|挖回')(o.st, 0, pool);
  s = applyAction(s, { type: 'RESOLVE_SELECTION', senderIdx: 0, selectedIids: [o.topIid] }, pool);
  const p = s.players[0];
  assert.deepEqual(p.deck.map(c => c.iid), [o.bIid, o.cIid], '頂卡移除、其餘維持原順序');
  assert.ok(p.discard.some(c => c.iid === o.topIid), '頂卡進棄牌區');
});

T('★挖回：不選(回復原樣) → 牌庫完全不變、不重洗、無丟棄', () => {
  const o = mk(ROCKRUFF);
  let s = ATTACK_POST.get('岩狗狗|挖回')(o.st, 0, pool);
  s = applyAction(s, { type: 'RESOLVE_SELECTION', senderIdx: 0, selectedIids: [] }, pool);
  const p = s.players[0];
  assert.deepEqual(p.deck.map(c => c.iid), [o.topIid, o.bIid, o.cIid], '牌庫順序原封不動');
  assert.equal(p.discard.length, 0, '無丟棄');
});

T('燭光靈|光照燃燒：同樣開 reveal picker（validIids=頂卡）', () => {
  const o = mk(CANDLE);
  const out = ATTACK_POST.get('燭光靈|光照燃燒')(o.st, 0, pool);
  assert.equal(out.pendingSelection?.type, 'deck-search');
  assert.deepEqual(out.pendingSelection?.params?.validIids, [o.topIid]);
});

console.log('\n查看牌庫頂可丟棄(reveal picker):PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
