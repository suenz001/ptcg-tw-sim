#!/usr/bin/env node
/**
 * v6.529 守衛：官方 Q&A 第二輪比對（B1 組）——效果判定。全部走 applyAction 完整流程。
 *
 *   IA  鐵蟻｜一起啃食：備戰只有鐵蟻ex 不 +20（PTCG_RULES L2392）；正對照：備戰有鐵蟻 +20
 *   SM  壯偉碩木：不可以把波普海豚進化成海豚俠ex（全能靈魂，L1745）——候選、resolver 兩端
 *   PS  毒音波疊在「放 16 個指示物的中毒」上：寶可夢檢查放 1 個（L2978）
 *   RH  改造之錘：緊張感的斧牙龍不可選（L1688）；正對照：一般寶可夢可選
 *   TT  上搗角擊：薄霧能量 ⇒ 不放回（L1926）；正對照：沒有薄霧照常開選擇
 *   GD  傷害集結：選擇指示物（不再自動全搬）；薄霧能量 ⇒ 移除不放置（L1511）；正對照：照放
 *   GC  齒輪塗層：附稜鏡能量的基礎寶可夢算有【鋼】能量 ⇒ -20（L2354）；正對照：沒有齒輪怪不減
 *   CR  漸強波 × 詛咒根：選的水能量進棄牌區、不附加（L2855）；正對照：沒有詛咒根照附
 * 【H】BASE（v6.528）：每一條新斷言逐條紅；正對照兩版都綠。
 */
import { readFileSync, readdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.528。
const BASE_SHA = '2ab86d04';
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
  W: byName('基本【水】能量'), D: byName('基本【惡】能量'), M: byName('基本【鋼】能量'), C: byName('基本【水】能量'), filler: '19178',
  ironAnt: withAttack('鐵蟻', '一起啃食'), ironAntEx: byName('鐵蟻ex'),
  wood: byName('壯偉碩木'), finizen: byName('波普海豚'), palafin: withAbility('海豚俠ex', '全能靈魂'),
  crobat: withAttack('叉字蝠', '毒音波'), bigHp: byName('超級毒藻龍ex'),
  hammer: byName('改造之錘'), haxorus: withAbility('斧牙龍', '緊張感'), ancient: byName('古舊能量'),
  tauros: withAttack('帕底亞 肯泰羅', '上搗角擊'), mist: byName('薄霧能量'), klinklang: withAbility('齒輪怪', '齒輪塗層'),
  gouhun: withAttack('勾魂眼', '傷害集結'), alakazam: withAttack('胡地', '奇異駭入'), P: byName('基本【超】能量'),
  genesect: byName('蓋諾賽克特ex'), prism: byName('稜鏡能量'), zacian: withAttack('勾帕路翁', '神聖刀鋒'),
  sakura: withAttack('櫻花魚', '漸強波'),
};
const missing = Object.entries(ID).filter(([, v]) => !v).map(([k]) => k);

