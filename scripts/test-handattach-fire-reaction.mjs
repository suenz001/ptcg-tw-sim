/**
 * 從手牌附能 → 必觸發對手反應 fireOnHandEnergyAttached(耿鬼ex 侵蝕詛咒/帕奇利茲 麻痺門牙)(v5.782)
 * 5 卡原漏 fire:玉樹臨風/烈火亂舞/經驗法則/迴旋充能/漸強波。
 * 驗法:對手 bench 放 耿鬼ex(侵蝕詛咒,每次對手從手牌附能→放2指示物=20),
 *   附能後攻擊方「被附能的寶可夢」應 +20 damage。驗 HEAD FAIL(未修=0)。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.hf-s.js'), E = join(ROOT, '.hf-e.ts'), O = join(ROOT, '.hf-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { applyAction } from './src/lib/game/engine';\nexport { ATTACK_POST } from './src/lib/game/effects/_shared';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { applyAction, ATTACK_POST } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const GENGAR = '16916', TORNADUS = '17081', ENTEI = '16583', URSALUNA = '10607', WISHIWASHI = '12775', WUGTRIO = '10518';
const E_FIRE = '18518', E_FIGHT = '11178', E_WATER = '18519';
// v6.165：迴旋充能的卡面是「選擇最多2張『基本【雷】能量』卡」，resolver 已依 v6.009 紀律
//   自驗 client 送來的 iid ⇒ fixture 必須用**基本【雷】能量**（原本誤用基本【水】能量，
//   舊實作不驗才會通過）。⚠ 常數 WUGTRIO=10518 其實就是 大電海燕ex（命名沿用，id 正確）。
const E_LIGHTNING = '18520';
let nn = 0;
const inst = (cid, e = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...e });
const eng = (cid) => ({ iid: 'e' + (++nn), cardId: String(cid), damage: 0, energyAttached: [] });
const prize = n => Array.from({ length: n }, () => inst(E_FIRE));
// P1=attacker(active=測試卡, hand=能量); P2=對手(bench=耿鬼ex 侵蝕詛咒)
function mk(activeCid, handEnergies, activeExtra = {}) {
  return {
    phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
    log: [], setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], pendingSelection: null,
    players: [
      { name: 'P1', active: inst(activeCid, activeExtra), bench: [], hand: handEnergies.map(eng), deck: [inst(E_FIRE)], discard: [], prizes: prize(6) },
      { name: 'P2', active: inst(WUGTRIO), bench: [inst(GENGAR)], hand: [], deck: [inst(E_FIRE)], discard: [], prizes: prize(6) },
    ],
  };
}
const RESOLVE = (iids) => ({ type: 'RESOLVE_SELECTION', selectedIids: iids });
let pass = 0, fail = 0;
const T = (n, f) => { try { f(); console.log('  OK', n); pass++; } catch (e) { console.log('  FAIL', n, '::', e.message); fail++; } };

// (1) 玉樹臨風 — attack regPost 直接附能
T('★玉樹臨風:從手牌附能→侵蝕詛咒+20', () => {
  const st = mk(TORNADUS, [E_WATER]);
  const post = ATTACK_POST.get('龍捲雲|玉樹臨風');
  assert.ok(post, '找不到 玉樹臨風 ATTACK_POST');
  const out = post(st, 0, pool, {});
  assert.equal(out.players[0].active.damage, 20, '附能後自身應因侵蝕詛咒 +20(HEAD=0)');
  assert.equal(out.players[0].active.energyAttached.length, 1, '能量已附');
});

// (2) 經驗法則 — ursaluna-bm-attach resolver
T('★經驗法則:從手牌附能→侵蝕詛咒+20', () => {
  const st = mk(URSALUNA, [E_FIGHT]);
  const hostIid = st.players[0].active.iid;
  const energyIid = st.players[0].hand[0].iid;
  st.pendingSelection = { type: 'hand-choose', actorIdx: 0, sourcePlayerIdx: 0, minCount: 0, maxCount: 2, effectKey: 'ursaluna-bm-attach', params: { hostIid } };
  const out = applyAction(st, RESOLVE([energyIid]), pool);
  assert.equal(out.players[0].active.damage, 20, '附能後 +20(HEAD=0)');
});

// (3) 迴旋充能 — h-wave2-attach-from-hand
//   v6.165：params 不帶 hostIid（模擬升版前開好的舊 pending）→ resolver fallback 回戰鬥位，
//   對局不會卡住；侵蝕詛咒仍要 per-card 觸發。
T('★迴旋充能:從手牌附能→侵蝕詛咒+20', () => {
  const st = mk(WUGTRIO, [E_LIGHTNING]); // active = 大電海燕ex(10518)
  const energyIid = st.players[0].hand[0].iid;
  st.pendingSelection = { type: 'hand-choose', actorIdx: 0, sourcePlayerIdx: 0, minCount: 0, maxCount: 2, effectKey: 'h-wave2-attach-from-hand', params: {} };
  const out = applyAction(st, RESOLVE([energyIid]), pool);
  assert.equal(out.players[0].active.damage, 20, '附能後 +20(HEAD=0)');
  assert.equal(out.players[0].active.energyAttached.length, 1, 'v6.165 舊 pending(無 hostIid) 仍附到戰鬥位');
});

// (4) 漸強波 — sakura-crescendo-attach
T('★漸強波:從手牌附能→侵蝕詛咒+20', () => {
  const st = mk(WISHIWASHI, [E_WATER]);
  const energyIid = st.players[0].hand[0].iid;
  const defIid = st.players[1].active.iid;
  st.pendingSelection = { type: 'hand-choose', actorIdx: 0, sourcePlayerIdx: 0, minCount: 0, maxCount: 9, effectKey: 'sakura-crescendo-attach', params: { defIid } };
  const out = applyAction(st, RESOLVE([energyIid]), pool);
  assert.equal(out.players[0].active.damage, 20, '附能後自身 +20(HEAD=0)');
});

// (5) 烈火亂舞 — inferno-fandango-attach(_magHeal 別名案例)
T('★烈火亂舞:從手牌附能→侵蝕詛咒+20', () => {
  const st = mk(ENTEI, [E_FIRE]);
  const hostIid = st.players[0].active.iid;
  const energyIid = st.players[0].hand[0].iid;
  // inferno-fandango-attach 從 params 取 energyIid/energyCardId,targetIid 由 iids
  st.pendingSelection = { type: 'heal-target', actorIdx: 0, sourcePlayerIdx: 0, minCount: 1, maxCount: 1, effectKey: 'inferno-fandango-attach', params: { energyIid, energyCardId: E_FIRE, validIids: [hostIid] } };
  const out = applyAction(st, RESOLVE([hostIid]), pool);
  assert.equal(out.players[0].active.damage, 20, '附能後 +20(HEAD=0)');
});

console.log('\n從手牌附能觸發對手反應(v5.782):PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
