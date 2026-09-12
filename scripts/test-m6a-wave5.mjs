// v6.345 守衛（M6a 批次5）：18 招，一律用**完整 ATTACK 流程**驗證行為，不驗字串存在。
//   ⭐ 每一條都附「哨兵」：招式真的跑完了（攻擊方 active.attackUsedThisTurn === 招式名）
//     ＋ 卡面傷害真的照卡面結算（本批 17 招 damage 為空 ⇒ 對手場上傷害總和必須是 0；
//     暴飛龍ex｜龍之波動 是 240 ⇒ 真的打了 240）。
//     沒有哨兵時，招式若根本沒被執行（key 打錯／import 漏接／費用付不出來 ⇒ ATTACK 靜默 return），
//     效果斷言會是**空真**。
//   ⭐ 會開 picker 的招式一律真的 RESOLVE_SELECTION 解掉再看結果（「有開 picker」＝安慰劑）。
//   ⭐ 每一型都附正對照：同一支中央 helper 的**既有卡**必須同樣通過。
//   ⚠ 靶一律用 neutralFor(atk)（對出招者屬性既不弱也不抗），否則弱點×2／抵抗−20 會把哨兵打歪。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.m6aw5-s.js'), E = join(ROOT, '.m6aw5-e.ts'), O = join(ROOT, '.m6aw5-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";');
writeFileSync(E,
  "export { applyAction, createGame } from './src/lib/game/engine';\n"
  + "export { TRAINER_EFFECTS } from './src/lib/game/effects';\n"
  + "import './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20', alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { applyAction, createGame, TRAINER_EFFECTS } = await import(pathToFileURL(O).href);

const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map(); const byName = new Map();
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    if (c?.id == null) continue;
    pool.set(String(c.id), c);
    if (!byName.has(c.name)) byName.set(c.name, []);
    byName.get(c.name).push(c);
  }
}
/** 依「卡名＋招式名」找印刷；**優先 M6a**（本批要驗的就是 M6a 那一張）。 */
const find = (n, a) => {
  const hits = (byName.get(n) || []).filter((c) => (c.attacks || []).some((x) => x.name === a));
  return hits.find((c) => String(c.setCode) === 'M6a') ?? hits[0];
};
const ZH = { Grass: '草', Fire: '火', Water: '水', Lightning: '雷', Psychic: '超', Fighting: '鬥', Darkness: '惡', Metal: '鋼' };
const EID = {};
for (const [id, c] of pool) {
  if (c.supertype !== 'Energy') continue;
  for (const [k, z] of Object.entries(ZH)) if (c.name === `基本【${z}】能量` && !EID[k]) EID[k] = id;
}
EID.Colorless = EID.Water; EID.Dragon = EID.Water; const FILL = EID.Water;
let n = 0; const inst = (cid, e = {}) => ({ iid: `w${++n}`, cardId: String(cid), damage: 0, energyAttached: [], ...e });
let pass = 0, fail = 0;
const chk = (t, c, extra = '') => { if (c) { pass++; console.log('  ✓', t); } else { fail++; console.log('  ❌', t, extra); } };

const pick = (f) => { const a = [...pool.values()].filter(f); a.sort((x, y) => Number(y.hp) - Number(x.hp)); return a[0]; };
const isEx = (c) => /ex$/.test(c.name || '');
const BASE_OK = (c) => c.supertype === 'Pokemon' && c.stage === 'Basic' && !(c.abilities || []).length && !isEx(c);
const PLAIN = pick(BASE_OK);
const typeOf = (c) => c?.pokemonType ?? null;
const neutral = (x, t) => !t || (x.weakness?.type !== t && x.resistance?.type !== t);
const neutralFor = (atk) => pick((x) => BASE_OK(x) && neutral(x, typeOf(atk))) ?? PLAIN;
/** 要驗大傷害（240）時的靶：HP 夠高才不會被打死（active=null → 讀不到 damage ＝ 假 FAIL）。 */
const bigTargetFor = (atk, minHp) => pick((x) => x.supertype === 'Pokemon' && Number(x.hp) >= minHp
  && !(x.abilities || []).length && neutral(x, typeOf(atk)));

// ── 各類 fixture 卡（不能硬編 id：卡池會變） ────────────────────────────────
const SUPPORTER = pick((c) => c.supertype === 'Trainer' && c.subtype === 'Supporter');
const SUPPORTER2 = [...pool.values()].find((c) => c.supertype === 'Trainer' && c.subtype === 'Supporter' && c.id !== SUPPORTER?.id);
const ITEM = pick((c) => c.supertype === 'Trainer' && c.subtype === 'Item');
const ITEM2 = [...pool.values()].find((c) => c.supertype === 'Trainer' && c.subtype === 'Item' && c.id !== ITEM?.id);
const STADIUM = pick((c) => c.supertype === 'Trainer' && c.subtype === 'Stadium');
const STADIUM2 = [...pool.values()].find((c) => c.supertype === 'Trainer' && c.subtype === 'Stadium' && c.id !== STADIUM?.id);
const BASIC_E = pool.get(String(EID.Water));
const BASIC_E2 = pool.get(String(EID.Psychic));
const SPECIAL_E = pick((c) => c.supertype === 'Energy' && c.subtype !== 'Basic');
const DRAGON_P = pick((c) => c.supertype === 'Pokemon' && c.pokemonType === 'Dragon');
const DRAGON_P2 = [...pool.values()].find((c) => c.supertype === 'Pokemon' && c.pokemonType === 'Dragon' && c.id !== DRAGON_P?.id);
const WATER_P = pick((c) => c.supertype === 'Pokemon' && c.pokemonType === 'Water');
const NONDRAGON_P = pick((c) => BASE_OK(c) && c.pokemonType !== 'Dragon');
// ⚠ PLAIN2 必須是**不同卡**：deckCards 放兩張同 id 時 iidIn() 會回同一個 iid → picker 只選到 1 張（假 FAIL）。
const PLAIN2 = [...pool.values()].find((c) => BASE_OK(c) && String(c.id) !== String(PLAIN.id));

