// v6.634 守衛：「效果把寶可夢卡直接放置於備戰區」不可以放上海豚俠ex（全能靈魂）
//
// 由來：v6.633 審查（Opus）列出同一句卡面的 5 處漏洞，站長：「請繼續下一版」。
//   海豚俠ex｜全能靈魂（卡面）：「這張卡只可依據『海豚俠』的特性『全能變身』的效果放置於場上。」
//   v6.633 已擋「從牌庫直接進化」；本版擋「卡面不限基礎的放備戰效果」：
//     米立龍ex｜硃砂誘餌、人造細胞卵｜傳喚之門（牌庫上方 N 張，共用 deckTopPeekPokemonToBenchPost）
//     超級妖火紅狐ex｜戲法傳送門（牌庫上方 9 張，resolver bench-basic-from-deck）
//     下石鳥｜親送挑戰（擲 2 幣全正面 → 牌庫選 1 張寶可夢）
//     刺龍王ex｜王之號召（棄牌區最多 3 張【水】寶可夢；海豚俠ex 是【水】）
//   全站掃過：其餘放備戰效果卡面都限【基礎】、限名稱或限非水屬性，碰不到海豚俠ex（1 階）。
//   中央判準 canEffectPlaceOnBench（_shared.ts）＝ 候選 validIids ＝ resolver 再驗；
//   TOP 型 filter（Pokemon:TOP_N／TOP9）在中央 selection-filter 與 validIids 交集 ⇒ UI／AI／消毒閘同一份。
//
// 【A】行為（五張卡各跑完整流程 ATTACK → RESOLVE_SELECTION）
//   A1 候選（照 UI／AI 的算法：zone ∩ validIids ∩ 中央 filter）不含海豚俠ex、含海豚俠（正對照）
//   A2 偽造 payload 選海豚俠ex（經 applyAction）⇒ 不上備戰、留在原區
//   A3 直呼 resolver（跳過消毒閘）選海豚俠ex ⇒ 仍不上備戰（resolver 自己再驗）；A3b 同上但 params 沒有 validIids（舊 pending）
//   A4 正對照：選海豚俠 ⇒ 上備戰
//   A5 只有海豚俠ex 可選時 ⇒ TOP 型只開「查看」（maxCount 0）且仍看得到它；棄牌區型不開選卡
// 【B】中央判準單元與 filter 交集
// 【H】HEAD-FAIL：BASE（v6.633）引擎跑 A1／A2 ⇒ 紅
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hasBaseCommit, shallowSkip } from './lib/base-blob.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_SHA = '301b6e23';   // v6.633（本版的上一版）
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? ' — ' + String(x).slice(0, 500) : '')); } };

async function loadEngine(srcRoot, tag) {
  const S = join(srcRoot, `.v6634${tag}-s.js`), E = join(srcRoot, `.v6634${tag}-e.ts`), O = join(srcRoot, `.v6634${tag}-o.mjs`);
  process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
  writeFileSync(S, 'export const base="";export const assets="";');
  writeFileSync(E, "export { applyAction } from './src/lib/game/engine';\nexport * as SH from './src/lib/game/effects/_shared';\n"
    + "export { evaluateSelectionFilter } from './src/lib/game/selection-filter';\nimport './src/lib/game/effects';\n");
  await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
    alias: { $lib: join(srcRoot, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
  return import(pathToFileURL(O).href);
}

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map(); const all = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) { if (c?.id == null) continue; pool.set(String(c.id), c); all.push(c); }
}
const byId = (id) => { const c = pool.get(String(id)); if (!c) throw new Error('卡池抓不到 id ' + id); return c; };
const PALAFIN = byId('16686'), PALAFIN_EX = byId('16687');
const PLAIN = all.find((c) => c.supertype === 'Pokemon' && c.stage === 'Basic' && !(c.abilities || []).length && c.pokemonType === 'Colorless'
  && ['H', 'I', 'J'].includes(c.regulationMark) && Number(c.hp) >= 60);
