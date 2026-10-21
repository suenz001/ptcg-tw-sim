#!/usr/bin/env node
/**
 * v6.528 守衛：官方 Q&A 第二輪比對（A 組）——「效果完全無法執行 ⇒ 不能使用」與妨礙機器人。全部走 applyAction 完整流程。
 *
 * 依據（PTCG_RULES.md 行號）：
 *   大飛翅 L2814／L2816、快節奏 L1891、特殊紅牌 §18.I、危險光線 L1697～L1701、艾莉絲的鬥志 L2089、
 *   琵魯 §17.46.I（L2797～L2810）、火箭隊的妨礙機器人 L2213／L2215。
 * 【H】BASE（v6.527）：每一條「官方說不可以／可以」的斷言逐條紅；正對照兩版都綠。
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
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.527。
const BASE_SHA = '7b508fe2';
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
const withAbility = (cardName, abName) => { for (const c of pool.values()) if (c.name === cardName && (c.abilities || []).some((a) => a.name === abName)) return String(c.id); return null; };
const ID = {
  W: byName('基本【水】能量'), filler: '19178', potion: byName('傷藥'),
  butterfree: withAbility('彩粉蝶', '大飛翅'), squawk: withAbility('狂歡浪舞鴨', '快節奏'),
  redCard: byName('特殊紅牌'), rays: byName('危險光線'), alice: byName('艾莉絲的鬥志'), pirou: byName('琵魯'),
  bot: byName('火箭隊的妨礙機器人'),
};
const missing = Object.entries(ID).filter(([, v]) => !v).map(([k]) => k);

async function load(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6528-'));
  const E = join(tmp, 'e.ts'), S = join(tmp, 's.js'), O = join(tmp, 'o.mjs');
  writeFileSync(S, 'export const base="";');
  const p = (x) => join(srcRoot, x).replace(/\\/g, '/');
  writeFileSync(E, `export { applyAction, createGame, getUsableAbilities } from '${p('src/lib/game/engine')}';\nimport '${p('src/lib/game/effects')}';`);
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
  const mk = ({ a0, hand0 = [], deck0, a1, hand1 = [], deck1, prizes1 }) => {
    const s = M.createGame({ name: 'P1', entries: [{ cardId: ID.filler, count: 1 }] }, { name: 'P2', entries: [{ cardId: ID.filler, count: 1 }] }, pool);
    return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
      setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], log: [], supporterPlayedThisTurn: false,
      players: [
        { ...s.players[0], hand: hand0, deck: deck0 ?? many(ID.W, 10), discard: [], prizes: many(ID.W, 6), bench: [], active: a0 ?? inst(ID.filler) },
        { ...s.players[1], hand: hand1, deck: deck1 ?? many(ID.W, 10), discard: [], prizes: prizes1 ?? many(ID.W, 6), bench: [], active: a1 ?? inst(ID.filler) },
      ] };
  };
  const act = (s, a) => M.applyAction(s, a, pool);
  const listed = (s, iid) => (M.getUsableAbilities(s, pool) || []).some((u) => u.iid === iid);
  // 打出訓練家：回傳「卡有沒有離開手牌」與打出後的盤面
  const play = (s, card) => { const t = act(s, { type: 'PLAY_TRAINER', iid: card.iid }); return { played: !t.players[0].hand.some((c) => c.iid === card.iid), st: t }; };
  const out = {};
  const T = (k, f) => { try { out[k] = f(); } catch (e) { out[k] = 'ERR ' + e.message.split('\n')[0]; } };

  // 大飛翅
  T('BW_opp0', () => { const b = inst(ID.butterfree); const s = mk({ a0: b, hand1: [], deck1: many(ID.W, 5) });
    const u = act(s, { type: 'USE_ABILITY', iid: b.iid, abilityIndex: 0 });
    return { listed: listed(s, b.iid), deckAfter: u.players[1].deck.length, hand1After: u.players[1].hand.length }; });
  T('BW_deck0', () => { const b = inst(ID.butterfree); const s = mk({ a0: b, hand1: many(ID.W, 2), deck1: [] }); return { listed: listed(s, b.iid) }; });
  // 快節奏
  T('QR_6', () => { const d = inst(ID.squawk); const s = mk({ a0: d, hand0: many(ID.W, 6) }); return { listed: listed(s, d.iid) }; });
  T('QR_5', () => { const d = inst(ID.squawk); const s = mk({ a0: d, hand0: many(ID.W, 5) }); return { listed: listed(s, d.iid) }; });
  // 特殊紅牌（對手獎賞 3 張）
  T('RC_opp0', () => { const c = inst(ID.redCard); return play(mk({ hand0: [c], hand1: [], prizes1: many(ID.W, 3) }), c).played; });
  T('RC_opp1', () => { const c = inst(ID.redCard); return play(mk({ hand0: [c], hand1: many(ID.W, 1), prizes1: many(ID.W, 3) }), c).played; });
  // 危險光線
  T('DR_both', () => { const c = inst(ID.rays); return play(mk({ hand0: [c], a1: inst(ID.filler, { status: 'confused', secondaryStatus: 'burned' }) }), c).played; });
  T('DR_sleep', () => { const c = inst(ID.rays); return play(mk({ hand0: [c], a1: inst(ID.filler, { status: 'asleep' }) }), c).played; });
  T('DR_variant', () => { const c = inst(ID.rays); return play(mk({ hand0: [c], a1: inst(ID.filler, { status: 'confused', secondaryStatus: 'burned', confusionSelfDamageCounters: 3 }) }), c).played; });
  // 艾莉絲的鬥志（手牌張數含本卡）
  T('AL_8', () => { const c = inst(ID.alice); return play(mk({ hand0: [c, ...many(ID.potion, 7)] }), c).played; });
  T('AL_7', () => { const c = inst(ID.alice); return play(mk({ hand0: [c, ...many(ID.potion, 6)] }), c).played; });
  // 琵魯
  T('PI_deck0', () => { const c = inst(ID.pirou); return play(mk({ hand0: [c, ...many(ID.potion, 3)], deck0: [] }), c).played; });
  T('PI_7', () => { const c = inst(ID.pirou); const r = play(mk({ hand0: [c, ...many(ID.potion, 6)] }), c);
    const ps = r.st.pendingSelection;
    // 只丟 1 張（改過的 client）⇒ 不可以結算：picker 重開、手牌不抽
    let after1 = null;
    if (ps) {
      const pick = r.st.players[0].hand.slice(0, 1).map((x) => x.iid);
      const t = act(r.st, { type: 'RESOLVE_SELECTION', effectKey: ps.effectKey, selectedIids: pick, actorIdx: 0, pendingToken: ps.token });
      after1 = { reopened: !!t.pendingSelection && t.pendingSelection.effectKey === ps.effectKey, hand: t.players[0].hand.length };
      // 再連送 3 次只丟 1 張 ⇒ 第 4 次起不再重開（比照 RESOLVE_REJECT_STREAK_MAX，任何情況下都不軟鎖）
      let u = t, k = 0;
      while (u.pendingSelection && u.pendingSelection.effectKey === ps.effectKey && k++ < 6) {
        const q = u.pendingSelection;
        u = act(u, { type: 'RESOLVE_SELECTION', effectKey: q.effectKey, selectedIids: u.players[0].hand.slice(0, 1).map((x) => x.iid), actorIdx: 0, pendingToken: q.token });
      }
      after1.closedAfter = k;
    }
    return { played: r.played, minCount: ps && ps.minCount, after1 }; });
  T('PI_5', () => { const c = inst(ID.pirou); const r = play(mk({ hand0: [c, ...many(ID.potion, 4)] }), c);
    const ps = r.st.pendingSelection; return { played: r.played, minCount: ps && ps.minCount }; });
  T('PI_deck1', () => { const c = inst(ID.pirou); const r = play(mk({ hand0: [c, ...many(ID.potion, 3)], deck0: many(ID.W, 1) }), c);
    const ps = r.st.pendingSelection; if (!ps) return { played: r.played };
    const t = act(r.st, { type: 'RESOLVE_SELECTION', effectKey: ps.effectKey, selectedIids: r.st.players[0].hand.map((x) => x.iid), actorIdx: 0, pendingToken: ps.token });
    return { played: r.played, hand: t.players[0].hand.length, deck: t.players[0].deck.length }; });
  // 火箭隊的妨礙機器人
  T('BOT_hand0', () => { const c = inst(ID.bot); const r = play(mk({ hand0: [c], hand1: [] }), c);
    return { played: r.played, faceUp: r.st.players[1].prizes.filter((p) => p.faceUp).length, pending: !!r.st.pendingSelection }; });
  T('BOT_allFaceUp', () => { const c = inst(ID.bot); const r = play(mk({ hand0: [c], hand1: many(ID.W, 2), prizes1: many(ID.W, 3).map((p) => ({ ...p, faceUp: true })) }), c);
    return { played: r.played, pending: !!r.st.pendingSelection }; });
  T('BOT_partial', () => { // 6 張裡 5 張已正面 ⇒ 一定挑到唯一反面那張
    const pr = many(ID.W, 6).map((p, i) => (i === 3 ? p : { ...p, faceUp: true }));
    // Math.random 固定 0 ⇒ 舊版「從全部獎賞隨機」必定挑到第 0 張（正面）＝確定性紅；新版只從反面那張挑
    const c = inst(ID.bot); const old = Math.random; Math.random = () => 0;
    let r; try { r = play(mk({ hand0: [c], hand1: many(ID.W, 2), prizes1: pr }), c); } finally { Math.random = old; }
    const ps = r.st.pendingSelection;
    return { played: r.played, pickedFaceDown: !!ps && ps.params?.prizeIid === pr[3].iid }; });
  T('BOT_ctl', () => { const c = inst(ID.bot); const r = play(mk({ hand0: [c], hand1: many(ID.W, 2) }), c); return { played: r.played, pending: !!r.st.pendingSelection }; });
  T('BOT_none', () => { const c = inst(ID.bot); return play(mk({ hand0: [c], hand1: [], prizes1: many(ID.W, 2).map((p) => ({ ...p, faceUp: true })) }), c).played; });
  return out;
}

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const judge = (r) => ({
  BW_opp0: !!r.BW_opp0 && r.BW_opp0.listed === false && r.BW_opp0.deckAfter === 5,
  BW_deck0: !!r.BW_deck0 && r.BW_deck0.listed === true,
  QR_6: !!r.QR_6 && r.QR_6.listed === false,
  QR_5: !!r.QR_5 && r.QR_5.listed === true,
  RC_opp0: r.RC_opp0 === false,
  RC_opp1: r.RC_opp1 === true,
  DR_both: r.DR_both === false,
  DR_sleep: r.DR_sleep === true,
  DR_variant: r.DR_variant === true,
  AL_8: r.AL_8 === false,
  AL_7: r.AL_7 === true,
  PI_deck0: r.PI_deck0 === false,
  PI_7: !!r.PI_7 && r.PI_7.played === true && r.PI_7.minCount === 2 && !!r.PI_7.after1 && r.PI_7.after1.reopened === true && r.PI_7.after1.hand === 6 && r.PI_7.after1.closedAfter === 3,
  PI_5: !!r.PI_5 && r.PI_5.played === true && r.PI_5.minCount === 0,
  PI_deck1: !!r.PI_deck1 && r.PI_deck1.played === true && r.PI_deck1.hand === 1 && r.PI_deck1.deck === 0,
  BOT_hand0: !!r.BOT_hand0 && r.BOT_hand0.played === true && r.BOT_hand0.faceUp === 1 && r.BOT_hand0.pending === false,
  BOT_allFaceUp: !!r.BOT_allFaceUp && r.BOT_allFaceUp.played === true && r.BOT_allFaceUp.pending === false,
  BOT_partial: !!r.BOT_partial && r.BOT_partial.played === true && r.BOT_partial.pickedFaceDown === true,
  BOT_ctl: !!r.BOT_ctl && r.BOT_ctl.played === true && r.BOT_ctl.pending === true,
  BOT_none: r.BOT_none === false,
});
const LABEL = {
  BW_opp0: '★★★ 大飛翅：對手手牌 0 張 ⇒ 不能用（L2816）', BW_deck0: '★ 大飛翅正對照：對手牌庫 0、手牌 2 ⇒ 可以（L2814）',
  QR_6: '★★★ 快節奏：手牌 6 張 ⇒ 不能用（L1891）', QR_5: '★ 快節奏正對照：手牌 5 張 ⇒ 可以',
  RC_opp0: '★★★ 特殊紅牌：對手手牌 0 張 ⇒ 不能打出（§18.I）', RC_opp1: '★ 特殊紅牌正對照：對手手牌 1 張 ⇒ 可以',
  DR_both: '★★★ 危險光線：對手已灼傷＋混亂 ⇒ 不能打出（L1699）', DR_sleep: '★ 危險光線正對照：睡眠 ⇒ 可以（L1701）',
  DR_variant: '★ 危險光線：混亂是放 3 個指示物的變體 ⇒ 可以（L1697）',
  AL_8: '★★★ 艾莉絲的鬥志：含本卡 8 張 ⇒ 不能打出（L2089）', AL_7: '★ 艾莉絲的鬥志正對照：含本卡 7 張 ⇒ 可以',
  PI_deck0: '★★★ 琵魯：牌庫 0 張 ⇒ 不能打出（L2810）',
  PI_7: '★★★ 琵魯：含本卡 7 張 ⇒ 至少丟 2 張；只送 1 張 ⇒ 重開選擇視窗、什麼都沒丟（L2797）；連續不夠 3 次後不再重開（不軟鎖）',
  PI_5: '★ 琵魯正對照：含本卡 5 張 ⇒ 可不丟（L2799）', PI_deck1: '★ 琵魯：牌庫 1 張 ⇒ 丟光再抽 1 張（L2807）',
  BOT_hand0: '★★★ 妨礙機器人：對手手牌 0 ⇒ 可打出、翻 1 張獎賞後結束（L2213）',
  BOT_allFaceUp: '★★★ 妨礙機器人：獎賞全正面 ⇒ 可打出、查看手牌後結束、不問互換（L2215）',
  BOT_partial: '★★★ 妨礙機器人：只從反面朝上的獎賞卡選',
  BOT_ctl: '★ 妨礙機器人正對照：兩邊都有 ⇒ 問要不要互換',
  BOT_none: '★ 妨礙機器人：獎賞全正面且對手手牌 0 ⇒ 不能打出（完全沒效果）',
};
const NEW = ['BW_opp0', 'QR_6', 'RC_opp0', 'DR_both', 'AL_8', 'PI_deck0', 'PI_7', 'BOT_hand0', 'BOT_allFaceUp', 'BOT_partial'];

if (missing.length) { console.log('fixture 卡片缺：' + missing.join(',')); process.exit(1); }
const HM = await load(ROOT);
const H = scenarios(HM), J = judge(H);
for (const k of Object.keys(LABEL)) ok(LABEL[k], J[k], JSON.stringify(H[k]));

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6528b-'));
  try {
    extractBaseArchive(ROOT, BASE_SHA, ["src"], tmp);
    const BM = await load(tmp);
    const B = scenarios(BM), BJ = judge(B);
    for (const k of Object.keys(LABEL)) {
      if (NEW.includes(k)) ok(`★★★[H] v6.527：${k} 紅`, BJ[k] === false, JSON.stringify(B[k]));
      else ok(`★[H 正對照] v6.527：${k} 綠`, BJ[k] === true, JSON.stringify(B[k]));
    }
  } catch (e) { ok('★★★[H] BASE 可打包', false, e.message.split('\n')[0]); }
  finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
} else shallowSkip('v6528 H', '需要 v6.527 commit');

console.log(`\n=== v6.528 官方判例 A 組（不能使用條件）：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
