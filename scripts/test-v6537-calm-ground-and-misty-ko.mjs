#!/usr/bin/env node
/**
 * v6.537 守衛（站長 2026-10-12 裁定 1、3 ＋ 平穩境地全站 audit）：
 *   MAX     滿充的體貼 × 對手的美納斯｜平穩境地 ⇒ HP 全恢復、能量留在身上（裁定 1 選項 A；Q&A L2491）
 *   VORTEX  寶可夢旋風回收機 × 對手的平穩境地 ⇒ 不能打出（audit 漏網；判準①類推）
 *   CLOCK   奇異時鐘 × 對手的平穩境地 ⇒ 不能打出（audit 漏網；L1862 奧密之眼「不可以退化」類推）
 *   WING／BREEZE 原始之翼／微風吹拂 × 自己的平穩境地 ⇒ 按鈕不出現（原本按下去只寫 log、吃掉每回合 1 次；判準①類推）
 *   THRUST_KO 上搗角擊打昏附薄霧能量的 2 階進化 ⇒ 能量不放回（裁定 3 選項 A）
 *   *_ctl／THRUST_LIVE 正對照
 *   THRUST_SNAP 直呼 POST、戰鬥位已昏厥離場（快照帶薄霧能量）⇒ 不開 picker（縱深防禦）
 * 【H】BASE（v6.536）：MAX、VORTEX、CLOCK、WING、BREEZE、THRUST_SNAP 逐條紅；其餘兩版綠。
 *   ⚠ THRUST_KO 在 BASE 已綠：v6.533 起主管線昏厥延後到招式效果之後，走到效果時戰鬥寶可夢還在、由 v6.528 那條擋下 ⇒ 裁定 3 在一般流程本來就成立，本版只補縱深防禦。
 */
import { readFileSync, readdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.536。
const BASE_SHA = 'ab4afb3e';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const HIJ = (c) => 'HIJ'.includes(c.regulationMark || '?');
const byName = (n) => { for (const c of pool.values()) if (c.name === n && HIJ(c)) return String(c.id); return null; };
const withAttack = (n, a) => { for (const c of pool.values()) if (c.name === n && HIJ(c) && (c.attacks || []).some((x) => x.name === a)) return String(c.id); return null; };
const withAbility = (n, a) => { for (const c of pool.values()) if (c.name === n && HIJ(c) && (c.abilities || []).some((x) => x.name === a)) return String(c.id); return null; };
const EN = { Grass: '草', Fire: '火', Water: '水', Lightning: '雷', Psychic: '超', Fighting: '鬥', Darkness: '惡', Metal: '鋼', Colorless: '水' };
const ID = {
  filler: '19178', W: byName('基本【水】能量'), P: byName('基本【超】能量'), G: byName('基本【草】能量'), misty: byName('薄霧能量'),
  manaphy: withAbility('美納斯', '平穩境地'), mega: '19544', maxAff: byName('滿充的體貼'), vortex: byName('寶可夢旋風回收機'), clock: byName('奇異時鐘'),
  woobat: '13391', swoobat: '13391', stage2: '13360', tauros: withAttack('帕底亞 肯泰羅', '上搗角擊'),
  archeops: withAbility('始祖大鳥', '原始之翼'), venomoth: withAbility('毒粉蛾', '微風吹拂'),
};
const missing = Object.entries(ID).filter(([, v]) => !v).map(([k]) => k);
const atkIdx = (id, n) => pool.get(id).attacks.findIndex((a) => a.name === n);

async function load(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6537-'));
  const E = join(tmp, 'e.ts'), S = join(tmp, 's.js'), O = join(tmp, 'o.mjs');
  writeFileSync(S, 'export const base="";');
  const p = (x) => join(srcRoot, x).replace(/\\/g, '/');
  writeFileSync(E, `export { applyAction, createGame, getUsableAbilities } from '${p('src/lib/game/engine')}';\nexport { ATTACK_POST } from '${p('src/lib/game/effects/_shared')}';\nimport '${p('src/lib/game/effects')}';`);
  try {
    await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
      alias: { '$lib': join(srcRoot, 'src/lib'), '$app/paths': S }, logLevel: 'silent', nodePaths: [join(ROOT, 'node_modules')] });
    return await import(pathToFileURL(O).href);
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}

