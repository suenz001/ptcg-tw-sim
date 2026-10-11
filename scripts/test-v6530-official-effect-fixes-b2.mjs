#!/usr/bin/env node
/**
 * v6.530 守衛：官方 Q&A 第二輪比對（B2 組）。全部走 applyAction 完整流程（必要時直呼中央出口）。
 *
 *   AC  阿塞蘿拉的惡作劇：選了戰鬥寶可夢、同回合撤退到備戰 ⇒ 效果不消除（PTCG_RULES L2528）；被退化 ⇒ 消除（L2493）
 *   FS  密勒頓｜防護代碼：下個對手回合才放上備戰的「未來」寶可夢也不受 ex 招式傷害（L1979）；密勒頓離開戰鬥場 ⇒ 消除（卡面）
 *   CM  核心記憶碟：可以附在超級基格爾德ex 以外的寶可夢身上，但不能用卡上的招式（L2801）
 *   DD  白日夢 × 碧綠之舞：附能後照樣抽 1 張，然後回合結束；手動附能也照舊結束回合（鬼之假面 × 白日夢判例）
 *   NT  九尾｜靈怪變化：丟出的支援者使用條件不符 ⇒ 不能使用效果（L2403）；魔牆人偶｜相仿秀同句（類推）
 *   CB  咒詛炸彈：雙方各剩 1 張獎賞、雙方都沒有備戰、同時昏厥 ⇒ 平手（L1669）
 *   HV  電擊魔獸ex｜高電壓壓制：附反擊增幅器（所需能量 -1）＋4 雷 ⇒ +100（反擊增幅器判例）
 * 【H】BASE（v6.529）：新斷言逐條紅；正對照兩版綠。
 */
import { readFileSync, readdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.529。
const BASE_SHA = '14121b8b';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + x : '')); } };

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) if (c?.id != null) pool.set(String(c.id), c);
}
const byName = (n) => { for (const c of pool.values()) if (c.name === n && 'HIJ'.includes(c.regulationMark || '?')) return String(c.id); return null; };
const withAttack = (n, a) => { for (const c of pool.values()) if (c.name === n && 'HIJ'.includes(c.regulationMark || '?') && (c.attacks || []).some((x) => x.name === a)) return String(c.id); return null; };
const withAbility = (n, a) => { for (const c of pool.values()) if (c.name === n && (c.abilities || []).some((x) => x.name === a)) return String(c.id); return null; };
const ID = {
  W: byName('基本【水】能量'), L: byName('基本【雷】能量'), F: byName('基本【鬥】能量'), G: byName('基本【草】能量'), filler: '19178',
  acerola: byName('阿塞蘿拉的惡作劇'), pikaEx: withAttack('皮卡丘ex', '十萬伏特'), kirlia: byName('奇魯莉安'), gardevoirEx: byName('超級沙奈朵ex'),
  miraidon: withAttack('密勒頓', '防護代碼'), ironCrown: byName('鐵頭殼ex'),
  zygarde: byName('超級基格爾德ex'), disc: byName('核心記憶碟'),
  ogerpon: withAbility('厄鬼椪 碧草面具ex', '碧綠之舞'),
  ninetales: withAttack('九尾', '靈怪變化'), mime: withAttack('魔牆人偶', '相仿秀'),
  dusclops: withAbility('彷徨夜靈', '咒詛炸彈'),
  electivire: withAttack('電擊魔獸ex', '高電壓壓制'), amp: byName('反擊增幅器'), bigHp: byName('超級毒藻龍ex'),
};
const missing = Object.entries(ID).filter(([, v]) => !v).map(([k]) => k);

