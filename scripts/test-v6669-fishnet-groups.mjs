#!/usr/bin/env node
/**
 * v6.669 守衛：豐收漁網的「各 3 張、選滿變暗」收進中央多組選擇（v6.668 的 params.groups，每組 max 3）。
 *   卡面：「從自己的棄牌區選擇【水】寶可夢卡與『基本【水】能量』卡最多各3張，在給對手看過後放回牌庫並重洗。」
 *
 * 【A】打出：discard-search、filter 'Groups'、組別【寶可夢】／【能量】各 max 3、validIids 只含【水】寶可夢＋基本【水】能量
 * 【B】完整流程：送 4 隻【水】寶可夢＋4 張基本【水】能量 ⇒ engine 消毒閘先分組，各 3 張回牌庫、其餘留棄牌區、卡片不複製
 * 【C】engine 消毒閘直測：[水寶可夢×4、水能量、外來 iid、重複] ⇒ 3＋1
 * 【D】resolver 自保直測（不經 engine）：4 隻寶可夢 ⇒ 只收 3 隻
 * 【E】AI：每組各取 ≤3 張（不會 4 隻寶可夢＋2 張能量）
 * 【F】舊 pending 相容：沒有 groups 的舊 pending ⇒ resolver 仍各型上限 3
 * 【G】對戰頁：豐收漁網專用的 fishnetPickState／isFishnetDisabled 已移除；棄牌區候選有傳 params
 * 【H】HEAD-FAIL：BASE（v6.668）上 NEW 各自紅、正對照綠
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
// ⚠ BASE_SHA 必須是留在 main 上的那一顆（IRON_RULES Rule 45）：v6.668。
const BASE_SHA = '64c7f253';
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
const ID = {
  net: '18493',
  wpoke: find((c) => c.supertype === 'Pokemon' && c.pokemonType === 'Water' && !c.evolvesFrom && !/ex$/.test(c.name)),
  wE: find((c) => c.name === '基本【水】能量'),
  fpoke: find((c) => c.supertype === 'Pokemon' && c.pokemonType === 'Fire' && !c.evolvesFrom),
  fE: find((c) => c.name === '基本【火】能量'),
  sup: find((c) => c.supertype === 'Trainer' && c.subtype === 'Supporter'),
};
const missing = Object.entries(ID).filter(([, v]) => !v || !pool.get(v)).map(([k]) => k);

async function load(srcRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6669-'));
  const E = join(tmp, 'e.ts'), S = join(tmp, 's.js'), O = join(tmp, 'o.mjs');
  writeFileSync(S, 'export const base="";');
  const p = (x) => join(srcRoot, x).replace(/\\/g, '/');
  writeFileSync(E, `export { applyAction, createGame, sanitizeSelectedIids } from '${p('src/lib/game/engine')}';\n`
    + `export { RESOLVERS } from '${p('src/lib/game/effects/_shared')}';\n`
    + `export { evaluateSelectionFilter, isKnownSelectionFilter } from '${p('src/lib/game/selection-filter')}';\n`
    + `export { getAIAction } from '${p('src/lib/game/ai')}';\nimport '${p('src/lib/game/effects')}';`);
  try {
    await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
      alias: { '$lib': join(srcRoot, 'src/lib'), '$app/paths': S }, logLevel: 'silent', nodePaths: [join(ROOT, 'node_modules')] });
    return await import(pathToFileURL(O).href);
  } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
}

function scenarios(M) {
  let n = 0;
  const inst = (cid) => ({ iid: 'i' + (++n), cardId: String(cid), damage: 0, energyAttached: [] });
  const many = (cid, k) => Array.from({ length: k }, () => inst(cid));
  const mk = (p0 = {}) => {
    const s = M.createGame({ name: 'P1', entries: [{ cardId: ID.wpoke, count: 1 }] }, { name: 'P2', entries: [{ cardId: ID.wpoke, count: 1 }] }, pool);
    return { ...s, phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 5, isFirstTurn: false,
      setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], log: [],
      players: [
        { ...s.players[0], hand: [], deck: many(ID.fE, 10), discard: [], prizes: many(ID.fE, 6), bench: [], active: inst(ID.wpoke), ...p0 },
        { ...s.players[1], hand: [], deck: many(ID.fE, 10), discard: [], prizes: many(ID.fE, 6), bench: [], active: inst(ID.wpoke) },
      ] };
  };
  const act = (s, a) => M.applyAction(s, a, pool);
  const res = (s, ids) => act(s, { type: 'RESOLVE_SELECTION', effectKey: s.pendingSelection.effectKey, selectedIids: ids, actorIdx: 0, senderIdx: 0, pendingToken: s.pendingSelection.token });
  const out = {};
  const T = (k, f) => { try { out[k] = f(); } catch (e) { out[k] = 'ERR ' + String(e?.message ?? e).split('\n')[0]; } };
  const setup = () => {
    const net = inst(ID.net);
    const P = many(ID.wpoke, 4), W = many(ID.wE, 4), other = [inst(ID.fpoke), inst(ID.fE), inst(ID.sup)];
    const st = mk({ hand: [net], discard: [...P, ...W, ...other] });
    return { s: act(st, { type: 'PLAY_TRAINER', iid: net.iid }), P, W, other };
  };
  const GROUPS = [{ label: '【寶可夢】', filter: 'PokemonOfType=Water', max: 3 }, { label: '【能量】', filter: 'BasicEnergyOf=Water', max: 3 }];

  T('A1', () => {
    const { s, P, W, other } = setup();
    const p = s.pendingSelection;
    const g = (p?.params?.groups ?? []).map((x) => `${x.label}=${x.filter}/${x.max}`).join(',');
    const vi = new Set(p?.params?.validIids ?? []);
    return { type: p?.type, filter: p?.filter, max: p?.maxCount, g,
      vi: [...P, ...W].every((c) => vi.has(c.iid)) && other.every((c) => !vi.has(c.iid)) };
  });
  T('B1', () => {
    const { s, P, W, other } = setup();
    const s2 = res(s, [...P, ...W].map((c) => c.iid));
    const d = s2.players[0].discard.map((c) => c.iid), k = s2.players[0].deck.map((c) => c.iid);
    const all = [...d, ...k, ...s2.players[0].hand.map((c) => c.iid)];
    return { backP: P.filter((c) => k.includes(c.iid)).length, backW: W.filter((c) => k.includes(c.iid)).length,
      stayP: d.includes(P[3].iid), stayW: d.includes(W[3].iid), other: other.every((c) => d.includes(c.iid)),
      uniq: new Set(all).size === all.length, done: !s2.pendingSelection };
  });
  T('C1', () => {
    const P = many(ID.wpoke, 4), W = many(ID.wE, 1), f = inst(ID.fpoke);
    const st = mk({ discard: [...P, ...W, f] });
    const pend = { type: 'discard-search', actorIdx: 0, sourcePlayerIdx: 0, filter: 'Groups', minCount: 0, maxCount: 6, effectKey: 'fishnet-unified',
      params: { validIids: [...P, ...W].map((c) => c.iid), groups: GROUPS } };
    const r = M.sanitizeSelectedIids(st, pend, [P[0].iid, P[0].iid, P[1].iid, P[2].iid, P[3].iid, f.iid, W[0].iid], pool);
    return r.map((id) => [...P, ...W, f].findIndex((c) => c.iid === id)).join(',');
  });
  T('C2', () => {   // 外來卡是「不在 validIids 的水寶可夢」⇒ 必須由 validIids 擋（分組擋不到它）；validIids 裡混進火寶可夢 ⇒ 必須由分組擋
    const P = many(ID.wpoke, 2), x = inst(ID.wpoke), fp = inst(ID.fpoke), W = inst(ID.wE);
    const st = mk({ discard: [...P, x, fp, W] });
    const pend = { type: 'discard-search', actorIdx: 0, sourcePlayerIdx: 0, filter: 'Groups', minCount: 0, maxCount: 6, effectKey: 'fishnet-unified',
      params: { validIids: [...P, fp, W].map((c) => c.iid), groups: GROUPS } };
    const r = M.sanitizeSelectedIids(st, pend, [x.iid, fp.iid, P[0].iid, W.iid, P[1].iid], pool);
    return r.map((id) => [...P, x, fp, W].findIndex((c) => c.iid === id)).join(',');
  });
  T('C3', () => {   // 中央 Groups 述詞（棄牌區）直測：UI 候選清單就是用它
    const ev = M.evaluateSelectionFilter; if (!ev) return 'MISSING';
    const params = { groups: GROUPS };
    return [ev('discard-search', 'Groups', { iid: 'a' }, pool.get(ID.wpoke), { params }), ev('discard-search', 'Groups', { iid: 'a' }, pool.get(ID.wE), { params }),
      ev('discard-search', 'Groups', { iid: 'a' }, pool.get(ID.fpoke), { params }), ev('discard-search', 'Groups', { iid: 'a' }, pool.get(ID.fE), { params }),
      ev('discard-search', 'Groups', { iid: 'a' }, pool.get(ID.sup), { params }), M.isKnownSelectionFilter('discard-search', 'Groups')].join(',');
  });
  T('E2', () => {   // AI 候選直接走中央 Groups 述詞（沒有 validIids 時）：火寶可夢、火能量、支援者都不可以選
    const P = many(ID.wpoke, 1), W = many(ID.wE, 1), other = [inst(ID.fpoke), inst(ID.fE), inst(ID.sup)];
    let st = mk({ discard: [...other, ...P, ...W] });
    st = { ...st, pendingSelection: { type: 'discard-search', actorIdx: 0, sourcePlayerIdx: 0, filter: 'Groups', minCount: 0, maxCount: 6, effectKey: 'fishnet-unified', params: { groups: GROUPS } } };
    const ids = M.getAIAction(st, pool, 0)?.selectedIids ?? [];
    return ids.map((id) => [...other, ...P, ...W].findIndex((c) => c.iid === id)).sort().join(',');
  });
  T('D1', () => {
    const rz = M.RESOLVERS.get('fishnet-unified'); if (!rz) return 'MISSING';
    const P = many(ID.wpoke, 4), W = many(ID.wE, 1);
    const st = mk({ discard: [...P, ...W] });
    const s2 = rz(st, 0, [...P, ...W].map((c) => c.iid), { groups: GROUPS }, pool);
    return s2.players[0].discard.length + '|' + s2.players[0].deck.length;
  });
  T('E1', () => {
    const { s } = setup();
    const a = M.getAIAction(s, pool, 0);
    const ids = a?.selectedIids ?? [];
    const cards = ids.map((id) => s.players[0].discard.find((c) => c.iid === id)).map((c) => c && pool.get(c.cardId));
    return cards.filter((c) => c?.supertype === 'Pokemon').length + '/' + cards.filter((c) => c?.supertype === 'Energy').length;
  });
  T('D2', () => {   // resolver 的 groups 分支本身（不經 engine）：payload 混進火寶可夢 ⇒ 不屬於任何組、不可以放回牌庫（舊路徑只看 supertype 會收）
    const rz = M.RESOLVERS.get('fishnet-unified'); if (!rz) return 'MISSING';
    const w = inst(ID.wpoke), fp = inst(ID.fpoke);
    const st = mk({ discard: [w, fp] });
    const s2 = rz(st, 0, [fp.iid, w.iid], { groups: GROUPS }, pool);
    return s2.players[0].discard.map((c) => (c.iid === fp.iid ? 'fire' : 'water')).join(',');
  });
  T('F1', () => {   // 舊 pending（部署當下開出、沒有 groups）照舊各型上限 3
    const rz = M.RESOLVERS.get('fishnet-unified'); if (!rz) return 'MISSING';
    const P = many(ID.wpoke, 4), W = many(ID.wE, 4);
    const st = mk({ discard: [...P, ...W] });
    const s2 = rz(st, 0, [...P, ...W].map((c) => c.iid), { validIids: [...P, ...W].map((c) => c.iid) }, pool);
    return s2.players[0].discard.length + '|' + s2.players[0].deck.length;
  });
  return out;
}

const LABEL = {
  A1: '★★★ A1 打出：discard-search、Groups、【寶可夢】／【能量】各 max 3、validIids 只含水寶可夢與基本水能量',
  B1: '★ B1 完整流程：各 3 張回牌庫、第 4 張留棄牌區、非水卡不動、卡片不複製、結束 pending',
  C1: '★★★ C1 engine 消毒閘（棄牌區）：去重、濾外來、每組 3 張 ⇒ [寶可夢×3, 能量]',
  C2: '★★★ C2 engine 消毒閘：不在 validIids 的水寶可夢被擋、validIids 裡的火寶可夢被分組擋 ⇒ [寶可夢, 能量, 寶可夢]',
  C3: '★★★ C3 中央 Groups 述詞（棄牌區）：水寶可夢／基本水能量 true，火寶可夢／火能量／支援者 false、已收錄',
  E2: '★★★ E2 AI 候選走中央 Groups 述詞：只選水寶可夢與基本水能量',
  D1: '★ D1 resolver 自保（不經 engine）：4 隻寶可夢＋1 能量 ⇒ 回牌庫 4 張',
  E1: '★★★ E1 AI：每組各 ≤3 張（3/3）',
  D2: '★★★ D2 resolver groups 分支：混進的火寶可夢留在棄牌區（審查 P3-4）',
  F1: '★ F1 舊 pending 相容：沒有 groups ⇒ 仍各型上限 3',
};
const judge = (r) => ({
  A1: r.A1?.type === 'discard-search' && r.A1.filter === 'Groups' && r.A1.max === 6 && r.A1.g === '【寶可夢】=PokemonOfType=Water/3,【能量】=BasicEnergyOf=Water/3' && r.A1.vi,
  B1: r.B1?.backP === 3 && r.B1.backW === 3 && r.B1.stayP && r.B1.stayW && r.B1.other && r.B1.uniq && r.B1.done,
  C1: r.C1 === '0,1,2,4',
  C2: r.C2 === '0,4,1', C3: r.C3 === 'true,true,false,false,false,true', E2: r.E2 === '3,4',
  D1: r.D1 === '1|14',
  E1: r.E1 === '3/3',
  D2: r.D2 === 'fire',
  F1: r.F1 === '2|16',
});
const NEW = ['A1', 'C1', 'C2', 'C3', 'D2', 'E1', 'E2'];

if (missing.length) { console.log('fixture 卡片缺：' + missing.join(',')); process.exit(1); }
console.log('【A～F】行為');
const HM = await load(ROOT);
const H = scenarios(HM), J = judge(H);
for (const k of Object.keys(LABEL)) ok(LABEL[k], J[k], JSON.stringify(H[k]));

console.log('\n【G】對戰頁');
{
  const raw = readFileSync(join(ROOT, 'src/routes/game/+page.svelte'), 'utf8').replace(/\r\n/g, '\n');
  const src = stripCommentsBlankChecked(raw, { label: '+page.svelte' });
  // 註解裡允許提到舊名字（說明搬家），所以只看「宣告／呼叫」的形態
  ok('G1 豐收漁網專用判準已移除（不再宣告 fishnetPickState／isFishnetDisabled、也不再呼叫）',
    !/const fishnetPickState\s*=/.test(src) && !/function isFishnetDisabled\s*\(/.test(src) && !/isFishnetDisabled\(item\)/.test(src) && !/fishnetPickState\.(pokeCount|energyCount)/.test(src));
  ok('G2 棄牌區候選呼叫中央求值器時有傳 params（Groups 讀 params.groups）',
    /isKnownSelectionFilter\('discard-search', f\)\) return evaluateSelectionFilter\('discard-search', f, c, card, \{ params: pendingSelection\.params \}\) === true;/.test(src));
}

console.log('\n【H】HEAD-FAIL');
if (hasBaseCommit(ROOT, BASE_SHA)) {
  const tmp = mkdtempSync(join(tmpdir(), 'v6669b-'));
  try {
    extractBaseArchive(ROOT, BASE_SHA, ['src'], tmp);
    const BM = await load(tmp);
    const B = scenarios(BM), BJ = judge(B);
    for (const k of Object.keys(LABEL)) {
      if (NEW.includes(k)) ok(`★★★[H] v6.668：${k} 紅`, BJ[k] === false, JSON.stringify(B[k]));
      else ok(`★[H 正對照] v6.668：${k} 綠`, BJ[k] === true, JSON.stringify(B[k]));
    }
    const rawB = readFileSync(join(tmp, 'src/routes/game/+page.svelte'), 'utf8');
    ok('★★★[H] v6.668：G1 紅（對戰頁還有豐收漁網專用判準）', /function isFishnetDisabled\s*\(/.test(rawB));
  } catch (e) { ok('★★★[H] BASE 可打包', false, String(e?.message ?? e).split('\n')[0]); }
  finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } }
} else shallowSkip('v6669 H', '需要 v6.668 commit');

console.log(`\n=== v6.669 豐收漁網收進中央多組選擇：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
