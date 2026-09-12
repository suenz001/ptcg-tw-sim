// v6.362 守衛：站長裁定 A-1 / A-2 / A-3（三張 M6a 卡）— 全部走**完整 ATTACK / RESOLVE_SELECTION 流程**驗行為。
//
//   【A】賽富豪｜歡慶（M6a 19999 / 20030）
//        卡面：「若自己的手牌為30張，則獲得2張自己的獎賞卡。然後，將自己的手牌全部放回牌庫並重洗。」
//        站長裁定 A-1 逐字：「如果當時有翻正面的獎賞卡，就讓玩家選」
//        ⇒ 有 faceUp 獎賞時 addPendingPrize 開 take-prize-choose 逐張 picker，
//          **選完之後**才「把手牌全部放回牌庫並重洗」。
//   【B】洛奇亞｜元素爆破（M6a 20009）
//        卡面：「選擇這隻寶可夢身上附加的【火】【水】【雷】能量各1個，將其丟棄。」
//        站長裁定 A-2：「能乾脆放讓玩家選嗎??先選【火】再選【水】再選【雷】??」
//        ⇒ 依序開 3 個 picker（火→水→雷），候選集合走中央 host-aware 述詞。
//        ⚠ 本區塊是**現況錨釘**（v6.343 起就已經是這個形狀，本版沒有改動任何一行）——
//          放在這裡是為了讓「有人哪天把它改回引擎自動挑」立刻翻紅。詳見回報第 5 節。
//   【C】寶寶丁｜軟彈陣（M6a 20008）
//        卡面：「造成自己的最大HP為「30」的備戰寶可夢的數量×30點傷害。」
//        站長裁定 A-3 逐字：「如果改變hp，就以當下hp來算，因此如果當最大HP不是30hp，
//        則不列入計算(例如場上有激動競技場)」⇒ 讀中央 getEffectiveHP，不是印刷 card.hp。
//
//   ⚠ 反安慰劑紀律：
//     ・【0】段先證明 harness 不會空真（打錯招名 → __err；招式真的被執行 → attackUsedThisTurn）。
//     ・會開 picker 的一律**真的** RESOLVE_SELECTION 解掉再看盤面；「有開 picker 就算過」＝安慰劑。
//     ・每一條「不該發生」的斷言都配一個**同盤面哨兵**（拿掉那張場地／道具就回到基準值），
//       否則「整招沒跑」與「正確排除」會同時是空真。
//     ・卡片守恆：張數與 cardId multiset 前後相等（洗回牌庫會換 iid ⇒ 只能比 cardId）。
import { build } from 'esbuild';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const S = join(ROOT, '.v6362-s.js'), E = join(ROOT, '.v6362-e.ts'), O = join(ROOT, '.v6362-o.mjs');
process.on('exit', () => { for (const p of [S, E, O]) { try { unlinkSync(p); } catch { /* noop */ } } });
writeFileSync(S, 'export const base="";');
writeFileSync(E, "export { applyAction, createGame, getEffectiveHP } from './src/lib/game/engine';\nimport './src/lib/game/effects';");
await build({ entryPoints: [E], outfile: O, bundle: true, format: 'esm', platform: 'node', target: 'node20',
  alias: { $lib: join(ROOT, 'src/lib'), '$app/paths': S }, logLevel: 'error' });
const { applyAction, createGame, getEffectiveHP } = await import(pathToFileURL(O).href);

// ── 卡池（只收 index.json 列出的現役卡檔）─────────────────────────────────────
const dir = join(ROOT, 'static/cards');
const live = new Set(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).map((e) => e.code));
const pool = new Map(); const byName = new Map(); const allCards = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json') || f === 'index.json' || !live.has(f.slice(0, -5))) continue;
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    if (c?.id == null) continue;
    pool.set(String(c.id), c); allCards.push(c);
    if (!byName.has(c.name)) byName.set(c.name, []);
    byName.get(c.name).push(c);
  }
}
const printingsOf = (n, a) => (byName.get(n) || []).filter((c) => (c.attacks || []).some((x) => x.name === a));
const findM6a = (n, a) => { const h = printingsOf(n, a); return h.find((c) => String(c.setCode) === 'M6a') ?? h[0]; };
const cardNamed = (n) => (byName.get(n) || [])[0];
const ZH = { Grass: '草', Fire: '火', Water: '水', Lightning: '雷', Psychic: '超', Fighting: '鬥', Darkness: '惡', Metal: '鋼' };
const EID = {};
for (const c of allCards) { if (c.supertype !== 'Energy') continue; for (const [k, z] of Object.entries(ZH)) if (c.name === `基本【${z}】能量` && !EID[k]) EID[k] = String(c.id); }
EID.Colorless = EID.Water;

let seq = 0;
const inst = (cid, extra = {}) => ({ iid: `g${++seq}`, cardId: String(cid), damage: 0, energyAttached: [], ...extra });
let pass = 0, fail = 0;
const chk = (t, c, extra = '') => { if (c) { pass++; console.log('  ✓', t); } else { fail++; console.log('  ❌', t, extra); } };