async function load(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6530-'));
  const E = join(tmp, 'e.ts'), S = join(tmp, 's.js'), O = join(tmp, 'o.mjs');
  writeFileSync(S, 'export const base="";');
  const p = (x) => join(srcRoot, x).replace(/\\/g, '/');
  writeFileSync(E, `export { applyAction, createGame, getEffectiveAttacks } from '${p('src/lib/game/engine')}';\n`
    + `export { dealAttackDamageToTarget } from '${p('src/lib/game/effects')}';\n`
    + `export { buildDevolvedInstance } from '${p('src/lib/game/effects/_shared')}';\nimport '${p('src/lib/game/effects')}';`);
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
  const mk = ({ a0, b0 = [], a1, b1 = [], hand0 = [], deck0, prizes0, prizes1, active = 0 }) => {
    const s = M.createGame({ name: 'P1', entries: [{ cardId: ID.filler, count: 1 }] }, { name: 'P2', entries: [{ cardId: ID.filler, count: 1 }] }, pool);
    return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: active, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
      setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], log: [],
      players: [
        { ...s.players[0], hand: hand0, deck: deck0 ?? many(ID.W, 10), discard: [], prizes: prizes0 ?? many(ID.W, 6), bench: b0, active: a0 },
        { ...s.players[1], hand: [], deck: many(ID.W, 10), discard: [], prizes: prizes1 ?? many(ID.W, 6), bench: b1, active: a1 },
      ] };
  };
  const act = (s, a) => M.applyAction(s, a, pool);
  const res = (s, pick) => { let g = 0; while (s.pendingSelection && g++ < 6) { const ps = s.pendingSelection;
    const sel = pick ? pick(ps, s) : (ps.type === 'modal-choice' ? ['yes'] : (ps.params?.validIids ?? []).slice(0, Math.max(1, ps.minCount || 0)));
    if (sel === null) break;
    s = act(s, { type: 'RESOLVE_SELECTION', effectKey: ps.effectKey, selectedIids: sel, actorIdx: ps.actorIdx ?? 0, pendingToken: ps.token }); }
    return s; };
  const atkIdx = (inst0, name, s) => M.getEffectiveAttacks(s, inst0, pool).findIndex((x) => x.atk.name === name);
  const out = {};
  const T = (k, f) => { try { out[k] = f(); } catch (e) { out[k] = 'ERR ' + e.message.split('\n')[0]; } };

  // AC 阿塞蘿拉的惡作劇：選戰鬥寶可夢 → 撤退到備戰 → 回合結束 ⇒ 備戰那隻仍有效果
  T('AC', () => { const tgt = inst(ID.pikaEx, { energyAttached: many(ID.W, 1) }), sub = inst(ID.filler), c = inst(ID.acerola);
    let s = mk({ a0: tgt, b0: [sub], hand0: [c], a1: inst(ID.filler), prizes1: many(ID.W, 2) });
    s = act(s, { type: 'PLAY_TRAINER', iid: c.iid });
    s = res(s, () => [tgt.iid]);
    s = act(s, { type: 'RETREAT', newActiveIid: sub.iid });
    const onBench = s.players[0].bench.find((b) => b.iid === tgt.iid);
    return { retreated: !!onBench, flag: onBench?.immuneToExAttackNextTurn === true }; });
  T('AC_devolve', () => { const k = inst(ID.kirlia); const g = inst(ID.gardevoirEx, { evolvedFromStack: [k], immuneToExAttackNextTurn: true });
    const s = mk({ a0: g, a1: inst(ID.filler) });
    const r = M.buildDevolvedInstance(g, 1, s, pool);
    return { flag: r?.devolved?.immuneToExAttackNextTurn ?? null }; });
  // FS 防護代碼：P1 密勒頓用防護代碼 → 回合結束 → P2 回合，P1 備戰新放上鐵頭殼ex，P2 的 ex 打它
  const shield = (moveOff) => { const mir = inst(ID.miraidon, { energyAttached: many(ID.L, 2) }), sub = inst(ID.filler);
    let s = mk({ a0: mir, b0: [sub], a1: inst(ID.pikaEx, { energyAttached: many(ID.L, 3) }) });
    s = res(act(s, { type: 'ATTACK', attackIndex: atkIdx(mir, '防護代碼', s), actorIdx: 0 }));
    if (s.activePlayerIndex === 0) s = act(s, { type: 'END_TURN' });
    if (s.turnPhase === 'draw') s = act(s, { type: 'DRAW_CARD' });
    const crown = inst(ID.ironCrown);   // 下個對手回合才放上場（判例：配樂之笛）
    s = { ...s, players: [{ ...s.players[0], bench: [...s.players[0].bench, crown] }, s.players[1]] };
    if (moveOff) s = { ...s, players: [{ ...s.players[0], active: sub, bench: [mir, crown] }, s.players[1]] };   // 密勒頓離開戰鬥場
    const t = M.dealAttackDamageToTarget(s, 1, crown.iid, 60, pool, { kind: 'attack-damage', label: '測試', noWeakness: true });
    const c2 = t.players[0].bench.find((b) => b.iid === crown.iid);
    return { dmg: c2?.damage ?? 'KO', turn: s.activePlayerIndex }; };
  T('FS', () => shield(false));
  T('FS_off', () => shield(true));
  // CM 核心記憶碟
  const disc = (holderId) => { const h = inst(holderId, { energyAttached: many(ID.F, 4) }), d = inst(ID.disc);
    let s = mk({ a0: h, hand0: [d], a1: inst(ID.bigHp) });
    s = res(act(s, { type: 'PLAY_TRAINER', iid: d.iid }), () => [h.iid]);
    const attached = !!s.players[0].active.toolAttached && s.players[0].active.toolAttached.iid === d.iid;
    const hasBeam = M.getEffectiveAttacks(s, s.players[0].active, pool).some((x) => x.atk.name === '大地光炮');
    return { attached, hasBeam }; };
  T('CM', () => disc(ID.filler));
  T('CM_ctl', () => disc(ID.zygarde));
  // DD 白日夢 × 碧綠之舞
  T('DD', () => { const o = inst(ID.ogerpon, { endTurnOnOppAttachEnergyThisTurn: true }), g = inst(ID.G);
    let s = mk({ a0: o, hand0: [g], a1: inst(ID.filler), deck0: many(ID.W, 5) });
    const deck0 = s.players[0].deck.length;
    s = res(act(s, { type: 'USE_ABILITY', iid: o.iid, abilityIndex: 0 }), (ps) => (ps.params?.validIids ?? [g.iid]).slice(0, 1));
    return { drew: deck0 - s.players[0].deck.length >= 1, turnEnded: s.activePlayerIndex === 1, attached: s.players[0].active.energyAttached.some((e) => e.iid === g.iid) }; });
  T('DD_manual', () => { const a = inst(ID.filler, { endTurnOnOppAttachEnergyThisTurn: true }), w = inst(ID.W);
    let s = mk({ a0: a, hand0: [w], a1: inst(ID.filler) });
    s = act(s, { type: 'ATTACH_ENERGY', energyIid: w.iid, targetIid: a.iid });
    return { turnEnded: s.activePlayerIndex === 1 }; });
  // NT 九尾｜靈怪變化：牌庫頂是阿塞蘿拉的惡作劇（對手剩 6 張獎賞 ⇒ 使用條件不符）
  const nine = (oppPrizes) => { const nt = inst(ID.ninetales, { energyAttached: many(ID.W, 1) }), top = inst(ID.acerola);
    let s = mk({ a0: nt, a1: inst(ID.filler), deck0: [top, ...many(ID.W, 5)], prizes1: many(ID.W, oppPrizes) });
    s = act(s, { type: 'ATTACK', attackIndex: atkIdx(nt, '靈怪變化', s), actorIdx: 0 });
    return { pendingAcerola: s.pendingSelection?.effectKey === 'acerola-prank' }; };
  T('NT', () => nine(6));
  T('NT_ctl', () => nine(2));
  T('MM', () => { const mm = inst(ID.mime, { energyAttached: many(ID.W, 1) }), sup = inst(ID.acerola);
    let s = mk({ a0: mm, a1: inst(ID.filler), prizes1: many(ID.W, 6) });
    s = { ...s, players: [s.players[0], { ...s.players[1], hand: [sup] }] };
    s = act(s, { type: 'ATTACK', attackIndex: atkIdx(mm, '相仿秀', s), actorIdx: 0 });
    const ps = s.pendingSelection;
    if (!ps) return { pending: false };
    s = act(s, { type: 'RESOLVE_SELECTION', effectKey: ps.effectKey, selectedIids: [sup.iid], actorIdx: 0, pendingToken: ps.token });
    return { pendingAcerola: s.pendingSelection?.effectKey === 'acerola-prank' }; });
  // CB 咒詛炸彈：P1 戰鬥場的彷徨夜靈、P2 戰鬥場低 HP、雙方都沒有備戰、雙方各剩 1 張獎賞
  T('CB', () => { const d = inst(ID.dusclops);
    const vh = Number(pool.get(ID.filler).hp);
    const victim = inst(ID.filler, { damage: Math.max(0, vh - 50) });
    let s = mk({ a0: d, a1: victim, prizes0: many(ID.W, 1), prizes1: many(ID.W, 1) });
    s = act(s, { type: 'USE_ABILITY', iid: d.iid, abilityIndex: 0 });
    s = res(s, () => [victim.iid]);
    return { phase: s.phase, winner: s.winner ?? null, isDraw: s.isDraw === true }; });
  // CB2／CB3（Fable 審查 v6.530 P1-1）：使用方可以放置、對手不可以 ⇒ 使用方勝（L1669）——兩次取完最後一張不可以「後寫的贏」
  const bomb = (userOnBench, userHasBench) => { const d = inst(ID.dusclops);
    const vh = Number(pool.get(ID.filler).hp);
    const victim = inst(ID.filler, { damage: Math.max(0, vh - 50) });
    const a0 = userOnBench ? inst(ID.filler) : d;
    const b0 = userOnBench ? [d] : (userHasBench ? [inst(ID.filler)] : []);
    let s = mk({ a0, b0, a1: victim, prizes0: many(ID.W, 1), prizes1: many(ID.W, 1) });
    s = act(s, { type: 'USE_ABILITY', iid: d.iid, abilityIndex: 0 });
    s = res(s, () => [victim.iid]);
    return { phase: s.phase, winner: s.winner ?? null, isDraw: s.isDraw === true }; };
  T('CB2', () => bomb(false, true));
  T('CB3', () => bomb(true, false));
  // HV 高電壓壓制：自己獎賞比對手多（反擊增幅器生效）＋4 雷
  const hv = (withAmp) => { const e = inst(ID.electivire, { energyAttached: many(ID.L, 4), ...(withAmp ? { toolAttached: inst(ID.amp) } : {}) });
    let s = mk({ a0: e, a1: inst(ID.bigHp), prizes0: many(ID.W, 5), prizes1: many(ID.W, 3) });
    s = res(act(s, { type: 'ATTACK', attackIndex: atkIdx(e, '高電壓壓制', s), actorIdx: 0 }));
    return s.players[1].active?.damage ?? 'KO'; };
  T('HV', () => hv(true));
  T('HV_ctl', () => hv(false));
  return out;
}