const TRAINER = all.find((c) => c.supertype === 'Trainer' && c.subtype === 'Item' && ['H', 'I', 'J'].includes(c.regulationMark));
const ENERGY = {};
for (const t of ['Fire', 'Water', 'Darkness', 'Psychic', 'Grass', 'Lightning', 'Fighting', 'Metal']) {
  const zh = { Fire: '火', Water: '水', Darkness: '惡', Psychic: '超', Grass: '草', Lightning: '雷', Fighting: '鬥', Metal: '鋼' }[t];
  ENERGY[t] = all.find((c) => c.supertype === 'Energy' && c.name === `基本【${zh}】能量`);
}

let nn = 0;
const inst = (cid, extra = {}) => ({ iid: 'i' + (++nn), cardId: String(cid), damage: 0, energyAttached: [], abilityUsedThisTurn: false,
  evolvedThisTurn: false, playedFromHand: false, movedToActiveThisTurn: false, evolvedFromStack: [], ...extra });
const filler = (n) => Array.from({ length: n }, () => inst(TRAINER.id));
const P = (o = {}) => ({ name: 'P', active: null, bench: [], hand: [], deck: filler(10), discard: [],
  prizes: Array.from({ length: 6 }, () => inst(PLAIN.id)), abilityNamesUsedThisTurn: [], ...o });
const mk = (p0, p1) => ({ phase: 'playing', turnPhase: 'main', activePlayerIndex: 0, firstPlayerIdx: 0, turn: 7, isFirstTurn: false, log: [],
  pendingSelection: null, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0], coinFlippedThisAttack: false,
  _attackerActiveBonusDone: false, activeStadium: null, activeStadiumOwnerIdx: 0, players: [P({ name: 'A', ...p0 }), P({ name: 'B', ...p1 })] });
const energyFor = (card, atk) => (card.attacks.find((a) => a.name === atk).cost || []).map((t) => inst((ENERGY[t] || ENERGY.Water).id));

// [標籤, 攻擊方 id, 招式名, 來源區 'deck'|'discard']
const CASES = [
  ['米立龍ex｜硃砂誘餌', '11261', '硃砂誘餌', 'deck'],
  ['人造細胞卵｜傳喚之門', '9802', '傳喚之門', 'deck'],
  ['超級妖火紅狐ex｜戲法傳送門', '18560', '戲法傳送門', 'deck'],
  ['下石鳥｜親送挑戰', '19213', '親送挑戰', 'deck'],
  ['刺龍王ex｜王之號召', '10594', '王之號召', 'discard'],
];

/** 對戰頁（+page.svelte selectionItemsRaw）的候選算法：deck-search 先問中央 filter，已收錄（回 boolean）就**只看它**
 *  （TOP 型就是這樣，UI 不另外交集 validIids ⇒ 中央 filter 自己必須交集）；未收錄的 'Pokemon' 與 discard-search 才交集 validIids。 */
function uiCands(M, ps, zone) {
  const vi = Array.isArray(ps?.params?.validIids) ? new Set(ps.params.validIids) : null;
  return zone.filter((c) => {
    const card = pool.get(c.cardId);
    if (!card || card.supertype !== 'Pokemon') return false;
    if (ps.type === 'deck-search') {
      const r = M.evaluateSelectionFilter('deck-search', ps.filter ?? '', c, card, { params: ps.params });
      if (r !== null) return r;
    }
    return !vi || vi.has(c.iid);
  });
}

