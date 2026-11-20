#!/usr/bin/env node
/**
 * v6.668 守衛：「各選 1 張」多組選擇收斂成同一個視窗（玩家建議：小光不要再逐段選、選過不能改）。
 *
 * 【A】中央判準（selection-filter.ts，實跑）
 *   A1 readSelectionGroups 丟掉格式不對的組、組內不可再是 Groups（防遞迴）
 *   A2 selectionGroupIndex：卡屬於哪一組；組內 filter 沒收錄 ⇒ 不屬於（fail-closed）
 *   A3 sanitizeSelectionSet('Groups')：每組最多 N 張、首見保留、不屬於任何組的濾掉；max 2 時可收 2 張
 *   A4 'Groups'／'Groups:TOP_N' 求值：TOP_N 只認 params.topIids 裡的卡
 *   A5 selectionGroupBlocked：同組選滿 ⇒ 擋；別組 ⇒ 不擋
 *   A6 手牌區（hand-discard）'Groups' 述詞與候選（handDiscardCandidates 有傳 params）
 *   A7 BasicEnergyOf=X：只認基本能量、已收錄
 * 【B】10 張卡完整流程（applyAction／特性函式＋RESOLVE_SELECTION）
 *   B1 七張「從牌庫加入手牌」：只開一個視窗、組別標記照站長指定、各組一張一次送完全部進手牌、公開卡名、選完就結束
 *   B2 同組送兩張 ⇒ 只收第一張（engine 消毒閘）；B3 選 0 張 ⇒ 正常結束、牌庫張數不變
 *   B4 代價先付：秘密箱先丟 3 張、青木先丟光手牌；B5 杜若只認上方 7 張
 *   B6 三張附能：大吾的巨金怪ex／烈焰猴／鴨嘴炎獸 開多組選擇 ⇒ 選完進入逐張選目標的能量鏈；同組兩張只收 1 張
 *   B7 舊的逐段 effectKey 仍註冊（部署當下停在舊 pending 的對局能走完）
 * 【C】AI：小光由 AI 選 ⇒ 每組各 1 張
 * 【D】對戰頁接線（剝註解後）：變暗、點擊防呆、確認鈕判定、卡片組別標籤、組別計數都走中央函式
 * 【H】HEAD-FAIL：BASE（v6.667）上 NEW 各自紅、正對照綠
 */
import { extractBaseArchive } from './lib/base-archive.mjs';
import { readFileSync, readdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';
import { stripCommentsBlankChecked } from './lib/strip-comments.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠ BASE_SHA 必須是留在 main 上的那一顆（IRON_RULES Rule 45）：v6.667。
const BASE_SHA = 'fd0903d4';
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
const find = (pred) => { for (const c of pool.values()) if (HIJ(c) && pred(c)) return String(c.id); return null; };
const byName = (n) => find((c) => c.name === n);
const stg = (c) => c.stage ?? c.subtype;
const ID = {
  koharu: '14424', touko: '14468', aoki: '17166', tora: '17174', box: '10506', akuroma: '10641', lantern: '19614',
  metagross: '15993', monferno: '16576', magmortar: '19532',
  basic: find((c) => c.supertype === 'Pokemon' && !c.evolvesFrom && stg(c) === 'Basic' && !/ex$/.test(c.name)),
  stage1: find((c) => c.supertype === 'Pokemon' && !!c.evolvesFrom && stg(c) === 'Stage1'),
  stage2: find((c) => c.supertype === 'Pokemon' && !!c.evolvesFrom && stg(c) === 'Stage2'),
  item: find((c) => c.supertype === 'Trainer' && c.subtype === 'Item' && c.name !== '秘密箱'),
  tool: find((c) => c.supertype === 'Trainer' && c.subtype === 'PokemonTool'),
  supporter: find((c) => c.supertype === 'Trainer' && c.subtype === 'Supporter'),
  stadium: find((c) => c.supertype === 'Trainer' && c.subtype === 'Stadium'),
  special: find((c) => c.supertype === 'Energy' && c.subtype !== 'Basic'),
  W: byName('基本【水】能量'), F: byName('基本【火】能量'), L: byName('基本【雷】能量'), P: byName('基本【超】能量'),
  M: byName('基本【鋼】能量'), FG: byName('基本【鬥】能量'), eleki: byName('電擊魔獸'),
  nonPM: find((c) => c.supertype === 'Pokemon' && !c.evolvesFrom && stg(c) === 'Basic' && !['Psychic', 'Metal'].includes(c.pokemonType) && !/ex$/.test(c.name)),
};
const missing = Object.entries(ID).filter(([, v]) => !v || !pool.get(v)).map(([k]) => k);

async function load(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6668-'));
  const E = join(tmp, 'e.ts'), S = join(tmp, 's.js'), O = join(tmp, 'o.mjs');
  writeFileSync(S, 'export const base="";');
  const p = (x) => join(srcRoot, x).replace(/\\/g, '/');
  writeFileSync(E, `export { applyAction, createGame, sanitizeSelectedIids, getUsableAbilities } from '${p('src/lib/game/engine')}';\n`
    + `export * from '${p('src/lib/game/selection-filter')}';\n`
    + `export { handDiscardCandidates } from '${p('src/lib/game/selection-candidates')}';\n`
    + `export { RESOLVERS, TRAINER_EFFECTS, getAbilityFn } from '${p('src/lib/game/effects/_shared')}';\n`
    + `export { getAIAction } from '${p('src/lib/game/ai')}';\nimport '${p('src/lib/game/effects')}';`);
  try {
    await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
      alias: { '$lib': join(srcRoot, 'src/lib'), '$app/paths': S }, logLevel: 'silent', nodePaths: [join(ROOT, 'node_modules')] });
    return await import(pathToFileURL(O).href);
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}

