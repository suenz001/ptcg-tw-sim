#!/usr/bin/env node
/**
 * v6.532 守衛：
 *   RT   官方 Q&A（念力土偶｜退化光線 × 布里卡隆｜尖刺盔甲）：退化先發生 ⇒ 尖刺盔甲不生效（念力土偶身上 0 個）
 *   RT_ctl 正對照：布里卡隆不是進化而來（退化不了）⇒ 尖刺盔甲照常（2 張草 ⇒ 60）
 *   斧牙龍｜緊張感「對手從手牌使出物品卡或者支援者卡時，這隻寶可夢不會受到那個效果的影響」（同 v6.528 改造之錘，PTCG_RULES L1688）：
 *   CH   粉碎之錘：唯一有能量的是斧牙龍 ⇒ 不能使用；CH_ctl 另一隻有能量 ⇒ 候選不含斧牙龍
 *   LT   悠哉尾草棒：唯一有能量的是斧牙龍 ⇒ 不能使用
 *   SB   火箭隊的驚嚇炸彈：正面、對手只有斧牙龍 ⇒ 不放指示物；SB_ctl 有備戰 ⇒ 候選不含斧牙龍
 *   DR   危險光線：斧牙龍不灼傷不混亂；DR_ctl 一般寶可夢照常
 *   MB   百萬噸吹風機：斧牙龍身上的道具／特殊能量留著，另一隻照丟
 *   HB   高溫燃燒器：選項不含斧牙龍身上的道具
 *   HM   霍米加的演奏：斧牙龍中毒仍可撤退；HM_ctl 一般寶可夢不能撤退；HM_atk 'as-attack-effect'（靈怪變化）⇒ 斧牙龍也不能撤退
 *   HM_play 從手牌使出 ⇒ 旗標寫 true；HM_copy 作為招式的效果使出 ⇒ 'as-attack-effect'
 * 【H】BASE（v6.531）：RT、CH、CH_ctl、LT、SB、SB_ctl、DR、MB、MB_gate、HB、HB_gate、SB_payload、HM、HM_copy、HM_merge 逐條紅；其餘（含 HM_atk：BASE 一律鎖）兩版綠。
 */