async function load(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6529-'));
  const E = join(tmp, 'e.ts'), S = join(tmp, 's.js'), O = join(tmp, 'o.mjs');
  writeFileSync(S, 'export const base="";');
  const p = (x) => join(srcRoot, x).replace(/\\/g, '/');
  writeFileSync(E, `export { applyAction, createGame } from '${p('src/lib/game/engine')}';\nexport { getAIAction } from '${p('src/lib/game/ai')}';\nimport '${p('src/lib/game/effects')}';`);
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
  const mk = ({ a0, b0 = [], a1, b1 = [], hand0 = [], deck0, extra = {} }) => {
    const s = M.createGame({ name: 'P1', entries: [{ cardId: ID.filler, count: 1 }] }, { name: 'P2', entries: [{ cardId: ID.filler, count: 1 }] }, pool);
    return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
      setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], log: [], ...extra,
      players: [
        { ...s.players[0], hand: hand0, deck: deck0 ?? many(ID.W, 10), discard: [], prizes: many(ID.W, 6), bench: b0, active: a0 },
        { ...s.players[1], hand: [], deck: many(ID.W, 10), discard: [], prizes: many(ID.W, 6), bench: b1, active: a1 },
      ] };
  };
  const act = (s, a) => M.applyAction(s, a, pool);
  const res = (s, pick) => { let g = 0; while (s.pendingSelection && g++ < 6) { const ps = s.pendingSelection;
    const sel = pick ? pick(ps, s) : (ps.type === 'modal-choice' ? ['yes'] : (ps.params?.validIids ?? []).slice(0, Math.max(1, ps.minCount || 0)));
    if (sel === null) break;
    s = act(s, { type: 'RESOLVE_SELECTION', effectKey: ps.effectKey, selectedIids: sel, actorIdx: ps.actorIdx ?? 0, pendingToken: ps.token }); }
    return s; };
  const atk = (s, cid, name) => act(s, { type: 'ATTACK', attackIndex: pool.get(cid).attacks.findIndex((a) => a.name === name), actorIdx: 0, discardedEnergyIids: undefined });
  const out = {};
  const T = (k, f) => { try { out[k] = f(); } catch (e) { out[k] = 'ERR ' + e.message.split('\n')[0]; } };

  // IA 鐵蟻
  const antHit = (benchId) => { const s = mk({ a0: inst(ID.ironAnt, { energyAttached: many(ID.W, 1) }), b0: [inst(benchId)], a1: inst(ID.bigHp) });
    const t = res(atk(s, ID.ironAnt, '一起啃食')); return t.players[1].active?.damage; };
  T('IA_ex', () => antHit(ID.ironAntEx));
  T('IA_ctl', () => antHit(ID.ironAnt));
  // SM 壯偉碩木
  T('SM', () => { const b = inst(ID.finizen), d = inst(ID.palafin);
    let s = mk({ a0: inst(ID.filler), b0: [b], a1: inst(ID.filler), deck0: [d, inst(ID.filler)], extra: { activeStadium: inst(ID.wood), activeStadiumOwnerIdx: 0 } });
    s = act(s, { type: 'USE_STADIUM' });
    const ps = s.pendingSelection;
    if (!ps) return { pending: false };
    const t = act(s, { type: 'RESOLVE_SELECTION', effectKey: ps.effectKey, selectedIids: [d.iid], actorIdx: 0, pendingToken: ps.token });
    return { pending: true, benchCard: t.players[0].bench[0]?.cardId === ID.palafin ? 'palafin' : 'finizen', deckHasPalafin: t.players[0].deck.some((c) => c.iid === d.iid) }; });
  // PS 毒音波 × 放 16 個的中毒
  T('PS', () => { const s = mk({ a0: inst(ID.crobat, { energyAttached: many(ID.D, 1) }), a1: inst(ID.bigHp, { status: 'poisoned', poisonDamagePerCheckup: 160 }) });
    let t = res(atk(s, ID.crobat, '毒音波'));
    const before = t.players[1].active.damage;
    t = act(t, { type: 'END_TURN' });
    return { per: (t.players[1].active?.damage ?? 0) - before, flag: t.players[1].active?.poisonDamagePerCheckup ?? null }; });
  // RH 改造之錘
  const hammer = (oppActive) => { const c = inst(ID.hammer); const s = mk({ a0: inst(ID.filler), hand0: [c], a1: oppActive });
    const t = act(s, { type: 'PLAY_TRAINER', iid: c.iid }); return !t.players[0].hand.some((x) => x.iid === c.iid); };
  T('RH', () => hammer(inst(ID.haxorus, { energyAttached: [inst(ID.ancient)] })));
  T('RH_ctl', () => hammer(inst(ID.filler, { energyAttached: [inst(ID.ancient)] })));
  // TT 上搗角擊
  const tauros = (withMist) => { const e = [inst(ID.W), ...(withMist ? [inst(ID.mist)] : [inst(ID.W)])];
    const s = mk({ a0: inst(ID.tauros, { energyAttached: many(ID.W, 2) }), a1: inst(ID.klinklang, { energyAttached: e }) });
    const t0 = atk(s, ID.tauros, '上搗角擊');
    const opened = !!t0.pendingSelection && t0.pendingSelection.effectKey === 'v327-tauros-thrust';
    const t = res(t0, (ps) => (ps.effectKey === 'v327-tauros-thrust' ? e.map((x) => x.iid) : (ps.type === 'modal-choice' ? ['yes'] : (ps.params?.validIids ?? []).slice(0, Math.max(1, ps.minCount || 0)))));
    return { opened, left: t.players[1].active?.energyAttached.length, oppHand: t.players[1].hand.length }; };
  T('TT', () => tauros(true));
  T('TT_ctl', () => tauros(false));
  // GD 傷害集結
  const gather = (withMist) => { const b1 = inst(ID.filler, { damage: 30 });
    const s = mk({ a0: inst(ID.gouhun, { energyAttached: many(ID.W, 2) }), a1: inst(ID.bigHp, { energyAttached: withMist ? [inst(ID.mist)] : [] }), b1: [b1] });
    const t0 = atk(s, ID.gouhun, '傷害集結');
    const ps = t0.pendingSelection;
    const picker = !!ps && ps.type === 'damage-distribute';
    const t = picker ? act(t0, { type: 'RESOLVE_SELECTION', effectKey: ps.effectKey, selectedIids: [b1.iid, b1.iid], actorIdx: 0, pendingToken: ps.token }) : t0;
    return { picker, bench: t.players[1].bench[0]?.damage, active: t.players[1].active?.damage }; };
  T('GD', () => gather(true));
  // AH_ai（v6.529 複審）：奇異駭入 AI——對手沒有備戰時不可以把戰鬥位的指示物抽走丟掉（等於替對手治療）
  T('AH_ai', () => { const s = mk({ a0: inst(ID.alakazam, { energyAttached: many(ID.P, 1) }), a1: inst(ID.bigHp, { damage: 40 }) });
    let t = atk(s, ID.alakazam, '奇異駭入'); let g = 0;
    while (t.pendingSelection && g++ < 4) { const ps = t.pendingSelection; const a = M.getAIAction(t, pool, ps.actorIdx ?? 0);
      if (!a || a.type !== 'RESOLVE_SELECTION') break;
      t = act(t, { ...a, effectKey: ps.effectKey, actorIdx: ps.actorIdx ?? 0, pendingToken: ps.token }); }
    return { dmg: t.players[1].active?.damage }; });
  // GD_ai（Fable 審查 v6.529 P2-1）：AI 在「抽走」模式要選有指示物的那隻、取滿（不可挑無傷的高 HP 備戰被夾成 0）
  T('GD_ai', () => { const hurt = inst(ID.filler, { damage: 30 }), fresh = inst(ID.bigHp);
    const s = mk({ a0: inst(ID.gouhun, { energyAttached: many(ID.W, 2) }), a1: inst(ID.bigHp), b1: [hurt, fresh] });
    const t0 = atk(s, ID.gouhun, '傷害集結');
    if (!t0.pendingSelection) return { pending: false };
    const a = M.getAIAction(t0, pool, 0);
    return { pick: a && a.selectedIids, hurt: hurt.iid }; });
  T('GD_ctl', () => gather(false));
  // GC 齒輪塗層 × 稜鏡能量
  const gear = (withKlink) => { const pr = inst(ID.prism);
    const s = mk({ a0: inst(ID.zacian, { energyAttached: many(ID.M, 1) }), a1: inst(ID.genesect, { energyAttached: [pr] }), b1: withKlink ? [inst(ID.klinklang)] : [] });
    const t = res(atk(s, ID.zacian, '神聖刀鋒'), (ps) => (ps.params?.validIids ?? [pr.iid]).slice(0, Math.max(1, ps.minCount || 0)));
    return { dmg: t.players[1].active?.damage, prismGone: !t.players[1].active?.energyAttached.some((x) => x.iid === pr.iid) }; };
  T('GC', () => gear(true));
  T('GC_ctl', () => gear(false));
  // CR 漸強波 × 詛咒根
  const crescendo = (cursed) => { const h = many(ID.W, 2);
    const s = mk({ a0: inst(ID.sakura, { energyAttached: many(ID.W, 1), ...(cursed ? { cantAttachEnergyThisTurn: true } : {}) }), hand0: h, a1: inst(ID.bigHp) });
    const t = res(atk(s, ID.sakura, '漸強波'), (ps) => (ps.effectKey === 'sakura-crescendo-attach' ? h.map((x) => x.iid) : (ps.type === 'modal-choice' ? ['yes'] : [])));
    return { dmg: t.players[1].active?.damage, attached: t.players[0].active?.energyAttached.length, discardW: t.players[0].discard.filter((c) => h.some((x) => x.iid === c.iid)).length }; };
  T('CR', () => crescendo(true));
  T('CR_ctl', () => crescendo(false));
  return out;
}

