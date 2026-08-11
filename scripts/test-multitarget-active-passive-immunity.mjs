/**
 * v6.164 回歸守衛 — 多目標／自跑傷害迴圈的 resolver，對「戰鬥位」目標必須套 PASSIVE_IMMUNITY。
 *
 * 玩家回報：酋雷姆（特性【反等離子】）｜三重冰霜 打得到戰鬥場上的 厄鬼椪 礎石面具ex，
 * 但礎石面具ex 卡面【礎石之勢】＝「這隻寶可夢不會受到對手的擁有特性的寶可夢招式的傷害。」
 *
 * 真因：snipe-multi / clone-strike-multi-hit 兩個 resolver 只呼叫 canApplyEffectToTarget，
 *      而 PASSIVE_IMMUNITY 那一層在**備戰側**是 resolveBenchGuard 內含（v5.367），
 *      **戰鬥位側從來沒有** → v6.164 收斂到中央 resolveMultiTargetDamageGuard。
 *
 * 本檔同時含「正對照」：攻擊方不符合免疫條件時必須照樣打得到（防過度免疫）。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.mtpi-s.js'), E = join(ROOT, '.mtpi-e.ts'), O = join(ROOT, '.mtpi-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch {} } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { ATTACK_POST, ATTACK_PRE } from './src/lib/game/effects/_shared';\n"
  + "export { applyAction } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({
  entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node',
  target: 'node20', alias: { '$lib': join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error',
});
const mod = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map(e => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
/**
 * 依卡名取 id；限定 regulationMark ∈ H/I/J（只維護這三標）。
 * ⚠ 同名卡有多個印刷版本且招式不同（甲賀忍蛙ex：MC 版只有「變幻手裏劍」，SV5a 版才有
 *   「分身連打」）——需要特定招式時必須帶 attackName，否則會抓到沒有那招的版本。
 */
function byName(name, attackName) {
  for (const [id, c] of pool) {
    if (c.name !== name || !['H', 'I', 'J'].includes(c.regulationMark)) continue;
    if (attackName && !(c.attacks ?? []).some(a => a.name === attackName)) continue;
    return id;
  }
  throw new Error('找不到 H/I/J 卡：' + name + (attackName ? '｜' + attackName : ''));
}
let U = 0;
const inst = (name, extra = {}, attackName) => ({ iid: 'i' + (++U), cardId: byName(name, attackName), damage: 0, energyAttached: [], ...extra });
const ecard = (name) => ({ iid: 'e' + (++U), cardId: byName(name) });
const mk = (p0, p1) => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0,
  turn: 5, isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
  players: [
    { name: 'A', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [] , ...p0 },
    { name: 'B', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [], ...p1 },
  ],
});
const dmgOf = (st, where, iid) => {
  const p = st.players[1];
  const c = where === 'active' ? p.active : p.bench.find(b => b.iid === iid);
  return c ? c.damage : 'KO';
};

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('  ✓', msg); };

// ── 三重冰霜（酋雷姆，擁有特性【反等離子】）走 snipe-multi ───────────────────
function fireTripleFrost(defActive, defBench = []) {
  const kyu = inst('酋雷姆', {}, '三重冰霜');
  // 三重冰霜 cost = 水水鋼鋼無（5 顆）
  kyu.energyAttached = [ecard('基本【水】能量'), ecard('基本【水】能量'),
    ecard('基本【鋼】能量'), ecard('基本【鋼】能量'), ecard('基本【火】能量')];
  let st = mk({ active: kyu }, { active: defActive, bench: defBench });
  st = mod.applyAction(st, { type: 'ATTACK', attackIndex: 0, actorIdx: 0 }, pool);
  assert.ok(st.pendingSelection?.effectKey === 'snipe-multi', '三重冰霜應開 snipe-multi picker');
  const ids = [defActive.iid, ...defBench.map(b => b.iid)];
  return mod.applyAction(st, { type: 'RESOLVE_SELECTION', selectedIids: ids }, pool);
}