import { readFileSync, readdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.531。
const BASE_SHA = '6c14391c';
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
const withAbility = (n, a) => { for (const c of pool.values()) if (c.name === n && (c.abilities || []).some((x) => x.name === a)) return String(c.id); return null; };
const withAttack = (n, a) => { for (const c of pool.values()) if (c.name === n && (c.attacks || []).some((x) => x.name === a)) return String(c.id); return null; };
const special = () => byName('稜鏡能量');
const ID = {
  W: byName('基本【水】能量'), G: byName('基本【草】能量'), F: byName('基本【鬥】能量'), R: byName('基本【火】能量'), filler: '19178',
  bri: withAbility('布里卡隆', '尖刺盔甲'), chespin: byName('哈力栗'), quilladin: byName('胖胖哈力'), golett: withAttack('念力土偶', '退化光線'),
  haxorus: withAbility('斧牙龍', '緊張感'), special: special(), tool: byName('極限腰帶'),
  crush: byName('粉碎之錘'), lazy: byName('悠哉尾草棒'), scare: byName('火箭隊的驚嚇炸彈'), rays: byName('危險光線'),
  blower: byName('百萬噸吹風機'), stadium: byName('全金屬實驗室'), burner: byName('高溫燃燒器'), homika: byName('霍米加的演奏'),
};
const missing = Object.entries(ID).filter(([, v]) => !v).map(([k]) => k);

async function load(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6532-'));
  const E = join(tmp, 'e.ts'), S = join(tmp, 's.js'), O = join(tmp, 'o.mjs');
  writeFileSync(S, 'export const base="";');
  const p = (x) => join(srcRoot, x).replace(/\\/g, '/');
  writeFileSync(E, `export { applyAction, createGame, canRetreat } from '${p('src/lib/game/engine')}';\nexport { runAsCopiedSupporterEffect } from '${p('src/lib/game/supporter-effect-source')}';\nexport { TRAINER_EFFECTS } from '${p('src/lib/game/effects/_shared')}';\nimport '${p('src/lib/game/effects')}';`);
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
  const mk = ({ a0, b0 = [], a1, b1 = [], hand0 = [], turn = 5, activePlayerIndex = 0, firstPlayerIdx = 0, stadium = null, p0extra = {} }) => {
    const s = M.createGame({ name: 'P1', entries: [{ cardId: ID.filler, count: 1 }] }, { name: 'P2', entries: [{ cardId: ID.filler, count: 1 }] }, pool);
    return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex, firstPlayerIdx, turn, isFirstTurn: false,
      setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], log: [], supporterPlayedThisTurn: false,
      ...(stadium ? { activeStadium: stadium, activeStadiumOwnerIdx: 0 } : {}),
      players: [
        { ...s.players[0], hand: hand0, deck: many(ID.W, 10), discard: [], prizes: many(ID.W, 6), bench: b0, active: a0 ?? inst(ID.filler), ...p0extra },
        { ...s.players[1], hand: [], deck: many(ID.W, 10), discard: [], prizes: many(ID.W, 6), bench: b1, active: a1 ?? inst(ID.filler) },
      ] };
  };
  const act = (s, a) => M.applyAction(s, a, pool);
  const play = (s, card, actor = 0) => { const t = act(s, { type: 'PLAY_TRAINER', iid: card.iid, actorIdx: actor });
    return { played: !t.players[actor].hand.some((c) => c.iid === card.iid), st: t }; };
  const heads = (f) => { const old = Math.random; Math.random = () => 0; try { return f(); } finally { Math.random = old; } };
  const out = {};
  const T = (k, f) => { try { out[k] = f(); } catch (e) { out[k] = 'ERR ' + e.message.split('\n')[0]; } };
  const hax = (e = {}) => inst(ID.haxorus, e);

  // ── 975 退化光線 × 尖刺盔甲 ──
  const rt = (evolved) => {
    const bri = inst(ID.bri, { energyAttached: many(ID.G, 2), ...(evolved ? { evolvedFromStack: [inst(ID.chespin), inst(ID.quilladin)] } : {}) });
    const gol = inst(ID.golett, { energyAttached: many(ID.F, 1) });
    let s = mk({ a0: gol, a1: bri, b1: [inst(ID.filler)] });
    const ai = pool.get(ID.golett).attacks.findIndex((a) => a.name === '退化光線');
    s = act(s, { type: 'ATTACK', attackIndex: ai, actorIdx: 0 });
    return { now: pool.get(s.players[1].active?.cardId)?.name ?? null, golettDmg: s.players[0].active?.damage ?? null };
  };
  T('RT', () => rt(true));
  T('RT_ctl', () => rt(false));

  // ── 粉碎之錘 ──
  T('CH', () => { const c = inst(ID.crush); return heads(() => play(mk({ hand0: [c], a1: hax({ energyAttached: many(ID.W, 1) }) }), c).played); });
  T('CH_ctl', () => { const c = inst(ID.crush); const h = hax({ energyAttached: many(ID.W, 1) }); const f = inst(ID.filler, { energyAttached: many(ID.W, 1) });
    const r = heads(() => play(mk({ hand0: [c], a1: h, b1: [f] }), c));
    const v = r.st.pendingSelection?.params?.validIids ?? null;
    return { played: r.played, hasHax: !!v && v.includes(h.iid), hasF: !!v && v.includes(f.iid) }; });
  // ── 悠哉尾草棒（後攻第一回合）──
  T('LT', () => { const c = inst(ID.lazy); return play(mk({ hand0: [c], a1: hax({ energyAttached: many(ID.W, 1) }), turn: 1, firstPlayerIdx: 1 }), c).played; });
  T('LT_ctl', () => { const c = inst(ID.lazy); return play(mk({ hand0: [c], a1: inst(ID.filler, { energyAttached: many(ID.W, 1) }), turn: 1, firstPlayerIdx: 1 }), c).played; });
  // ── 火箭隊的驚嚇炸彈 ──
  T('SB', () => { const c = inst(ID.scare); const h = hax(); const r = heads(() => play(mk({ hand0: [c], a1: h }), c));
    let s = r.st; const ps = s.pendingSelection;
    if (ps) s = act(s, { type: 'RESOLVE_SELECTION', effectKey: ps.effectKey, selectedIids: [h.iid], actorIdx: 0, pendingToken: ps.token });
    return { haxDmg: s.players[1].active?.damage }; });
  T('SB_ctl', () => { const c = inst(ID.scare); const h = hax(); const f = inst(ID.filler); const r = heads(() => play(mk({ hand0: [c], a1: h, b1: [f] }), c));
    const v = r.st.pendingSelection?.params?.validIids ?? null;
    let s = r.st; const ps = s.pendingSelection;
    if (ps) s = act(s, { type: 'RESOLVE_SELECTION', effectKey: ps.effectKey, selectedIids: [f.iid], actorIdx: 0, pendingToken: ps.token });
    return { offered: !!ps, hasHax: !v || v.includes(h.iid), fDmg: s.players[1].bench[0]?.damage }; });
  // 改過的 client 硬送斧牙龍 ⇒ 不放（中央閘＋resolver 雙層）
  T('SB_payload', () => { const c = inst(ID.scare); const h = hax(); const r = heads(() => play(mk({ hand0: [c], a1: h, b1: [inst(ID.filler)] }), c));
    let s = r.st; const ps = s.pendingSelection;
    if (ps) s = act(s, { type: 'RESOLVE_SELECTION', effectKey: ps.effectKey, selectedIids: [h.iid], actorIdx: 0, pendingToken: ps.token });
    return { haxDmg: s.players[1].active?.damage }; });
  // ── 危險光線 ──
  const statuses = (a) => [a?.status, a?.secondaryStatus, a?.tertiaryStatus].filter(Boolean).sort().join(',');
  T('DR', () => { const c = inst(ID.rays); const r = play(mk({ hand0: [c], a1: hax() }), c); return { played: r.played, st: statuses(r.st.players[1].active) }; });
  T('DR_ctl', () => { const c = inst(ID.rays); const r = play(mk({ hand0: [c], a1: inst(ID.filler) }), c); return { st: statuses(r.st.players[1].active) }; });
  // ── 百萬噸吹風機 ──
  T('MB', () => { const c = inst(ID.blower);
    const h = hax({ toolAttached: inst(ID.tool), energyAttached: [inst(ID.special)] }); const f = inst(ID.filler, { toolAttached: inst(ID.tool), energyAttached: [inst(ID.special)] });
    const r = play(mk({ hand0: [c], a1: h, b1: [f] }), c);
    const H = r.st.players[1].active, F = r.st.players[1].bench[0];
    return { haxTool: !!H?.toolAttached, haxSpecial: H?.energyAttached.length, fTool: !!F?.toolAttached, fSpecial: F?.energyAttached.length,
      logged: (r.st.log || []).some((l) => String(l.message ?? l.text ?? l).includes('不受對手物品卡的效果影響')) }; });
  // gate：唯一可丟的在斧牙龍身上、沒有競技場 ⇒ 不能使用（審查 v6.532 P3-1）；有競技場 ⇒ 可以
  T('MB_gate', () => { const c = inst(ID.blower); return play(mk({ hand0: [c], a1: hax({ toolAttached: inst(ID.tool), energyAttached: [inst(ID.special)] }) }), c).played; });
  T('MB_gate_ctl', () => { const c = inst(ID.blower); return play(mk({ hand0: [c], a1: hax({ toolAttached: inst(ID.tool) }), stadium: inst(ID.stadium) }), c).played; });
  // ── 高溫燃燒器 ──
  T('HB', () => { const c = inst(ID.burner); const h = hax({ toolAttached: inst(ID.tool) }); const f = inst(ID.filler, { toolAttached: inst(ID.tool) });
    const r = play(mk({ hand0: [c, inst(ID.R)], a1: h, b1: [f] }), c);
    const ids = (r.st.pendingSelection?.params?.options ?? []).map((o) => o.id);
    return { hasHax: ids.includes('tool:' + h.iid), hasF: ids.includes('tool:' + f.iid) }; });
  // gate：唯一的道具在斧牙龍身上、沒有競技場 ⇒ 不能使用（否則先丟火能量再「無可丟棄」＝白燒一張卡）
  T('HB_gate', () => { const c = inst(ID.burner); const r = play(mk({ hand0: [c, inst(ID.R)], a1: hax({ toolAttached: inst(ID.tool) }) }), c); return { played: r.played, hand: r.st.players[0].hand.length }; });
  T('HB_gate_ctl', () => { const c = inst(ID.burner); return play(mk({ hand0: [c, inst(ID.R)], a1: hax({ toolAttached: inst(ID.tool) }), stadium: inst(ID.stadium) }), c).played; });
  // ── 霍米加的演奏 ──
  const retreatable = (activeInst, flag) => {
    const s = mk({ a0: activeInst, b0: [inst(ID.filler)], p0extra: { cantRetreatIfPoisonedThisTurn: flag } });
    const t = act(s, { type: 'RETREAT', newActiveIid: s.players[0].bench[0].iid });
    return { canRetreat: M.canRetreat(s, pool), moved: t.players[0].active?.iid !== activeInst.iid };
  };
  T('HM', () => retreatable(hax({ status: 'poisoned', energyAttached: many(ID.W, 2) }), true));
  T('HM_ctl', () => retreatable(inst(ID.filler, { status: 'poisoned', energyAttached: many(ID.W, 4) }), true));
  T('HM_atk', () => retreatable(hax({ status: 'poisoned', energyAttached: many(ID.W, 2) }), 'as-attack-effect'));
  // 同回合先作為招式效果、再從手牌使出 ⇒ 仍是較嚴的 'as-attack-effect'
  T('HM_merge', () => { const c = inst(ID.homika); const s0 = mk({ hand0: [c] });
    const s1 = { ...s0, players: [s0.players[0], { ...s0.players[1], cantRetreatIfPoisonedNextTurn: 'as-attack-effect' }] };
    return play(s1, c).st.players[1].cantRetreatIfPoisonedNextTurn ?? null; });
  T('HM_play', () => { const c = inst(ID.homika); const r = play(mk({ hand0: [c] }), c); return r.st.players[1].cantRetreatIfPoisonedNextTurn ?? null; });
  // 靈怪變化／相仿秀「作為招式的效果」使出 ⇒ 旗標記 'as-attack-effect'（緊張感等免疫不適用）
  T('HM_copy', () => { const fn = M.TRAINER_EFFECTS.get('霍米加的演奏'); const t = M.runAsCopiedSupporterEffect(() => fn(mk({}), 0, pool));
    return t.players[1].cantRetreatIfPoisonedNextTurn ?? null; });
  return out;
}

