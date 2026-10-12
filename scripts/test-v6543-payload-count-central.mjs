#!/usr/bin/env node
/**
 * v6.543 守衛（小問題批次：選擇視窗的張數與範圍改由中央驗證）：
 *   高級球少丟／空選／重複／外來 iid ⇒ 不執行、視窗留著；杜若選上方 7 張以外 ⇒ 不拿、不複製；
 *   奇異駭入少放 ⇒ 退回、多放 ⇒ 夾回 5 個；吃飽先送 2 張 ⇒ 只附 1 張；18 種 TOP filter 全部由中央求值器判定。
 * 【H】BASE（v6.542）：NEW 全紅、正對照綠。
 */
import { readFileSync, readdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.542。
const BASE_SHA = '67880226';
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
const ID = { filler: '19178', W: byName('基本【水】能量'), PSY: byName('基本【超】能量'), sw: byName('寶可夢交替'),
  ub: '15964', tora: '17174', big: '14425', abra: '10463', snor: '17038' };
const missing = Object.entries(ID).filter(([, v]) => !v || !pool.get(v)).map(([k]) => k);

async function load(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6543-'));
  const E = join(tmp, 'e.ts'), S = join(tmp, 's.js'), O = join(tmp, 'o.mjs');
  writeFileSync(S, 'export const base="";');
  const p = (x) => join(srcRoot, x).replace(/\\/g, '/');
  writeFileSync(E, `export { applyAction, createGame } from '${p('src/lib/game/engine')}';\nexport { evaluateSelectionFilter, isKnownSelectionFilter } from '${p('src/lib/game/selection-filter')}';\nexport { RESOLVERS } from '${p('src/lib/game/effects/_shared')}';\nexport { getAIAction } from '${p('src/lib/game/ai')}';\nimport '${p('src/lib/game/effects')}';`);
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
  const mk = (p0 = {}, p1 = {}) => {
    const s = M.createGame({ name: 'P1', entries: [{ cardId: ID.filler, count: 1 }] }, { name: 'P2', entries: [{ cardId: ID.filler, count: 1 }] }, pool);
    return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
      setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], log: [],
      players: [
        { ...s.players[0], hand: [], deck: many(ID.W, 10), discard: [], prizes: many(ID.W, 6), bench: [inst(ID.filler)], active: inst(ID.filler), ...p0 },
        { ...s.players[1], hand: [], deck: many(ID.W, 10), discard: [], prizes: many(ID.W, 6), bench: [inst(ID.filler)], active: inst(ID.filler), ...p1 },
      ] };
  };
  const act = (s, a) => M.applyAction(s, a, pool);
  const res = (s, ids) => act(s, { type: 'RESOLVE_SELECTION', effectKey: s.pendingSelection.effectKey, selectedIids: ids, actorIdx: 0, senderIdx: 0, pendingToken: s.pendingSelection.token });
  const key = (s) => s.pendingSelection?.effectKey ?? null;
  const out = {};
  const T = (k, f) => { try { out[k] = f(); } catch (e) { out[k] = 'ERR ' + e.message.split('\n')[0]; } };
  // ── 高級球（卡面：必須將自己的 2 張手牌丟棄才可使用）
  const ub = (pick) => {
    const hand = [inst(ID.ub), inst(ID.W), inst(ID.W), inst(ID.W)];
    let s = act(mk({ hand, deck: [inst(ID.filler), ...many(ID.W, 5)] }), { type: 'PLAY_TRAINER', iid: hand[0].iid });
    const k1 = key(s);
    s = res(s, pick(s));
    return { k1, k2: key(s), hand: s.players[0].hand.length, discard: s.players[0].discard.length };
  };
  T('UB_OK', () => ub((s) => s.players[0].hand.slice(0, 2).map((c) => c.iid)));
  T('UB_SHORT', () => ub((s) => [s.players[0].hand[0].iid]));
  T('UB_EMPTY', () => ub(() => []));
  T('UB_DUP', () => ub((s) => [s.players[0].hand[0].iid, s.players[0].hand[0].iid]));
  T('UB_FOREIGN', () => ub((s) => s.players[0].deck.slice(0, 2).map((c) => c.iid)));
  // ── 杜若（上方 7 張：filler(寶)、交替(訓)、水×5；第 8 張起：BIG(寶)、交替(訓)）
  const tora = (p1, p2) => {
    const deck = [inst(ID.filler), inst(ID.sw), ...many(ID.W, 5), inst(ID.big), inst(ID.sw)];
    let s = mk({ hand: [inst(ID.tora)], deck });
    s = act(s, { type: 'PLAY_TRAINER', iid: s.players[0].hand[0].iid });
    s = res(s, p1(deck));
    if (key(s) === 'tora-trainer') s = res(s, p2(deck));
    const ids = [...s.players[0].hand, ...s.players[0].deck].map((c) => c.iid);
    return { hand: s.players[0].hand.map((c) => c.cardId), total: ids.length, uniq: new Set(ids).size, big: s.players[0].hand.some((c) => c.cardId === ID.big) };
  };
  T('TORA_OK', () => tora((d) => [d[0].iid], (d) => [d[1].iid]));
  T('TORA_OUT_TRAINER', () => tora(() => [], (d) => [d[8].iid]));
  // 杜若 resolver 自保（中央消毒閘之外的第二層）：直接呼叫 resolver、送上方 7 張以外的訓練家 ⇒ 不拿、不複製
  T('TORA_RESOLVER_DIRECT', () => {
    const deck = [inst(ID.filler), inst(ID.sw), ...many(ID.W, 5), inst(ID.big), inst(ID.sw)];
    const s0 = mk({ deck });
    const s = M.RESOLVERS.get('tora-trainer')(s0, 0, [deck[8].iid], { topIids: deck.slice(0, 7).map((c) => c.iid) }, pool);
    const ids = [...s.players[0].hand, ...s.players[0].deck].map((c) => c.iid);
    return { hand: s.players[0].hand.length, total: ids.length, uniq: new Set(ids).size };
  });
  // 正對照（逃生口）：候選不足 minCount（手牌只剩 1 張）⇒ 少選閘放行，不可以把玩家卡死
  T('UB_FEW_ESCAPE', () => {
    const one = inst(ID.W);
    const s0 = { ...mk({ hand: [one], deck: [inst(ID.filler), ...many(ID.W, 5)] }), pendingSelection: { type: 'hand-discard', actorIdx: 0, sourcePlayerIdx: 0, minCount: 2, maxCount: 2, effectKey: 'ultra-ball-discard', filter: 'Pokemon', params: {}, token: 7 } };
    const s = act(s0, { type: 'RESOLVE_SELECTION', effectKey: 'ultra-ball-discard', selectedIids: [one.iid], actorIdx: 0, senderIdx: 0, pendingToken: 7 });
    return { k2: key(s), handHasOne: s.players[0].hand.some((c) => c.iid === one.iid) };
  });
  // AI（審查 P3-1）：卡面要放滿 6 個、對手備戰只剩 1 隻剩餘 HP 30 ⇒ AI 仍送滿 6 個（否則少選閘退回 3 次）；min 0（可少放）時不補
  const aiDist = (min) => {
    const b = inst(ID.big, { damage: (pool.get(ID.big).hp ?? 0) - 30 });
    const s0 = { ...mk({}, { bench: [b] }), pendingSelection: { type: 'damage-distribute', actorIdx: 0, sourcePlayerIdx: 1, minCount: min, maxCount: 6, effectKey: 'dragapult-snipe',
      params: { totalCounters: 6, placedCounters: 0, counterDamage: 10, validIids: [b.iid] }, token: 3 } };
    const a = M.getAIAction(s0, pool, 0);
    return { n: (a?.selectedIids ?? []).length, allB: (a?.selectedIids ?? []).every((x) => x === b.iid) };
  };
  T('AI_PAD', () => aiDist(6));
  T('AI_NO_PAD_OPTIONAL', () => aiDist(0));
  T('TORA_OUT_POKE', () => tora((d) => [d[7].iid], () => []));
  // ── 胡地｜奇異駭入（抽走 5 個 ⇒ 必須放回 5 個）
  const abra = (place) => {
    const a = inst(ID.big, { damage: 30 }), b = inst(ID.big, { damage: 20 });
    const atk = pool.get(ID.abra).attacks.findIndex((x) => x.name === '奇異駭入');
    let s = act(mk({ active: inst(ID.abra, { energyAttached: [inst(ID.PSY)] }) }, { active: a, bench: [b] }), { type: 'ATTACK', attackIndex: atk });
    s = res(s, [a.iid, a.iid, a.iid, b.iid, b.iid]);
    const k1 = key(s);
    s = res(s, place(a, b));
    return { k1, k2: key(s), total: (s.players[1].active?.damage ?? 0) + s.players[1].bench.reduce((t, x) => t + (x.damage ?? 0), 0) };
  };
  T('ABRA_OK', () => abra((a, b) => [a.iid, a.iid, b.iid, b.iid, b.iid]));
  T('ABRA_SHORT', () => abra((a, b) => [a.iid, b.iid]));
  T('ABRA_OVER', () => abra((_a, b) => Array(9).fill(b.iid)));
  // ── 卡比獸｜吃飽先（「從自己的手牌選擇 1 張能量卡」）：改過的 client 送 2 張 ⇒ 只附 1 張
  T('SNOR_2', () => {
    const sn = inst(ID.snor, { damage: 40, energyAttached: [inst(ID.W)] });
    let s = act(mk({ active: sn, hand: [inst(ID.W), inst(ID.W)] }), { type: 'ATTACK', attackIndex: pool.get(ID.snor).attacks.findIndex((x) => x.name === '吃飽先') });
    const k1 = key(s);
    s = res(s, s.players[0].hand.map((c) => c.iid));
    return { k1, energy: s.players[0].active.energyAttached.length, hand: s.players[0].hand.length };
  });
  // ── 中央 TOP filter：黑暗球（Pokemon:TOP7）／杜若（Trainer:TOP_N）等全部由中央求值器判定（AI 原本漏 TOP7／TOP9）
  T('TOP_CENTRAL', () => {
    const TOPS = ['TOP2', 'TOP4', 'TOP6', 'TOP8', 'Supporter:TOP4', 'Supporter:TOP6', 'Supporter:TOP7', 'Pokemon:TOP7', 'Pokemon:TOP9', 'Basic:TOP5',
      'GrassBasicOrGrassEnergy:TOP7', 'Basic:TOP_N', 'Energy:TOP_N', 'BasicEnergy:TOP_N', 'Pokemon:TOP_N', 'Trainer:TOP_N', 'DarknessPokemon:TOP7', 'BasicMetalEnergy:TOP4'];
    const known = TOPS.filter((f) => M.isKnownSelectionFilter('deck-search', f)).length;
    const pk = pool.get(ID.big), tr = pool.get(ID.sw);
    const ev = (f, card, key, inTop) => M.evaluateSelectionFilter('deck-search', f, { iid: 'x' }, card, { params: { [key]: inTop ? ['x'] : ['y'] } });
    return { known, total: TOPS.length,
      top7In: ev('Pokemon:TOP7', pk, 'top7Iids', true), top7Out: ev('Pokemon:TOP7', pk, 'top7Iids', false),
      top9In: ev('Pokemon:TOP9', pk, 'top9Iids', true), trIn: ev('Trainer:TOP_N', tr, 'topIids', true), trOut: ev('Trainer:TOP_N', tr, 'topIids', false),
      trPk: ev('Trainer:TOP_N', pk, 'topIids', true) };
  });
  return out;
}