function run(atkName, atk, opt = {}) {
  const def = opt.def ?? neutralFor(atk);
  const ai = (atk.attacks || []).findIndex((a) => a.name === atkName);
  if (ai < 0) return { __err: '找不到招式 ' + atkName };
  const A = inst(atk.id, opt.atkPatch || {});
  A.energyAttached = ((atk.attacks[ai].cost) || []).map((t) => inst(EID[t] ?? FILL));
  const D = inst(def.id, opt.defPatch || {});
  const s0 = createGame({ name: 'P1', entries: [{ cardId: String(atk.id), count: 1 }] },
    { name: 'P2', entries: [{ cardId: String(def.id), count: 1 }] }, pool);
  const selfBench = opt.selfBenchCards
    ? opt.selfBenchCards.map((cid) => inst(cid))
    : Array.from({ length: opt.selfBench ?? 0 }, () => inst(atk.id));
  const oppBench = Array.from({ length: opt.oppBench ?? 1 }, () => inst(def.id));
  const st = {
    ...s0, phase: 'playing', turnPhase: 'main', turn: 5, activePlayerIndex: 0, firstPlayerIdx: 0,
    isFirstTurn: false, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
    coinFlippedThisAttack: false, _attackerActiveBonusDone: false,
    activeStadium: null, activeStadiumOwnerIdx: 0, pendingSelection: null, pendingChainQueue: [], log: [],
    players: [
      { ...s0.players[0], active: A, bench: selfBench,
        hand: (opt.handCards || []).map((cid) => inst(cid)),
        deck: (opt.deckCards || Array.from({ length: opt.deckN ?? 3 }, () => PLAIN.id)).map((cid) => inst(cid)),
        discard: (opt.discardCards || []).map((cid) => inst(cid)),
        prizes: Array.from({ length: opt.prizeN ?? 6 }, () => inst(def.id)) },
      { ...s0.players[1], active: D, bench: oppBench,
        hand: (opt.oppHandCards || []).map((cid) => inst(cid)),
        deck: (opt.oppDeckCards || Array.from({ length: 3 }, () => def.id)).map((cid) => inst(cid)),
        discard: [], prizes: Array.from({ length: 6 }, () => inst(def.id)) },
    ],
  };
  const seq = opt.coins ? [...opt.coins] : null;
  let ci = 0;
  const orig = Math.random;
  Math.random = () => {
    if (seq) { const v = seq[ci++]; return v === 'H' ? 0.1 : 0.9; }
    return opt.heads === false ? 0.9 : 0.1;
  };
  let out;
  try { out = applyAction(st, { type: 'ATTACK', attackIndex: ai }, pool); }
  catch (e) { out = { __err: e.message }; }
  finally { Math.random = orig; }
  return out;
}
const P0 = (r) => r?.players?.[0];
const P1 = (r) => r?.players?.[1];
const dmgOf = (r) => P1(r)?.active?.damage ?? -1;
const pend = (r) => r?.pendingSelection ?? null;
const resolveAs = (r, iids, actor = 0) => applyAction(r, { type: 'RESOLVE_SELECTION', selectedIids: iids, actorIdx: actor }, pool);
const faceRaw = (card, a) => String((card.attacks || []).find((x) => x.name === a)?.damage ?? '');
/** 場上所有對手寶可夢的傷害總和（damage=='' 的純效果招式的哨兵：一點都不該多出來）。 */
const oppTotalDmg = (r) => [P1(r)?.active, ...(P1(r)?.bench ?? [])].filter(Boolean)
  .reduce((a, c) => a + (c.damage ?? 0), 0);
/** ⭐ 哨兵①：招式真的被引擎跑完（否則下面全是空真）。 */
const ran = (r, atkName) => P0(r)?.active?.attackUsedThisTurn === atkName;
const pubMsg = (l) => (typeof l === 'string' ? l : (l?.message || ''));
const privMsg = (l) => (typeof l === 'string' ? '' : (l?.privateMessage || ''));
const pubHas = (r, t) => (r?.log || []).some((l) => pubMsg(l).includes(t));
const privHas = (r, t) => (r?.log || []).some((l) => privMsg(l).includes(t));
const nameOfInst = (i) => pool.get(String(i.cardId))?.name ?? '?';
const cidsOf = (arr) => (arr || []).map((c) => String(c.cardId));
/** 從結果狀態的某一區找出第一張指定卡的 iid（picker 要傳真的 iid）。 */
const iidIn = (zone, cardId) => (zone || []).find((c) => String(c.cardId) === String(cardId))?.iid;

console.log('\n【0】harness 自驗（沒有這一段，下面全部可能是空真）');
{
  const c = find('暴飛龍ex', '龍之波動');
  chk('0a fixture：抓得到 M6a 的暴飛龍ex｜龍之波動（240）',
    !!c && String(c.setCode) === 'M6a' && faceRaw(c, '龍之波動') === '240', `${c?.setCode}/${faceRaw(c, '龍之波動')}`);
  chk('0b ⭐反安慰劑：不存在的招式名會回 __err（run() 不會默默成功）', !!run('這招不存在', c).__err);
  const big = bigTargetFor(c, 250);
  chk('0c fixture：找得到 HP≥250 的中立靶（240 不會把它打死 → 讀得到 damage）',
    !!big && Number(big.hp) >= 250, `${big?.name}/${big?.hp}`);
  const r = run('龍之波動', c, { def: big, deckCards: [PLAIN.id, PLAIN.id, PLAIN.id, PLAIN.id] });
  chk('0d ⭐哨兵：卡面 240 真的結算了（regPost-only，傷害由引擎讀卡面）', dmgOf(r) === 240, String(dmgOf(r)));
  chk('0e ⭐哨兵：attackUsedThisTurn 被寫成招式名（證明 ATTACK 沒有靜默 return）', ran(r, '龍之波動'),
    String(P0(r)?.active?.attackUsedThisTurn));
  chk('0f fixture：各類測試卡都抓得到',
    !!SUPPORTER && !!SUPPORTER2 && !!ITEM && !!ITEM2 && !!STADIUM && !!STADIUM2 && !!BASIC_E && !!BASIC_E2
    && !!SPECIAL_E && !!DRAGON_P && !!DRAGON_P2 && !!WATER_P && !!NONDRAGON_P
    && !!PLAIN2 && String(PLAIN2.id) !== String(PLAIN.id),
    [SUPPORTER, ITEM, STADIUM, BASIC_E, SPECIAL_E, DRAGON_P, WATER_P].map((x) => x?.name).join('/'));
}