const judge = (r) => ({
  RT: !!r.RT && r.RT.now === '胖胖哈力' && r.RT.golettDmg === 0,
  RT_ctl: !!r.RT_ctl && r.RT_ctl.now === '布里卡隆' && r.RT_ctl.golettDmg === 60,
  CH: r.CH === false,
  CH_ctl: !!r.CH_ctl && r.CH_ctl.played === true && r.CH_ctl.hasHax === false && r.CH_ctl.hasF === true,
  LT: r.LT === false,
  LT_ctl: r.LT_ctl === true,
  SB: !!r.SB && r.SB.haxDmg === 0,
  SB_payload: !!r.SB_payload && r.SB_payload.haxDmg === 0,
  SB_ctl: !!r.SB_ctl && r.SB_ctl.offered === true && r.SB_ctl.hasHax === false && r.SB_ctl.fDmg === 20,
  DR: !!r.DR && r.DR.st === '',
  DR_ctl: !!r.DR_ctl && r.DR_ctl.st === 'burned,confused',
  MB: !!r.MB && r.MB.haxTool === true && r.MB.haxSpecial === 1 && r.MB.fTool === false && r.MB.fSpecial === 0 && r.MB.logged === true,
  MB_gate: r.MB_gate === false,
  MB_gate_ctl: r.MB_gate_ctl === true,
  HB: !!r.HB && r.HB.hasHax === false && r.HB.hasF === true,
  HB_gate: !!r.HB_gate && r.HB_gate.played === false && r.HB_gate.hand === 2,
  HB_gate_ctl: r.HB_gate_ctl === true,
  HM: !!r.HM && r.HM.canRetreat === true && r.HM.moved === true,
  HM_ctl: !!r.HM_ctl && r.HM_ctl.canRetreat === false && r.HM_ctl.moved === false,
  HM_atk: !!r.HM_atk && r.HM_atk.canRetreat === false && r.HM_atk.moved === false,
  HM_merge: r.HM_merge === 'as-attack-effect',
  HM_play: r.HM_play === true,
  HM_copy: r.HM_copy === 'as-attack-effect',
});
const LABEL = {
  RT: '★★★ 退化光線 × 尖刺盔甲：退化先發生 ⇒ 念力土偶身上 0（官方 Q&A）',
  RT_ctl: '★ 正對照：沒退化 ⇒ 尖刺盔甲照常 60',
  CH: '★★ 粉碎之錘：唯一有能量的是緊張感斧牙龍 ⇒ 不能使用',
  CH_ctl: '★ 粉碎之錘：候選不含斧牙龍、含另一隻',
  LT: '★★ 悠哉尾草棒：唯一有能量的是斧牙龍 ⇒ 不能使用',
  LT_ctl: '★ 正對照：一般寶可夢有能量 ⇒ 可以使用',
  SB: '★★ 驚嚇炸彈：斧牙龍不放指示物',
  SB_payload: '★★ 驚嚇炸彈：硬送斧牙龍 ⇒ 不放',
  SB_ctl: '★ 驚嚇炸彈：候選不含斧牙龍、備戰照放 20',
  DR: '★★ 危險光線：斧牙龍不灼傷不混亂',
  DR_ctl: '★ 正對照：一般寶可夢灼傷＋混亂',
  MB: '★★ 百萬噸吹風機：斧牙龍身上的留著（並 log 說明）、另一隻照丟',
  MB_gate: '★★ 百萬噸吹風機：可丟的只在斧牙龍身上、無競技場 ⇒ 不能使用',
  MB_gate_ctl: '★ 正對照：有競技場 ⇒ 可以使用',
  HB: '★★ 高溫燃燒器：選項不含斧牙龍的道具',
  HB_gate: '★★ 高溫燃燒器：唯一道具在斧牙龍身上、無競技場 ⇒ 不能使用（火能量不會白丟）',
  HB_gate_ctl: '★ 正對照：有競技場 ⇒ 可以使用',
  HM: '★★ 霍米加的演奏：中毒的斧牙龍仍可撤退',
  HM_ctl: '★ 正對照：一般中毒寶可夢不能撤退',
  HM_atk: '★★ 作為招式效果使出（as-attack-effect）⇒ 斧牙龍也不能撤退',
  HM_merge: '★★ 同回合先作為招式效果、再從手牌使出 ⇒ 仍為 as-attack-effect',
  HM_play: '★ 從手牌使出 ⇒ 旗標為 true',
  HM_copy: '★★ 作為招式的效果使出（runAsCopiedSupporterEffect）⇒ 旗標為 as-attack-effect',
};
const NEW = ['RT', 'CH', 'CH_ctl', 'LT', 'SB', 'SB_ctl', 'DR', 'MB', 'HB', 'HM', 'HM_copy', 'MB_gate', 'HB_gate', 'SB_payload', 'HM_merge'];

if (missing.length) { console.log('fixture 卡片缺：' + missing.join(',')); process.exit(1); }
const HM = await load(ROOT);
const H = scenarios(HM), J = judge(H);
for (const k of Object.keys(LABEL)) ok(LABEL[k], J[k], JSON.stringify(H[k]));

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6532b-'));
  try {
    execFileSync('sh', ['-c', `git -C "${ROOT}" archive ${BASE_SHA} src | tar -x -C "${tmp}"`]);
    const BM = await load(tmp);
    const B = scenarios(BM), BJ = judge(B);
    for (const k of Object.keys(LABEL)) {
      if (NEW.includes(k)) ok(`★★★[H] v6.531：${k} 紅`, BJ[k] === false, JSON.stringify(B[k]));
      else ok(`★[H 正對照] v6.531：${k} 綠`, BJ[k] === true, JSON.stringify(B[k]));
    }
  } catch (e) { ok('★★★[H] BASE 可打包', false, e.message.split('\n')[0]); }
  finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
} else shallowSkip('v6532 H', '需要 v6.531 commit');

console.log(`\n=== v6.532 退化後反擊／緊張感（物品・支援者）：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