function scenarios(M) {
  let n = 0;
  const inst = (cid, e = {}) => ({ iid: 'i' + (++n), cardId: String(cid), damage: 0, energyAttached: [], ...e });
  const many = (cid, k) => Array.from({ length: k }, () => inst(cid));
  const mk = ({ a0, b0 = [], a1, b1 = [], hand0 = [] }) => {
    const s = M.createGame({ name: 'P1', entries: [{ cardId: ID.filler, count: 1 }] }, { name: 'P2', entries: [{ cardId: ID.filler, count: 1 }] }, pool);
    return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
      setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], log: [], supporterPlayedThisTurn: false,
      players: [
        { ...s.players[0], hand: hand0, deck: many(ID.W, 10), discard: [], prizes: many(ID.W, 6), bench: b0, active: a0 ?? inst(ID.filler) },
        { ...s.players[1], hand: [], deck: many(ID.W, 10), discard: [], prizes: many(ID.W, 6), bench: b1, active: a1 ?? inst(ID.filler) },
      ] };
  };
  const act = (s, a) => M.applyAction(s, a, pool);
  const drive = (s, pick) => { let g = 0; while (s.pendingSelection && s.phase === 'playing' && g++ < 8) { const ps = s.pendingSelection;
      s = act(s, { type: 'RESOLVE_SELECTION', effectKey: ps.effectKey, selectedIids: pick(ps), actorIdx: ps.actorIdx ?? 0, senderIdx: ps.actorIdx ?? 0, pendingToken: ps.token }); } return s; };
  const play = (s, card) => { const t = act(s, { type: 'PLAY_TRAINER', iid: card.iid, actorIdx: 0 }); return { played: !t.players[0].hand.some((c) => c.iid === card.iid), st: t }; };
  const out = {};
  const T = (k, f) => { try { out[k] = f(); } catch (e) { out[k] = 'ERR ' + e.message.split('\n')[0]; } };
  const usable = (s, name) => M.getUsableAbilities(s, pool).some((u) => u.abilityName === name);

  // 滿充的體貼：對手有平穩境地 ⇒ HP 全恢復、能量留在身上（站長 2026-10-12 A；Q&A L2491）
  // 美納斯位置：true／'opp'＝對手備戰、'own'＝自己備戰、'oppNull'＝對手戰鬥場但特性被消除、false＝沒有（審查 P3-1 的方向／消除正對照）
  const place = (where) => ({ b0: where === 'own' ? [inst(ID.manaphy)] : [], b1: (where === true || where === 'opp') ? [inst(ID.manaphy)] : [],
    a1: where === 'oppNull' ? inst(ID.manaphy, { abilityNullifiedThisTurn: true }) : undefined });
  const maxAff = (withManaphy) => { const m = inst(ID.mega, { damage: 100, energyAttached: many(ID.W, 2) }); const c = inst(ID.maxAff); const pl = place(withManaphy);
    let { played, st } = play(mk({ a0: m, hand0: [c], b0: pl.b0, b1: pl.b1, a1: pl.a1 }), c);
    st = drive(st, () => [m.iid]);
    const now = st.players[0].active;
    return { played, dmg: now?.damage, energy: now?.energyAttached?.length, handEnergy: st.players[0].hand.filter((h) => h.cardId === ID.W).length }; };
  T('MAX', () => maxAff(true));
  T('MAX_ctl', () => maxAff(false));
  // 寶可夢旋風回收機：對手有平穩境地 ⇒ 不能打出
  const vortex = (withManaphy) => { const c = inst(ID.vortex); const b = inst(ID.filler); const pl = place(withManaphy);
    return play(mk({ hand0: [c], b0: [b, ...pl.b0], b1: pl.b1, a1: pl.a1 }), c).played; };
  T('VORTEX', () => vortex(true));
  T('VORTEX_ctl', () => vortex(false));
  // 奇異時鐘：對手有平穩境地 ⇒ 不能打出（L1862 奧密之眼同型：不可以退化）
  const clock = (withManaphy) => { const c = inst(ID.clock); const e = inst(ID.swoobat, { evolvedFromStack: [inst(ID.filler)] }); const pl = place(withManaphy);
    return play(mk({ hand0: [c], b0: [e, ...pl.b0], b1: pl.b1, a1: pl.a1 }), c).played; };
  T('CLOCK', () => clock(true));
  T('CLOCK_ctl', () => clock(false));
  // 原始之翼／微風吹拂：自己的平穩境地生效 ⇒ 按鈕不出現（不吃掉每回合 1 次）
  // 原始之翼／微風吹拂：擋的是**自己的**美納斯（true／'own'）；對手的美納斯（'opp'）不擋
  const wing = (where) => { const a = inst(ID.archeops); const ev = inst(ID.swoobat, { evolvedFromStack: [inst(ID.filler)] });
    return usable(mk({ a0: a, b0: (where === true || where === 'own') ? [inst(ID.manaphy)] : [], a1: ev, b1: where === 'opp' ? [inst(ID.manaphy)] : [] }), '原始之翼'); };
  T('WING', () => wing(true));
  T('WING_ctl', () => wing(false));
  const breeze = (where) => { const v = inst(ID.venomoth);
    return usable(mk({ b0: [v, ...((where === true || where === 'own') ? [inst(ID.manaphy)] : [])], a1: inst(ID.filler, { energyAttached: many(ID.W, 1) }), b1: where === 'opp' ? [inst(ID.manaphy)] : [] }), '微風吹拂'); };
  T('BREEZE', () => breeze(true));
  T('BREEZE_ctl', () => breeze(false));
  // 方向／消除正對照（審查 P3-1）：述詞改成「雙方都擋」或漏了特性消除時才抓得到
  T('MAX_own', () => maxAff('own'));
  T('MAX_null', () => maxAff('oppNull'));
  T('VORTEX_own', () => vortex('own'));
  T('VORTEX_null', () => vortex('oppNull'));
  T('CLOCK_own', () => clock('own'));
  T('WING_opp', () => wing('opp'));
  T('BREEZE_opp', () => breeze('opp'));
  // 上搗角擊打昏 2 階進化 × 薄霧能量 ⇒ 能量不放回（站長 2026-10-12 A；Q&A L1926 的打昏版）
  const thrust = (misty, ko) => { const t = inst(ID.tauros, { energyAttached: many(ID.W, 3) });
    const hp = Number(pool.get(ID.stage2).hp);
    const d = inst(ID.stage2, { damage: ko ? hp - 30 : 0, energyAttached: [inst(ID.G), ...(misty ? [inst(ID.misty)] : [inst(ID.G)])], evolvedFromStack: [inst(ID.filler), inst(ID.filler)] });
    let s = act(mk({ a0: t, a1: d, b1: [inst(ID.filler)] }), { type: 'ATTACK', attackIndex: atkIdx(ID.tauros, '上搗角擊'), actorIdx: 0, discardedEnergyIids: ['yes'] });
    const sawPicker = s.pendingSelection?.effectKey === 'v327-tauros-thrust';
    s = drive(s, (ps) => (ps.effectKey === 'v327-tauros-thrust' ? (ps.params?.validIids ?? d.energyAttached.map((e) => e.iid)).slice(0, 2) : (ps.params?.validIids ?? []).slice(0, ps.minCount ?? 1)));
    const oppHandE = s.players[1].hand.filter((h) => h.cardId === ID.G || h.cardId === ID.misty).length;
    return { sawPicker, oppHandE, gone: s.players[1].active?.iid !== d.iid }; };
  T('THRUST_KO', () => thrust(true, true));
  T('THRUST_KO_ctl', () => thrust(false, true));
  T('THRUST_LIVE', () => thrust(true, false));
  // THRUST_SNAP：直呼 POST，模擬「進入效果時戰鬥位已昏厥離場」（_koDefenderSnapshot 帶著薄霧能量、能量在棄牌區）
  const snap = (misty) => { const t = inst(ID.tauros, { energyAttached: many(ID.W, 3) });
    const e1 = inst(ID.G), e2 = misty ? inst(ID.misty) : inst(ID.G);
    const d = inst(ID.stage2, { energyAttached: [e1, e2], evolvedFromStack: [inst(ID.filler), inst(ID.filler)] });
    const st0 = mk({ a0: t, a1: null, b1: [inst(ID.filler)] });
    st0.players[1].active = null; st0.players[1].discard = [d, e1, e2]; st0._koDefenderSnapshot = { idx: 1, inst: d };
    const post = M.ATTACK_POST.get('帕底亞 肯泰羅|上搗角擊');
    const s = post(st0, 0, pool, { discardedEnergyIids: ['yes'] });
    return { sawPicker: s.pendingSelection?.effectKey === 'v327-tauros-thrust' }; };
  T('THRUST_SNAP', () => snap(true));
  T('THRUST_SNAP_ctl', () => snap(false));
  return out;
}