console.log('\n【A】牌庫搜尋「帶條件」→ 手牌（4 招；minCount 必須 0＝可宣告找不到）');
{
  const c = find('拉普拉斯', '載著游水');
  const r = run('載著游水', c, { deckCards: [ITEM.id, SUPPORTER.id, ITEM2.id] });
  chk('A1 ⭐哨兵：招式跑完 + 卡面 damage 為空 ⇒ 對手場上一點傷害都不該多出來',
    ran(r, '載著游水') && oppTotalDmg(r) === 0, `${P0(r)?.active?.attackUsedThisTurn}/${oppTotalDmg(r)}`);
  chk('A2 開的是牌庫 picker，走中央 search-to-hand-reshuffle，filter=Supporter',
    pend(r)?.type === 'deck-search' && pend(r)?.effectKey === 'search-to-hand-reshuffle'
    && pend(r)?.filter === 'Supporter', `${pend(r)?.type}/${pend(r)?.effectKey}/${pend(r)?.filter}`);
  chk('A3 ⭐卡面「選擇1張」＝ maxCount 1；牌庫是隱藏資訊 ⇒ minCount 0（v6.104 可宣告找不到）',
    pend(r)?.minCount === 0 && pend(r)?.maxCount === 1, `${pend(r)?.minCount}/${pend(r)?.maxCount}`);
  const sid = iidIn(P0(r).deck, SUPPORTER.id);
  const a = resolveAs(r, [sid]);
  chk('A4 ⭐解完 picker：支援者真的進手牌、牌庫少 1 張',
    cidsOf(P0(a).hand).includes(String(SUPPORTER.id)) && P0(a).deck.length === 2,
    `hand=${cidsOf(P0(a).hand)} deck=${P0(a).deck.length}`);
  chk('A5 ⭐「在給對手看過後」＝公開揭示 ⇒ 對戰紀錄的**公開**訊息要有卡名',
    pubHas(a, SUPPORTER.name), JSON.stringify((a.log || []).map(pubMsg).slice(-3)));
  const z = resolveAs(r, []);
  chk('A6 ⭐0-pick 也要重洗牌庫（看過整副牌庫 ⇒ 不洗就洩漏順序）',
    pubHas(z, '牌庫已重洗') && P0(z).deck.length === 3, `deck=${P0(z).deck.length}`);
}
{
  const c = find('皮卡丘', '尋找朋友');
  const r = run('尋找朋友', c, { deckCards: [ITEM.id, PLAIN.id, ITEM2.id] });
  chk('A7 皮卡丘｜尋找朋友：filter=Pokemon / min0 / max1 + 哨兵',
    ran(r, '尋找朋友') && oppTotalDmg(r) === 0 && pend(r)?.filter === 'Pokemon'
    && pend(r)?.minCount === 0 && pend(r)?.maxCount === 1,
    `${pend(r)?.filter}/${pend(r)?.minCount}/${pend(r)?.maxCount}`);
  const a = resolveAs(r, [iidIn(P0(r).deck, PLAIN.id)]);
  chk('A8 解完 picker：寶可夢真的進手牌', cidsOf(P0(a).hand).includes(String(PLAIN.id)) && pubHas(a, PLAIN.name));
}
{
  const c = find('皮卡丘', '能量尾');
  const r = run('能量尾', c, { deckCards: [ITEM.id, SPECIAL_E.id, BASIC_E.id] });
  chk('A9 ⭐皮卡丘｜能量尾：卡面是「能量卡」不是「基本能量卡」⇒ filter=Energy（含特殊能量）',
    ran(r, '能量尾') && oppTotalDmg(r) === 0 && pend(r)?.filter === 'Energy'
    && pend(r)?.minCount === 0 && pend(r)?.maxCount === 1,
    `${pend(r)?.filter}/${pend(r)?.minCount}/${pend(r)?.maxCount}`);
  const a = resolveAs(r, [iidIn(P0(r).deck, SPECIAL_E.id)]);
  chk('A10 解完 picker：特殊能量也拿得到（證明 filter 不是 BasicEnergy）',
    cidsOf(P0(a).hand).includes(String(SPECIAL_E.id)));
}
{
  const c = find('哲爾尼亞斯', '大地導航');
  const r = run('大地導航', c, { deckCards: [STADIUM.id, ITEM.id, STADIUM2.id] });
  chk('A11 ⭐哲爾尼亞斯｜大地導航：卡面「最多2張競技場卡」⇒ filter=Stadium / min0 / **max2**',
    ran(r, '大地導航') && oppTotalDmg(r) === 0 && pend(r)?.filter === 'Stadium'
    && pend(r)?.minCount === 0 && pend(r)?.maxCount === 2,
    `${pend(r)?.filter}/${pend(r)?.minCount}/${pend(r)?.maxCount}`);
  const a = resolveAs(r, [iidIn(P0(r).deck, STADIUM.id), iidIn(P0(r).deck, STADIUM2.id)]);
  chk('A12 解完 picker：兩張競技場都進手牌、牌庫剩 1 張',
    P0(a).hand.length === 2 && P0(a).deck.length === 1, `${P0(a).hand.length}/${P0(a).deck.length}`);
}
{
  const c = find('幾何雪花', '呼喚信號');
  const r = c ? run('呼喚信號', c, { deckCards: [ITEM.id, PLAIN.id, ITEM2.id] }) : null;
  chk('A13 ⭐正對照：既有「幾何雪花｜呼喚信號」同樣走 search-to-hand-reshuffle / min0',
    !!c && pend(r)?.effectKey === 'search-to-hand-reshuffle' && pend(r)?.minCount === 0,
    String(pend(r)?.effectKey));
}

console.log('\n【B】牌庫「任意選擇」→ 手牌（索財靈｜走個夠；v6.126 不可以 1 張都不選）');
{
  const c = find('索財靈', '走個夠');
  const rH = run('走個夠', c, { heads: true, deckCards: [ITEM.id, PLAIN.id, BASIC_E.id] });
  chk('B1 ⭐哨兵：招式跑完、對手沒掉血', ran(rH, '走個夠') && oppTotalDmg(rH) === 0, String(oppTotalDmg(rH)));
  chk('B2 正面 → 開牌庫 picker（search-to-hand-reshuffle）',
    pend(rH)?.type === 'deck-search' && pend(rH)?.effectKey === 'search-to-hand-reshuffle',
    `${pend(rH)?.type}/${pend(rH)?.effectKey}`);
  chk('B3 ⭐⭐「任意選擇1張卡」無類別限定 ⇒ minCount 必須是 1（v6.126），不可以是 0',
    pend(rH)?.minCount === 1 && pend(rH)?.maxCount === 1, `${pend(rH)?.minCount}/${pend(rH)?.maxCount}`);
  chk('B4 ⭐卡面沒有「在給對手看過後」⇒ privateReveal=true（對手只看到張數）',
    pend(rH)?.params?.privateReveal === true, JSON.stringify(pend(rH)?.params));
  const a = resolveAs(rH, [iidIn(P0(rH).deck, ITEM.id)]);
  chk('B5 ⭐解完 picker：卡進手牌，且卡名只在**私訊**、公開訊息不得洩漏',
    cidsOf(P0(a).hand).includes(String(ITEM.id)) && privHas(a, ITEM.name) && !pubHas(a, ITEM.name),
    `hand=${cidsOf(P0(a).hand)} pub=${JSON.stringify((a.log || []).map(pubMsg).slice(-2))}`);
  const rT = run('走個夠', c, { heads: false, deckCards: [ITEM.id, PLAIN.id, BASIC_E.id] });
  chk('B6 ⭐正反對照：反面 → 不開 picker、不搜尋、牌庫不動',
    ran(rT, '走個夠') && pend(rT) === null && P0(rT).deck.length === 3 && pubHas(rT, '反面'),
    `${pend(rT)?.effectKey}/${P0(rT).deck.length}`);
}

