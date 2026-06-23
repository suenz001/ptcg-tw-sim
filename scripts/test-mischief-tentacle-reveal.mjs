/**
 * 好啦魷|惡作劇觸手 — 查看對手牌庫頂 + 若希望重洗（v5.681）
 * 卡面：「查看對手的牌庫上方 1 張卡，回復原樣。若希望，重洗那個牌庫。」
 * 原借殼 binary-yes-no（決定在看牌前 + 自動重洗）→ 改 modal-choice：選項 text 揭示對手牌庫頂卡名，
 *   玩家看過後選「重洗 / 保留」。只揭示頂 1 張（不洩漏對手整副牌庫）。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.mt-s.mjs'), E = join(ROOT, '.mt-e.ts'), O = join(ROOT, '.mt-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { createGame, applyAction } from './src/lib/game/engine';\nexport { ATTACK_POST } from './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction, ATTACK_POST } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const INKAY = '10615' /*好啦魷 惡作劇觸手*/, A = '11177', B = '18519', C = '14705', D = '18520', DEF = '14705';
let nn = 0;
const inst = (cid, x = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...x });
function mk() {
  const s = createGame({ name: 'P1', entries: [{ cardId: INKAY, count: 1 }] }, { name: 'P2', entries: [{ cardId: DEF, count: 1 }] }, pool);
  const oppDeck = [inst(A), inst(B), inst(C), inst(D)];
  const st = { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0,
    players: [{ ...s.players[0], active: inst(INKAY) }, { ...s.players[1], active: inst(DEF), deck: oppDeck }] };
  return { st, oppDeckIids: oppDeck.map(c => c.iid), topName: pool.get(A)?.name ?? '?' };
}

let pass = 0, fail = 0;
const T = (nm, f) => { try { f(); console.log('  OK', nm); pass++; } catch (e) { console.log('  FAIL', nm, '::', e.message); fail++; } };

T('★惡作劇觸手：開 modal-choice，選項揭示對手牌庫頂卡名（HEAD 是 binary 無 modal → FAIL）', () => {
  const o = mk();
  const out = ATTACK_POST.get('好啦魷|惡作劇觸手')(o.st, 0, pool);
  assert.equal(out.pendingSelection?.type, 'modal-choice', '應開 modal-choice');
  assert.equal(out.pendingSelection?.effectKey, 'mischief-tentacle-reshuffle');
  const opts = out.pendingSelection?.params?.options ?? [];
  assert.ok(opts.some(o2 => String(o2.text).includes(o.topName)), '選項應揭示對手牌庫頂卡名「' + o.topName + '」');
});

T('★惡作劇觸手：選「保留」 → 對手牌庫順序完全不變（不重洗）', () => {
  const o = mk();
  let s = ATTACK_POST.get('好啦魷|惡作劇觸手')(o.st, 0, pool);
  s = applyAction(s, { type: 'RESOLVE_SELECTION', senderIdx: 0, selectedIids: ['keep'] }, pool);
  assert.deepEqual(s.players[1].deck.map(c => c.iid), o.oppDeckIids, '保留 → 順序原封不動');
});

T('惡作劇觸手：選「重洗」 → 對手牌庫卡片不增不減（multiset 不變）', () => {
  const o = mk();
  let s = ATTACK_POST.get('好啦魷|惡作劇觸手')(o.st, 0, pool);
  s = applyAction(s, { type: 'RESOLVE_SELECTION', senderIdx: 0, selectedIids: ['reshuffle'] }, pool);
  assert.deepEqual([...s.players[1].deck.map(c => c.iid)].sort(), [...o.oppDeckIids].sort(), '重洗 → 卡片集合不變');
});

console.log('\n惡作劇觸手(揭示對手頂+可重洗):PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
