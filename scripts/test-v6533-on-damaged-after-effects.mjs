#!/usr/bin/env node
/**
 * v6.533 守衛（站長 2026-10-12 裁定：受傷反擊整體移到招式效果之後；依官方 Q&A）：
 *   Q682  耿鬼ex｜戲法舞步把扣殺能量改附到備戰 ⇒ 不放 2 個指示物（BASE 放 20）；Q682_ctl 不改附 ⇒ 照放 20
 *   Q904  土地雲｜螺旋關節先把能量放回手牌 ⇒ 爆焰龜獸｜甲殼刺不能選那張（先開的是螺旋關節的視窗）
 *   Q905  喵喵ex｜夾尾巴逃跑整隻回手牌 ⇒ 甲殼刺不丟任何能量（3 張都在手牌）
 *   Q913  駒刀小兵｜推倒把爆焰龜獸換到備戰 ⇒ 甲殼刺照樣觸發（正對照，兩版皆綠）
 *   BENCH 鍬農炮蟲｜伏特替換把自己換到備戰 ⇒ 穿山王｜反擊針的 3 個指示物放在換下去的鍬農炮蟲（L615 控制輪同型；BASE 放錯在新上場那隻）
 *   LEG   沒有招式效果的招式（土地雲｜巨岩墜落）打穿山王 ⇒ 當場反擊 30（正對照，兩版皆綠）
 *   BENCH_SPIKE 伏特替換換到備戰 × 甲殼刺 ⇒ 丟的是換下去那一隻的能量（targetIid）
 *   TOOLGONE 招式視窗開著時道具被拿掉（手術）⇒ 龐克頭盔不觸發（BASE 在傷害當下就放了 40）
 *   RKO_ACTIVE／RKO_BENCH 反擊打昏攻擊方（戰鬥位／備戰）⇒ 中央結算，不是系統擊倒檢查
 *   ENDGAME 反擊打昏無備戰的攻擊方＋防守方帶古舊能量被打倒 ⇒ 對手勝（審查 P2-1：曾誤判平手）
 *   BENCH_POISON 伏特替換換到備戰 × 毒刺 ⇒ 備戰那隻不中毒、新上場那隻也不中毒
 * 【H】BASE（v6.532）：Q682、Q904、BENCH_SPIKE、TOOLGONE、ENDGAME、BENCH_POISON_LOG 逐條紅；其餘兩版綠（Q905／BENCH 在 BASE 碰巧正確，BENCH 的視角轉接由突變守）。
 */