console.log('\n【C】牌庫【基礎】寶可夢 → 備戰（皮卡丘ex｜皮卡皮卡大遊行；任意數量）');
{
  const c = find('皮卡丘ex', '皮卡皮卡大遊行');
  const r = run('皮卡皮卡大遊行', c, { deckCards: [PLAIN.id, ITEM.id, PLAIN2.id] });
  chk('C1 ⭐哨兵：招式跑完、對手沒掉血', ran(r, '皮卡皮卡大遊行') && oppTotalDmg(r) === 0, String(oppTotalDmg(r)));
  chk('C2 走中央 recruit-to-bench（牌庫 → 備戰，resolver 內含重洗）',
    pend(r)?.type === 'deck-search' && pend(r)?.effectKey === 'recruit-to-bench', `${pend(r)?.effectKey}`);
  chk('C3 ⭐⭐「任意數量」⇒ maxCount = **備戰空位**（5），不是寫死的 1/2/3；且可選 0（minCount 0）',
    pend(r)?.maxCount === 5 && pend(r)?.minCount === 0, `${pend(r)?.minCount}/${pend(r)?.maxCount}`);
  const a = resolveAs(r, [iidIn(P0(r).deck, PLAIN.id), iidIn(P0(r).deck, PLAIN2.id)]);
  chk('C4 ⭐解完 picker：兩隻基礎寶可夢真的上了**自己的**備戰，牌庫只剩 1 張',
    P0(a).bench.length === 2 && P0(a).deck.length === 1 && P1(a).bench.length === 1,
    `selfBench=${P0(a).bench.length} deck=${P0(a).deck.length}`);
  const rFull = run('皮卡皮卡大遊行', c, { selfBench: 5, deckCards: [PLAIN.id, PLAIN.id] });
  chk('C5 ⭐備戰區已滿 ⇒ 不開 picker、不當掉', !rFull.__err && pend(rFull) === null && pubHas(rFull, '備戰區已滿'),
    rFull.__err ?? String(pend(rFull)?.effectKey));
  const dz = find('毒電嬰', '呼朋引伴');
  const rz = dz ? run('呼朋引伴', dz, { deckCards: [PLAIN.id, PLAIN.id, ITEM.id] }) : null;
  chk('C6 ⭐正對照：既有「毒電嬰｜呼朋引伴」同樣 recruit-to-bench，但 maxCount 是卡面的 2（不是備戰空位）',
    !!dz && pend(rz)?.effectKey === 'recruit-to-bench' && pend(rz)?.maxCount === 2,
    `${pend(rz)?.effectKey}/${pend(rz)?.maxCount}`);
}

console.log('\n【D】丟棄自己牌庫上方（暴飛龍ex｜龍之波動 2 張、莫魯貝可｜選點心 3 張＋挑 1）');
{
  const c = find('暴飛龍ex', '龍之波動');
  const big = bigTargetFor(c, 250);
  const r = run('龍之波動', c, { def: big, deckCards: [ITEM.id, ITEM2.id, PLAIN.id, BASIC_E.id] });
  chk('D1 ⭐哨兵：卡面 240 真的結算（本批唯一有傷害的招式，禁止 regPre 硬寫）', dmgOf(r) === 240, String(dmgOf(r)));
  chk('D2 ⭐牌庫上方 **2** 張進棄牌區（不是 1、不是 3），順序由上往下',
    P0(r).discard.length === 2 && P0(r).deck.length === 2
    && cidsOf(P0(r).discard).join() === [ITEM.id, ITEM2.id].join(),
    `discard=${cidsOf(P0(r).discard)} deck=${P0(r).deck.length}`);
  const rEmpty = run('龍之波動', c, { def: big, deckCards: [] });
  chk('D3 ⭐牌庫為空 ⇒ 只寫 log 不當掉，傷害照打', !rEmpty.__err && dmgOf(rEmpty) === 240 && pubHas(rEmpty, '自己牌庫為空'),
    rEmpty.__err ?? String(dmgOf(rEmpty)));
  const ax = find('斧牙龍', '龍之波動');
  const rx = ax ? run('龍之波動', ax, { deckCards: [ITEM.id, ITEM2.id, PLAIN.id] }) : null;
  chk('D4 ⭐正對照：既有「斧牙龍｜龍之波動」丟 1 張（同一支 helper，數字不同）',
    !!ax && P0(rx).discard.length === 1 && P0(rx).deck.length === 2, `${P0(rx)?.discard?.length}`);
}
{
  const c = find('莫魯貝可', '選點心');
  const r = run('選點心', c, {
    deckCards: [ITEM.id, SUPPORTER.id, BASIC_E.id, PLAIN.id],
    discardCards: [STADIUM.id],   // 事前就在棄牌區的卡：**不可以**出現在候選裡
  });
  chk('D5 ⭐哨兵：招式跑完、對手沒掉血', ran(r, '選點心') && oppTotalDmg(r) === 0, String(oppTotalDmg(r)));
  chk('D6 ⭐先丟再挑：牌庫上方 **3** 張已經真的進棄牌區（棄牌區 1+3=4、牌庫剩 1）',
    P0(r).discard.length === 4 && P0(r).deck.length === 1, `${P0(r).discard.length}/${P0(r).deck.length}`);
  chk('D7 走 discard-to-hand，且卡面「選擇1張」⇒ minCount=maxCount=1',
    pend(r)?.type === 'discard-search' && pend(r)?.effectKey === 'discard-to-hand'
    && pend(r)?.minCount === 1 && pend(r)?.maxCount === 1,
    `${pend(r)?.effectKey}/${pend(r)?.minCount}/${pend(r)?.maxCount}`);
  const valid = pend(r)?.params?.validIids ?? [];
  const preIid = iidIn(P0(r).discard, STADIUM.id);
  chk('D8 ⭐⭐候選只綁在「剛丟的那 3 張」—— 事前就在棄牌區的卡不可以被選',
    valid.length === 3 && !valid.includes(preIid),
    `valid=${valid.length} 包含事前棄牌=${valid.includes(preIid)}`);
  const a = resolveAs(r, [iidIn(P0(r).discard, SUPPORTER.id)]);
  chk('D9 ⭐解完 picker：那張真的進手牌、棄牌區剩 3 張，且「給對手看過」＝公開揭示卡名',
    cidsOf(P0(a).hand).includes(String(SUPPORTER.id)) && P0(a).discard.length === 3 && pubHas(a, SUPPORTER.name),
    `hand=${cidsOf(P0(a).hand)} discard=${P0(a).discard.length}`);
  const rShort = run('選點心', c, { deckCards: [ITEM.id] });
  chk('D10 ⭐牌庫只剩 1 張 ⇒ 丟到沒有為止、候選只有 1 張，不當掉',
    !rShort.__err && P0(rShort).discard.length === 1 && (pend(rShort)?.params?.validIids ?? []).length === 1,
    rShort.__err ?? String(P0(rShort)?.discard?.length));
}