// 站長指定的組別標記（「鬥子就要標記【進化】／【能量】…以此類推」）
const DECK_CARDS = [
  { k: 'koharu', name: '小光', labels: ['【基礎】', '【1階進化】', '【2階進化】'], picks: ['basic', 'stage1', 'stage2'] },
  { k: 'touko', name: '鬥子', labels: ['【進化】', '【能量】'], picks: ['stage1', 'W'] },
  { k: 'aoki', name: '青木的手法', labels: ['【寶可夢】', '【支援者】', '【基本能量】'], picks: ['stage2', 'supporter', 'W'] },
  { k: 'box', name: '秘密箱', labels: ['【物品】', '【道具】', '【支援者】', '【競技場】'], picks: ['item', 'tool', 'supporter', 'stadium'] },
  { k: 'akuroma', name: '阿克羅瑪的執著', labels: ['【競技場】', '【能量】'], picks: ['stadium', 'special'] },
  { k: 'lantern', name: '冒險提燈', labels: ['【火】', '【雷】'], picks: ['F', 'L'] },
  { k: 'tora', name: '杜若', labels: ['【寶可夢】', '【訓練家】'], picks: ['basic', 'tool'] },
];

function scenarios(M) {
  let n = 0;
  const inst = (cid, e = {}) => ({ iid: 'i' + (++n), cardId: String(cid), damage: 0, energyAttached: [], ...e });
  const many = (cid, k) => Array.from({ length: k }, () => inst(cid));
  const mk = (p0 = {}) => {
    const s = M.createGame({ name: 'P1', entries: [{ cardId: ID.basic, count: 1 }] }, { name: 'P2', entries: [{ cardId: ID.basic, count: 1 }] }, pool);
    return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
      setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], log: [],
      players: [
        { ...s.players[0], hand: [], deck: many(ID.W, 10), discard: [], prizes: many(ID.W, 6), bench: [inst(ID.basic)], active: inst(ID.basic), ...p0 },
        { ...s.players[1], hand: [], deck: many(ID.W, 10), discard: [], prizes: many(ID.W, 6), bench: [inst(ID.basic)], active: inst(ID.basic) },
      ] };
  };
  const act = (s, a) => M.applyAction(s, a, pool);
  const res = (s, ids) => act(s, { type: 'RESOLVE_SELECTION', effectKey: s.pendingSelection.effectKey, selectedIids: ids, actorIdx: 0, senderIdx: 0, pendingToken: s.pendingSelection.token });
  const F = (name) => (typeof M[name] === 'function' ? M[name] : null);
  const out = {};
  const T = (k, f) => { try { out[k] = f(); } catch (e) { out[k] = 'ERR ' + String(e?.message ?? e).split('\n')[0]; } };
  const card = (id) => pool.get(ID[id] ?? id);
  const G3 = [{ label: '【基礎】', filter: 'Basic' }, { label: '【1階進化】', filter: 'Stage1' }, { label: '【2階進化】', filter: 'Stage2' }];

  // ── A 中央判準
  T('A1', () => {
    const r = F('readSelectionGroups'); if (!r) return 'MISSING';
    const g = r({ groups: [{ label: 'a', filter: 'Basic' }, { label: 'x', filter: 'Groups' }, { label: 'y' }, null, 'z', { label: 'm', filter: 'Energy', max: 2 }] });
    return JSON.stringify(g);
  });
  T('A2', () => {
    const gi = F('selectionGroupIndex'); if (!gi) return 'MISSING';
    return [gi(G3, { iid: 'a' }, card('basic')), gi(G3, { iid: 'b' }, card('stage1')), gi(G3, { iid: 'c' }, card('stage2')), gi(G3, { iid: 'd' }, card('W')),
      gi([{ label: 'q', filter: 'NoSuchFilter' }], { iid: 'e' }, card('basic'))].join(',');
  });
  T('A3', () => {
    const san = M.sanitizeSelectionSet;
    const b1 = inst(ID.basic), b2 = inst(ID.basic), s1 = inst(ID.stage1), w = inst(ID.W), s2 = inst(ID.stage2);
    const one = san('deck-search', 'Groups', [b1, w, b2, s1, s2], pool, { params: { groups: G3 } });
    const two = san('deck-search', 'Groups', [b1, w, b2, s1], pool, { params: { groups: [{ label: 'b', filter: 'Basic', max: 2 }] } });
    const ids = (a) => a.map((x) => [b1, b2, s1, w, s2].findIndex((y) => y.iid === x)).join(',');
    return ids(one) + '|' + ids(two);
  });
  T('A4', () => {
    const ev = M.evaluateSelectionFilter;
    const b = inst(ID.basic), w = inst(ID.W);
    const params = { groups: G3, topIids: [w.iid] };
    const b2 = inst(ID.basic);
    return [ev('deck-search', 'Groups', b, card('basic'), { params }), ev('deck-search', 'Groups', w, card('W'), { params }),
      ev('deck-search', 'Groups:TOP_N', b2, card('basic'), { params: { groups: G3, topIids: [b2.iid] } }),
      ev('deck-search', 'Groups:TOP_N', b, card('basic'), { params: { groups: G3, topIids: [w.iid] } })].join(',');
  });
  T('A5', () => {
    const bl = F('selectionGroupBlocked'); const cnt = F('selectionGroupCounts'); if (!bl || !cnt) return 'MISSING';
    const b1 = inst(ID.basic), b2 = inst(ID.basic), s1 = inst(ID.stage1);
    const counts = cnt(G3, [b1], pool);
    return [counts.join('/'), bl(G3, counts, b2, pool), bl(G3, counts, s1, pool), bl(G3, counts, inst(ID.W), pool)].join(',');
  });
  T('A6', () => {
    const groups = [{ label: '【火】', filter: 'BasicEnergyOf=Fire' }, { label: '【鬥】', filter: 'BasicEnergyOf=Fighting' }];
    const hand = [inst(ID.F), inst(ID.FG), inst(ID.W), inst(ID.basic)];
    const c = M.handDiscardCandidates('Groups', { groups }, hand, pool).map((x) => hand.indexOf(x));
    return c.join(',') + '|' + M.isKnownSelectionFilter('hand-discard', 'Groups');
  });
  T('A7', () => {
    const ev = M.evaluateSelectionFilter;
    return [ev('deck-search', 'BasicEnergyOf=Fire', { iid: 'a' }, card('F'), {}), ev('deck-search', 'BasicEnergyOf=Fire', { iid: 'a' }, card('W'), {}),
      ev('deck-search', 'BasicEnergyOf=Fire', { iid: 'a' }, card('special'), {}), M.isKnownSelectionFilter('deck-search', 'BasicEnergyOf=Fire')].join(',');
  });

  // ── B 完整流程
  const deckTo = (spec, pickIdx, extraHand = []) => {
    const pickInsts = spec.picks.map((k) => inst(ID[k]));
    const fillers = many(ID.W, 3);
    // 杜若：要拿的卡放在上方 7 張內
    const deck = [...pickInsts, ...fillers, ...many(ID.W, 4)];
    const tr = inst(ID[spec.k]);
    const hand = [tr, ...extraHand];
    let s = act(mk({ hand, deck }), { type: 'PLAY_TRAINER', iid: tr.iid });
    return { s, pickInsts, deck, hand };
  };
  for (const spec of DECK_CARDS) {
    T('B1_' + spec.k, () => {
      const extra = spec.k === 'box' ? many(ID.W, 3) : spec.k === 'aoki' ? [inst(ID.basic), inst(ID.W)] : [];
      let { s, pickInsts } = deckTo(spec, 0, extra);
      if (spec.k === 'box') s = res(s, s.players[0].hand.filter((c) => c.cardId === ID.W).slice(0, 3).map((c) => c.iid));
      const p = s.pendingSelection;
      const labels = (p?.params?.groups ?? []).map((g) => g.label).join('／');
      const deckBefore = s.players[0].deck.length;
      const s2 = res(s, [...pickInsts].reverse().map((c) => c.iid));
      const hand = s2.players[0].hand.map((c) => c.iid);
      const logs = (s2.log ?? []).map((l) => l.message ?? l.text ?? String(l)).join(' | ');
      return {
        one: p?.type === 'deck-search' && /^Groups/.test(p?.filter ?? '') && p?.minCount === 0 && p?.maxCount === spec.labels.length,
        labels, all: pickInsts.every((c) => hand.includes(c.iid)), done: !s2.pendingSelection,
        reveal: pickInsts.every((c) => logs.includes(pool.get(c.cardId).name)) && logs.includes('給對手看過'),
        deckOk: s2.players[0].deck.length === deckBefore - pickInsts.length,
      };
    });
  }
  T('B2', () => {
    const spec = DECK_CARDS[0];
    const { s, pickInsts, deck } = deckTo(spec, 0);
    const b2 = deck.find((c) => c.cardId === ID.W);   // 只是佔位
    const extraBasic = inst(ID.basic);
    const st = { ...s, players: [{ ...s.players[0], deck: [...s.players[0].deck, extraBasic] }, s.players[1]] };
    const s2 = res(st, [pickInsts[0].iid, extraBasic.iid, b2.iid]);
    const hand = s2.players[0].hand.map((c) => c.iid);
    return { first: hand.includes(pickInsts[0].iid), second: hand.includes(extraBasic.iid), water: hand.includes(b2.iid), done: !s2.pendingSelection };
  });
  T('B3', () => {
    const { s } = deckTo(DECK_CARDS[1], 0);
    const before = s.players[0].deck.length;
    const s2 = res(s, []);
    return { done: !s2.pendingSelection, deck: s2.players[0].deck.length === before, hand: s2.players[0].hand.length };
  });
  T('B4', () => {
    const box = deckTo(DECK_CARDS[3], 0, many(ID.W, 3));
    const boxFirst = box.s.pendingSelection?.type === 'hand-discard' && box.s.pendingSelection?.minCount === 3;
    const aoki = deckTo(DECK_CARDS[2], 0, [inst(ID.basic), inst(ID.W)]);
    return { boxFirst, aokiHandEmpty: aoki.s.players[0].hand.length === 0, aokiDiscard: aoki.s.players[0].discard.length >= 2, aokiGrouped: /^Groups/.test(aoki.s.pendingSelection?.filter ?? '') };
  });
  T('B5', () => {
    const tr = inst(ID.tora);
    const deck = [...many(ID.W, 7), inst(ID.basic), inst(ID.tool)];
    const s = act(mk({ hand: [tr], deck }), { type: 'PLAY_TRAINER', iid: tr.iid });
    const s2 = res(s, [deck[7].iid, deck[8].iid]);
    const ids = [...s2.players[0].hand, ...s2.players[0].deck].map((c) => c.iid);
    return { filter: s.pendingSelection?.filter, taken: s2.players[0].hand.length, uniq: new Set(ids).size === ids.length, total: ids.length };
  });
  // 附能三張
  T('B6_metagross', () => {
    const self = inst(ID.metagross);
    const fn = M.getAbilityFn('大吾的巨金怪ex', 'X啟動', 0);
    const p1 = inst(ID.P), p2 = inst(ID.P), m1 = inst(ID.M);
    let s = mk({ active: self, deck: [p1, p2, m1, ...many(ID.W, 5)] });
    s = fn(s, 0, pool, self);
    const ps = s.pendingSelection;
    const labels = (ps?.params?.groups ?? []).map((g) => g.label).join('／');
    const s2 = res(s, [p1.iid, p2.iid, m1.iid]);
    const moved = [p1, p2, m1].filter((c) => !s2.players[0].deck.some((d) => d.iid === c.iid)).map((c) => [p1, p2, m1].indexOf(c)).join(',');
    return { one: ps?.filter === 'Groups' && ps?.maxCount === 2, labels, chain: !!s2.pendingSelection && s2.pendingSelection.effectKey !== ps?.effectKey, moved };
  });
  const handAttach = (cardName, abName, selfId, e1, e2, extraBench = []) => {
    const self = inst(ID[selfId]);
    const fn = M.getAbilityFn(cardName, abName, 0);
    const a1 = inst(ID[e1]), a2 = inst(ID[e1]), b1 = inst(ID[e2]), w = inst(ID.W);
    let s = mk({ active: self, bench: extraBench.map((k) => inst(ID[k])), hand: [a1, a2, b1, w] });
    s = fn(s, 0, pool, self);
    const ps = s.pendingSelection;
    const labels = (ps?.params?.groups ?? []).map((g) => g.label).join('／');
    const cand = M.handDiscardCandidates(ps?.filter, ps?.params, s.players[0].hand, pool).map((c) => c.iid);
    const s2 = res(s, [a1.iid, a2.iid, b1.iid]);
    const inHand = (c) => s2.players[0].hand.some((h) => h.iid === c.iid);
    return { one: ps?.type === 'hand-discard' && ps?.filter === 'Groups' && ps?.maxCount === 2, labels,
      cand: cand.includes(a1.iid) && cand.includes(b1.iid) && !cand.includes(w.iid),
      chain: !!s2.pendingSelection && s2.pendingSelection.effectKey !== ps?.effectKey, keptSecond: inHand(a2), tookOne: !inHand(a1) && !inHand(b1) };
  };
  T('B6_monferno', () => handAttach('烈焰猴', '火焰蹈舞', 'monferno', 'F', 'FG', ['basic']));
  T('B6_magmortar', () => handAttach('鴨嘴炎獸', '拍檔提升', 'magmortar', 'F', 'L', ['eleki']));
  T('B7', () => ['koharu-phase1', 'koharu-phase2', 'koharu-phase3', 'touko-phase1', 'touko-phase2', 'aoki-phase1', 'aoki-phase3', 'mystery-box-pick-item',
    'mystery-box-pick-stadium', 'akuroma-step1-stadium', 'akuroma-step2-energy', 'm6-lantern-step1-fire', 'm6-lantern-step2-lightning', 'tora-pokemon', 'tora-trainer',
    'metagross-x-start-psy', 'metagross-x-start-met', 'flame-dance-pick-fire', 'flame-dance-pick-fight', 'm6-partner-boost-pick'].filter((k) => !M.RESOLVERS.has(k)).join(','));
  T('B8_grouped_key', () => M.RESOLVERS.has('grouped-search-to-hand'));
  // ── C AI
  T('C1', () => {
    const spec = DECK_CARDS[0];
    const extra = [inst(ID.basic), inst(ID.stage1), inst(ID.stage2)];
    let { s, pickInsts } = deckTo(spec, 0);
    s = { ...s, players: [{ ...s.players[0], deck: [...s.players[0].deck, ...extra] }, s.players[1]] };
    const a = M.getAIAction(s, pool, 0);
    const ids = a?.selectedIids ?? [];
    const cats = ids.map((id) => [...pickInsts, ...extra].find((c) => c.iid === id)).map((c) => c && stg(pool.get(c.cardId))).sort().join(',');
    return cats;
  });
  // ── E 兩層防護各自直測（engine 消毒閘、中央 resolver 自保）—— 只測一層的話另一層的突變會存活
  T('E1', () => {
    const b1 = inst(ID.basic), b2 = inst(ID.basic), s1 = inst(ID.stage1), s2 = inst(ID.stage2);
    const st = mk({ deck: [b1, b2, s1, s2, ...many(ID.W, 3)] });
    const pend = { type: 'deck-search', actorIdx: 0, sourcePlayerIdx: 0, filter: 'Groups', minCount: 0, maxCount: 3, effectKey: 'grouped-search-to-hand', params: { groups: G3 } };
    const r = M.sanitizeSelectedIids(st, pend, [b1.iid, b2.iid, s1.iid, s2.iid], pool);
    return r.map((id) => [b1, b2, s1, s2].findIndex((c) => c.iid === id)).join(',');
  });
  T('E2', () => {
    const f1 = inst(ID.F), f2 = inst(ID.F), g1 = inst(ID.FG), w = inst(ID.W);
    const st = mk({ hand: [f1, f2, g1, w] });
    const groups = [{ label: '【火】', filter: 'BasicEnergyOf=Fire' }, { label: '【鬥】', filter: 'BasicEnergyOf=Fighting' }];
    const pend = { type: 'hand-discard', actorIdx: 0, sourcePlayerIdx: 0, filter: 'Groups', minCount: 0, maxCount: 2, effectKey: 'flame-dance-grouped', params: { groups } };
    const r = M.sanitizeSelectedIids(st, pend, [f1.iid, f2.iid, w.iid, g1.iid], pool);
    return r.map((id) => [f1, f2, g1, w].findIndex((c) => c.iid === id)).join(',');
  });
  T('E3', () => {
    const rz = M.RESOLVERS.get('grouped-search-to-hand'); if (!rz) return 'MISSING';
    const b1 = inst(ID.basic), b2 = inst(ID.basic), w = inst(ID.W), s1 = inst(ID.stage1);
    const st = mk({ deck: [b1, b2, w, s1, ...many(ID.W, 3)] });
    const s2 = rz(st, 0, [b1.iid, b2.iid, w.iid, s1.iid, 'ghost'], { label: '小光', groups: G3 }, pool);
    const ids = [...s2.players[0].hand, ...s2.players[0].deck].map((c) => c.iid);
    return s2.players[0].hand.map((c) => [b1, b2, w, s1].findIndex((x) => x.iid === c.iid)).join(',') + '|' + (new Set(ids).size === ids.length && ids.length === 7);
  });
  T('E4', () => {
    const rz = M.RESOLVERS.get('grouped-search-to-hand'); if (!rz) return 'MISSING';
    const deck = [...many(ID.W, 7), inst(ID.basic)];
    const st = mk({ deck });
    const s2 = rz(st, 0, [deck[7].iid], { label: '杜若', groups: [{ label: '【寶可夢】', filter: 'PokemonCard' }], topIids: deck.slice(0, 7).map((c) => c.iid) }, pool);
    return s2.players[0].hand.length + '|' + s2.players[0].deck.length;
  });
  // ── F 審查補洞
  T('F5', () => {   // 舊呼叫端沒傳 pool：手牌多組選擇照樣夾總數（與牌庫分支對稱）
    const hand = [inst(ID.F), inst(ID.FG), inst(ID.F)];
    const st = mk({ hand });
    const pend = { type: 'hand-discard', actorIdx: 0, sourcePlayerIdx: 0, filter: 'Groups', minCount: 0, maxCount: 2, effectKey: 'flame-dance-grouped', params: { groups: [] } };
    return M.sanitizeSelectedIids(st, pend, hand.map((c) => c.iid)).length;
  });
  T('F1', () => {   // engine 消毒閘自己擋「上方 7 張以外」（不靠 resolver 那一層）
    const deck = [...many(ID.W, 7), inst(ID.basic)];
    const st = mk({ deck });
    const pend = { type: 'deck-search', actorIdx: 0, sourcePlayerIdx: 0, filter: 'Groups:TOP_N', minCount: 0, maxCount: 2, effectKey: 'grouped-search-to-hand',
      params: { groups: [{ label: '【寶可夢】', filter: 'PokemonCard' }], topIids: deck.slice(0, 7).map((c) => c.iid) } };
    return M.sanitizeSelectedIids(st, pend, [deck[7].iid], pool).length;
  });
  T('F2', () => {   // 附能目標限制照舊：拍檔提升的鏈只認電擊魔獸／鴨嘴炎獸；X啟動只認【超】【鋼】
    const self = inst(ID.magmortar), el = inst(ID.eleki), other = inst(ID.basic);
    const fn = M.getAbilityFn('鴨嘴炎獸', '拍檔提升', 0);
    const f1 = inst(ID.F), l1 = inst(ID.L);
    let s = fn(mk({ active: self, bench: [el, other], hand: [f1, l1] }), 0, pool, self);
    s = res(s, [f1.iid, l1.iid]);
    const vi = s.pendingSelection?.params?.validIids ?? [];
    const mg = inst(ID.metagross), oth2 = inst(ID.nonPM);   // 非【超】非【鋼】的基礎寶可夢（審查 P3：避免 fixture 退化成恆真）
    const fn2 = M.getAbilityFn('大吾的巨金怪ex', 'X啟動', 0);
    const p1 = inst(ID.P), m1 = inst(ID.M);
    let s2 = fn2(mk({ active: mg, bench: [oth2, inst(ID.basic)], deck: [p1, m1, ...many(ID.W, 4)] }), 0, pool, mg);
    s2 = res(s2, [p1.iid, m1.iid]);
    const vi2 = s2.pendingSelection?.params?.validIids ?? [];
    return { mag: vi.includes(self.iid) && vi.includes(el.iid) && !vi.includes(other.iid),
      meta: vi2.includes(mg.iid) && !vi2.includes(oth2.iid) };
  });
  T('F3', () => {   // 手牌附能、場上目標全被詛咒根鎖住：特性不能按；就算走到能量鏈，能量也留在手牌（不可以丟進棄牌區）
    const self = inst(ID.monferno, { cantAttachEnergyThisTurn: true });
    const f1 = inst(ID.F), g1 = inst(ID.FG);
    const st = mk({ active: self, bench: [], hand: [f1, g1] });
    const usable = (M.getUsableAbilities(st, pool) ?? []).some((u) => u.abilityName === '火焰蹈舞');
    const rz = M.RESOLVERS.get('flame-dance-grouped');
    if (!rz) return { usable, hand: -1, discard: -1 };
    const s2 = rz(st, 0, [f1.iid, g1.iid], { groups: [{ label: '【火】', filter: 'BasicEnergyOf=Fire' }, { label: '【鬥】', filter: 'BasicEnergyOf=Fighting' }] }, pool);
    return { usable, hand: s2.players[0].hand.length, discard: s2.players[0].discard.length };
  });
  T('F4', () => {   // 正對照：有一隻沒被鎖的備戰 ⇒ 照樣能按
    const self = inst(ID.monferno, { cantAttachEnergyThisTurn: true });
    const st = mk({ active: self, bench: [inst(ID.basic)], hand: [inst(ID.F)] });
    return (M.getUsableAbilities(st, pool) ?? []).some((u) => u.abilityName === '火焰蹈舞');
  });
  return out;
}