const judge = (r) => ({
  AC: !!r.AC && r.AC.retreated === true && r.AC.flag === true,
  AC_devolve: !!r.AC_devolve && (r.AC_devolve.flag === null || r.AC_devolve.flag === false || r.AC_devolve.flag === undefined),
  FS: !!r.FS && r.FS.turn === 1 && r.FS.dmg === 0,
  FS_off: !!r.FS_off && r.FS_off.dmg === 60,
  CM: !!r.CM && r.CM.attached === true && r.CM.hasBeam === false,
  CM_ctl: !!r.CM_ctl && r.CM_ctl.attached === true && r.CM_ctl.hasBeam === true,
  DD: !!r.DD && r.DD.attached === true && r.DD.drew === true && r.DD.turnEnded === true,
  DD_manual: !!r.DD_manual && r.DD_manual.turnEnded === true,
  NT: !!r.NT && r.NT.pendingAcerola === false,
  NT_ctl: !!r.NT_ctl && r.NT_ctl.pendingAcerola === true,
  MM: !!r.MM && r.MM.pendingAcerola === false,
  CB: !!r.CB && r.CB.phase === 'game-over' && r.CB.isDraw === true,
  CB2: !!r.CB2 && r.CB2.phase === 'game-over' && r.CB2.winner === 0,
  CB3: !!r.CB3 && r.CB3.phase === 'game-over' && r.CB3.winner === 0,
  HV: typeof r.HV === 'number' && typeof r.HV_ctl === 'number' && r.HV - r.HV_ctl === 100,
  HV_ctl: r.HV_ctl === 180,
});
const LABEL = {
  AC: '★★★ 阿塞蘿拉的惡作劇：撤退到備戰後效果仍在（L2528）',
  AC_devolve: '★★ 阿塞蘿拉的惡作劇：被退化 ⇒ 效果消除（L2493）',
  FS: '★★★ 防護代碼：下個對手回合才放上的鐵頭殼ex 不受 ex 招式傷害（L1979）',
  FS_off: '★★ 防護代碼：密勒頓離開戰鬥場 ⇒ 效果消除（卡面）',
  CM: '★★★ 核心記憶碟：可附在其他寶可夢、但不能用大地光炮（L2801）', CM_ctl: '★ 核心記憶碟正對照：超級基格爾德ex 可用大地光炮',
  DD: '★★★ 白日夢 × 碧綠之舞：附能、抽 1 張，然後回合結束', DD_manual: '★ 白日夢正對照：手動附能照舊結束回合',
  NT: '★★★ 靈怪變化：阿塞蘿拉的惡作劇使用條件不符（對手 6 張獎賞）⇒ 不能使用效果（L2403）', NT_ctl: '★ 靈怪變化正對照：對手 2 張獎賞 ⇒ 可以',
  MM: '★★ 相仿秀（類推 L2403）：使用條件不符 ⇒ 不能使用效果',
  CB: '★★★ 咒詛炸彈：雙方各剩 1 張獎賞、雙方都沒有備戰、同時昏厥 ⇒ 平手（L1669）',
  CB2: '★★ 咒詛炸彈：使用者在戰鬥場且有備戰、對手沒有備戰、雙方各剩 1 張 ⇒ 使用方勝（審查 P1-1）',
  CB3: '★★ 咒詛炸彈：使用者在備戰、對手沒有備戰、雙方各剩 1 張 ⇒ 使用方勝（審查 P1-1）',
  HV: '★★★ 高電壓壓制：反擊增幅器 -1 後 4 雷 ⇒ +100（反擊增幅器判例）', HV_ctl: '★ 高電壓壓制正對照：沒有增幅器 4 雷 ⇒ 180',
};
const NEW = ['AC', 'FS', 'CM', 'DD', 'NT', 'MM', 'CB', 'HV'];

if (missing.length) { console.log('fixture 卡片缺：' + missing.join(',')); process.exit(1); }
const HM = await load(ROOT);
const H = scenarios(HM), J = judge(H);
for (const k of Object.keys(LABEL)) ok(LABEL[k], J[k], JSON.stringify(H[k]));

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6530b-'));
  try {
    execFileSync('sh', ['-c', `git -C "${ROOT}" archive ${BASE_SHA} src | tar -x -C "${tmp}"`]);
    const BM = await load(tmp);
    const B = scenarios(BM), BJ = judge(B);
    for (const k of Object.keys(LABEL)) {
      if (NEW.includes(k)) ok(`★★★[H] v6.529：${k} 紅`, BJ[k] === false, JSON.stringify(B[k]));
      else ok(`★[H 正對照] v6.529：${k} 綠`, BJ[k] === true, JSON.stringify(B[k]));
    }
  } catch (e) { ok('★★★[H] BASE 可打包', false, e.message.split('\n')[0]); }
  finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
} else shallowSkip('v6530 H', '需要 v6.529 commit');

console.log(`\n=== v6.530 官方判例 B2 組：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