console.log('\n【E】棄牌區 → 手牌（皮卡丘｜存起來，最多 2 張基本能量）');
{
  const c = find('皮卡丘', '存起來');
  const r = run('存起來', c, { discardCards: [BASIC_E.id, ITEM.id, BASIC_E2.id, SPECIAL_E.id] });
  chk('E1 ⭐哨兵：招式跑完、對手沒掉血', ran(r, '存起來') && oppTotalDmg(r) === 0, String(oppTotalDmg(r)));
  chk('E2 走 discard-to-hand，filter=BasicEnergy，maxCount=2（卡面「最多2張」）',
    pend(r)?.type === 'discard-search' && pend(r)?.effectKey === 'discard-to-hand'
    && pend(r)?.filter === 'BasicEnergy' && pend(r)?.maxCount === 2,
    `${pend(r)?.effectKey}/${pend(r)?.filter}/${pend(r)?.maxCount}`);
  chk('E3 ⭐棄牌區是公開資訊 ⇒ 純「最多N張」措辭維持站規必選 ≥1（minCount 1）',
    pend(r)?.minCount === 1, String(pend(r)?.minCount));
  const a = resolveAs(r, [iidIn(P0(r).discard, BASIC_E.id), iidIn(P0(r).discard, BASIC_E2.id)]);
  chk('E4 ⭐解完 picker：2 張基本能量進手牌、棄牌區剩 2 張，且公開揭示卡名',
    P0(a).hand.length === 2 && P0(a).discard.length === 2 && pubHas(a, '從棄牌取回'),
    `hand=${P0(a).hand.length} discard=${P0(a).discard.length}`);
  const rNone = run('存起來', c, { discardCards: [ITEM.id, SPECIAL_E.id] });
  chk('E5 ⭐棄牌區沒有基本能量 ⇒ 不開空 picker、不當掉',
    !rNone.__err && pend(rNone) === null && pubHas(rNone, '棄牌區沒有可選的卡'), String(pend(rNone)?.effectKey));
  const tb = find('鐵斑葉', '補全之網');
  const rb = tb ? run('補全之網', tb, { discardCards: [PLAIN.id, ITEM.id, NONDRAGON_P.id] }) : null;
  chk('E6 ⭐正對照：既有「鐵斑葉｜補全之網」同樣 discard-to-hand / min1 / max2',
    !!tb && pend(rb)?.effectKey === 'discard-to-hand' && pend(rb)?.minCount === 1 && pend(rb)?.maxCount === 2,
    `${pend(rb)?.effectKey}/${pend(rb)?.minCount}/${pend(rb)?.maxCount}`);
}

console.log('\n【F】棄牌區 → 牌庫並重洗（帝牙盧卡｜反轉時間，寶可夢＋基本能量合計最多 3 張）');
{
  const c = find('帝牙盧卡', '反轉時間');
  const r = run('反轉時間', c, {
    discardCards: [PLAIN.id, NONDRAGON_P.id, BASIC_E.id, ITEM.id, SPECIAL_E.id],
    deckCards: [ITEM2.id, ITEM2.id],
  });
  chk('F1 ⭐哨兵：招式跑完、對手沒掉血', ran(r, '反轉時間') && oppTotalDmg(r) === 0, String(oppTotalDmg(r)));
  chk('F2 ⭐⭐「合計最多3張」＝**一個** picker 混選兩種卡型（filter=PokemonOrBasicEnergy、maxCount 3）',
    pend(r)?.type === 'discard-search' && pend(r)?.filter === 'PokemonOrBasicEnergy'
    && pend(r)?.maxCount === 3, `${pend(r)?.filter}/${pend(r)?.maxCount}`);
  chk('F3 共用聖灰的中央 resolver，且 label 有參數化（log 要寫「反轉時間」不是「聖灰」）',
    pend(r)?.effectKey === 'sacred-ash-discard-to-deck' && pend(r)?.params?.label === '反轉時間',
    `${pend(r)?.effectKey}/${pend(r)?.params?.label}`);
  const valid = pend(r)?.params?.validIids ?? [];
  chk('F4 ⭐候選只有 3 張（2 寶可夢 + 1 基本能量）—— 物品卡與特殊能量都不在內',
    valid.length === 3 && !valid.includes(iidIn(P0(r).discard, ITEM.id))
    && !valid.includes(iidIn(P0(r).discard, SPECIAL_E.id)), `valid=${valid.length}`);
  const a = resolveAs(r, valid);
  chk('F5 ⭐解完 picker：3 張真的回到牌庫（2→5）、棄牌區只剩物品與特殊能量',
    P0(a).deck.length === 5 && P0(a).discard.length === 2
    && cidsOf(P0(a).discard).sort().join() === [String(ITEM.id), String(SPECIAL_E.id)].sort().join(),
    `deck=${P0(a).deck.length} discard=${cidsOf(P0(a).discard)}`);
  chk('F6 ⭐「在給對手看過後」＝公開揭示；且 log 標籤是「反轉時間」',
    pubHas(a, '反轉時間：') && pubHas(a, PLAIN.name) && !pubHas(a, '聖灰：'),
    JSON.stringify((a.log || []).map(pubMsg).slice(-2)));
}
{
  // ⭐ 正對照：既有「聖灰」（Item）共用同一支 resolver，沒傳 label ⇒ 一定要 fallback 回「聖灰」
  const ash = TRAINER_EFFECTS.get('聖灰');
  const holder = find('帝牙盧卡', '反轉時間');
  const st = run('反轉時間', holder, { discardCards: [PLAIN.id], deckCards: [ITEM.id] });
  const base = { ...st, pendingSelection: null, pendingChainQueue: [] };
  const opened = ash ? ash(base, 0, pool) : null;
  const after = opened?.pendingSelection
    ? resolveAs(opened, [iidIn(opened.players[0].discard, PLAIN.id)]) : null;
  // ⚠ 不可以只驗 pubHas('聖灰：') —— 聖灰**開 picker** 那行 log 本來就以「聖灰：」開頭，
  //   會把「resolver 的 label fallback 壞掉」矇混過去（實測 M29 因此沒紅＝安慰劑）。
  //   ⇒ 驗的是 **resolver 產出的那一行**：「聖灰：<卡名>（N 張）放回牌庫並重洗」。
  chk('F7 ⭐正對照：既有「聖灰」沒傳 label ⇒ resolver 的結算 log fallback 成「聖灰：」（相容紀律 A）',
    !!after && pubHas(after, `聖灰：${PLAIN.name}`) && !pubHas(after, `反轉時間：${PLAIN.name}`),
    JSON.stringify((after?.log || []).map(pubMsg).slice(-2)));
}

