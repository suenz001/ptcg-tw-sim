#!/usr/bin/env node
/**
 * v6.554 守衛（站長 2026-10-12 17:29：「丟棄牌到棄牌區時，都應該要顯示在對戰log（例如使用高級球）」；玩家回報探險家的嚮導）：
 *   中央出口 v6554-discard-announce：整串動作結束時，這一串 log 沒說到的棄牌補一行「🗑 棄牌區：…」；
 *   能量鏈暫放棄牌區不誤報、昏厥時身上的卡不重複列、已經寫過的（高級球）不重複寫。
 * 【H】BASE（v6.553）：NEW 紅、正對照綠。
 */
import { extractBaseArchive, linkBaseModules } from './lib/base-archive.mjs';
import { readFileSync, readdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠⚠ BASE_SHA 必須是「留在 main 上的那一顆」（IRON_RULES Rule 45）：v6.553。
const BASE_SHA = '4d70c6b2';
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
const ID = { filler: '19178', W: byName('基本【水】能量'), F: byName('基本【火】能量'), explorer: '17188', ultra: '15964',
  garden: '14083', tower: '15970', burn: '13443', flareon: '16565', ironThorns: '10226', achroma: '11687',
  L: byName('基本【雷】能量'), future: [...pool.values()].filter((c) => c.tags?.includes('未來') && c.supertype !== 'Energy' && HIJ(c)).slice(0, 2).map((c) => String(c.id)) };
const missing = Object.entries(ID).filter(([k, v]) => k === 'future' ? v.length < 2 : (!v || !pool.get(String(v)))).map(([k]) => k);

async function load(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6554-'));
  const E = join(tmp, 'e.ts'), S = join(tmp, 's.js'), O = join(tmp, 'o.mjs');
  writeFileSync(S, 'export const base="";');
  const p = (x) => join(srcRoot, x).replace(/\\/g, '/');
  writeFileSync(E, `export * as ENG from '${p('src/lib/game/engine')}';\nexport { applyAction, createGame } from '${p('src/lib/game/engine')}';\nimport '${p('src/lib/game/effects')}';`);
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
  const mk = (p0 = {}, p1 = {}, top = {}) => {
    const s0 = M.createGame({ name: 'P1', entries: [{ cardId: ID.filler, count: 1 }] }, { name: 'P2', entries: [{ cardId: ID.filler, count: 1 }] }, pool);
    return { ...s0, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], log: [], ...top,
      players: [
        { ...s0.players[0], hand: [], deck: many(ID.W, 10), discard: [], prizes: many(ID.W, 6), bench: [inst(ID.filler)], active: inst(ID.filler), ...p0 },
        { ...s0.players[1], hand: [], deck: many(ID.W, 10), discard: [], prizes: many(ID.W, 6), bench: [inst(ID.filler)], active: inst(ID.filler), ...p1 },
      ] };
  };
  const act = (s, a) => M.applyAction(s, a, pool);
  const res = (s, ids) => act(s, { type: 'RESOLVE_SELECTION', effectKey: s.pendingSelection.effectKey, selectedIids: ids, actorIdx: s.pendingSelection.actorIdx, senderIdx: s.pendingSelection.actorIdx, pendingToken: s.pendingSelection.token });
  const msgs = (s) => s.log.map((l) => (typeof l === 'string' ? l : l.message ?? ''));
  const trash = (s) => msgs(s).filter((m) => m.startsWith('🗑'));
  const out = {};
  const T = (k, f) => { try { out[k] = f(); } catch (e) { out[k] = 'ERR ' + e.message.split('\n')[0]; } };
  // ① 探險家的嚮導：牌庫頂 6 張（各不相同的 iid），選 2 張 ⇒ 其餘 4 張要寫進對戰紀錄
  T('EXPLORER', () => {
    const top = many(ID.W, 6); const card = inst(ID.explorer);
    let s = act(mk({ hand: [card], deck: [...top, ...many(ID.W, 4)] }), { type: 'PLAY_TRAINER', iid: card.iid, actorIdx: 0 });
    if (s.pendingSelection?.effectKey !== 'explorer-guide') return { key: s.pendingSelection?.effectKey ?? null };
    s = res(s, [top[0].iid, top[1].iid]);
    const t = trash(s);
    return { lines: t.length, listed: top.slice(2).every((c) => (t[0] ?? '').includes(c.iid)), notChosen: !(t[0] ?? '').includes(top[0].iid), selfListed: (t[0] ?? '').includes(card.iid) };
  });
  // ② 高級球：自己就寫了丟棄的卡 ⇒ 不重複寫
  T('ULTRA_NO_DUP', () => {
    const card = inst(ID.ultra); const d1 = inst(ID.F), d2 = inst(ID.F);
    let s = act(mk({ hand: [card, d1, d2] }), { type: 'PLAY_TRAINER', iid: card.iid, actorIdx: 0 });
    if (s.pendingSelection?.effectKey !== 'ultra-ball-discard') return { key: s.pendingSelection?.effectKey ?? null };
    s = res(s, [d1.iid, d2.iid]);
    let g = 0; while (s.pendingSelection && g++ < 3) s = res(s, []);
    return { inDiscard: s.players[0].discard.filter((c) => c.iid === d1.iid || c.iid === d2.iid).length, lines: trash(s).length,
      mentioned: msgs(s).join('\n').includes('基本【火】能量') };
  });
  // ③ 換掉競技場 ⇒ 被換掉的競技場進棄牌區要寫
  T('STADIUM_REPLACE', () => {
    const old = inst(ID.garden); const nw = inst(ID.tower);
    const s = act(mk({ hand: [nw] }, {}, { activeStadium: old, stadiumOwnerIdx: 1 }), { type: 'PLAY_TRAINER', iid: nw.iid, actorIdx: 0 });
    const t = trash(s);
    return { gardenInDiscard: s.players.some((p) => p.discard.some((c) => c.iid === old.iid)), lines: t.length, listed: t.some((m) => m.includes(old.iid)) };
  });
  // ④ 撤退費丟的能量要寫
  T('RETREAT_COST', () => {
    const e = inst(ID.W); const a = inst(ID.filler, { energyAttached: [e] }); const b = inst(ID.filler);
    const rc = (pool.get(ID.filler).retreatCost ?? []).length;
    const s = act(mk({ active: a, bench: [b] }), { type: 'RETREAT', newActiveIid: b.iid, discardedEnergyIids: rc > 0 ? [e.iid] : [] });
    return { rc, paid: s.players[0].discard.some((c) => c.iid === e.iid), listed: trash(s).some((m) => m.includes(e.iid)) };
  });
  // ⑤ 正對照：能量鏈暫放棄牌區再附上（火伊布ex｜燃燒充能）⇒ 不可以誤報成丟棄
  T('CHAIN_NO_FALSE', () => {
    const fl = inst(ID.flareon, { energyAttached: many(ID.F, 2) });
    let s = act(mk({ active: fl, deck: [...many(ID.F, 3), ...many(ID.W, 5)] }), { type: 'ATTACK', attackIndex: 0 });
    let g = 0; while (s.pendingSelection && g++ < 6) { const ps = s.pendingSelection; const v = ps.params?.validIids ?? s.players[0].deck.filter((c) => c.cardId === ID.F).map((c) => c.iid);
      s = res(s, ps.type === 'deck-search' ? v.slice(0, 2) : [fl.iid]); }
    return { lines: trash(s).length, attached: (s.players[0].active?.energyAttached.length ?? 0) };
  });
  // ⑥ 正對照：一般動作沒有棄牌 ⇒ 不寫
  T('NO_DISCARD', () => { const e = inst(ID.W); const s = act(mk({ hand: [e] }), { type: 'ATTACH_ENERGY', energyIid: e.iid, targetIid: 'x' }); return { lines: trash(s).length }; });
  // ⑦ 燃火能量回合結束丟棄：當場寫（在寶可夢檢查的中毒之前）
  T('BURN_SOUL', () => {
    const b = inst(ID.burn); const a = inst(ID.filler, { energyAttached: [b], status: 'poisoned' });
    const s = act(mk({ active: a }), { type: 'END_TURN' });
    const m = msgs(s); const iBurn = m.findIndex((x) => x.startsWith('燃火能量：') && x.includes(b.iid)); const iPoison = m.findIndex((x) => x.includes('中毒'));
    return { iBurn, iPoison, dup: trash(s).some((x) => x.includes(b.iid)) };
  });
  // ⑧ 正對照：寶可夢昏厥時身上的能量一起進棄牌區 ⇒ 由昏厥的 log 交代，不另外列（對手戰鬥寶可夢中毒昏厥）
  T('KO_NO_ATTACH_LIST', () => {
    const e1 = inst(ID.W), e2 = inst(ID.W); const HP = Number(pool.get(ID.filler).hp);
    const o = inst(ID.filler, { damage: HP - 10, status: 'poisoned', energyAttached: [e1, e2] });
    const s = act(mk({}, { active: o }), { type: 'END_TURN' });
    return { ko: s.players[1].discard.some((c) => c.iid === o.iid), energyIn: s.players[1].discard.filter((c) => c.iid === e1.iid || c.iid === e2.iid).length, lines: trash(s).length };
  });
  // ⑨ 審查 P2-1：翻開（公開）後丟棄其中一部分（鐵荊棘｜壞死壓榨）⇒ 翻開那一行有卡名，不算說明了丟棄 ⇒ 要寫
  T('REVEAL_THEN_DISCARD', () => {
    const tt = inst(ID.ironThorns, { energyAttached: many(ID.L, 2) });
    const f1 = inst(ID.future[0]), f2 = inst(ID.future[1]);
    let s = act(mk({ active: tt, deck: [f1, inst(ID.W), f2, inst(ID.W), inst(ID.W), ...many(ID.W, 5)] }, { bench: [inst(ID.filler)] }), { type: 'ATTACK', attackIndex: 0 });
    let g = 0; while (s.pendingSelection && g++ < 4) s = res(s, []);
    const t = trash(s).join('\n');
    return { inDiscard: s.players[0].discard.filter((c) => c.iid === f1.iid || c.iid === f2.iid).length, listed: t.includes(f1.iid) && t.includes(f2.iid) };
  });
  // ⑩ 開視窗那一步就丟的牌（青木的手法：先丟全部手牌，再開搜尋視窗）⇒ 整串結束時要寫
  T('DISCARD_AT_OPEN_STEP', () => {
    const card = inst(ID.achroma); const h1 = inst(ID.garden), h2 = inst(ID.tower);
    let s = act(mk({ hand: [card, h1, h2] }), { type: 'PLAY_TRAINER', iid: card.iid, actorIdx: 0 });
    const opened = !!s.pendingSelection;
    let g = 0; while (s.pendingSelection && g++ < 5) s = res(s, []);
    const t = trash(s).join('\n');
    return { opened, listed: t.includes(h1.iid) && t.includes(h2.iid), selfListed: t.includes(card.iid), watchLeft: s._discardWatch != null };
  });
  // ⑪ 單元（直呼中央出口；BASE 沒有這支 ⇒ 紅）
  const ann = typeof M.ENG?.announceDiscardsV6554 === 'function' ? M.ENG.announceDiscardsV6554 : null;
  const unit = (addedCards, lines) => {
    if (!ann) return 'MISSING';
    const before = mk(); const after = { ...before, players: [{ ...before.players[0], discard: [...addedCards] }, before.players[1]],
      log: [...before.log, ...lines.map((m) => ({ turn: 5, playerIndex: 0, message: m }))] };
    return trash(ann(before, after, pool)).join('\n');
  };
  const LK = (c, n) => `\uE100${c.iid}\uE101${n}\uE102`;
  // 複審 P3-1：同名兩張，一張已用卡名連結寫到、另一張沒寫 ⇒ 沒寫的那張要列
  T('UNIT_LINK_SAME_NAME', () => { const a = inst(ID.W), b = inst(ID.W); const t = unit([a, b], [`效果：丟棄 ${LK(a, '基本【水】能量')}`]);
    return t === 'MISSING' ? t : { a: t.includes(a.iid), b: t.includes(b.iid) }; });
  // 複審 P3-1／P3-2：講棄牌的行只出現「更長的卡名」⇒ 較短卡名的那張要列
  const pair = (() => { for (const c of pool.values()) { if (!HIJ(c) || c.supertype !== 'Pokemon') continue;
    for (const d of pool.values()) if (HIJ(d) && d.name !== c.name && d.name.includes(c.name) && !d.name.startsWith(c.name)) return [c, d]; } return null; })();
  T('UNIT_NAME_BOUNDARY', () => { if (!pair) return 'NOPAIR'; const x = inst(pair[0].id); const t = unit([x], [`效果：丟棄 ${pair[1].name}`]);
    return t === 'MISSING' ? t : { short: pair[0].name, long: pair[1].name, listed: t.includes(x.iid) }; });
  // 複審 P3-2：「從棄牌區取回」的行不算說明了丟棄
  T('UNIT_RETRIEVE_LINE', () => { const w = inst(ID.W); const t = unit([w], ['效果：從棄牌區將 基本【水】能量 加入手牌']);
    return t === 'MISSING' ? t : { listed: t.includes(w.iid) }; });
  // 正對照：講棄牌的行用卡名寫到（無連結）⇒ 不列
  T('UNIT_NAME_ANNOUNCED', () => { const w = inst(ID.W); const t = unit([w], ['效果：丟棄 基本【水】能量']);
    return t === 'MISSING' ? t : { listed: t.includes(w.iid) }; });
  return out;
}