const pick = (f) => { const a = allCards.filter(f); a.sort((x, y) => Number(y.hp) - Number(x.hp)); return a[0]; };
const isEx = (c) => c?.subtype === 'ex' || /(ex|EX|GX)$/.test(c?.name || '');
const BASE_OK = (c) => c.supertype === 'Pokemon' && c.stage === 'Basic' && !(c.abilities || []).length && !isEx(c);
const PLAIN = pick(BASE_OK);
const PLAIN2 = allCards.find((c) => BASE_OK(c) && String(c.id) !== String(PLAIN.id));
// ⚠ 靶一律挑高 HP、對出招者屬性中立的（弱點 ×2 / 抵抗 -20 會讓數字對不上；靶被打死 → active=null → 假 FAIL）
const neutral = (c, t) => !t || (c.weakness?.type !== t && c.resistance?.type !== t);
const tankFor = (atk) => pick((x) => x.supertype === 'Pokemon' && !(x.abilities || []).length && neutral(x, atk?.pokemonType));

/** 場上＋手牌＋牌庫＋棄牌＋獎賞 的 cardId multiset（洗回牌庫會換 iid ⇒ 只能比 cardId）。 */
function cardCensus(p) {
  const out = [];
  const push = (arr) => { for (const c of arr || []) { out.push(String(c.cardId)); for (const e of c.energyAttached || []) out.push(String(e.cardId)); if (c.toolAttached) out.push(String(c.toolAttached.cardId)); } };
  push(p.active ? [p.active] : []); push(p.bench); push(p.hand); push(p.deck); push(p.discard); push(p.prizes);
  return out.sort().join(',');
}

function run(atk, atkName, opt = {}) {
  const ai = (atk.attacks || []).findIndex((a) => a.name === atkName);
  if (ai < 0) return { __err: '找不到招式 ' + atkName };
  const def = opt.def ?? tankFor(atk);
  const A = inst(atk.id, opt.atkPatch || {});
  // ⚠ extraEnergy / atkEnergy 的元素可以是屬性名（'Fire'）或**能量卡 id**（特殊能量）。
  const eInst = (x) => inst(EID[x] ?? x);
  A.energyAttached = opt.atkEnergy
    ? opt.atkEnergy.map(eInst)
    : ((atk.attacks[ai].cost) || []).map(eInst).concat((opt.extraEnergy || []).map(eInst));
  const D = inst(def.id);
  const s0 = createGame({ name: 'P1', entries: [{ cardId: String(atk.id), count: 1 }] },
    { name: 'P2', entries: [{ cardId: String(def.id), count: 1 }] }, pool);
  const st = {
    ...s0, phase: 'playing', turnPhase: 'main', turn: 5, activePlayerIndex: 0, firstPlayerIdx: 0,
    isFirstTurn: false, setupDone: [true, true], pendingMulliganDraw: [0, 0], pendingPrizes: [0, 0],
    coinFlippedThisAttack: false, _attackerActiveBonusDone: false,
    activeStadium: opt.stadium ? { cardId: String(opt.stadium), iid: 'stad-v6362' } : null,
    activeStadiumOwnerIdx: 0, pendingSelection: null, pendingChainQueue: [], log: [],
    players: [
      { ...s0.players[0], active: A, bench: opt.selfBench || [],
        hand: (opt.handCards || []).map((c) => inst(c)),
        deck: (opt.deckCards || [PLAIN.id, PLAIN.id, PLAIN.id]).map((c) => inst(c)),
        discard: [], prizes: opt.prizes || Array.from({ length: 6 }, () => inst(PLAIN.id)) },
      { ...s0.players[1], active: D, bench: [inst(def.id)], hand: [],
        deck: [inst(def.id), inst(def.id)], discard: [], prizes: Array.from({ length: 6 }, () => inst(def.id)) },
    ],
  };
  const before = cardCensus(st.players[0]);
  const orig = Math.random; Math.random = () => 0.1;
  let out;
  try { out = applyAction(st, { type: 'ATTACK', attackIndex: ai }, pool); }
  catch (e) { out = { __err: e.message }; }
  finally { Math.random = orig; }
  if (out && out.players) { out.__before = before; out.__st0 = st; }
  return out;
}
const resolve = (r, iids) => { const o = applyAction(r, { type: 'RESOLVE_SELECTION', selectedIids: iids, actorIdx: 0 }, pool); if (o && o.players) o.__before = r.__before; return o; };
const P0 = (r) => r?.players?.[0];
const P1 = (r) => r?.players?.[1];
const dmgOf = (r) => P1(r)?.active?.damage ?? -1;
const pend = (r) => r?.pendingSelection ?? null;
const ran = (r, n) => P0(r)?.active?.attackUsedThisTurn === n;
const msg = (l) => (typeof l === 'string' ? l : (l?.message || ''));
const logIdx = (r, t) => (r?.log || []).findIndex((l) => msg(l).includes(t));
const nameOf = (c) => pool.get(String(c.cardId))?.name ?? '?';
const eNames = (r) => (P0(r)?.active?.energyAttached || []).map(nameOf);
const dNames = (r) => (P0(r)?.discard || []).map(nameOf);

