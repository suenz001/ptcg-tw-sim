/**
 * v6.164 回歸守衛 — 「從手牌一次附 N 張能量卡」時，「每次附能」的反應必須觸發 N 次。
 *
 * 官方裁定（PTCG RULES/PTCG_RULES.md，唯一權威）：
 *   §17.21.F L1511-1512：對手場上有【侵蝕詛咒】耿鬼ex 時，用「菜種的活力」為 1 隻備戰
 *     附 2 張【草】能量 → 放置的傷害指示物為 **4 個**。
 *   §17.37.A L2196-2197：櫻花魚｜漸強波 造成傷害前從手牌附 **5 張**基本【水】能量 →
 *     侵蝕詛咒放置 **10 個**指示物。
 * 卡面（static/cards，台灣官方中文）：
 *   耿鬼ex｜侵蝕詛咒：「只要這隻寶可夢在場上，**每次**對手從手牌將能量卡附於寶可夢身上時，
 *                    在那隻寶可夢身上放置2個傷害指示物。」
 *   瑪機雅娜｜自動治癒：「只要這隻寶可夢在戰鬥場上，**每次**從自己的手牌將能量卡附於
 *                    寶可夢身上時，將那隻寶可夢恢復「90」HP。」
 *   帕奇利茲｜麻痺門牙（招式）：「……**每次**對手從手牌將能量卡附於受到這個招式的寶可夢
 *                    身上時，在那隻寶可夢身上放置8個傷害指示物。」
 * ⇒ 「每次」＝每一張能量卡各一次。bespoke 附能 resolver 過去一律只 fire 一次 ⇒ under-count。
 */
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.hapc-s.js'), E = join(ROOT, '.hapc-e.ts'), O = join(ROOT, '.hapc-o.mjs');
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
function byName(name, attackName) {
  for (const [id, c] of pool) {
    if (c.name !== name || !['H', 'I', 'J'].includes(c.regulationMark)) continue;
    if (attackName && !(c.attacks ?? []).some(a => a.name === attackName)) continue;
    return id;
  }
  throw new Error('找不到 H/I/J 卡：' + name + (attackName ? '｜' + attackName : ''));
}
let U = 0;
const inst = (name, extra = {}, atk) => ({ iid: 'i' + (++U), cardId: byName(name, atk), damage: 0, energyAttached: [], ...extra });
const hcard = (name) => ({ iid: 'h' + (++U), cardId: byName(name) });
const mk = (p0, p1) => ({
  phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0,
  turn: 5, isFirstTurn: false, log: [], pendingSelection: null, setupDone: [true, true],
  players: [
    { name: 'A', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [], ...p0 },
    { name: 'B', active: null, bench: [], hand: [], deck: [], discard: [], prizes: [], ...p1 },
  ],
});
const find = (st, iid) => {
  const p = st.players[0];
  return p.active?.iid === iid ? p.active : p.bench.find(c => c.iid === iid);
};
let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('  ✓', msg); };