const judge = (r) => ({
  EXPLORER: !!r.EXPLORER && r.EXPLORER.lines === 1 && r.EXPLORER.listed === true && r.EXPLORER.notChosen === true && r.EXPLORER.selfListed === false,
  ULTRA_NO_DUP: !!r.ULTRA_NO_DUP && r.ULTRA_NO_DUP.inDiscard === 2 && r.ULTRA_NO_DUP.lines === 0 && r.ULTRA_NO_DUP.mentioned === true,
  STADIUM_REPLACE: !!r.STADIUM_REPLACE && r.STADIUM_REPLACE.gardenInDiscard === true && r.STADIUM_REPLACE.listed === true,
  RETREAT_COST: !!r.RETREAT_COST && r.RETREAT_COST.rc > 0 && r.RETREAT_COST.paid === true && r.RETREAT_COST.listed === true,
  CHAIN_NO_FALSE: !!r.CHAIN_NO_FALSE && r.CHAIN_NO_FALSE.lines === 0 && r.CHAIN_NO_FALSE.attached === 4,
  NO_DISCARD: !!r.NO_DISCARD && r.NO_DISCARD.lines === 0,
  KO_NO_ATTACH_LIST: !!r.KO_NO_ATTACH_LIST && r.KO_NO_ATTACH_LIST.ko === true && r.KO_NO_ATTACH_LIST.energyIn === 2 && r.KO_NO_ATTACH_LIST.lines === 0,
  REVEAL_THEN_DISCARD: !!r.REVEAL_THEN_DISCARD && r.REVEAL_THEN_DISCARD.inDiscard === 2 && r.REVEAL_THEN_DISCARD.listed === true,
  DISCARD_AT_OPEN_STEP: !!r.DISCARD_AT_OPEN_STEP && r.DISCARD_AT_OPEN_STEP.opened === true && r.DISCARD_AT_OPEN_STEP.listed === true && r.DISCARD_AT_OPEN_STEP.selfListed === false && r.DISCARD_AT_OPEN_STEP.watchLeft === false,
  UNIT_LINK_SAME_NAME: typeof r.UNIT_LINK_SAME_NAME === 'object' && r.UNIT_LINK_SAME_NAME.a === false && r.UNIT_LINK_SAME_NAME.b === true,
  UNIT_NAME_BOUNDARY: typeof r.UNIT_NAME_BOUNDARY === 'object' && r.UNIT_NAME_BOUNDARY.listed === true,
  UNIT_RETRIEVE_LINE: typeof r.UNIT_RETRIEVE_LINE === 'object' && r.UNIT_RETRIEVE_LINE.listed === true,
  UNIT_NAME_ANNOUNCED: typeof r.UNIT_NAME_ANNOUNCED === 'object' && r.UNIT_NAME_ANNOUNCED.listed === false,
  BURN_SOUL: !!r.BURN_SOUL && r.BURN_SOUL.iBurn >= 0 && r.BURN_SOUL.iPoison > r.BURN_SOUL.iBurn && r.BURN_SOUL.dup === false,
});
const LABEL = {
  EXPLORER: '★★★ 探險家的嚮導：其餘 4 張丟棄要寫進對戰紀錄（不含選進手牌的）',
  ULTRA_NO_DUP: '★ 正對照：高級球自己就寫了丟棄的卡 ⇒ 不重複寫',
  STADIUM_REPLACE: '★★★ 競技場被換掉 ⇒ 舊競技場進棄牌區要寫',
  RETREAT_COST: '★★★ 撤退費丟棄的能量要寫',
  CHAIN_NO_FALSE: '★ 正對照：能量鏈暫放棄牌區再附上 ⇒ 不誤報（附上 2 張）',
  NO_DISCARD: '★ 正對照：沒有棄牌的動作不寫',
  KO_NO_ATTACH_LIST: '★ 正對照：昏厥時身上的能量一起進棄牌區 ⇒ 不另外列',
  REVEAL_THEN_DISCARD: '★★★ 翻開後丟棄其中一部分（壞死壓榨）⇒ 翻開那一行的卡名不算說明，丟棄要寫（審查 P2-1）',
  DISCARD_AT_OPEN_STEP: '★★★ 開視窗那一步就丟的手牌（青木的手法）⇒ 整串結束時寫；打出的訓練家本身不列；起點記錄清掉',
  UNIT_LINK_SAME_NAME: '★★★ 同名兩張：一張已用連結寫到，另一張沒寫 ⇒ 沒寫的要列（複審 P3-1）',
  UNIT_NAME_BOUNDARY: '★★★ 講棄牌的行只有更長的卡名（前綴型，例：阿羅拉○○）⇒ 較短卡名那張要列（複審 P3-1／P3-2）',
  UNIT_RETRIEVE_LINE: '★★★「從棄牌區取回」的行不算說明了丟棄（複審 P3-2）',
  UNIT_NAME_ANNOUNCED: '★ 正對照：講棄牌的行用卡名寫到 ⇒ 不重複列（BASE 沒有中央出口，單元無法執行 ⇒ 列入 NEW）',
  BURN_SOUL: '★★★ 燃火能量回合結束丟棄當場寫（在中毒之前），不重複',
};
const NEW = ['EXPLORER', 'STADIUM_REPLACE', 'RETREAT_COST', 'BURN_SOUL', 'REVEAL_THEN_DISCARD', 'DISCARD_AT_OPEN_STEP', 'UNIT_LINK_SAME_NAME', 'UNIT_NAME_BOUNDARY', 'UNIT_RETRIEVE_LINE', 'UNIT_NAME_ANNOUNCED'];
if (missing.length) { console.log('fixture 卡片缺：' + missing.join(',')); process.exit(1); }
const HM = await load(ROOT);
const H = scenarios(HM), J = judge(H);
for (const k of Object.keys(LABEL)) ok(LABEL[k], J[k], JSON.stringify(H[k]));

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6554b-'));
  try {
    extractBaseArchive(ROOT, BASE_SHA, ["src", "scripts", "static/cards"], tmp);
    linkBaseModules(ROOT, tmp);
    const BM = await load(tmp);
    const B = scenarios(BM), BJ = judge(B);
    for (const k of Object.keys(LABEL)) {
      if (NEW.includes(k)) ok(`★★★[H] v6.553：${k} 紅`, BJ[k] === false, JSON.stringify(B[k]));
      else ok(`★[H 正對照] v6.553：${k} 綠`, BJ[k] === true, JSON.stringify(B[k]));
    }
  } catch (e) { ok('★★★[H] BASE 可打包', false, e.message.split('\n')[0]); }
  finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
} else shallowSkip('v6554 H', '需要 v6.553 commit');

console.log(`\n=== v6.554 棄牌一律寫進對戰紀錄：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