function runCase(M, [label, atkId, atk, zoneName], mode) {
  const act = (st, a) => { try { return M.applyAction(st, a, pool); } catch (e) { return { __err: e.message, players: st.players, log: [] }; } };
  const attacker = byId(atkId);
  const ex = inst(PALAFIN_EX.id), normal = inst(PALAFIN.id);
  const pile = mode === 'onlyEx' ? [ex] : [ex, normal];
  const p0 = { active: inst(atkId, { energyAttached: energyFor(attacker, atk) }), bench: [] };
  if (zoneName === 'deck') p0.deck = [...pile, ...filler(6)]; else { p0.discard = pile; p0.deck = filler(6); }
  const st = mk(p0, { active: inst(PLAIN.id) });
  const rnd = Math.random; Math.random = () => 0.1;   // 親送挑戰：兩次都正面
  let r;
  try { r = act(st, { type: 'ATTACK', attackIndex: attacker.attacks.findIndex((a) => a.name === atk) }); } finally { Math.random = rnd; }
  const ps = r?.pendingSelection;
  const zone = r?.players?.[0]?.[zoneName] ?? [];
  const names = (xs) => xs.map((c) => pool.get(c.cardId)?.name);
  const onBench = (s, i) => (s?.players?.[0]?.bench ?? []).some((b) => b.iid === i.iid);
  const inZone = (s, i) => (s?.players?.[0]?.[zoneName] ?? []).some((b) => b.iid === i.iid);
  const out = { pend: ps?.type, key: ps?.effectKey, max: ps?.maxCount, err: r?.__err };
  if (mode === 'onlyEx') {
    const peek = ps?.params?.topIids ?? ps?.params?.top9Iids;
    out.cands = ps ? names(uiCands(M, ps, zone)) : [];
    out.viewable = Array.isArray(peek) ? peek.includes(ex.iid) : null;
    return out;
  }
  out.cands = ps ? names(uiCands(M, ps, zone)) : [];
  if (!ps) return out;
  const fg = act(r, { type: 'RESOLVE_SELECTION', selectedIids: [ex.iid], actorIdx: 0 });
  out.forged = { exOnBench: onBench(fg, ex), exInZone: inZone(fg, ex) };
  // 直呼 resolver（跳過 engine 的消毒閘）：證明 resolver 自己會再驗
  const fn = M.SH.RESOLVERS.get(ps.effectKey);
  let dr = null;
  try { dr = fn ? fn({ ...r, pendingSelection: null }, 0, [ex.iid], ps.params, pool) : null; } catch (e) { dr = { __err: e.message }; }
  out.direct = { exOnBench: onBench(dr, ex), exInZone: inZone(dr, ex), err: dr?.__err, hasFn: !!fn };
  // 同上但 params 不帶 validIids（部署瞬間停在舊版開的 pending，或共用 resolver 的其他呼叫端）⇒ resolver 的最後一層仍要擋
  let dr2 = null;
  try { dr2 = fn ? fn({ ...r, pendingSelection: null }, 0, [ex.iid], { ...ps.params, validIids: undefined }, pool) : null; } catch (e) { dr2 = { __err: e.message }; }
  out.direct2 = { exOnBench: onBench(dr2, ex), exInZone: inZone(dr2, ex), err: dr2?.__err };
  const hn = act(r, { type: 'RESOLVE_SELECTION', selectedIids: [normal.iid], actorIdx: 0 });
  out.honest = { onBench: onBench(hn, normal) };
  return out;
}
const runAll = (M) => Object.fromEntries(CASES.map((c) => [c[0], { main: runCase(M, c, 'main'), onlyEx: runCase(M, c, 'onlyEx') }]));

console.log('【A】五張卡完整流程');
const CUR = await loadEngine(ROOT, 'c');
const A = runAll(CUR);
for (const [label, , , zoneName] of CASES) {
  const { main: m, onlyEx: o } = A[label];
  ok(`★★★ A1 ${label}：候選不含海豚俠ex、含海豚俠（正對照）`, !!m.pend && !m.cands.includes('海豚俠ex') && m.cands.includes('海豚俠'), JSON.stringify(m));
  ok(`★★★ A2 ${label}：偽造選海豚俠ex ⇒ 不上備戰、留在${zoneName === 'deck' ? '牌庫' : '棄牌區'}`, m.forged && !m.forged.exOnBench && m.forged.exInZone, JSON.stringify(m.forged));
  ok(`★★★ A3 ${label}：直呼 resolver 選海豚俠ex ⇒ 仍不上備戰（resolver 自己再驗）`, m.direct?.hasFn && !m.direct.err && !m.direct.exOnBench && m.direct.exInZone, JSON.stringify(m.direct));
  ok(`★★★ A3b ${label}：直呼 resolver 且 params 沒有 validIids（舊 pending）⇒ 仍不上備戰`, !m.direct2?.err && !m.direct2?.exOnBench && m.direct2?.exInZone, JSON.stringify(m.direct2));
  ok(`★★ A4 ${label}：正對照：選海豚俠 ⇒ 上備戰`, m.honest?.onBench === true, JSON.stringify(m.honest));
  if (zoneName === 'deck' && label !== '下石鳥｜親送挑戰') {
    ok(`★★ A5 ${label}：上方只有海豚俠ex 一隻寶可夢 ⇒ 只開查看（maxCount 0、沒有候選），仍看得到它（查看權不變）`,
      o.pend === 'deck-search' && o.max === 0 && o.cands.length === 0 && o.viewable === true, JSON.stringify(o));
  } else if (zoneName === 'deck') {
    ok(`★★ A5 ${label}：牌庫只有海豚俠ex 一隻寶可夢 ⇒ 候選為空（不會被選上）`, o.pend === 'deck-search' && o.cands.length === 0, JSON.stringify(o));
  } else {
    ok(`★★ A5 ${label}：棄牌區只有海豚俠ex ⇒ 不開選卡（只寫 log）`, !o.pend, JSON.stringify(o));
  }
}