console.log('\n【G】棄牌區【龍】寶可夢 → 備戰（暴飛龍ex｜轟鳴呼聲，最多 3 張）');
{
  const c = find('暴飛龍ex', '轟鳴呼聲');
  // ⚠ 棄牌區要放滿 3 張【龍】，maxCount 才驗得到卡面的「最多3張」（候選只有 2 張時 min() 會遮掉）。
  const r = run('轟鳴呼聲', c, { discardCards: [DRAGON_P.id, NONDRAGON_P.id, DRAGON_P.id, ITEM.id, DRAGON_P2.id] });
  chk('G1 ⭐哨兵：招式跑完、對手沒掉血（卡面 damage 為空）',
    ran(r, '轟鳴呼聲') && oppTotalDmg(r) === 0, `${P0(r)?.active?.attackUsedThisTurn}/${oppTotalDmg(r)}`);
  chk('G2 ⭐是從**棄牌區**放備戰（discard-search + bench-from-discard-samename，不是牌庫），且卡面「最多3張」⇒ maxCount 3',
    pend(r)?.type === 'discard-search' && pend(r)?.effectKey === 'bench-from-discard-samename'
    && pend(r)?.maxCount === 3,
    `${pend(r)?.type}/${pend(r)?.effectKey}/${pend(r)?.maxCount}`);
  const valid = pend(r)?.params?.validIids ?? [];
  chk('G3 ⭐候選只有【龍】寶可夢 3 張（非龍寶可夢與物品卡都排除），targetName=【龍】寶可夢',
    valid.length === 3 && !valid.includes(iidIn(P0(r).discard, NONDRAGON_P.id))
    && !valid.includes(iidIn(P0(r).discard, ITEM.id))
    && pend(r)?.params?.targetName === '【龍】寶可夢',
    `valid=${valid.length}/${pend(r)?.params?.targetName}`);
  const a = resolveAs(r, valid);
  chk('G4 ⭐解完 picker：3 隻【龍】真的上了自己的備戰、棄牌區剩下 2 張（且上場的全是【龍】）',
    P0(a).bench.length === 3 && P0(a).discard.length === 2
    && P0(a).bench.every((b) => pool.get(String(b.cardId))?.pokemonType === 'Dragon'),
    `bench=${cidsOf(P0(a).bench)} discard=${P0(a).discard.length}`);
  const rFull = run('轟鳴呼聲', c, { selfBench: 5, discardCards: [DRAGON_P.id] });
  chk('G5 ⭐備戰區已滿 ⇒ 不開 picker、不當掉', !rFull.__err && pend(rFull) === null && pubHas(rFull, '備戰區已滿'),
    rFull.__err ?? String(pend(rFull)?.effectKey));
  const rNone = run('轟鳴呼聲', c, { discardCards: [NONDRAGON_P.id, ITEM.id] });
  chk('G6 ⭐棄牌區沒有【龍】⇒ 不開空 picker', !rNone.__err && pend(rNone) === null && pubHas(rNone, '棄牌區無【龍】寶可夢'),
    String(pend(rNone)?.effectKey));
  const kg = find('刺龍王ex', '王之號召');
  const rk = kg ? run('王之號召', kg, { discardCards: [WATER_P.id, ITEM.id] }) : null;
  chk('G7 ⭐正對照：收斂後的既有「刺龍王ex｜王之號召」仍然開【水】寶可夢的 picker',
    !!kg && pend(rk)?.effectKey === 'bench-from-discard-samename'
    && pend(rk)?.params?.targetName === '【水】寶可夢' && (pend(rk)?.params?.validIids ?? []).length === 1,
    `${pend(rk)?.effectKey}/${pend(rk)?.params?.targetName}`);
}

console.log('\n【H】抽到手牌滿 N 張（基拉祈ex｜實現願望 7、皮卡丘｜南國氛圍 睡眠 + 6）');
{
  const c = find('基拉祈ex', '實現願望');
  const r = run('實現願望', c, { handCards: [ITEM.id, ITEM2.id], deckCards: Array.from({ length: 10 }, () => PLAIN.id) });
  chk('H1 ⭐哨兵 + 手牌 2 → 補到剛好 **7** 張（牌庫 10→5）',
    ran(r, '實現願望') && oppTotalDmg(r) === 0 && P0(r).hand.length === 7 && P0(r).deck.length === 5,
    `hand=${P0(r).hand.length} deck=${P0(r).deck.length}`);
  const rFull = run('實現願望', c, {
    handCards: Array.from({ length: 8 }, () => ITEM.id), deckCards: Array.from({ length: 10 }, () => PLAIN.id) });
  chk('H2 ⭐手牌已經 8 張（≥7）⇒ **一張都不抽**（不是抽 0 也不是報錯）',
    !rFull.__err && P0(rFull).hand.length === 8 && P0(rFull).deck.length === 10 && pubHas(rFull, '手牌已滿'),
    `hand=${P0(rFull).hand.length} deck=${P0(rFull).deck.length}`);
  const rShort = run('實現願望', c, { handCards: [], deckCards: [PLAIN.id, PLAIN.id] });
  chk('H3 ⭐牌庫不足 ⇒ 抽到沒有為止，不當掉',
    !rShort.__err && P0(rShort).hand.length === 2 && P0(rShort).deck.length === 0, String(P0(rShort)?.hand?.length));
  const ow = find('狙射樹梟', '羽毛庫存');
  const ro = ow ? run('羽毛庫存', ow, { handCards: [ITEM.id], deckCards: Array.from({ length: 10 }, () => PLAIN.id) }) : null;
  chk('H4 ⭐正對照：既有「狙射樹梟｜羽毛庫存」同樣抽到滿 7 張', !!ow && P0(ro).hand.length === 7, String(P0(ro)?.hand?.length));
}
{
  const c = find('皮卡丘', '南國氛圍');
  const r = run('南國氛圍', c, { handCards: [], deckCards: Array.from({ length: 10 }, () => PLAIN.id) });
  const a0 = P0(r)?.active;
  const asleep = !!a0 && (a0.status === 'asleep' || a0.secondaryStatus === 'asleep' || a0.tertiaryStatus === 'asleep');
  chk('H5 ⭐把**這隻**寶可夢【睡眠】（selfStatusPost；不是打對手的 statusPost）', ran(r, '南國氛圍') && asleep,
    JSON.stringify([a0?.status, a0?.secondaryStatus, a0?.tertiaryStatus]));
  chk('H6 ⭐再抽到手牌滿 **6** 張（不是 7；牌庫 10→4）',
    P0(r).hand.length === 6 && P0(r).deck.length === 4 && oppTotalDmg(r) === 0,
    `hand=${P0(r).hand.length} deck=${P0(r).deck.length}`);
  chk('H7 ⭐【睡眠】是加在**自己**身上，不是對手',
    !(P1(r)?.active?.status === 'asleep' || P1(r)?.active?.secondaryStatus === 'asleep'),
    String(P1(r)?.active?.status));
  const rFull = run('南國氛圍', c, {
    handCards: Array.from({ length: 7 }, () => ITEM.id), deckCards: Array.from({ length: 10 }, () => PLAIN.id) });
  const b0 = P0(rFull)?.active;
  chk('H8 ⭐手牌已 7 張 ⇒ 不抽，但【睡眠】照樣要中（兩段互相獨立）',
    P0(rFull).hand.length === 7 && P0(rFull).deck.length === 10
    && (b0?.status === 'asleep' || b0?.secondaryStatus === 'asleep' || b0?.tertiaryStatus === 'asleep'),
    `hand=${P0(rFull).hand.length} status=${b0?.status}`);
}