// ══ 1) 阿響的鳳王ex｜金色火焰（特性，卡面「最多2張」）══════════════════════
function goldFlame(nEnergy, oppActiveName = '耿鬼ex', targetDamage = 0) {
  const gold = inst('阿響的鳳王ex');
  const target = inst('阿響的凱羅斯', { damage: targetDamage });
  const es = Array.from({ length: nEnergy }, () => hcard('基本【火】能量'));
  let st = mk({ active: gold, bench: [target], hand: es }, { active: inst(oppActiveName), bench: [] });
  st = mod.applyAction(st, { type: 'USE_ABILITY', iid: gold.iid, abilityIndex: 0 }, pool);
  assert.ok(st.pendingSelection?.effectKey === 'gold-flame-pick-energy', '金色火焰應開能量 picker');
  st = mod.applyAction(st, { type: 'RESOLVE_SELECTION', selectedIids: es.map(e => e.iid) }, pool);
  if (st.pendingSelection) st = mod.applyAction(st, { type: 'RESOLVE_SELECTION', selectedIids: [target.iid] }, pool);
  return { st, target };
}
console.log('【金色火焰】對手耿鬼ex｜侵蝕詛咒（每張 2 個指示物）');
{
  const { st, target } = goldFlame(2);
  const t = find(st, target.iid);
  ok(t.energyAttached.length === 2 && t.damage === 40,
    `一次附 2 張 → 4 個指示物 = 40 點（官方 §17.21.F；實得 ${t?.damage}）`);
}
{
  const { st, target } = goldFlame(1);
  ok(find(st, target.iid).damage === 20, '一次附 1 張 → 2 個指示物 = 20 點（正對照，不得亂乘）');
}
console.log('【金色火焰】自方瑪機雅娜｜自動治癒（每張恢復 90 HP）');
{
  const { st, target } = goldFlame(2, '阿響的凱羅斯', 110);
  const t = find(st, target.iid);
  // 對手 active 換成無反應的一般卡；自方 active 是鳳王ex，故另外驗自動治癒需要瑪機雅娜在戰鬥場
  ok(t.damage === 110, '對手無侵蝕詛咒時不放指示物（正對照，實得 ' + t.damage + '）');
}
{
  // 瑪機雅娜在自己的戰鬥場 → 金色火焰把 2 張火能量附到備戰的「阿響的」寶可夢
  const mag = inst('瑪機雅娜');
  const gold = inst('阿響的鳳王ex');
  const target = inst('阿響的凱羅斯', { damage: 110 });
  const es = [hcard('基本【火】能量'), hcard('基本【火】能量')];
  let st = mk({ active: mag, bench: [gold, target], hand: es }, { active: inst('阿響的凱羅斯') });
  st = mod.applyAction(st, { type: 'USE_ABILITY', iid: gold.iid, abilityIndex: 0 }, pool);
  st = mod.applyAction(st, { type: 'RESOLVE_SELECTION', selectedIids: es.map(e => e.iid) }, pool);
  if (st.pendingSelection) st = mod.applyAction(st, { type: 'RESOLVE_SELECTION', selectedIids: [target.iid] }, pool);
  const t = find(st, target.iid);
  ok(t.damage === 0, `自動治癒：附 2 張 → 恢復 90×2 = 180（110 傷害全清；實得 damage=${t.damage}）`);
}

// ══ 2) 櫻花魚｜漸強波（招式，卡面「任意數量」）官方 §17.37.A：5 張 → 10 個 ══
console.log('【漸強波】官方 §17.37.A：從手牌附 N 張 → 侵蝕詛咒放 2N 個指示物');
{
  const sakura = inst('櫻花魚');
  const es = [hcard('基本【水】能量'), hcard('基本【水】能量'), hcard('基本【水】能量')];
  let st = mk({ active: sakura, hand: es }, { active: inst('耿鬼ex') });
  st = mod.ATTACK_POST.get('櫻花魚|漸強波')(st, 0, pool, {});
  assert.ok(st.pendingSelection, '漸強波應開手牌能量 picker');
  st = mod.applyAction(st, { type: 'RESOLVE_SELECTION', selectedIids: es.map(e => e.iid) }, pool);
  const a = st.players[0].active;
  ok(a.damage === 60, `附 3 張 → 6 個指示物 = 60 點（實得 ${a?.damage}）`);
}

console.log('【漸強波】官方 §17.37.A L2196-2197：附能反應打死攻擊者，招式傷害仍須先結算');
{
  const sakura = inst('櫻花魚');                       // HP 90
  const shelter = inst('阿響的凱羅斯');                // 備戰墊背，避免直接 game-over
  const es = Array.from({ length: 5 }, () => hcard('基本【水】能量'));
  const gengar = inst('耿鬼ex');                       // HP 310
  let st = mk({ active: sakura, bench: [shelter], hand: es, prizes: [{ iid: 'p1' }, { iid: 'p2' }] },
              { active: gengar, prizes: [{ iid: 'q1' }, { iid: 'q2' }] });
  st = mod.ATTACK_POST.get('櫻花魚|漸強波')(st, 0, pool, {});
  st = mod.applyAction(st, { type: 'RESOLVE_SELECTION', selectedIids: es.map(e => e.iid) }, pool);
  const dealt = st.players[1].active?.damage ?? 0;
  ok(dealt === 150,
    `官方：「會（造成傷害）。／應先處理漸強波的傷害，再處理櫻花魚的昏厥」→ 耿鬼ex 受 5×30=150（實得 ${dealt}）`);
  ok(st.players[0].active === null,
    '櫻花魚隨後因 10 個傷害指示物昏厥（HP 90 ≤ 100）');
}