const LABEL = {
  A1: '★★★ A1 readSelectionGroups：只留格式對的組、組內不可再是 Groups、保留 max',
  A2: '★★★ A2 selectionGroupIndex：基礎→0、1階→1、2階→2、能量→-1、組內 filter 沒收錄→-1（fail-closed）',
  A3: '★★★ A3 sanitizeSelectionSet(Groups)：每組首見 1 張、不屬於的濾掉；max 2 時收 2 張',
  A4: '★★★ A4 Groups／Groups:TOP_N 求值（TOP_N 只認 topIids 裡的卡）',
  A5: '★★★ A5 selectionGroupBlocked：同組選滿擋、別組不擋、不屬於任何組擋',
  A6: '★★★ A6 手牌區 Groups：候選＝基本【火】＋基本【鬥】（handDiscardCandidates 有傳 params）',
  A7: '★★★ A7 BasicEnergyOf=Fire：只認基本【火】能量、已收錄',
  ...Object.fromEntries(DECK_CARDS.map((d) => ['B1_' + d.k, `★★★ B1 ${d.name}：一個視窗、標記 ${d.labels.join('／')}、各一張一次全進手牌、公開卡名、選完結束`])),
  B2: '★★★ B2 同組送兩張（兩張基礎）＋外來卡 ⇒ 只收第一張基礎',
  B3: '★★★ B3 選 0 張 ⇒ 正常結束、牌庫張數不變（可宣告找不到，L832）',
  B4: '★★★ B4 代價先付：秘密箱先丟 3 張；青木先丟光手牌再開多組視窗',
  B5: '★★★ B5 杜若：Groups:TOP_N、上方 7 張以外的卡不拿、卡片不複製',
  B6_metagross: '★★★ B6 大吾的巨金怪ex｜X啟動：【超】／【鋼】一個視窗、送兩張超只收 1 張、接著進能量鏈',
  B6_monferno: '★★★ B6 烈焰猴｜火焰蹈舞：手牌【火】／【鬥】一個視窗、兩張火只收 1 張、接著進能量鏈',
  B6_magmortar: '★★★ B6 鴨嘴炎獸｜拍檔提升：手牌【火】／【雷】一個視窗、兩張火只收 1 張、接著進能量鏈',
  B7: '★ B7 舊的逐段 effectKey 全部仍註冊（部署當下的舊 pending 走得完）',
  B8_grouped_key: '★★★ B8 中央 resolver grouped-search-to-hand 已註冊',
  C1: '★★★ C1 AI 用小光：每組各 1 張（基礎／1 階／2 階）',
  E1: '★★★ E1 engine 消毒閘（牌庫）：[基礎,基礎,1階,2階] 先分組再夾總數 ⇒ [基礎,1階,2階]',
  E2: '★★★ E2 engine 消毒閘（手牌）：[火,火,水,鬥] ⇒ [火,鬥]（第二張火、水被濾掉，鬥不會被總數誤夾）',
  E3: '★★★ E3 中央 resolver 自保：直接送兩張基礎＋能量＋不存在的 iid ⇒ 只拿 [基礎,1階]、卡片不複製',
  E4: '★★★ E4 中央 resolver 自保（杜若）：上方 7 張以外的卡不拿',
  F1: '★★★ F1 engine 消毒閘自己擋杜若上方 7 張以外的卡（審查 P3）',
  F2: '★★★ F2 附能目標限制不變：拍檔提升只認電擊魔獸／鴨嘴炎獸、X啟動只認【超】【鋼】（審查 P3）',
  F3: '★★★ F3 場上全被詛咒根鎖住：火焰蹈舞不能按；能量鏈附不上時能量留在手牌（審查 P2-1）',
  F5: '★ F5 沒傳 pool 的舊呼叫端：手牌多組選擇仍夾到 maxCount（審查 P3-2）',
  F4: '★ F4 正對照：有一隻沒被鎖的寶可夢 ⇒ 火焰蹈舞照樣能按',
};
const judge = (r) => {
  const b1 = (k, labels) => { const x = r['B1_' + k]; return !!x && typeof x === 'object' && x.one && x.labels === labels && x.all && x.done && x.reveal && x.deckOk; };
  const out = {
    A1: r.A1 === JSON.stringify([{ label: 'a', filter: 'Basic' }, { label: 'm', filter: 'Energy', max: 2 }]),
    A2: r.A2 === '0,1,2,-1,-1',
    A3: r.A3 === '0,2,4|0,1',
    A4: r.A4 === 'true,false,true,false',
    A5: r.A5 === '1/0/0,true,false,true',
    A6: r.A6 === '0,1|true',
    A7: r.A7 === 'true,false,false,true',
    B2: !!r.B2?.first && r.B2.second === false && r.B2.water === false && r.B2.done,
    B3: !!r.B3?.done && r.B3.deck && r.B3.hand === 0,
    B4: !!r.B4?.boxFirst && r.B4.aokiHandEmpty && r.B4.aokiDiscard && r.B4.aokiGrouped,
    B5: r.B5?.filter === 'Groups:TOP_N' && r.B5.taken === 0 && r.B5.uniq && r.B5.total === 9,
    B6_metagross: !!r.B6_metagross?.one && r.B6_metagross.labels === '【超】／【鋼】' && r.B6_metagross.chain && r.B6_metagross.moved === '0,2',
    B6_monferno: !!r.B6_monferno?.one && r.B6_monferno.labels === '【火】／【鬥】' && r.B6_monferno.cand && r.B6_monferno.chain && r.B6_monferno.keptSecond && r.B6_monferno.tookOne,
    B6_magmortar: !!r.B6_magmortar?.one && r.B6_magmortar.labels === '【火】／【雷】' && r.B6_magmortar.cand && r.B6_magmortar.chain && r.B6_magmortar.keptSecond && r.B6_magmortar.tookOne,
    B7: r.B7 === '',
    B8_grouped_key: r.B8_grouped_key === true,
    C1: r.C1 === 'Basic,Stage1,Stage2',
    F1: r.F1 === 0, F2: !!r.F2?.mag && r.F2.meta, F3: r.F3?.usable === false && r.F3.hand === 2 && r.F3.discard === 0, F4: r.F4 === true, F5: r.F5 === 2,
    E1: r.E1 === '0,2,3', E2: r.E2 === '0,2', E3: r.E3 === '0,3|true', E4: r.E4 === '0|8',
  };
  for (const d of DECK_CARDS) out['B1_' + d.k] = b1(d.k, d.labels.join('／'));
  return out;
};
const NEW = Object.keys(LABEL).filter((k) => !['B7', 'F4', 'F5'].includes(k));   // F2 在 BASE 要兩段才進鏈，一次送出走不到 ⇒ 也是紅