import { extractBaseArchive } from './lib/base-archive.mjs';
import { readFileSync, readdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.532。
const BASE_SHA = 'af9ea475';
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
const special = () => byName('稜鏡能量');
const withAttack = (n, a) => { for (const c of pool.values()) if (c.name === n && 'HIJ'.includes(c.regulationMark || '?') && (c.attacks || []).some((x) => x.name === a)) return String(c.id); return null; };
const withAbility = (n, a) => { for (const c of pool.values()) if (c.name === n && 'HIJ'.includes(c.regulationMark || '?') && (c.abilities || []).some((x) => x.name === a)) return String(c.id); return null; };
const ID = {
  W: byName('基本【水】能量'), F: byName('基本【鬥】能量'), D: byName('基本【惡】能量'), L: byName('基本【雷】能量'), M: byName('基本【鋼】能量'), filler: '19178',
  gengar: withAttack('耿鬼ex', '戲法舞步'), smash: byName('扣殺能量'),
  landorus: withAttack('土地雲', '螺旋關節'), torkoal: withAbility('爆焰龜獸', '甲殼刺'),
  meowth: withAttack('喵喵ex', '夾尾巴逃跑'), pawn: withAttack('駒刀小兵', '推倒'),
  kuwa: withAttack('鍬農炮蟲', '伏特替換'), sandslash: withAbility('穿山王', '反擊針'), qwil: withAbility('千針魚', '毒刺'), punk: byName('龐克頭盔'), ancient: byName('古舊能量'),
};
const missing = Object.entries(ID).filter(([, v]) => !v).map(([k]) => k);
const atkIdx = (id, n) => pool.get(id).attacks.findIndex((a) => a.name === n);

async function load(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6533-'));
  const E = join(tmp, 'e.ts'), S = join(tmp, 's.js'), O = join(tmp, 'o.mjs');
  writeFileSync(S, 'export const base="";');
  const p = (x) => join(srcRoot, x).replace(/\\/g, '/');
  writeFileSync(E, `export { applyAction, createGame } from '${p('src/lib/game/engine')}';\nimport '${p('src/lib/game/effects')}';`);
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
  const mk = ({ a0, b0 = [], a1, b1 = [] }) => {
    const s = M.createGame({ name: 'P1', entries: [{ cardId: ID.filler, count: 1 }] }, { name: 'P2', entries: [{ cardId: ID.filler, count: 1 }] }, pool);
    return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
      setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], log: [],
      players: [
        { ...s.players[0], hand: [], deck: many(ID.W, 10), discard: [], prizes: many(ID.W, 6), bench: b0, active: a0 },
        { ...s.players[1], hand: [], deck: many(ID.W, 10), discard: [], prizes: many(ID.W, 6), bench: b1, active: a1 },
      ] };
  };
  const act = (s, a) => M.applyAction(s, a, pool);
  const rs = (s, sel) => { const ps = s.pendingSelection; return act(s, { type: 'RESOLVE_SELECTION', effectKey: ps.effectKey, selectedIids: sel, actorIdx: ps.actorIdx ?? 0, senderIdx: ps.actorIdx ?? 0, pendingToken: ps.token }); };
  const out = {};
  const T = (k, f) => { try { out[k] = f(); } catch (e) { out[k] = 'ERR ' + e.message.split('\n')[0]; } };

  // Q682：戲法舞步把扣殺能量改附到對手備戰 ⇒ 不放
  const q682 = (move) => {
    const g = inst(ID.gengar, { energyAttached: many(ID.D, 2) });
    const sm = inst(ID.smash);
    const tgt = inst(ID.gengar, { energyAttached: [sm] }); const b = inst(ID.filler);   // 310HP：160 打不倒
    let s = act(mk({ a0: g, a1: tgt, b1: [b] }), { type: 'ATTACK', attackIndex: atkIdx(ID.gengar, '戲法舞步'), actorIdx: 0 });
    let guard = 0;
    while (s.pendingSelection && guard++ < 6) {
      const ps = s.pendingSelection;
      if (ps.type === 'modal-choice') { const ids = (ps.params?.options ?? []).map((o) => o.id); s = rs(s, [move ? (ids.find((x) => /yes|是|move/i.test(x)) ?? ids[0]) : (ids.find((x) => /no|否|skip/i.test(x)) ?? ids[ids.length - 1])]); continue; }
      if (!move) { s = rs(s, []); continue; }
      const v = ps.params?.validIids ?? [];
      s = rs(s, v.includes(sm.iid) ? [sm.iid] : v.includes(b.iid) ? [b.iid] : v.slice(0, 1));
    }
    const smOn = [s.players[1].active, ...s.players[1].bench].find((c) => c && c.energyAttached.some((e) => e.iid === sm.iid));
    return { gengarDmg: s.players[0].active?.damage, smashOn: smOn?.iid === b.iid ? 'bench' : smOn ? 'active' : 'none' };
  };
  T('Q682', () => q682(true));
  T('Q682_ctl', () => q682(false));

  // Q904：螺旋關節先把能量放回手牌 ⇒ 甲殼刺選不到
  T('Q904', () => {
    const e1 = inst(ID.F), e2 = inst(ID.F), e3 = inst(ID.W);
    const ld = inst(ID.landorus, { energyAttached: [e1, e2, e3] });
    let s = act(mk({ a0: ld, a1: inst(ID.torkoal), b1: [inst(ID.filler)] }), { type: 'ATTACK', attackIndex: atkIdx(ID.landorus, '螺旋關節'), actorIdx: 0 });
    const order = []; let guard = 0;
    while (s.pendingSelection && guard++ < 6) {
      const ps = s.pendingSelection; order.push(ps.effectKey);
      if (ps.effectKey === 'spike-shell-discard') { s = rs(s, [e3.iid]); continue; }     // 硬選已回手的 e3 ⇒ 不可以被丟
      if (ps.type === 'active-energy-discard' || (ps.params?.validIids ?? []).includes(e3.iid)) { s = rs(s, [e3.iid]); continue; }
      s = rs(s, (ps.params?.validIids ?? []).slice(0, 1));
    }
    return { firstIsSpike: order[0] === 'spike-shell-discard', spikeSeen: order.includes('spike-shell-discard'),
      e3InHand: s.players[0].hand.some((c) => c.iid === e3.iid), e3Discarded: s.players[0].discard.some((c) => c.iid === e3.iid) };
  });
  // Q905：夾尾巴逃跑整隻回手牌 ⇒ 甲殼刺不丟
  T('Q905', () => {
    const es = many(ID.W, 3);
    const me = inst(ID.meowth, { energyAttached: es });
    let s = act(mk({ a0: me, b0: [inst(ID.filler)], a1: inst(ID.torkoal), b1: [inst(ID.filler)] }), { type: 'ATTACK', attackIndex: atkIdx(ID.meowth, '夾尾巴逃跑'), actorIdx: 0 });
    let guard = 0; let spike = false;
    while (s.pendingSelection && guard++ < 6) { const ps = s.pendingSelection; if (ps.effectKey === 'spike-shell-discard') spike = true;
      s = rs(s, ps.effectKey === 'spike-shell-discard' ? [es[0].iid] : (ps.params?.validIids ?? []).slice(0, 1)); }
    return { spike, inHand: es.filter((e) => s.players[0].hand.some((c) => c.iid === e.iid)).length, discarded: s.players[0].discard.length };
  });
  // Q913：推倒把爆焰龜獸換到備戰 ⇒ 甲殼刺照樣觸發
  T('Q913', () => {
    const m = inst(ID.M); const pw = inst(ID.pawn, { energyAttached: [m] }); const fb = inst(ID.filler);
    let s = act(mk({ a0: pw, a1: inst(ID.torkoal), b1: [fb] }), { type: 'ATTACK', attackIndex: atkIdx(ID.pawn, '推倒'), actorIdx: 0 });
    let guard = 0;
    while (s.pendingSelection && guard++ < 6) { const ps = s.pendingSelection;
      s = rs(s, ps.effectKey === 'spike-shell-discard' ? [m.iid] : [fb.iid]); }
    return { mDiscarded: s.players[0].discard.some((c) => c.iid === m.iid), torkoalOnBench: s.players[1].bench.some((c) => pool.get(c.cardId)?.name === '爆焰龜獸') };
  });
  // BENCH：自己換到備戰 ⇒ 反擊針放在換下去的那一隻
  T('BENCH', () => {
    const k = inst(ID.kuwa, { energyAttached: many(ID.L, 3) }); const kb = inst(ID.kuwa);
    let s = act(mk({ a0: k, b0: [kb], a1: inst(ID.sandslash), b1: [inst(ID.filler)] }), { type: 'ATTACK', attackIndex: atkIdx(ID.kuwa, '伏特替換'), actorIdx: 0 });
    let guard = 0;
    while (s.pendingSelection && guard++ < 6) s = rs(s, (s.pendingSelection.params?.validIids ?? [kb.iid]).slice(0, 1));
    const usedNow = [s.players[0].active, ...s.players[0].bench].find((c) => c?.iid === k.iid);
    const newAct = s.players[0].active;
    return { usedLoc: s.players[0].active?.iid === k.iid ? 'active' : usedNow ? 'bench' : 'gone', usedDmg: usedNow?.damage ?? null, newActiveDmg: newAct?.iid === kb.iid ? newAct.damage : null };
  });
  // BENCH_SPIKE：自己換到備戰 ⇒ 甲殼刺丟的是使出招式那一隻（在備戰）的能量，不是新上場那隻
  T('BENCH_SPIKE', () => {
    const ke = many(ID.L, 3); const k = inst(ID.kuwa, { energyAttached: ke }); const kbE = inst(ID.L); const kb = inst(ID.kuwa, { energyAttached: [kbE] });
    let s = act(mk({ a0: k, b0: [kb], a1: inst(ID.torkoal), b1: [inst(ID.filler)] }), { type: 'ATTACK', attackIndex: atkIdx(ID.kuwa, '伏特替換'), actorIdx: 0 });
    let guard = 0;
    while (s.pendingSelection && guard++ < 6) { const ps = s.pendingSelection;
      s = rs(s, ps.effectKey === 'spike-shell-discard' ? [ke[0].iid] : [kb.iid]); }
    const kNow = [s.players[0].active, ...s.players[0].bench].find((c) => c?.iid === k.iid);
    return { kLoc: s.players[0].active?.iid === k.iid ? 'active' : 'bench', kEnergy: kNow?.energyAttached.length, kbEnergy: [s.players[0].active, ...s.players[0].bench].find((c) => c?.iid === kb.iid)?.energyAttached.length,
      discarded: s.players[0].discard.some((c) => c.iid === ke[0].iid) };
  });
  // BENCH_POISON：自己換到備戰 ⇒ 毒刺不會讓備戰的那一隻中毒（特殊狀態只存在於戰鬥寶可夢），也不會毒到新上場那隻
  T('BENCH_POISON', () => {
    const k = inst(ID.kuwa, { energyAttached: many(ID.L, 3) }); const kb = inst(ID.kuwa);
    let s = act(mk({ a0: k, b0: [kb], a1: inst(ID.qwil), b1: [inst(ID.filler)] }), { type: 'ATTACK', attackIndex: atkIdx(ID.kuwa, '伏特替換'), actorIdx: 0 });
    let guard = 0;
    while (s.pendingSelection && guard++ < 6) s = rs(s, [kb.iid]);
    const kNow = s.players[0].bench.find((c) => c.iid === k.iid);
    const st = (c) => [c?.status, c?.secondaryStatus, c?.tertiaryStatus].filter(Boolean).join(',');
    const L = (s.log || []).map((l) => l.message);
    return { kStatus: kNow ? st(kNow) : 'missing', newActive: s.players[0].active?.iid === kb.iid ? st(s.players[0].active) : 'other', noFalseLog: !L.some((x) => x.includes('陷入【中毒】')) };
  });
  // TOOLGONE：招式效果的選擇視窗還開著時，持有者的道具已不在身上 ⇒ 結算時不觸發（以「結算當下還附著」為準，比照扣殺能量 Q682）
  T('TOOLGONE', () => {
    const e1 = inst(ID.F), e2 = inst(ID.F), e3 = inst(ID.W);
    const ld = inst(ID.landorus, { energyAttached: [e1, e2, e3] });
    const hb = inst(ID.gengar, { toolAttached: inst(ID.punk) });   // 【惡】310HP
    let s = act(mk({ a0: ld, a1: hb, b1: [inst(ID.filler)] }), { type: 'ATTACK', attackIndex: atkIdx(ID.landorus, '螺旋關節'), actorIdx: 0 });
    const dmgAfterAttack = s.players[0].active?.damage;
    // 手術：模擬招式效果中途把道具拿掉（現行卡池沒有「造成傷害後丟道具」的招式；凡是丟道具的都寫「在造成傷害前」）
    if (s.players[1].active) s = { ...s, players: [s.players[0], { ...s.players[1], active: { ...s.players[1].active, toolAttached: undefined } }] };
    let guard = 0;
    while (s.pendingSelection && guard++ < 6) s = rs(s, [e3.iid]);
    return { dmgAfterAttack, final: s.players[0].active?.damage };
  });
  // RKO_ACTIVE：反擊把戰鬥位的攻擊方打昏 ⇒ 走中央 koAttackerAfterRetaliation（log「反彈傷害」、對手拿獎賞），不是系統擊倒檢查
  T('RKO_ACTIVE', () => {
    const m = inst(ID.M); const pw = inst(ID.pawn, { energyAttached: [m], damage: 40 }); const fb = inst(ID.filler);
    let s = act(mk({ a0: pw, b0: [inst(ID.filler)], a1: inst(ID.sandslash), b1: [fb] }), { type: 'ATTACK', attackIndex: atkIdx(ID.pawn, '推倒'), actorIdx: 0 });
    let guard = 0;
    while (s.pendingSelection && guard++ < 6) s = rs(s, [fb.iid]);
    const L = (s.log || []).map((l) => l.message);
    return { pawnGone: ![s.players[0].active, ...s.players[0].bench].some((c) => c?.iid === pw.iid),
      p2Prizes: s.players[1].prizes.length, viaCentral: L.some((x) => x.includes('反彈傷害')), sysSweep: L.some((x) => /系統擊倒檢查|系統昏厥檢查/.test(x)) };
  });
  // RKO_BENCH：攻擊方換到備戰後被反擊打昏 ⇒ 中央 koTargetAfterAttackDamage（不是系統擊倒檢查）
  T('RKO_BENCH', () => {
    const k = inst(ID.kuwa, { energyAttached: many(ID.L, 3), damage: Number(pool.get(ID.kuwa).hp) - 30 }); const kb = inst(ID.kuwa);
    let s = act(mk({ a0: k, b0: [kb], a1: inst(ID.sandslash), b1: [inst(ID.filler)] }), { type: 'ATTACK', attackIndex: atkIdx(ID.kuwa, '伏特替換'), actorIdx: 0 });
    let guard = 0;
    while (s.pendingSelection && guard++ < 6) s = rs(s, [kb.iid]);
    const L = (s.log || []).map((l) => l.message);
    return { kGone: ![s.players[0].active, ...s.players[0].bench].some((c) => c?.iid === k.iid), p2Prizes: s.players[1].prizes.length,
      sysSweep: L.some((x) => /系統擊倒檢查|系統昏厥檢查/.test(x)) };
  });
  // ENDGAME（審查 P2-1）：反擊打昏攻擊方（無備戰）＋防守方被打倒帶古舊能量 ⇒ 攻擊方只拿 1 張、沒取完 ⇒ 對手勝（不是平手）
  T('ENDGAME', () => {
    const pw = inst(ID.pawn, { energyAttached: [inst(ID.M)], damage: 50 });
    const g = inst(ID.gengar, { damage: 300, toolAttached: inst(ID.punk), energyAttached: [inst(ID.ancient)] }); const fb = inst(ID.filler);
    let s0 = mk({ a0: pw, a1: g, b1: [fb] });
    s0 = { ...s0, players: [{ ...s0.players[0], prizes: many(ID.W, 2) }, s0.players[1]] };
    let s = act(s0, { type: 'ATTACK', attackIndex: atkIdx(ID.pawn, '推倒'), actorIdx: 0 });
    let guard = 0;
    while (s.pendingSelection && guard++ < 6) s = rs(s, (s.pendingSelection.params?.validIids ?? [fb.iid]).slice(0, 1));
    return { phase: s.phase, winner: s.winner ?? null, isDraw: !!s.isDraw, p1Prizes: s.players[0].prizes.length };
  });
  // LEG：沒有招式效果 ⇒ 當場反擊
  T('LEG', () => {
    const ld = inst(ID.landorus, { energyAttached: many(ID.F, 2) });
    const s = act(mk({ a0: ld, a1: inst(ID.sandslash), b1: [inst(ID.filler)] }), { type: 'ATTACK', attackIndex: atkIdx(ID.landorus, '巨岩墜落'), actorIdx: 0 });
    return { dmg: s.players[0].active?.damage, pending: (s._pendingOnDamaged ?? []).length };
  });
  return out;
}