// ══ 3) 艾姆利多｜滿載心田（招式，「最多2張…以任意方式」→ v158 energy-chain）══
console.log('【滿載心田】v158 energy-chain：集中 / 分散 兩條路徑都要 per-card');
function fullHeart(assign) {   // assign = 每張能量指定的目標 iid 陣列
  const emo = inst('艾姆利多');
  const b1 = inst('阿響的凱羅斯'), b2 = inst('阿響的凱羅斯');
  const es = [hcard('基本【超】能量'), hcard('基本【超】能量')];
  let st = mk({ active: emo, bench: [b1, b2], hand: es }, { active: inst('耿鬼ex') });
  st = mod.ATTACK_POST.get('艾姆利多|滿載心田')(st, 0, pool, {});
  assert.ok(st.pendingSelection, '滿載心田應開手牌能量 picker');
  st = mod.applyAction(st, { type: 'RESOLVE_SELECTION', selectedIids: es.map(e => e.iid) }, pool);
  let guard = 0;
  while (st.pendingSelection && guard++ < 8) {
    st = mod.applyAction(st, { type: 'RESOLVE_SELECTION', selectedIids: assign(b1, b2, emo) }, pool);
  }
  return { st, b1, b2, emo };
}
{
  const { st, b1, b2 } = fullHeart((x, y) => [x.iid, x.iid]);   // 2 張都給 b1
  ok(find(st, b1.iid).damage === 40 && find(st, b2.iid).damage === 0,
    `2 張集中同 1 隻 → 該隻 4 個指示物 = 40（實得 ${find(st, b1.iid)?.damage}）`);
}
{
  const { st, b1, b2 } = fullHeart((x, y) => [x.iid, y.iid]);   // 分散
  ok(find(st, b1.iid).damage === 20 && find(st, b2.iid).damage === 20,
    `2 張分散 2 隻 → 各 2 個指示物 = 各 20（實得 ${find(st, b1.iid)?.damage}/${find(st, b2.iid)?.damage}）`);
}

// ══ 4) 大電海燕ex｜迴旋充能（招式，卡面「最多2張」）════════════════════════
console.log('【迴旋充能】');
{
  const bird = inst('大電海燕ex', {}, '迴旋充能');
  const back = inst('阿響的凱羅斯');
  const es = [hcard('基本【雷】能量'), hcard('基本【雷】能量')];
  let st = mk({ active: bird, bench: [back], hand: es }, { active: inst('耿鬼ex') });
  st = mod.ATTACK_POST.get('大電海燕ex|迴旋充能')(st, 0, pool, {});
  // 迴旋充能先與備戰互換（可能先開換位 picker），再開手牌能量 picker
  let g0 = 0;
  while (st.pendingSelection && st.pendingSelection.effectKey !== 'h-wave2-attach-from-hand' && g0++ < 4) {
    st = mod.applyAction(st, { type: 'RESOLVE_SELECTION', selectedIids: [back.iid] }, pool);
  }
  assert.ok(st.pendingSelection?.effectKey === 'h-wave2-attach-from-hand',
    '迴旋充能應開手牌 picker，實得 ' + st.pendingSelection?.effectKey);
  st = mod.applyAction(st, { type: 'RESOLVE_SELECTION', selectedIids: es.map(e => e.iid) }, pool);
  // ⚠ 斷言刻意寫成「自方場上總傷害」而不是「active 的傷害」——
  //   v6.164 發現 迴旋充能 另有一個**獨立**的既有 bug：`selfSwapPostInline` 開的互換 picker
  //   會被緊接著的 `withPending(hand-choose)` 覆蓋掉 ⇒ 互換其實沒有發生；而卡面是
  //   「將這隻寶可夢與備戰寶可夢互換。然後……附於**這隻寶可夢**身上」。
  //   那個 bug 不在本版範圍（待站長裁定），這裡不用測試把任何一種行為固化。
  const total = [st.players[0].active, ...st.players[0].bench]
    .filter(Boolean).reduce((n2, c) => n2 + (c.damage ?? 0), 0);
  ok(total === 40, `附 2 張 → 自方場上共 4 個指示物 = 40（實得 ${total}）`);
}