console.log('\n【I】查看對手手牌（皮卡丘｜窺視、伊布｜叼去藏）—— ⚠⚠ Check T 資訊洩漏');
{
  const c = find('皮卡丘', '窺視');
  const r = run('窺視', c, { oppHandCards: [ITEM.id, SUPPORTER.id] });
  chk('I1 ⭐哨兵：招式跑完、對手沒掉血', ran(r, '窺視') && oppTotalDmg(r) === 0, String(oppTotalDmg(r)));
  chk('I2 走中央 peek-opp-hand-view-only（純檢視 picker：maxCount 0、來源是對手手牌）',
    pend(r)?.type === 'hand-choose' && pend(r)?.effectKey === 'peek-opp-hand-view-only'
    && pend(r)?.actorIdx === 0 && pend(r)?.sourcePlayerIdx === 1 && pend(r)?.maxCount === 0,
    `${pend(r)?.type}/${pend(r)?.effectKey}/${pend(r)?.maxCount}`);
  chk('I3 ⭐⭐Check T：**公開** log 只有張數，絕不可出現對手手牌的卡名',
    !pubHas(r, ITEM.name) && !pubHas(r, SUPPORTER.name) && pubHas(r, '查看對手手牌'),
    JSON.stringify((r.log || []).map(pubMsg)));
  const rEmpty = run('窺視', c, { oppHandCards: [] });
  chk('I4 ⭐對手手牌為空 ⇒ 不開空 picker、不當掉', !rEmpty.__err && pend(rEmpty) === null, String(pend(rEmpty)?.effectKey));
  const mm = find('妙喵', '看透');
  const rm = mm ? run('看透', mm, { oppHandCards: [ITEM.id] }) : null;
  chk('I5 ⭐正對照：既有「妙喵｜看透」同樣走 peek-opp-hand-view-only',
    !!mm && pend(rm)?.effectKey === 'peek-opp-hand-view-only', String(pend(rm)?.effectKey));
}
{
  const c = find('伊布', '叼去藏');
  // ⚠ 對手牌庫放 8 張：J6「順序原封不動」要夠長，才不會被一次僥倖的洗牌矇混過去。
  const oppDeck = Array.from({ length: 8 }, () => PLAIN.id);
  const r = run('叼去藏', c, { oppHandCards: [SUPPORTER.id, ITEM.id, BASIC_E.id], oppDeckCards: oppDeck });
  chk('J1 ⭐哨兵：招式跑完、對手沒掉血', ran(r, '叼去藏') && oppTotalDmg(r) === 0, String(oppTotalDmg(r)));
  chk('J2 ⭐⭐Check T：picker 之前**公開** log 不可出現對手手牌卡名；卡名只在 actor 私訊',
    !pubHas(r, SUPPORTER.name) && !pubHas(r, ITEM.name) && privHas(r, ITEM.name) && pubHas(r, '查看對手手牌'),
    JSON.stringify((r.log || []).map(pubMsg)));
  chk('J3 走中央 peek-pick-to-deck-bottom（來源＝對手手牌），卡面「選擇1張」⇒ min=max=1',
    pend(r)?.effectKey === 'peek-pick-to-deck-bottom' && pend(r)?.sourcePlayerIdx === 1
    && pend(r)?.actorIdx === 0 && pend(r)?.minCount === 1 && pend(r)?.maxCount === 1,
    `${pend(r)?.effectKey}/${pend(r)?.minCount}/${pend(r)?.maxCount}`);
  const valid = pend(r)?.params?.validIids ?? [];
  chk('J4 ⭐候選只有**物品卡**（支援者與能量都排除）',
    valid.length === 1 && valid[0] === iidIn(P1(r).hand, ITEM.id), `valid=${valid.length}`);
  const before = P1(r).deck.map((x) => x.iid);
  const a = resolveAs(r, valid);
  const d = P1(a).deck;
  chk('J5 ⭐解完 picker：那張物品卡從對手手牌消失、放到對手牌庫**最下方**',
    P1(a).hand.length === 2 && d.length === 9 && String(d[d.length - 1].cardId) === String(ITEM.id),
    `hand=${P1(a).hand.length} deck=${d.length} bottom=${nameOfInst(d[d.length - 1])}`);
  chk('J6 ⭐⭐卡面沒有「重洗」⇒ 原本的牌庫順序必須**原封不動**（keep-order，不可洗牌）',
    d.slice(0, 8).map((x) => x.iid).join() === before.join(), `${d.slice(0, 8).map((x) => x.iid).join()}`);
  chk('J7 放回牌庫的那一張是公開資訊（雙方都看過）⇒ 公開 log 要有卡名', pubHas(a, ITEM.name));
  const rNoItem = run('叼去藏', c, { oppHandCards: [SUPPORTER.id, BASIC_E.id], oppDeckCards: oppDeck });
  chk('J8 ⭐對手手牌沒有物品卡 ⇒ 仍然要讓玩家「查看」（maxCount 0 的純檢視 picker），不可整招跳過',
    pend(rNoItem)?.effectKey === 'peek-pick-to-deck-bottom' && pend(rNoItem)?.maxCount === 0
    && (pend(rNoItem)?.params?.validIids ?? []).length === 0 && pubHas(rNoItem, '對手手牌無物品卡'),
    `${pend(rNoItem)?.effectKey}/${pend(rNoItem)?.maxCount}`);
  chk('J9 ⭐無物品卡時也不得洩漏：公開 log 沒有卡名、私訊有',
    !pubHas(rNoItem, SUPPORTER.name) && privHas(rNoItem, SUPPORTER.name));
  const rEmpty = run('叼去藏', c, { oppHandCards: [] });
  chk('J10 ⭐對手手牌為空 ⇒ 不開 picker、不當掉', !rEmpty.__err && pend(rEmpty) === null, String(pend(rEmpty)?.effectKey));
}