const judge = (r) => ({
  Q682: !!r.Q682 && r.Q682.smashOn === 'bench' && r.Q682.gengarDmg === 0,
  Q682_ctl: !!r.Q682_ctl && r.Q682_ctl.smashOn === 'active' && r.Q682_ctl.gengarDmg === 20,
  Q904: !!r.Q904 && r.Q904.spikeSeen && !r.Q904.firstIsSpike && r.Q904.e3InHand && !r.Q904.e3Discarded,
  Q905: !!r.Q905 && r.Q905.spike === false && r.Q905.inHand === 3 && r.Q905.discarded === 0,
  Q913: !!r.Q913 && r.Q913.mDiscarded === true && r.Q913.torkoalOnBench === true,
  BENCH: !!r.BENCH && r.BENCH.usedLoc === 'bench' && r.BENCH.usedDmg === 30 && r.BENCH.newActiveDmg === 0,
  LEG: !!r.LEG && r.LEG.dmg === 30 && r.LEG.pending === 0,
  RKO_ACTIVE: !!r.RKO_ACTIVE && r.RKO_ACTIVE.pawnGone && r.RKO_ACTIVE.p2Prizes === 5 && r.RKO_ACTIVE.viaCentral && !r.RKO_ACTIVE.sysSweep,
  RKO_BENCH: !!r.RKO_BENCH && r.RKO_BENCH.kGone && r.RKO_BENCH.p2Prizes === 5 && !r.RKO_BENCH.sysSweep,
  ENDGAME: !!r.ENDGAME && r.ENDGAME.phase === 'game-over' && r.ENDGAME.winner === 1 && !r.ENDGAME.isDraw && r.ENDGAME.p1Prizes === 1,
  TOOLGONE: !!r.TOOLGONE && r.TOOLGONE.dmgAfterAttack === 0 && r.TOOLGONE.final === 0,
  BENCH_SPIKE: !!r.BENCH_SPIKE && r.BENCH_SPIKE.kLoc === 'bench' && r.BENCH_SPIKE.kEnergy === 2 && r.BENCH_SPIKE.kbEnergy === 1 && r.BENCH_SPIKE.discarded === true,
  BENCH_POISON: !!r.BENCH_POISON && r.BENCH_POISON.kStatus === '' && r.BENCH_POISON.newActive === '',
  BENCH_POISON_LOG: !!r.BENCH_POISON && r.BENCH_POISON.noFalseLog === true,
});
const LABEL = {
  Q682: '★★★ Q682 戲法舞步先把扣殺能量改附 ⇒ 耿鬼ex 不被放指示物',
  Q682_ctl: '★ 正對照：不改附 ⇒ 照放 20',
  Q904: '★★★ Q904 螺旋關節先回手 ⇒ 甲殼刺選不到、晚於招式視窗',
  Q905: '★★★ Q905 夾尾巴逃跑整隻回手 ⇒ 甲殼刺不丟能量',
  Q913: '★ Q913 推倒把持有者換到備戰 ⇒ 甲殼刺照樣觸發（正對照）',
  BENCH: '★★ 攻擊方被自己的招式換到備戰 ⇒ 反擊針放在使出招式的那一隻',
  LEG: '★ 正對照：沒有招式效果 ⇒ 當場反擊、不排佇列',
  RKO_ACTIVE: '★★ 反擊打昏戰鬥位的攻擊方 ⇒ 中央結算（反彈傷害），不是系統擊倒檢查',
  RKO_BENCH: '★★ 反擊打昏備戰的攻擊方 ⇒ 中央結算，不是系統擊倒檢查',
  ENDGAME: '★★★ 攻擊方被反擊打昏且無備戰＋防守方帶古舊能量 ⇒ 攻擊方只拿 1 張 ⇒ 對手勝（審查 P2-1）',
  TOOLGONE: '★★ 結算當下道具已不在身上 ⇒ 龐克頭盔不觸發（傷害當下不再先觸發）',
  BENCH_SPIKE: '★★ 攻擊方換到備戰 ⇒ 甲殼刺丟的是使出招式那一隻的能量（targetIid）',
  BENCH_POISON: '★★ 攻擊方換到備戰 ⇒ 毒刺不讓備戰那隻中毒、也不毒到新上場那隻',
  BENCH_POISON_LOG: '★ 不先印「陷入【中毒】」再撤回（審查 P3-3）',
};
const NEW = ['Q682', 'Q904', 'BENCH_SPIKE', 'TOOLGONE', 'ENDGAME', 'BENCH_POISON_LOG'];   // Q905／BENCH：BASE 碰巧正確（攻擊方已回手／反擊在互換視窗之前就套上）⇒ 正對照；BENCH 由突變守住視角轉接

if (missing.length) { console.log('fixture 卡片缺：' + missing.join(',')); process.exit(1); }
const HM = await load(ROOT);
const H = scenarios(HM), J = judge(H);
for (const k of Object.keys(LABEL)) ok(LABEL[k], J[k], JSON.stringify(H[k]));

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6533b-'));
  try {
    extractBaseArchive(ROOT, BASE_SHA, ["src"], tmp);
    const BM = await load(tmp);
    const B = scenarios(BM), BJ = judge(B);
    for (const k of Object.keys(LABEL)) {
      if (NEW.includes(k)) ok(`★★★[H] v6.532：${k} 紅`, BJ[k] === false, JSON.stringify(B[k]));
      else ok(`★[H 正對照] v6.532：${k} 綠`, BJ[k] === true, JSON.stringify(B[k]));
    }
  } catch (e) { ok('★★★[H] BASE 可打包', false, e.message.split('\n')[0]); }
  finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
} else shallowSkip('v6533 H', '需要 v6.532 commit');

console.log(`\n=== v6.533 受傷觸發在招式效果之後結算：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