// ══ 5) 信使鳥｜幸福禮物 — v6.164 補「零觸發」（原本完全沒 fire）══════════════
console.log('【幸福禮物】卡面「各自從自己的手牌選擇最多3張基本能量卡」⇒ 必須觸發附能反應');
{
  const bird = inst('信使鳥', {}, '幸福禮物');
  const b1 = inst('阿響的凱羅斯');
  const es = [hcard('基本【草】能量'), hcard('基本【草】能量')];
  // 對手手牌沒有基本能量 ⇒ 跳過對手側，直接進自己側
  let st = mk({ active: bird, bench: [b1], hand: es }, { active: inst('耿鬼ex'), hand: [] });
  st = mod.ATTACK_POST.get('信使鳥|幸福禮物')(st, 0, pool, { discardedEnergyIids: [es[0].iid] });
  assert.ok(st.pendingSelection, '幸福禮物應開手牌能量 picker');
  st = mod.applyAction(st, { type: 'RESOLVE_SELECTION', selectedIids: es.map(e => e.iid) }, pool);
  let guard = 0;
  while (st.pendingSelection && guard++ < 8) {
    st = mod.applyAction(st, { type: 'RESOLVE_SELECTION', selectedIids: [b1.iid] }, pool);
  }
  ok(find(st, b1.iid).damage === 40,
    `2 張都附到同 1 隻 → 4 個指示物 = 40（實得 ${find(st, b1.iid)?.damage}）`);
}

// ══ 5b) v158 energy-chain（hand source）也要接自方瑪機雅娜｜自動治癒 ═══════════
console.log('【拍檔提升】特性型 chain：瑪機雅娜可同時在戰鬥場 ⇒ 自動治癒要 per-card');
{
  // ⚠ 「鴨嘴炎獸」同名多版：MC/SV9 的 I 標是「熔岩波動」，要的是 J 標「拍檔提升」那版
  let magmarId = null;
  for (const [id, c] of pool) {
    if (c.name === '鴨嘴炎獸' && (c.abilities ?? []).some(a => a.name === '拍檔提升')) { magmarId = id; break; }
  }
  assert.ok(magmarId, '找不到 鴨嘴炎獸｜拍檔提升');
  const mag = inst('瑪機雅娜');                               // 自動治癒（必須在戰鬥場）
  const magmar = { iid: 'i' + (++U), cardId: magmarId, damage: 130, energyAttached: [] }; // HP 140
  const es = [hcard('基本【火】能量'), hcard('基本【雷】能量')];
  let st = mk({ active: mag, bench: [magmar], hand: es }, { active: inst('阿響的凱羅斯') });
  const abIdx = (pool.get(magmarId).abilities ?? []).findIndex(a => a.name === '拍檔提升');
  st = mod.applyAction(st, { type: 'USE_ABILITY', iid: magmar.iid, abilityIndex: abIdx }, pool);
  assert.ok(st.pendingSelection, '拍檔提升應開手牌能量 picker');
  st = mod.applyAction(st, { type: 'RESOLVE_SELECTION', selectedIids: es.map(e => e.iid) }, pool);
  let g = 0;
  while (st.pendingSelection && g++ < 8) {
    st = mod.applyAction(st, { type: 'RESOLVE_SELECTION', selectedIids: [magmar.iid] }, pool);
  }
  const m = find(st, magmar.iid);
  ok(m && m.energyAttached.length === 2 && m.damage === 0,
    `附火+雷共 2 張 → 自動治癒 90×2=180（130 傷害全清；實得 damage=${m?.damage}、能量 ${m?.energyAttached.length}）`);
}