console.log('\n【K】手牌洗回牌庫（滑滑小子｜挑毛病 對手、賽富豪｜歡慶 自己＋獎賞）');
{
  const c = find('滑滑小子', '挑毛病');
  const r = run('挑毛病', c, {
    handCards: [ITEM.id, ITEM2.id],
    oppHandCards: [SUPPORTER.id, ITEM.id, BASIC_E.id],
    oppDeckCards: Array.from({ length: 10 }, () => PLAIN.id),
  });
  chk('K1 ⭐哨兵：招式跑完、對手沒掉血', ran(r, '挑毛病') && oppTotalDmg(r) === 0, String(oppTotalDmg(r)));
  chk('K2 ⭐對手手牌 3 張洗回牌庫後抽 **4** 張（手牌 3→4、牌庫 10→9）',
    P1(r).hand.length === 4 && P1(r).deck.length === 9, `hand=${P1(r).hand.length} deck=${P1(r).deck.length}`);
  chk('K3 ⭐⭐方向對照：主詞是「對手」⇒ **自己的**手牌與牌庫完全沒動（不是 bothReturnHandAndDraw）',
    P0(r).hand.length === 2 && cidsOf(P0(r).hand).sort().join() === [String(ITEM.id), String(ITEM2.id)].sort().join(),
    `selfHand=${cidsOf(P0(r).hand)}`);
  const rShort = run('挑毛病', c, { oppHandCards: [], oppDeckCards: [PLAIN.id, PLAIN.id] });
  chk('K4 ⭐對手牌庫不足 4 張 ⇒ 抽到沒有為止，不當掉',
    !rShort.__err && P1(rShort).hand.length === 2 && P1(rShort).deck.length === 0,
    rShort.__err ?? `hand=${P1(rShort)?.hand?.length}`);
  const fw = find('巨翅飛魚', '掀起波浪');
  const rw = fw ? run('掀起波浪', fw, {
    handCards: [ITEM.id, ITEM2.id], oppHandCards: [SUPPORTER.id],
    deckCards: Array.from({ length: 10 }, () => PLAIN.id),
    oppDeckCards: Array.from({ length: 10 }, () => PLAIN.id) }) : null;
  chk('K5 ⭐正反對照：既有「巨翅飛魚｜掀起波浪」是**雙方**各洗各抽 4（證明 K3 的方向判準真的分得開）',
    !!fw && P0(rw).hand.length === 4 && P1(rw).hand.length === 4,
    `self=${P0(rw)?.hand?.length} opp=${P1(rw)?.hand?.length}`);
}
{
  const c = find('賽富豪', '歡慶');
  const hand30 = Array.from({ length: 30 }, () => ITEM.id);
  const r = run('歡慶', c, { handCards: hand30, deckCards: Array.from({ length: 5 }, () => PLAIN.id) });
  chk('K6 ⭐哨兵：招式跑完、對手沒掉血', ran(r, '歡慶') && oppTotalDmg(r) === 0, String(oppTotalDmg(r)));
  chk('K7 ⭐⭐手牌剛好 30 張 ⇒ 獲得 **2** 張獎賞卡（6→4，走中央 addPendingPrize）',
    P0(r).prizes.length === 4, String(P0(r).prizes.length));
  chk('K8 ⭐然後手牌全部（含剛拿到的 2 張獎賞）放回牌庫並重洗：手牌 0、牌庫 5+30+2=37',
    P0(r).hand.length === 0 && P0(r).deck.length === 37, `hand=${P0(r).hand.length} deck=${P0(r).deck.length}`);
  const r29 = run('歡慶', c, {
    handCards: Array.from({ length: 29 }, () => ITEM.id), deckCards: Array.from({ length: 5 }, () => PLAIN.id) });
  chk('K9 ⭐⭐條件是「**剛好** 30 張」：29 張 ⇒ 不拿獎賞（獎賞仍 6 張）',
    P0(r29).prizes.length === 6, String(P0(r29).prizes.length));
  chk('K10 ⭐但「然後…放回牌庫並重洗」是句號後的獨立句 ⇒ 不管 30 不 30 都要洗回去（手牌 0、牌庫 34）',
    P0(r29).hand.length === 0 && P0(r29).deck.length === 34, `hand=${P0(r29).hand.length} deck=${P0(r29).deck.length}`);
  const r31 = run('歡慶', c, {
    handCards: Array.from({ length: 31 }, () => ITEM.id), deckCards: Array.from({ length: 5 }, () => PLAIN.id) });
  chk('K11 ⭐反向：31 張（>30）也不拿獎賞（卡面不是「30張以上」）', P0(r31).prizes.length === 6, String(P0(r31).prizes.length));
  const rWin = run('歡慶', c, { handCards: hand30, deckCards: [PLAIN.id], prizeN: 2 });
  chk('K12 ⭐獎賞只剩 2 張時取滿 ⇒ 走中央 addPendingPrize 的勝利判定（game-over）',
    rWin.phase === 'game-over' && rWin.winner === 0, `${rWin.phase}/${rWin.winner}`);
}

console.log('\n【L】丟棄對手牌庫上方（一家鼠｜一同咬；擲幣數＝場上「一家鼠」數，丟棄＝正面×2）');
{
  const c = find('一家鼠', '一同咬');
  const r3 = run('一同咬', c, {
    selfBenchCards: [c.id, c.id], heads: true,
    oppDeckCards: Array.from({ length: 10 }, () => PLAIN.id) });
  chk('L1 ⭐哨兵：招式跑完、對手沒掉血（卡面 damage 為空）',
    ran(r3, '一同咬') && oppTotalDmg(r3) === 0, `${P0(r3)?.active?.attackUsedThisTurn}/${oppTotalDmg(r3)}`);
  chk('L2 ⭐⭐場上 3 隻一家鼠（戰鬥場 1 + 備戰 2）× 全正面 ⇒ 丟棄 3×**2**=6 張（不是 3）',
    P1(r3).deck.length === 4 && P1(r3).discard.length === 6,
    `deck=${P1(r3).deck.length} discard=${P1(r3).discard.length}`);
  const r1 = run('一同咬', c, {
    selfBenchCards: [NONDRAGON_P.id, NONDRAGON_P.id], heads: true,
    oppDeckCards: Array.from({ length: 10 }, () => PLAIN.id) });
  chk('L3 ⭐⭐數量對照：備戰換成別的寶可夢 ⇒ 只有 1 隻一家鼠 ⇒ 只丟 1×2=2 張',
    P1(r1).deck.length === 8 && P1(r1).discard.length === 2,
    `deck=${P1(r1).deck.length} discard=${P1(r1).discard.length}`);
  const rT = run('一同咬', c, {
    selfBenchCards: [c.id, c.id], heads: false,
    oppDeckCards: Array.from({ length: 10 }, () => PLAIN.id) });
  chk('L4 ⭐正反對照：全反面 ⇒ 一張都不丟、不當掉',
    !rT.__err && P1(rT).deck.length === 10 && P1(rT).discard.length === 0 && pubHas(rT, '沒有卡要丟棄'),
    `deck=${P1(rT).deck.length}`);
  const rMix = run('一同咬', c, {
    selfBenchCards: [c.id, c.id], coins: ['H', 'T', 'H'],
    oppDeckCards: Array.from({ length: 10 }, () => PLAIN.id) });
  chk('L5 ⭐正反混合（正反正 = 2 正面）⇒ 丟 2×2=4 張',
    P1(rMix).deck.length === 6 && P1(rMix).discard.length === 4,
    `deck=${P1(rMix).deck.length} discard=${P1(rMix).discard.length}`);
  const rShort = run('一同咬', c, { selfBenchCards: [c.id, c.id], heads: true, oppDeckCards: [PLAIN.id, PLAIN.id] });
  chk('L6 ⭐對手牌庫不足 6 張 ⇒ 丟到沒有為止，不當掉',
    !rShort.__err && P1(rShort).deck.length === 0 && P1(rShort).discard.length === 2,
    rShort.__err ?? `deck=${P1(rShort)?.deck?.length}`);
  const sw = find('穿山王', '挖洞爪');
  const rs = sw ? run('挖洞爪', sw, { oppDeckCards: Array.from({ length: 5 }, () => PLAIN.id) }) : null;
  chk('L7 ⭐正對照：既有「穿山王｜挖洞爪」同樣走 millOppDeckTopPost（固定 1 張）',
    !!sw && P1(rs).discard.length === 1 && P1(rs).deck.length === 4, String(P1(rs)?.discard?.length));
}

console.log(`\n=== M6a 批次5 守衛：PASS ${pass} / FAIL ${fail} ===`);
process.exit(fail ? 1 : 0);