const judge = (r) => ({
  UB_OK: !!r.UB_OK && r.UB_OK.k1 === 'ultra-ball-discard' && r.UB_OK.k2 !== 'ultra-ball-discard' && r.UB_OK.discard === 3,
  UB_SHORT: !!r.UB_SHORT && r.UB_SHORT.k2 === 'ultra-ball-discard' && r.UB_SHORT.discard === 1 && r.UB_SHORT.hand === 3,
  UB_EMPTY: !!r.UB_EMPTY && r.UB_EMPTY.k2 === 'ultra-ball-discard' && r.UB_EMPTY.discard === 1 && r.UB_EMPTY.hand === 3,
  UB_DUP: !!r.UB_DUP && r.UB_DUP.k2 === 'ultra-ball-discard' && r.UB_DUP.discard === 1 && r.UB_DUP.hand === 3,
  UB_FOREIGN: !!r.UB_FOREIGN && r.UB_FOREIGN.k2 === 'ultra-ball-discard' && r.UB_FOREIGN.discard === 1 && r.UB_FOREIGN.hand === 3,
  TORA_OK: !!r.TORA_OK && r.TORA_OK.hand.length === 2 && r.TORA_OK.total === r.TORA_OK.uniq && r.TORA_OK.total === 9,
  TORA_OUT_TRAINER: !!r.TORA_OUT_TRAINER && r.TORA_OUT_TRAINER.hand.length === 0 && r.TORA_OUT_TRAINER.total === 9 && r.TORA_OUT_TRAINER.uniq === 9,
  TORA_RESOLVER_DIRECT: !!r.TORA_RESOLVER_DIRECT && r.TORA_RESOLVER_DIRECT.hand === 0 && r.TORA_RESOLVER_DIRECT.total === 9 && r.TORA_RESOLVER_DIRECT.uniq === 9,
  UB_FEW_ESCAPE: !!r.UB_FEW_ESCAPE && r.UB_FEW_ESCAPE.k2 !== 'ultra-ball-discard' && !r.UB_FEW_ESCAPE.handHasOne,
  AI_PAD: !!r.AI_PAD && r.AI_PAD.n === 6 && r.AI_PAD.allB,
  AI_NO_PAD_OPTIONAL: !!r.AI_NO_PAD_OPTIONAL && r.AI_NO_PAD_OPTIONAL.n === 3,
  TORA_OUT_POKE: !!r.TORA_OUT_POKE && !r.TORA_OUT_POKE.big && r.TORA_OUT_POKE.total === 9,
  ABRA_OK: !!r.ABRA_OK && r.ABRA_OK.k1 === 'abra-hack-place' && r.ABRA_OK.total === 50,
  ABRA_SHORT: !!r.ABRA_SHORT && r.ABRA_SHORT.k2 === 'abra-hack-place',
  ABRA_OVER: !!r.ABRA_OVER && r.ABRA_OVER.k2 === null && r.ABRA_OVER.total === 50,
  SNOR_2: !!r.SNOR_2 && r.SNOR_2.k1 !== null && r.SNOR_2.energy === 2 && r.SNOR_2.hand === 1,
  TOP_CENTRAL: !!r.TOP_CENTRAL && r.TOP_CENTRAL.known === r.TOP_CENTRAL.total && r.TOP_CENTRAL.top7In === true && r.TOP_CENTRAL.top7Out === false
    && r.TOP_CENTRAL.top9In === true && r.TOP_CENTRAL.trIn === true && r.TOP_CENTRAL.trOut === false && r.TOP_CENTRAL.trPk === false,
});
const LABEL = {
  UB_OK: '★ 正對照：高級球丟 2 張 ⇒ 進入牌庫搜尋',
  UB_SHORT: '★★★ 高級球只丟 1 張 ⇒ 不執行、視窗留著（卡面「必須將 2 張手牌丟棄」）',
  UB_EMPTY: '★★★ 高級球送空選擇 ⇒ 不執行、視窗留著',
  UB_DUP: '★★★ 高級球同一張送兩次 ⇒ 去重後只有 1 張 ⇒ 不執行',
  UB_FOREIGN: '★★★ 高級球送不在手牌的 iid ⇒ 不執行（hand-discard 收斂到中央候選）',
  TORA_OK: '★ 正對照：杜若從上方 7 張各拿寶可夢、訓練家 1 張',
  TORA_OUT_TRAINER: '★★★ 杜若訓練家階段選上方 7 張以外的卡 ⇒ 不拿、卡片不會被複製（手牌＋牌庫 iid 不重複）',
  TORA_RESOLVER_DIRECT: '★★★ 杜若 resolver 自保：直接送上方 7 張以外的訓練家 ⇒ 不拿、不複製（中央閘之外的第二層）',
  UB_FEW_ESCAPE: '★ 正對照（逃生口）：手牌不足 minCount ⇒ 少選閘放行、不卡死',
  AI_PAD: '★★ AI：卡面要放滿 6 個、目標只剩 30 HP ⇒ 仍送滿 6 個（審查 P3-1；不靠少選閘退回 3 次）',
  AI_NO_PAD_OPTIONAL: '★ 正對照：minCount 0（可少放）時 AI 不補，維持原策略 3 個',
  TORA_OUT_POKE: '★★★ 杜若寶可夢階段選上方 7 張以外的寶可夢 ⇒ 不拿',
  ABRA_OK: '★ 正對照：奇異駭入抽走 5 個、放回 5 個 ⇒ 總傷害 50',
  ABRA_SHORT: '★★★ 奇異駭入只放回 2 個 ⇒ 不執行、視窗留著（指示物不會消失）',
  ABRA_OVER: '★★★ 奇異駭入送 9 個 ⇒ 夾成 5 個、總傷害仍是 50（不會憑空多出指示物）',
  SNOR_2: '★★★ 吃飽先送 2 張能量 ⇒ 只附 1 張（hand-discard 夾 maxCount）',
  TOP_CENTRAL: '★★★ 18 種牌庫頂 TOP filter 全部由中央求值器判定（含 AI 原本漏掉的 Pokemon:TOP7／TOP9）',
};
const NEW = ['UB_SHORT', 'UB_EMPTY', 'UB_DUP', 'UB_FOREIGN', 'TORA_OUT_TRAINER', 'TORA_RESOLVER_DIRECT', 'TORA_OUT_POKE', 'ABRA_SHORT', 'ABRA_OVER', 'SNOR_2', 'AI_PAD', 'TOP_CENTRAL'];
if (missing.length) { console.log('fixture 卡片缺：' + missing.join(',')); process.exit(1); }
const HM = await load(ROOT);
const H = scenarios(HM), J = judge(H);
for (const k of Object.keys(LABEL)) ok(LABEL[k], J[k], JSON.stringify(H[k]));

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6543b-'));
  try {
    execFileSync('sh', ['-c', `git -C "${ROOT}" archive ${BASE_SHA} src | tar -x -C "${tmp}"`]);
    const BM = await load(tmp);
    const B = scenarios(BM), BJ = judge(B);
    for (const k of Object.keys(LABEL)) {
      if (NEW.includes(k)) ok(`★★★[H] v6.542：${k} 紅`, BJ[k] === false, JSON.stringify(B[k]));
      else ok(`★[H 正對照] v6.542：${k} 綠`, BJ[k] === true, JSON.stringify(B[k]));
    }
  } catch (e) { ok('★★★[H] BASE 可打包', false, e.message.split('\n')[0]); }
  finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
} else shallowSkip('v6543 H', '需要 v6.542 commit');

console.log(`\n=== v6.543 選擇視窗張數／範圍的中央驗證：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