const judge = (r) => ({
  IA: typeof r.IA_ex === 'number' && typeof r.IA_ctl === 'number' && r.IA_ctl - r.IA_ex === 20,
  IA_ctl: typeof r.IA_ctl === 'number' && r.IA_ctl >= 40,
  SM: !!r.SM && r.SM.benchCard === 'finizen',
  PS: !!r.PS && r.PS.per === 10,
  RH: r.RH === false,
  RH_ctl: r.RH_ctl === true,
  TT: !!r.TT && r.TT.opened === false && r.TT.left === 2 && r.TT.oppHand === 0,
  TT_ctl: !!r.TT_ctl && r.TT_ctl.opened === true && r.TT_ctl.oppHand === 2,
  GD: !!r.GD && r.GD.picker === true && r.GD.bench === 10 && r.GD.active === 0,
  GD_ai: !!r.GD_ai && Array.isArray(r.GD_ai.pick) && r.GD_ai.pick.length === 3 && r.GD_ai.pick.every((x) => x === r.GD_ai.hurt),
  AH_ai: !!r.AH_ai && r.AH_ai.dmg >= 40,
  GD_ctl: !!r.GD_ctl && r.GD_ctl.picker === true && r.GD_ctl.bench === 10 && r.GD_ctl.active === 20,
  GC: !!r.GC && typeof r.GC.dmg === 'number' && typeof r.GC_ctl?.dmg === 'number' && r.GC_ctl.dmg - r.GC.dmg === 20 && r.GC.prismGone === true,
  GC_ctl: !!r.GC_ctl && r.GC_ctl.dmg === 20,
  CR: !!r.CR && r.CR.attached === 1 && r.CR.discardW === 2 && r.CR.dmg === 30,
  CR_ctl: !!r.CR_ctl && r.CR_ctl.attached === 3 && r.CR_ctl.dmg === 90,
});
const LABEL = {
  IA: '★★★ 一起啃食：備戰只有鐵蟻ex ⇒ 不 +20（L2392）', IA_ctl: '★ 一起啃食正對照：備戰有鐵蟻 ⇒ +20',
  SM: '★★★ 壯偉碩木：選海豚俠ex ⇒ 不進化（全能靈魂，L1745）',
  PS: '★★★ 毒音波覆蓋「放 16 個」的中毒 ⇒ 檢查放 1 個（L2978）',
  RH: '★★★ 改造之錘：只有緊張感斧牙龍有特殊能量 ⇒ 不能打出（L1688）', RH_ctl: '★ 改造之錘正對照：一般寶可夢 ⇒ 可以',
  TT: '★★★ 上搗角擊：對手 2 階有薄霧能量 ⇒ 不開選擇、能量不回手（L1926）', TT_ctl: '★ 上搗角擊正對照：沒有薄霧 ⇒ 開選擇、2 張回手',
  GD_ai: '★★★ 傷害集結 AI：抽走模式只選有指示物的備戰、取滿 3 個（Fable 審查 P2-1）',
  AH_ai: '★★ 奇異駭入 AI 正對照：對手沒有備戰 ⇒ 戰鬥位指示物不會被抽走丟掉（v6.529 複審）',
  GD: '★★★ 傷害集結：選擇視窗；選 2 個 ⇒ 備戰剩 10；薄霧能量 ⇒ 移除不放置（L1511）', GD_ctl: '★★ 傷害集結正對照：沒有薄霧 ⇒ 戰鬥 +20',
  GC: '★★★ 齒輪塗層：附稜鏡能量的基礎寶可夢 ⇒ -20，計算後才丟稜鏡（L2354）', GC_ctl: '★ 齒輪塗層正對照：沒有齒輪怪 ⇒ 20',
  CR: '★★★ 漸強波 × 詛咒根：選的 2 張水能量進棄牌區、只算 1 個水（L2855）', CR_ctl: '★ 漸強波正對照：照附 ⇒ 90',
};
const NEW = ['IA', 'SM', 'PS', 'RH', 'TT', 'GD', 'GD_ai', 'GD_ctl', 'GC', 'CR'];