console.log('\n【0】harness 自驗（沒有這一段，下面全部可能是空真）');
const SAIFU = findM6a('賽富豪', '歡慶');
const LUGIA = findM6a('洛奇亞', '元素爆破');
const IGGLY = findM6a('寶寶丁', '軟彈陣');
{
  chk('0a fixture：三張 M6a 卡與卡面逐字都抓得到',
    String(SAIFU?.id) === '19999' && String(SAIFU?.setCode) === 'M6a'
    && String(LUGIA?.id) === '20009' && String(IGGLY?.id) === '20008' && Number(IGGLY?.hp) === 30,
    `${SAIFU?.id}/${LUGIA?.id}/${IGGLY?.id}`);
  const fa = (c, n) => (c.attacks || []).find((x) => x.name === n);
  chk('0b fixture：卡面 effect 逐字（改卡面就翻紅）',
    fa(SAIFU, '歡慶').effect === '若自己的手牌為30張，則獲得2張自己的獎賞卡。然後，將自己的手牌全部放回牌庫並重洗。'
    && fa(LUGIA, '元素爆破').effect === '選擇這隻寶可夢身上附加的【火】【水】【雷】能量各1個，將其丟棄。'
    && JSON.stringify(fa(LUGIA, '元素爆破').cost) === '["Fire","Water","Lightning"]'
    && String(fa(LUGIA, '元素爆破').damage) === '250'
    && fa(IGGLY, '軟彈陣').effect === '造成自己的最大HP為「30」的備戰寶可夢的數量×30點傷害。'
    && String(fa(IGGLY, '軟彈陣').damage) === '30×',
    JSON.stringify([fa(SAIFU, '歡慶').effect, fa(LUGIA, '元素爆破').effect, fa(IGGLY, '軟彈陣').effect]));
  chk('0c ⭐反安慰劑：不存在的招式名會回 __err（run() 不會默默成功）', !!run(IGGLY, '這招不存在').__err);
  const r = run(IGGLY, '軟彈陣', { selfBench: [inst(IGGLY.id), inst(IGGLY.id), inst(IGGLY.id)] });
  chk('0d ⭐哨兵：ATTACK 真的被引擎執行（attackUsedThisTurn 寫成招式名）', ran(r, '軟彈陣'), String(P0(r)?.active?.attackUsedThisTurn));
  chk('0e fixture：兩張不同的測試用卡（PLAIN / PLAIN2）抓得到且不同 id',
    !!PLAIN && !!PLAIN2 && String(PLAIN.id) !== String(PLAIN2.id));
}

