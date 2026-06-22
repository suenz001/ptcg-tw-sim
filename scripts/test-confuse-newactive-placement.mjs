/**
 * 漩渦言靈+熔岩地域 對新上場者同時施混亂+灼傷:混亂須在 status 主格（v5.660）
 * bug:engine confuseNewActive 手動放置,status==='burned'(熔岩地域先燒)時把混亂放進 secondaryStatus,
 *   違反「行動類狀態永遠在 status」不變式 → 攻擊時混亂判定(只讀 status)漏掉。改用中央 applyStatusToActive。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.cf-s.mjs'), E = join(ROOT, '.cf-e.ts'), O = join(ROOT, '.cf-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { createGame, applyAction } from './src/lib/game/engine';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, applyAction } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }
const MUMA = '14354' /*夢妖魔ex 漩渦言靈*/, SLUG = '9859' /*熔岩蝸牛 熔岩地域*/, SUBJ = '10619' /*願增猿ex HP210*/, DEF = '13163', W = '18519';
let nn = 0;
const inst = (cid, x = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...x });
function mk(oppConfuse, oppBurn) {
  const s = createGame({ name: 'P1', entries: [{ cardId: DEF, count: 1 }] }, { name: 'P2', entries: [{ cardId: MUMA, count: 1 }] }, pool);
  const p0active = inst(DEF, { energyAttached: Array.from({ length: 4 }, () => inst(W)) }); // 4 水能量付撤退費(單屬性自動丟,免picker)
  const subj = inst(SUBJ);
  const p1bench = oppBurn ? [inst(SLUG)] : [inst(DEF)];
  return { st: { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, isFirstTurn: false,
    setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], pendingSelection: null,
    players: [
      { ...s.players[0], hand: [], deck: [inst(DEF)], discard: [], prizes: Array.from({ length: 6 }, () => inst(DEF)), active: p0active, bench: [subj] },
      { ...s.players[1], hand: [], deck: [inst(DEF)], discard: [], prizes: Array.from({ length: 6 }, () => inst(DEF)), active: oppConfuse ? inst(MUMA) : inst(DEF), bench: p1bench }] },
    subjIid: subj.iid };
}
function retreat(o) {
  const { st, subjIid } = o;
  let out = applyAction(st, { type: 'RETREAT', newActiveIid: subjIid }, pool);
  // 若開能量丟棄picker(理論上單屬性不會),自動選前N個
  if (out.pendingSelection && /energy/i.test(out.pendingSelection.type || '')) {
    const ids = out.players[0].active.energyAttached.slice(0, 1).map(e => e.iid);
    out = applyAction(out, { type: 'RESOLVE_SELECTION', effectKey: out.pendingSelection.effectKey, selectedIids: ids, actorIdx: 0 }, pool);
  }
  return out;
}
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };

T('★熔岩地域(先燒)+漩渦言靈 → 新active:混亂在 status 主格、灼傷在傷害槽', () => {
  const out = retreat(mk(true, true));
  const a = out.players[0].active;
  assert.equal(a.cardId, SUBJ, '新active應為被換上者');
  assert.equal(a.status, 'confused', '混亂必須在 status 主格(攻擊時混亂判定只讀 status)');
  const burnedSomewhere = a.secondaryStatus === 'burned' || a.tertiaryStatus === 'burned';
  assert.ok(burnedSomewhere, '灼傷應保留在傷害槽');
});

T('控制:只有漩渦言靈(無熔岩地域) → 新active 混亂在 status', () => {
  const out = retreat(mk(true, false));
  assert.equal(out.players[0].active.status, 'confused', '單純混亂應在 status');
});

T('控制:都沒有 → 新active 無狀態', () => {
  const out = retreat(mk(false, false));
  const a = out.players[0].active;
  assert.equal(a.status, undefined); assert.equal(a.secondaryStatus, undefined);
});

console.log('\n漩渦言靈+熔岩地域混亂放置:PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