console.log('【B】中央判準與 filter 交集');
{ const f = CUR.SH.canEffectPlaceOnBench;
  const exs = all.filter((c) => c.name === '海豚俠ex' && ['H', 'I', 'J'].includes(c.regulationMark));
  ok(`★★ B1 全部 ${exs.length} 個海豚俠ex 印刷 ⇒ false；海豚俠／基礎寶可夢 ⇒ true；非寶可夢／undefined ⇒ false`,
    typeof f === 'function' && exs.length >= 3 && exs.every((c) => f(c) === false) && f(PALAFIN) === true && f(PLAIN) === true
    && f(TRAINER) === false && f(ENERGY.Water) === false && f(undefined) === false);
  const ev = CUR.evaluateSelectionFilter, c1 = { iid: 'x1' }, c2 = { iid: 'x2' };
  // 沒宣告 validIids ⇒ 行為不變（杜若／黑暗球等既有招式）；有宣告 ⇒ 交集。用「讀它 vs 不讀它答案不同」的輸入（Rule 39）。
  ok('★★ B2 Pokemon:TOP_N：沒宣告 validIids ⇒ 照舊 true；宣告了但不含 ⇒ false；含 ⇒ true',
    ev('deck-search', 'Pokemon:TOP_N', c1, PALAFIN, { params: { topIids: ['x1'] } }) === true
    && ev('deck-search', 'Pokemon:TOP_N', c1, PALAFIN, { params: { topIids: ['x1'], validIids: ['x2'] } }) === false
    && ev('deck-search', 'Pokemon:TOP_N', c1, PALAFIN, { params: { topIids: ['x1'], validIids: ['x1'] } }) === true);
  ok('★★ B3 Pokemon:TOP9 同上；上方 9 張以外照樣 false',
    ev('deck-search', 'Pokemon:TOP9', c1, PALAFIN, { params: { top9Iids: ['x1'] } }) === true
    && ev('deck-search', 'Pokemon:TOP9', c1, PALAFIN, { params: { top9Iids: ['x1'], validIids: [] } }) === false
    && ev('deck-search', 'Pokemon:TOP9', c2, PALAFIN, { params: { top9Iids: ['x1'], validIids: ['x2'] } }) === false); }

console.log('【H】HEAD-FAIL');
if (!hasBaseCommit(ROOT, BASE_SHA)) shallowSkip('H（缺 BASE ' + BASE_SHA + '）');
else {
  const tmp = mkdtempSync(join(tmpdir(), 'v6634-base-'));
  try {
    execFileSync('bash', ['-c', `git -C "${ROOT}" archive ${BASE_SHA} src | tar -x -C "${tmp}"`]);
    const B = runAll(await loadEngine(tmp, 'b'));
    const reds = CASES.filter(([l]) => B[l].main.cands.includes('海豚俠ex') && B[l].main.forged?.exOnBench).map(([l]) => l);
    console.log('    BASE 上可以把海豚俠ex 放上備戰區：' + reds.join('、'));
    ok('★★★ H1 BASE（v6.633）五張卡都會列出海豚俠ex、而且選了就上備戰區（本版修的就是這個）', reds.length === CASES.length, JSON.stringify(B).slice(0, 800));
    ok('★★ H2 BASE 上正對照照常（選海豚俠會上備戰 ⇒ harness 沒壞）', CASES.every(([l]) => B[l].main.honest?.onBench === true));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

console.log(`=== v6.634 效果放備戰排除全能靈魂：${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
