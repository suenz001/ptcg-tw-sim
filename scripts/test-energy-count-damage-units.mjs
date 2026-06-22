/**
 * 「能量的數量×N / 比較」傷害 host-aware 收斂（v5.676）
 * 卡面「能量的數量」= 能量單位數（個，火箭隊能量=2…），非卡張數（Wilson 個vs張 裁定）。
 *  - 吞食獸|張大嘴：自身能量數 > 對手 → +160。原 raw .length 把火箭隊能量算 1 → 漏判。
 *  - 超級捷拉奧拉ex|閃電拳：自身【雷】能量數×60。原 inline 算「全部能量的卡張數」(漏雷filter+raw)。
 * 直接呼叫 ATTACK_PRE 的傷害公式（不經 USE_ATTACK，避開能量 cost 設置）。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.ec-s.mjs'), E = join(ROOT, '.ec-e.ts'), O = join(ROOT, '.ec-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";export const assets="";');
writeFileSync(E, "export { createGame } from './src/lib/game/engine';\nexport { ATTACK_PRE } from './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { createGame, ATTACK_PRE } = await import(pathToFileURL(O).href);
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) { if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue; for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c); }

const GULP = '10957' /*吞食獸*/, ZERA = '19170' /*超級捷拉奧拉ex*/,
      ROCKET = '17213' /*火箭隊能量(2單位)*/, LIGHT = '18520' /*基本雷*/, PSY = '11177' /*基本超*/, WATER = '18519' /*基本水*/, DEF = '14705';
let nn = 0;
const inst = (cid, x = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], ...x });
const en = (cid) => inst(cid);

function st2(attCid, attEnergy, defCid, defEnergy) {
  const s = createGame({ name: 'P1', entries: [{ cardId: GULP, count: 1 }] }, { name: 'P2', entries: [{ cardId: DEF, count: 1 }] }, pool);
  return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0,
    players: [
      { ...s.players[0], active: inst(attCid, { energyAttached: attEnergy }), bench: [] },
      { ...s.players[1], active: inst(defCid, { energyAttached: defEnergy }), bench: [] }] };
}
const dmgOf = (key, state) => ATTACK_PRE.get(key)(state, 0, pool).damage;

let pass = 0, fail = 0;
const T = (nm, f) => { try { f(); console.log('  OK', nm); pass++; } catch (e) { console.log('  FAIL', nm, '::', e.message); fail++; } };

T('★張大嘴：自火箭隊能量(2個) vs 對手1個 → 2>1 +160=170 (HEAD raw .length 1>1 false → FAIL)', () => {
  const d = dmgOf('吞食獸|張大嘴', st2(GULP, [en(ROCKET)], DEF, [en(WATER)]));
  assert.equal(d, 170, '火箭隊能量應算 2 個 → 觸發 +160');
});

T('張大嘴：自 1 基本 vs 對手火箭隊(2個) → 1>2 false → 10 (baseline)', () => {
  const d = dmgOf('吞食獸|張大嘴', st2(GULP, [en(WATER)], DEF, [en(ROCKET)]));
  assert.equal(d, 10, '對手火箭隊=2 個 → 自身 1 不大於 2');
});

T('★閃電拳：2雷+1超 → 只算【雷】2個 ×60 = 120 (HEAD 算全部 3 張 ×60=180 → FAIL)', () => {
  const d = dmgOf('超級捷拉奧拉ex|閃電拳', st2(ZERA, [en(LIGHT), en(LIGHT), en(PSY)], DEF, []));
  assert.equal(d, 120, '只算【雷】能量 2 個');
});

T('閃電拳：0 雷能量 → 0 (baseline)', () => {
  const d = dmgOf('超級捷拉奧拉ex|閃電拳', st2(ZERA, [en(PSY), en(WATER)], DEF, []));
  assert.equal(d, 0, '無【雷】能量 → 0');
});

console.log('\n能量數量×N傷害 host-aware:PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