const judge = (r) => ({
  MAX: !!r.MAX && r.MAX.played && r.MAX.dmg === 0 && r.MAX.energy === 2 && r.MAX.handEnergy === 0,
  MAX_ctl: !!r.MAX_ctl && r.MAX_ctl.played && r.MAX_ctl.dmg === 0 && r.MAX_ctl.energy === 0 && r.MAX_ctl.handEnergy === 2,
  VORTEX: r.VORTEX === false,
  VORTEX_ctl: r.VORTEX_ctl === true,
  CLOCK: r.CLOCK === false,
  CLOCK_ctl: r.CLOCK_ctl === true,
  WING: r.WING === false,
  WING_ctl: r.WING_ctl === true,
  BREEZE: r.BREEZE === false,
  BREEZE_ctl: r.BREEZE_ctl === true,
  MAX_own: !!r.MAX_own && r.MAX_own.energy === 0 && r.MAX_own.handEnergy === 2,
  MAX_null: !!r.MAX_null && r.MAX_null.energy === 0 && r.MAX_null.handEnergy === 2,
  VORTEX_own: r.VORTEX_own === true,
  VORTEX_null: r.VORTEX_null === true,
  CLOCK_own: r.CLOCK_own === true,
  WING_opp: r.WING_opp === true,
  BREEZE_opp: r.BREEZE_opp === true,
  THRUST_KO: !!r.THRUST_KO && r.THRUST_KO.gone && r.THRUST_KO.oppHandE === 0 && !r.THRUST_KO.sawPicker,
  THRUST_KO_ctl: !!r.THRUST_KO_ctl && r.THRUST_KO_ctl.gone && r.THRUST_KO_ctl.oppHandE === 2,
  THRUST_LIVE: !!r.THRUST_LIVE && !r.THRUST_LIVE.gone && r.THRUST_LIVE.oppHandE === 0 && !r.THRUST_LIVE.sawPicker,
  THRUST_SNAP: !!r.THRUST_SNAP && r.THRUST_SNAP.sawPicker === false,
  THRUST_SNAP_ctl: !!r.THRUST_SNAP_ctl && r.THRUST_SNAP_ctl.sawPicker === true,
});
const LABEL = {
  MAX: '★★★ 滿充的體貼 × 對手的平穩境地 ⇒ HP 全恢復、能量留在身上（站長 10-12 A）',
  MAX_ctl: '★ 正對照：沒有美納斯 ⇒ 能量照常回手',
  VORTEX: '★★★ 寶可夢旋風回收機 × 對手的平穩境地 ⇒ 不能打出',
  VORTEX_ctl: '★ 正對照：沒有美納斯 ⇒ 可以打出',
  CLOCK: '★★★ 奇異時鐘 × 對手的平穩境地 ⇒ 不能打出（L1862 同型）',
  CLOCK_ctl: '★ 正對照：沒有美納斯 ⇒ 可以打出',
  WING: '★★★ 原始之翼 × 自己的平穩境地 ⇒ 按鈕不出現',
  WING_ctl: '★ 正對照：沒有美納斯 ⇒ 可以按',
  BREEZE: '★★★ 微風吹拂 × 自己的平穩境地 ⇒ 按鈕不出現',
  BREEZE_ctl: '★ 正對照：沒有美納斯 ⇒ 可以按',
  MAX_own: '★ 方向正對照：美納斯在自己場上 ⇒ 滿充的體貼能量照常回手',
  MAX_null: '★ 消除正對照：對手的美納斯特性被消除 ⇒ 能量照常回手',
  VORTEX_own: '★ 方向正對照：美納斯在自己場上 ⇒ 旋風回收機可以打出',
  VORTEX_null: '★ 消除正對照：對手的美納斯特性被消除 ⇒ 旋風回收機可以打出',
  CLOCK_own: '★ 方向正對照：美納斯在自己場上 ⇒ 奇異時鐘可以打出',
  WING_opp: '★ 方向正對照：美納斯在對手場上 ⇒ 原始之翼可以按',
  BREEZE_opp: '★ 方向正對照：美納斯在對手場上 ⇒ 微風吹拂可以按',
  THRUST_KO: '★★ 上搗角擊打昏附薄霧能量的 2 階進化 ⇒ 能量不放回（站長 10-12 A）',
  THRUST_KO_ctl: '★ 正對照：打昏沒附薄霧能量的 ⇒ 照常可選 2 個放回',
  THRUST_LIVE: '★ 正對照：沒打昏、附薄霧能量 ⇒ 不放回（v6.528 Q&A L1926）',
  THRUST_SNAP: '★★ 戰鬥位已昏厥離場（快照帶薄霧能量）⇒ 不開放回 picker（裁定 3 的縱深防禦）',
  THRUST_SNAP_ctl: '★ 正對照：快照沒有薄霧能量 ⇒ 照常開 picker',
};
const NEW = ['MAX', 'VORTEX', 'CLOCK', 'WING', 'BREEZE', 'THRUST_SNAP'];
if (missing.length) { console.log('fixture 卡片缺：' + missing.join(',')); process.exit(1); }
const HM = await load(ROOT);
const H = scenarios(HM), J = judge(H);
for (const k of Object.keys(LABEL)) ok(LABEL[k], J[k], JSON.stringify(H[k]));

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6537b-'));
  try {
    execFileSync('sh', ['-c', `git -C "${ROOT}" archive ${BASE_SHA} src | tar -x -C "${tmp}"`]);
    const BM = await load(tmp);
    const B = scenarios(BM), BJ = judge(B);
    for (const k of Object.keys(LABEL)) {
      if (NEW.includes(k)) ok(`★★★[H] v6.536：${k} 紅`, BJ[k] === false, JSON.stringify(B[k]));
      else ok(`★[H 正對照] v6.536：${k} 綠`, BJ[k] === true, JSON.stringify(B[k]));
    }
  } catch (e) { ok('★★★[H] BASE 可打包', false, e.message.split('\n')[0]); }
  finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
} else shallowSkip('v6537 H', '需要 v6.536 commit');

console.log(`\n=== v6.537 平穩境地漏網與上搗角擊打昏 × 薄霧：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