console.log('\n【A】賽富豪｜歡慶 — 站長裁定 A-1「如果當時有翻正面的獎賞卡，就讓玩家選」');
const hand30 = Array.from({ length: 30 }, () => PLAIN.id);
const deck5 = Array.from({ length: 5 }, () => PLAIN.id);
{
  // ① 沒有正面朝上的獎賞 ⇒ 行為與現況完全相同（不開 picker、2 張直接入手、手牌一起洗回牌庫）
  const r = run(SAIFU, '歡慶', { handCards: hand30, deckCards: deck5 });
  chk('A1 ①沒有正面朝上獎賞：不開 picker、手牌 0、牌庫 5+30+2=37、獎賞剩 4',
    pend(r) === null && P0(r).hand.length === 0 && P0(r).deck.length === 37 && P0(r).prizes.length === 4,
    `pend=${pend(r)?.effectKey} hand=${P0(r).hand.length} deck=${P0(r).deck.length} prizes=${P0(r).prizes.length}`);
  chk('A1b ①哨兵：招式真的跑完、對手一點傷害都沒多出來（卡面 damage 是空字串）',
    ran(r, '歡慶') && (P1(r).active?.damage ?? -1) === 0, String(P1(r).active?.damage));
  chk('A1c ①卡片守恆：cardId multiset 前後一致', cardCensus(P0(r)) === r.__before);

  // ② 有正面朝上的獎賞 ⇒ 真的開 picker，而且**中途盤面不可以先被洗掉**
  const mkPrizes = () => [inst(PLAIN.id, { faceUp: true }), inst(PLAIN2.id, { faceUp: true }),
    inst(PLAIN.id), inst(PLAIN.id), inst(PLAIN.id), inst(PLAIN.id)];
  const r2 = run(SAIFU, '歡慶', { handCards: hand30, deckCards: deck5, prizes: mkPrizes() });
  chk('A2 ②有正面朝上獎賞：真的開 take-prize-choose picker（remaining=2）',
    pend(r2)?.effectKey === 'take-prize-choose' && pend(r2)?.params?.remaining === 2 && pend(r2)?.actorIdx === 0,
    JSON.stringify({ k: pend(r2)?.effectKey, rem: pend(r2)?.params?.remaining }));
  chk('A3 ⭐⭐⭐③反對照：picker 還沒解，手牌 30 張**還在**、牌庫還是 5 張、獎賞還是 6 張（盤面沒被先洗掉）',
    P0(r2).hand.length === 30 && P0(r2).deck.length === 5 && P0(r2).prizes.length === 6,
    `hand=${P0(r2).hand.length} deck=${P0(r2).deck.length} prizes=${P0(r2).prizes.length}`);
  chk('A3b ⭐③反對照：picker 還沒解時 log 裡**還沒有**「將自己的手牌全部放回牌庫並重洗」',
    logIdx(r2, '歡慶：將自己的手牌全部放回牌庫並重洗') < 0,
    (r2.log || []).map(msg).join(' | '));

  // 玩家指定第 2 個選項（正面朝上的 PLAIN2）——證明「真的照玩家選的拿」，不是引擎自己挑第一張
  const opts = pend(r2)?.params?.options || [];
  chk('A4 ②picker 的選項＝2 張正面朝上 ＋ 1 個「隨機取一張蓋著的」彙總選項',
    opts.length === 3 && opts[2].id === '__prize_random_facedown__'
    && opts.slice(0, 2).every((o) => o.text.includes('正面朝上')),
    JSON.stringify(opts));
  const r3 = resolve(r2, [opts[1].id]);
  chk('A5 ⭐⭐解掉第 1 張（玩家指定第 2 個選項）：拿到的是**玩家選的那一張**（PLAIN2），手牌 31、牌庫仍 5',
    P0(r3).hand.length === 31 && P0(r3).deck.length === 5 && P0(r3).prizes.length === 5
    && P0(r3).hand.some((c) => String(c.cardId) === String(PLAIN2.id))
    && !P0(r3).prizes.some((c) => c.iid === opts[1].id),
    `hand=${P0(r3).hand.length} deck=${P0(r3).deck.length} 有PLAIN2=${P0(r3).hand.some((c) => String(c.cardId) === String(PLAIN2.id))}`);
  chk('A5b ⭐第 1 張解完後 picker 還在（還欠 1 張）、手牌**仍未**被洗回牌庫',
    pend(r3)?.effectKey === 'take-prize-choose' && pend(r3)?.params?.remaining === 1
    && logIdx(r3, '歡慶：將自己的手牌全部放回牌庫並重洗') < 0,
    JSON.stringify({ k: pend(r3)?.effectKey, rem: pend(r3)?.params?.remaining }));
  const opts2 = pend(r3)?.params?.options || [];
  const r4 = resolve(r3, [opts2[0].id]);
  chk('A6 ⭐⭐⭐選完 2 張之後**才**洗手牌：picker 清空、手牌 0、牌庫 5+30+2=37、獎賞剩 4',
    pend(r4) === null && P0(r4).hand.length === 0 && P0(r4).deck.length === 37 && P0(r4).prizes.length === 4,
    `pend=${pend(r4)?.effectKey} hand=${P0(r4).hand.length} deck=${P0(r4).deck.length} prizes=${P0(r4).prizes.length}`);
  const iTake = (r4.log || []).findIndex((l) => msg(l).includes('取得了 1 張獎賞卡'));
  const iShuffle = logIdx(r4, '歡慶：將自己的手牌全部放回牌庫並重洗');
  chk('A7 ⭐⭐⭐log 順序＝先取獎賞、後洗手牌（卡面「然後」的順序）',
    iTake >= 0 && iShuffle >= 0 && iTake < iShuffle, `取獎@${iTake} 洗牌@${iShuffle}`);
  chk('A8 ②卡片守恆：cardId multiset 前後一致（沒有憑空多出或消失）',
    cardCensus(P0(r4)) === r4.__before,
    `before=${(r4.__before || '').length} after=${cardCensus(P0(r4)).length}`);
  chk('A9 ⭐⭐②兩張獎賞都**真的**進過手牌再一起洗回牌庫（牌庫裡找得到那兩張正面朝上的卡）',
    P0(r4).deck.filter((c) => String(c.cardId) === String(PLAIN2.id)).length === 1
    && P0(r4).hand.length === 0 && P0(r4).prizes.every((c) => !c.faceUp),
    `deck內PLAIN2=${P0(r4).deck.filter((c) => String(c.cardId) === String(PLAIN2.id)).length}`);
  chk('A10 旗標層補充：跨 picker 待辦 `_pendingReturnHandToDeck` 解完後已清除（不會殘留寫進 Firestore）',
    r4._pendingReturnHandToDeck === undefined && r3._pendingReturnHandToDeck !== undefined,
    `r3=${JSON.stringify(r3._pendingReturnHandToDeck)} r4=${JSON.stringify(r4._pendingReturnHandToDeck)}`);

  // ④ 取完最後一張獎賞就獲勝 ⇒ 不再洗手牌（與同步路徑 `if (phase==='game-over') return s` 同一條判準）
  const rWin0 = run(SAIFU, '歡慶', { handCards: hand30, deckCards: deck5,
    prizes: [inst(PLAIN.id, { faceUp: true }), inst(PLAIN2.id, { faceUp: true })] });
  const o1 = pend(rWin0)?.params?.options || [];
  const rWin1 = resolve(rWin0, [o1[0].id]);
  const o2 = pend(rWin1)?.params?.options || [];
  const rWin = o2.length ? resolve(rWin1, [o2[0].id]) : rWin1;
  chk('A11 ⭐④取完所有獎賞獲勝 ⇒ 不洗手牌（手牌 30+2=32、牌庫仍 5），且待辦旗標已清除',
    rWin.phase === 'game-over' && rWin.winner === 0
    && P0(rWin).hand.length === 32 && P0(rWin).deck.length === 5
    && rWin._pendingReturnHandToDeck === undefined,
    `phase=${rWin.phase} winner=${rWin.winner} hand=${P0(rWin).hand.length} deck=${P0(rWin).deck.length}`);

  // ⑤ 使用前提（v6.350 站長裁定）不可被本版動到
  const r29 = run(SAIFU, '歡慶', { handCards: hand30.slice(0, 29), deckCards: deck5, prizes: mkPrizes() });
  chk('A12 ⭐哨兵：手牌 29 張時整招不可使用（v6.350 的使用前提沒被本版動到）— 盤面完全沒變、沒開 picker',
    !ran(r29, '歡慶') && P0(r29).hand.length === 29 && P0(r29).deck.length === 5
    && P0(r29).prizes.length === 6 && pend(r29) === null,
    `ran=${ran(r29, '歡慶')} hand=${P0(r29).hand.length} prizes=${P0(r29).prizes.length}`);

  // ⑥ 兩個印刷都要有同樣行為（M6a 19999 / 20030）
  const allPrints = printingsOf('賽富豪', '歡慶').filter((c) => String(c.setCode) === 'M6a');
  chk('A13 fixture：M6a 的「賽富豪｜歡慶」有 2 個印刷（19999 / 20030）',
    allPrints.length === 2 && allPrints.map((c) => String(c.id)).sort().join(',') === '19999,20030',
    allPrints.map((c) => c.id).join(','));
  for (const p of allPrints) {
    const rp = run(p, '歡慶', { handCards: hand30, deckCards: deck5, prizes: mkPrizes() });
    const op = pend(rp)?.params?.options || [];
    const rp1 = resolve(rp, [op[0].id]);
    const op1 = pend(rp1)?.params?.options || [];
    const rp2 = resolve(rp1, [op1[0].id]);
    chk(`A14 印刷 ${p.id}：開 picker → 解完 2 張 → 手牌 0 / 牌庫 37（兩個印刷行為一致）`,
      pend(rp)?.effectKey === 'take-prize-choose' && P0(rp).hand.length === 30
      && pend(rp2) === null && P0(rp2).hand.length === 0 && P0(rp2).deck.length === 37,
      `pend=${pend(rp)?.effectKey} mid-hand=${P0(rp).hand.length} end-hand=${P0(rp2).hand.length} deck=${P0(rp2).deck.length}`);
  }
}