if (missing.length) { console.log('fixture 卡片缺：' + missing.join(',')); process.exit(1); }
console.log('【A／B／C】行為');
const HM = await load(ROOT);
const H = scenarios(HM), J = judge(H);
for (const k of Object.keys(LABEL)) ok(LABEL[k], J[k], JSON.stringify(H[k]));

// ── D 對戰頁接線（剝註解後）
console.log('\n【D】對戰頁接線');
{
  const raw = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8').replace(/\r\n/g, '\n');
  const src = stripCommentsBlankChecked(raw, { label: '+page.svelte' });
  const D = (n, re) => ok(n, re.test(src));
  D('D1 組別從 pending 讀（isGroupsFilter＋readSelectionGroups）', /const selGroups = \$derived\(pendingSelection && isGroupsFilter\(pendingSelection\.filter\)\s*\?\s*readSelectionGroups\(/);
  D('D2 每組張數走中央 selectionGroupCounts（只算已勾選的）', /selectionGroupCounts\(selGroups, selectionItems\.filter\(it => selectionPicked\.has\(it\.iid\)\), pool\)/);
  D('D3 變暗判準走中央 selectionGroupBlocked、已勾選的永遠可取消', /function isGroupPickDisabled\(item: CardInstance\): boolean \{\s*if \(!selGroups\) return false;\s*if \(selectionPicked\.has\(item\.iid\)\) return false;[^\n]*\s*return selectionGroupBlocked\(selGroups, selGroupCounts, item, pool\);/);
  D('D4 卡片變暗（_bdDisabled 併入 isGroupPickDisabled）', /\{@const _bdDisabled = isBrocksDigDisabled\(item\) \|\| isFishnetDisabled\(item\) \|\| isGroupPickDisabled\(item\)\}/);
  D('D5 點擊防呆：toggleSelection 拒絕變暗的卡', /if \(selGroups\) \{\s*const item = selectionItems\.find\(it => it\.iid === iid\);\s*if \(item && isGroupPickDisabled\(item\)\) return;\s*\}/);
  D('D6 確認鈕：任一組超過上限就不能確認', /if \(selGroups && selGroupCounts\.some\(\(n, i\) => n > groupMax\(selGroups\[i\]\)\)\) return false;/);
  D('D7 卡片左上角組別標籤（selectionGroupIndex 決定）', /\{#if _grpLabel\}<span class="sel-grp-tag">\{_grpLabel\}<\/span>\{\/if\}/.test(src) && /selectionGroupIndex\(selGroups, item, pool\.get\(item\.cardId\)\)/.test(src) ? /./ : /^\b$/);
  D('D8 提示列組別計數（不另外加說明文字）', /\{#if selGroups\}\{#each selGroups as g, gi\}<span class="sel-grp-chip"/);
  ok('D9 對戰頁沒有自己再寫一份組別判準（不出現 groups.filter／evaluateSelectionFilter 求組）', !/selGroups\.(findIndex|some|filter)\(g\s*=>\s*evaluateSelectionFilter/.test(src));
}

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6668b-'));
  try {
    extractBaseArchive(ROOT, BASE_SHA, ['src'], tmp);
    const BM = await load(tmp);
    const B = scenarios(BM), BJ = judge(B);
    for (const k of Object.keys(LABEL)) {
      if (NEW.includes(k)) ok(`★★★[H] v6.667：${k} 紅`, BJ[k] === false, JSON.stringify(B[k]));
      else ok(`★[H 正對照] v6.667：${k} 綠`, BJ[k] === true, JSON.stringify(B[k]));
    }
  } catch (e) { ok('★★★[H] BASE 可打包', false, String(e?.message ?? e).split('\n')[0]); }
  finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
} else shallowSkip('v6668 H', '需要 v6.667 commit');

console.log(`\n=== v6.668 多組選擇（各選 1 張）中央管線：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