console.log('【snipe-multi】三重冰霜（攻擊方有特性）vs 礎石之勢');
{
  const ogre = inst('厄鬼椪 礎石面具ex');
  const st = fireTripleFrost(ogre);
  ok(dmgOf(st, 'active') === 0,
    '戰鬥位 厄鬼椪 礎石面具ex 不受 三重冰霜 傷害（礎石之勢：不受擁有特性的寶可夢招式傷害）');
}
{
  const filler = inst('阿響的凱羅斯');
  const ogreB = inst('厄鬼椪 礎石面具ex');
  const st = fireTripleFrost(filler, [ogreB]);
  ok(dmgOf(st, 'bench', ogreB.iid) === 0, '備戰 厄鬼椪 礎石面具ex 同樣不受 三重冰霜 傷害（v5.367 既有行為）');
}
console.log('【正對照】不符合免疫條件時必須照樣打得到');
{
  const plain = inst('阿響的凱羅斯');   // 無特性、非 ex、對【龍】無弱點
  const st = fireTripleFrost(plain);
  ok(dmgOf(st, 'active') === 110, `一般寶可夢仍受 110 傷害（實得 ${dmgOf(st, 'active')}）`);
}
{
  const crab = inst('岩殿居蟹');        // 神秘石居：只擋「寶可夢【ex】」招式；酋雷姆非 ex
  const st = fireTripleFrost(crab);
  ok(dmgOf(st, 'active') === 110, `岩殿居蟹|神秘石居 擋不住非 ex 的酋雷姆（實得 ${dmgOf(st, 'active')}）`);
}

// ── 分身連打（甲賀忍蛙ex，**沒有**特性、但是 ex）走 clone-strike-multi-hit ────
function fireCloneStrike(defActive) {
  const frog = inst('甲賀忍蛙ex', {}, '分身連打');   // ⚠ 必須是 SV5a 版（MC 版沒這招）
  const frogAtkIdx = (pool.get(frog.cardId).attacks ?? []).findIndex(a => a.name === '分身連打');
  // 分身連打 cost = 水無無（3 顆）；招式本身還要丟 2 顆 ⇒ 給 4 顆
  frog.energyAttached = [ecard('基本【水】能量'), ecard('基本【水】能量'),
    ecard('基本【水】能量'), ecard('基本【水】能量')];
  let st = mk({ active: frog }, { active: defActive });
  st = mod.applyAction(st, { type: 'ATTACK', attackIndex: frogAtkIdx, actorIdx: 0 }, pool);
  assert.ok(st.pendingSelection?.effectKey === 'clone-strike-multi-hit',
    '分身連打應開 clone-strike-multi-hit picker，實得 ' + st.pendingSelection?.effectKey);
  return mod.applyAction(st, { type: 'RESOLVE_SELECTION', selectedIids: [defActive.iid] }, pool);
}
console.log('【clone-strike-multi-hit】分身連打（ex）vs 神秘石居');
{
  const crab = inst('岩殿居蟹');
  const st = fireCloneStrike(crab);
  ok(dmgOf(st, 'active') === 0,
    '戰鬥位 岩殿居蟹 不受 分身連打 傷害（神秘石居：不受對手「寶可夢【ex】」招式傷害）');
}
console.log('【正對照】攻擊方沒有特性 ⇒ 礎石之勢不生效');
{
  const ogre = inst('厄鬼椪 礎石面具ex');
  const st = fireCloneStrike(ogre);
  ok(dmgOf(st, 'active') > 0,
    `甲賀忍蛙ex 無特性 ⇒ 礎石面具ex 照樣受傷（實得 ${dmgOf(st, 'active')}）`);
}

// ── 靜態守衛：兩個 resolver 必須走中央閘，不得退回裸 canApplyEffectToTarget ──
{
  const src = readFileSync(join(ROOT, 'src/lib/game/effects.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/[​-‍﻿]/g, '');
  const anchors = ["regR('snipe-multi'", "regR('clone-strike-multi-hit'"];
  let checked = 0;
  for (const a of anchors) {
    const i = src.indexOf(a);
    assert.ok(i >= 0, 'anchor 失效：' + a);
    const blk = src.slice(i, i + 6000);
    assert.ok(blk.length > 2000 && blk.length <= 6000, 'anchor 窗口異常：' + a);
    assert.ok(blk.includes('resolveMultiTargetDamageGuard('),
      `${a} 必須走中央 resolveMultiTargetDamageGuard（否則戰鬥位漏 PASSIVE_IMMUNITY）`);
    checked++;
  }
  assert.ok(checked === 2, '掃描器只檢查到 ' + checked + ' 個 anchor，掃描器壞了？');
  ok(true, '兩個多目標 resolver 都走中央 resolveMultiTargetDamageGuard');
}

console.log(`\n✅ test-multitarget-active-passive-immunity: ${pass} 項全數通過`);