console.log('\n【B】洛奇亞｜元素爆破 — 站長裁定 A-2「先選【火】再選【水】再選【雷】」');
{
  const ANCIENT = cardNamed('古舊能量');      // 特殊能量：視為 1 個**所有屬性**的能量
  const HARDROCK = cardNamed('硬岩【鬥】能量'); // 特殊能量：只提供【鬥】⇒ 三個 picker 都不該列它
  chk('B0 fixture：古舊能量／硬岩【鬥】能量 都抓得到', !!ANCIENT && !!HARDROCK, `${ANCIENT?.id}/${HARDROCK?.id}`);

  // ① 各屬性都只有 1 個候選 ⇒ 依站上既有慣例直接丟（沒有可選餘地就不彈視窗）
  const r1 = run(LUGIA, '元素爆破', {});
  chk('B1 ①三種屬性各只有 1 個候選：不彈視窗、三個都丟掉、傷害 250',
    pend(r1) === null && (P0(r1).active?.energyAttached || []).length === 0
    && dNames(r1).sort().join(',') === ['基本【火】能量', '基本【水】能量', '基本【雷】能量'].sort().join(',')
    && dmgOf(r1) === 250,
    `pend=${pend(r1)?.effectKey} 棄=${dNames(r1)} dmg=${dmgOf(r1)}`);

  // ② 每種屬性各 2 個候選 ⇒ 依序開 3 個 picker：火 → 水 → 雷
  const r2 = run(LUGIA, '元素爆破', { extraEnergy: ['Fire', 'Water', 'Lightning'] });
  chk('B2 ⭐第 1 個 picker 是【火】（active-energy-discard / effectKey=discard-one-each-type）',
    pend(r2)?.type === 'active-energy-discard' && pend(r2)?.effectKey === 'discard-one-each-type'
    && String(pend(r2)?.params?.titleOverride).includes('【火】')
    && JSON.stringify(pend(r2)?.params?.restTypes) === '["Water","Lightning"]',
    JSON.stringify({ t: pend(r2)?.type, k: pend(r2)?.effectKey, title: pend(r2)?.params?.titleOverride, rest: pend(r2)?.params?.restTypes }));
  const fireIds = pend(r2)?.params?.validIids || [];
  const fireInsts = (P0(r2).active?.energyAttached || []).filter((e) => fireIds.includes(e.iid));
  chk('B3 ⭐【火】picker 的候選只有那 2 張【火】（validIids 不含水／雷）',
    fireIds.length === 2 && fireInsts.length === 2 && fireInsts.every((e) => nameOf(e) === '基本【火】能量'),
    `valid=${fireIds.length} names=${fireInsts.map(nameOf)}`);
  // ⭐⭐ 故意選**第二個**候選 —— 證明丟掉的是玩家選的那一個，不是引擎自己挑
  const keepFire = fireIds[0], dropFire = fireIds[1];
  const r3 = resolve(r2, [dropFire]);
  chk('B4 ⭐⭐玩家選第二個【火】：被丟掉的就是那一個（第一個還留在身上）',
    (P0(r3).active?.energyAttached || []).some((e) => e.iid === keepFire)
    && !(P0(r3).active?.energyAttached || []).some((e) => e.iid === dropFire),
    `留=${(P0(r3).active?.energyAttached || []).map((e) => e.iid)} 丟=${dropFire}`);
  chk('B5 ⭐第 2 個 picker 是【水】（順序 火→水→雷）',
    pend(r3)?.effectKey === 'discard-one-each-type'
    && String(pend(r3)?.params?.titleOverride).includes('【水】')
    && JSON.stringify(pend(r3)?.params?.restTypes) === '["Lightning"]'
    && (pend(r3)?.params?.validIids || []).every((i) => nameOf((P0(r3).active.energyAttached).find((e) => e.iid === i)) === '基本【水】能量'),
    JSON.stringify({ title: pend(r3)?.params?.titleOverride, rest: pend(r3)?.params?.restTypes }));
  const waterIds = pend(r3)?.params?.validIids || [];
  const r4 = resolve(r3, [waterIds[1]]);
  chk('B6 ⭐第 3 個 picker 是【雷】（restTypes 已空）',
    pend(r4)?.effectKey === 'discard-one-each-type'
    && String(pend(r4)?.params?.titleOverride).includes('【雷】')
    && JSON.stringify(pend(r4)?.params?.restTypes) === '[]',
    JSON.stringify({ title: pend(r4)?.params?.titleOverride, rest: pend(r4)?.params?.restTypes }));
  const lightIds = pend(r4)?.params?.validIids || [];
  const r5 = resolve(r4, [lightIds[1]]);
  chk('B7 ⭐⭐三個 picker 都解完：picker 清空、身上剩 3 個（火水雷各 1）、棄牌區是火水雷各 1',
    pend(r5) === null && (P0(r5).active?.energyAttached || []).length === 3
    && eNames(r5).sort().join(',') === ['基本【火】能量', '基本【水】能量', '基本【雷】能量'].sort().join(',')
    && dNames(r5).sort().join(',') === ['基本【火】能量', '基本【水】能量', '基本【雷】能量'].sort().join(','),
    `留=${eNames(r5)} 棄=${dNames(r5)}`);
  chk('B8 ⭐哨兵：卡面 250 真的結算了（傷害與丟幾個能量無關）', dmgOf(r5) === 250, String(dmgOf(r5)));

  // ③ 候選集合＝「真的能當這個屬性用」的能量（中央 host-aware 述詞 energyProvidesType）
  const r6 = run(LUGIA, '元素爆破', { extraEnergy: [ANCIENT.id, HARDROCK.id] });
  const valid6 = pend(r6)?.params?.validIids || [];
  const byIid = new Map((P0(r6).active?.energyAttached || []).map((e) => [e.iid, e]));
  chk('B9 ⭐⭐【火】候選含「視為該屬性」的古舊能量（host-aware，不是只看卡名）',
    valid6.length === 2 && valid6.map((i) => nameOf(byIid.get(i))).sort().join(',') === ['古舊能量', '基本【火】能量'].sort().join(','),
    valid6.map((i) => nameOf(byIid.get(i))).join(','));
  chk('B10 ⭐⭐反對照：只提供【鬥】的硬岩【鬥】能量**不在**【火】候選裡',
    !valid6.some((i) => nameOf(byIid.get(i)) === '硬岩【鬥】能量'),
    valid6.map((i) => nameOf(byIid.get(i))).join(','));

  // ④ 某個屬性沒有候選 —— 用「火 + 水 + 古舊能量」付費（古舊＝1 個所有屬性 ⇒ 付得出【雷】格），
  //    然後在【火】的 picker **故意選古舊**：【水】只剩 1 個候選自動丟，【雷】就沒有候選了。
  //    卡面沒有寫「否則招式失敗」⇒ 只記一行 log、招式照樣結算 250。
  //    ⭐ 官方裁定支持 fail-open：`PTCG RULES/PTCG_RULES.md` L1855
  //      Q:「…無法丟棄拉帝歐斯身上附加的3個能量，那麼可以對對手的寶可夢造成傷害嗎？」
  //      A:「可以。／ 這個情況下，丟棄2個拉帝歐斯身上附加的【超】能量。」
  //      ⇒ 丟得掉幾個就丟幾個，招式照常結算（另見 L767 / L2507 同型）。
  const r7 = run(LUGIA, '元素爆破', { atkEnergy: ['Fire', 'Water', ANCIENT.id] });
  chk('B11 ④「火+水+古舊」付得出費用，第 1 個 picker 仍是【火】且候選含古舊',
    pend(r7)?.effectKey === 'discard-one-each-type'
    && (pend(r7)?.params?.validIids || []).length === 2,
    JSON.stringify({ k: pend(r7)?.effectKey, n: (pend(r7)?.params?.validIids || []).length }));
  const anc = (P0(r7).active?.energyAttached || []).find((e) => nameOf(e) === '古舊能量');
  const r8 = resolve(r7, [anc.iid]);
  chk('B12 ⭐⭐④【火】用掉古舊之後【雷】沒有候選：不當掉、不開第 3 個 picker、傷害照樣 250',
    pend(r8) === null && dmgOf(r8) === 250
    && dNames(r8).sort().join(',') === ['古舊能量', '基本【水】能量'].sort().join(',')
    && eNames(r8).join(',') === '基本【火】能量',
    `pend=${pend(r8)?.effectKey} dmg=${dmgOf(r8)} 棄=${dNames(r8)} 留=${eNames(r8)}`);
  chk('B13 ⭐④log 逐字：「元素爆破：身上沒有【雷】能量可丟棄」（fail-open，只記一行）',
    logIdx(r8, '元素爆破：身上沒有【雷】能量可丟棄') >= 0,
    (r8.log || []).map(msg).filter((m) => m.includes('元素爆破')).join(' | '));
  chk('B14 哨兵：①②③④ 都沒有讓招式靜默失敗（attackUsedThisTurn 一律寫上）',
    ran(r1, '元素爆破') && ran(r5, '元素爆破') && ran(r8, '元素爆破'),
    `${ran(r1, '元素爆破')}/${ran(r5, '元素爆破')}/${ran(r8, '元素爆破')}`);
}
// ⚠ 能量不足的情境要繞過費用（費用本身就要 F/W/L 各 1）⇒ 用「多 1 個火、水雷各 1」的變形不成立。
//   改用「三種屬性各 1（剛好付完費用）＋ 費用支付**不丟能量**」的既有事實：付費不丟能量，
//   所以「身上沒有【水】能量」的盤面無法在合法對局中出現（cost 就付不出來）⇒ 不在本守衛範圍。
//   本版對此不做任何行為改動，詳見回報第 6 節「待站長裁示」。