if (missing.length) { console.log('fixture 卡片缺：' + missing.join(',')); process.exit(1); }
const HM = await load(ROOT);
const H = scenarios(HM), J = judge(H);
for (const k of Object.keys(LABEL)) ok(LABEL[k], J[k], JSON.stringify(k === 'IA' ? [H.IA_ex, H.IA_ctl] : H[k]));

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6529b-'));
  try {
    execFileSync('sh', ['-c', `git -C "${ROOT}" archive ${BASE_SHA} src | tar -x -C "${tmp}"`]);
    const BM = await load(tmp);
    const B = scenarios(BM), BJ = judge(B);
    for (const k of Object.keys(LABEL)) {
      if (NEW.includes(k)) ok(`★★★[H] v6.528：${k} 紅`, BJ[k] === false, JSON.stringify(k === 'IA' ? [B.IA_ex, B.IA_ctl] : B[k]));
      else ok(`★[H 正對照] v6.528：${k} 綠`, BJ[k] === true, JSON.stringify(B[k]));
    }
  } catch (e) { ok('★★★[H] BASE 可打包', false, e.message.split('\n')[0]); }
  finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
} else shallowSkip('v6529 H', '需要 v6.528 commit');

console.log(`\n=== v6.529 官方判例 B1 組（效果判定）：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