// ══ 6) 卡面枚舉守衛：「從自己的手牌 + 一次可能多張 + 附於」的卡必須列管 ══════
console.log('【枚舉守衛】卡面掃描（新卡出現時強制回來檢視 per-card 觸發）');
{
  const ZW = /[​-‍﻿]/g;
  const found = [];
  let scanned = 0;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
    for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
      if (!c || !['H', 'I', 'J'].includes(c.regulationMark)) continue;
      const entries = [
        ...(c.abilities ?? []).map(a => [a.name, a.effect ?? '']),
        ...(c.attacks ?? []).map(a => [a.name, a.effect ?? '']),
        ...(c.rulesText ? [['(訓練家)', c.rulesText]] : []),
      ];
      for (const [nm, raw] of entries) {
        const ef = String(raw).replace(ZW, '');
        scanned++;
        if (!ef.includes('能量') || !ef.includes('附')) continue;
        // ⚠ 來源必須是「**從自己的手牌選擇**…能量」。只寫「從手牌使出這張卡並完成進化時」
        //   的進化型特性（龐克練肌／合金建造／尖刺纏身…）來源其實是牌庫／棄牌區，不算。
        if (!/從自己的手牌選擇[^。]{0,30}能量/.test(ef)) continue;
        // 一次可能 >1 張：「最多2~9張」「任意數量」「任意張數」
        //   ⚠「最多**各**1張」（鴨嘴炎獸｜拍檔提升：火 1 + 雷 1）合計也可能是 2 張。
        if (!/最多\s*[2-9２-９]|最多各\s*[1-9１-９]|任意數量|任意張數/.test(ef)) continue;
        found.push(`${c.name}｜${nm}`);
      }
    }
  }
  assert.ok(scanned > 3000, `掃描器只掃到 ${scanned} 條效果文字，掃描器壞了？`);
  const uniq = [...new Set(found)].sort();
  const KNOWN = [
    '信使鳥｜幸福禮物',          // lucky-gift-attach（逐張，count=1）
    'splitter',
    '大電海燕ex｜迴旋充能',      // h-wave2-attach-from-hand
    '月月熊 赫月｜經驗法則',     // effects.ts inline
    '櫻花魚｜漸強波',            // sakura-crescendo-attach
    '艾姆利多｜滿載心田',        // v158-energy-chain（tally per-target）
    '鋼炮臂蝦｜返回重載',        // clamperl-bombard-attach
    '阿羅拉 椰蛋樹ex｜熱帶狂燒', // v158-energy-chain
    '阿響的鳳王ex｜金色火焰',    // gold-flame（fast-path + picker path 兩條）
    '鴨嘴炎獸｜拍檔提升',        // v158-energy-chain（火/雷 各最多 1 張 ⇒ 合計可 2 張）
    '烈焰猴｜火焰蹈舞',          // v2996 兩階段各 1 張、各自 fire 一次 ⇒ 天生就是 per-card
  ].filter(x => x !== 'splitter').sort();
  assert.ok(uniq.length >= 10, `枚舉只找到 ${uniq.length} 張，卡面 regex 可能失效`);
  assert.deepStrictEqual(uniq, KNOWN,
    '「從自己的手牌一次附多張能量」的卡清單有變動 —— 新卡必須確認其 resolver 有把實際張數\n'
    + '傳進 fireOnHandEnergyAttached / applyMagearnaHandAttachHeal（per-energy-card）。\n'
    + '實際掃到：\n  ' + uniq.join('\n  '));
  ok(true, `卡面枚舉一致（${uniq.length} 張全部已列管 per-card 觸發）`);
}

console.log(`\n✅ test-hand-attach-percard-reaction: ${pass} 項全數通過`);