console.log('\n【C】寶寶丁｜軟彈陣 — 站長裁定 A-3「以當下 hp 來算，最大HP不是30就不列入」');
{
  const STADIUM_EXCITE = allCards.find((c) => c.name === '激動競技場');         // 【基礎】最大HP +30
  const TOOL_HERO = allCards.find((c) => c.name === '英雄斗篷');                 // 最大HP +100
  const STADIUM_JAM = allCards.find((c) => c.name === '阻礙之塔');               // 道具 HP 加成失效
  const HP30 = allCards.find((c) => BASE_OK(c) && Number(c.hp) === 30 && String(c.id) !== String(IGGLY.id));
  const HP_NOT30 = allCards.find((c) => BASE_OK(c) && Number(c.hp) === 80);
  chk('C0 fixture：激動競技場／英雄斗篷／阻礙之塔／另一張 HP30【基礎】／HP80【基礎】都抓得到',
    !!STADIUM_EXCITE && !!TOOL_HERO && !!STADIUM_JAM && !!HP30 && !!HP_NOT30,
    `${STADIUM_EXCITE?.id}/${TOOL_HERO?.id}/${STADIUM_JAM?.id}/${HP30?.id}/${HP_NOT30?.id}`);
  chk('C0b fixture：兩張場地／道具的卡面逐字（改卡面就翻紅）',
    STADIUM_EXCITE.rulesText === '雙方場上所有【基礎】寶可夢的最大HP各「+30」。'
    && TOOL_HERO.rulesText === '附有這張卡的寶可夢的最大HP「+100」。',
    `${STADIUM_EXCITE.rulesText} / ${TOOL_HERO.rulesText}`);

  const bench3 = () => [inst(IGGLY.id), inst(HP30.id), inst(IGGLY.id)];
  // ① 基準
  const c1 = run(IGGLY, '軟彈陣', { selfBench: bench3() });
  chk('C1 ①基準：備戰 3 隻最大HP30 ⇒ 90（戰鬥場那一隻自己也是 HP30，但卡面寫「備戰」⇒ 不算）',
    dmgOf(c1) === 90, String(dmgOf(c1)));
  chk('C1b ⭐⑤反對照：備戰只有 2 隻 ⇒ 60（若把戰鬥場算進去會是 90）',
    dmgOf(run(IGGLY, '軟彈陣', { selfBench: [inst(IGGLY.id), inst(HP30.id)] })) === 60,
    String(dmgOf(run(IGGLY, '軟彈陣', { selfBench: [inst(IGGLY.id), inst(HP30.id)] }))));
  chk('C1c ⭐反安慰劑：備戰換成 HP80【基礎】3 隻 ⇒ 0（證明真的在比最大HP，不是數備戰隻數）',
    dmgOf(run(IGGLY, '軟彈陣', { selfBench: [inst(HP_NOT30.id), inst(HP_NOT30.id), inst(HP_NOT30.id)] })) === 0,
    String(dmgOf(run(IGGLY, '軟彈陣', { selfBench: [inst(HP_NOT30.id), inst(HP_NOT30.id), inst(HP_NOT30.id)] }))));

  // ② 來源一：道具（英雄斗篷 +100）—— 一隻被排除 ⇒ 60；同盤面拿掉道具 ⇒ 回到 90
  const benchTool = bench3(); benchTool[0] = inst(IGGLY.id, { toolAttached: inst(TOOL_HERO.id) });
  const c2 = run(IGGLY, '軟彈陣', { selfBench: benchTool });
  chk('C2 ⭐⭐②來源【道具】：備戰其中 1 隻附英雄斗篷（最大HP 130）⇒ 不列入 ⇒ 60',
    dmgOf(c2) === 60, `dmg=${dmgOf(c2)} effHP=${getEffectiveHP(P0(c2).bench[0], pool, c2)}`);
  chk('C2b ⭐②哨兵：同一盤面把道具拿掉 ⇒ 回到 90（證明不是招式整個沒跑）',
    dmgOf(run(IGGLY, '軟彈陣', { selfBench: bench3() })) === 90);
  chk('C2c ⭐⭐②中央述詞證明：阻礙之塔讓道具 HP 加成失效 ⇒ 那一隻又變回 30 ⇒ 90',
    dmgOf(run(IGGLY, '軟彈陣', { selfBench: (() => { const b = bench3(); b[0] = inst(IGGLY.id, { toolAttached: inst(TOOL_HERO.id) }); return b; })(), stadium: STADIUM_JAM.id })) === 90,
    String(dmgOf(run(IGGLY, '軟彈陣', { selfBench: (() => { const b = bench3(); b[0] = inst(IGGLY.id, { toolAttached: inst(TOOL_HERO.id) }); return b; })(), stadium: STADIUM_JAM.id }))));

  // ③ 來源二：場地（激動競技場 +30）—— 三隻全被排除 ⇒ 0；同盤面拿掉場地 ⇒ 回到 90
  const c3 = run(IGGLY, '軟彈陣', { selfBench: bench3(), stadium: STADIUM_EXCITE.id });
  chk('C3 ⭐⭐③來源【場地】：激動競技場讓三隻【基礎】最大HP 變 60 ⇒ 全不列入 ⇒ 0（站長舉的例子）',
    dmgOf(c3) === 0, `dmg=${dmgOf(c3)} effHP=${getEffectiveHP(P0(c3).bench[0], pool, c3)}`);
  chk('C3b ⭐③哨兵：同一盤面把場地拿掉 ⇒ 回到 90',
    dmgOf(run(IGGLY, '軟彈陣', { selfBench: bench3() })) === 90);
  chk('C3c ⭐⭐③混合：激動競技場 ＋ 備戰有一隻 HP80【基礎】（→110）⇒ 仍然 0（沒有人是 30）',
    dmgOf(run(IGGLY, '軟彈陣', { selfBench: [inst(IGGLY.id), inst(HP_NOT30.id), inst(HP30.id)], stadium: STADIUM_EXCITE.id })) === 0);

  // ④ 反對照：受傷但最大 HP 仍是 30 ⇒ 照樣列入（證明讀的是「最大 HP」不是「剩餘 HP」）
  const benchHurt = [inst(IGGLY.id, { damage: 20 }), inst(HP30.id, { damage: 25 }), inst(IGGLY.id, { damage: 10 })];
  chk('C4 ⭐⭐⭐④反對照：三隻都受傷（剩餘 10 / 5 / 20）但最大 HP 仍是 30 ⇒ 照樣 90（不可以拿 hp − damage）',
    dmgOf(run(IGGLY, '軟彈陣', { selfBench: benchHurt })) === 90,
    String(dmgOf(run(IGGLY, '軟彈陣', { selfBench: benchHurt }))));
  chk('C4b ⭐④反對照（另一個方向）：受傷 ＋ 英雄斗篷（最大HP 130、剩餘 110）⇒ 那一隻仍然不列入 ⇒ 60',
    dmgOf(run(IGGLY, '軟彈陣', { selfBench: (() => { const b = bench3(); b[0] = inst(IGGLY.id, { damage: 20, toolAttached: inst(TOOL_HERO.id) }); return b; })() })) === 60);

  // ⑤ 對手側的備戰不算（卡面主詞是「**自己的**…備戰寶可夢」）
  chk('C5 ⭐哨兵：對手側備戰不影響（自己備戰 0 隻 ⇒ 0，即使對手備戰有 HP30）',
    dmgOf(run(IGGLY, '軟彈陣', { selfBench: [], def: HP30 })) === 0,
    String(dmgOf(run(IGGLY, '軟彈陣', { selfBench: [], def: HP30 }))));
  // ⑥ log 逐字（行為層已經驗過，這條只是補充可讀性）
  const c6 = run(IGGLY, '軟彈陣', { selfBench: benchTool });
  chk('C6 log 逐字：「軟彈陣：自己備戰最大HP「30」的寶可夢 2 隻 × 30 → 60」',
    logIdx(c6, '軟彈陣：自己備戰最大HP「30」的寶可夢 2 隻 × 30 → 60') >= 0,
    (c6.log || []).map(msg).filter((m) => m.includes('軟彈陣')).join(' | '));
}

console.log(`\n═══ v6.362 站長裁定 A-1/A-2/A-3 守衛：PASS ${pass} ／ FAIL ${fail} ═══`);
process.exit(fail === 0 ? 0 : 1);
