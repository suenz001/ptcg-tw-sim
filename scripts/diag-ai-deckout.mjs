// 診斷：「牌組耗盡」敗局的牌庫是被什麼消耗掉的（AI 對戰強化 第 2 步；不進 CI，不動 src/）。
//
// 背景：批次 A 的對手池基線顯示敗局有兩成多是自己牌庫先抽完，連對「主階段隨機」的對手都會輸。
// 目的：分清楚是 **AI 決策問題**（牌庫見底還照打抽牌卡）還是 **預組問題**（那副牌本來就抽很兇）。
//   ⇒ 每一個被引擎接受的動作讓「哪一方的牌庫」少了幾張，歸到來源（卡名／特性／招式／回合開始抽牌）。
//   ⇒ 「見底後（牌庫 ≤ LOW）自己主動再消耗」分三桶：
//        可選抽牌（特性、訓練家、特殊能量、進化觸發的特性提示，單步 ≥ 2 張）——決策可以介入的部分
//        搜尋拿牌（選擇視窗單步只 −1，例如寶可平板、高級球）——通常是必要動作
//        強制（招式本身的效果）
//   ⇒ 每個來源除以「該側自己的回合數」再比較耗盡敗局 vs 勝局（fable 審查：不正規化時長局什麼都比較多，看不出因果）。
//
// ⚠ 已知盲點：setup 的 FINISH_SETUP 放獎賞是 engine 就地 shift 同一個陣列（prev 也被改），這裡看不到那 6 張；
//   對結論沒影響（獎賞固定 6 張），但各來源加總不會等於 60。
//
// 用法：node scripts/diag-ai-deckout.mjs [--seeds 12] [--out 報告.md]
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import {
  buildAiBundle, loadLivePool, presetById, playGame, makeRandomAgent, firstPlayerOf, pct, sideSummary,
} from './lib/ai-sim-harness.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const SEEDS = Number(arg('--seeds', 12));
const OUT = arg('--out', null);
const LOW = 8;   // 「牌庫見底」門檻（張）：只是量測口徑，不是要寫進 AI 的門檻

const mod = await buildAiBundle(ROOT);
const pool = loadLivePool(ROOT);
const ai = (st, idx) => mod.aiNew(st, pool, idx);
const DECKS = [
  ['胡地', '__preset_alakazam__'], ['呆呆王', '__preset_slowking__'], ['超級路卡利歐', '__preset_mega_lucario__'],
  ['瑪俐的長毛巨魔ex', '__preset_marnie_scrafty__'], ['魔靈多龍', '__preset_marrune_dragapult__'],
].map(([name, id]) => ({ name, deck: presetById(mod, id) }));
const nm = (cid) => pool.get(String(cid))?.name ?? '?';

/**
 * 動作來源（只讀 prev 盤面）。選擇視窗沿用同一方上一個「主動作」的來源（鬥子／小光的多段視窗才會歸回卡名）；
 * 進化觸發的特性提示（resolve-play-ability-prompt）用 params 的卡名＋特性名。
 * 回傳 { label, kind }：kind ∈ 'turn-draw' | 'optional' | 'forced' | 'setup' | 'other'
 */
function makeSourcer() {
  const lastMain = [null, null];
  return (prev, act, actor, victim) => {
    switch (act.type) {
      case 'END_TURN': return victim !== actor ? { label: '回合開始抽牌', kind: 'turn-draw' } : { label: '回合結束（寶可夢檢查等）', kind: 'other' };
      case 'PLAY_TRAINER': { const h = prev.players[actor].hand.find((c) => c.iid === act.iid); const l = { label: '訓練家｜' + (h ? nm(h.cardId) : '?'), kind: 'optional' }; lastMain[actor] = l; return l; }
      case 'USE_ABILITY': {
        const p = prev.players[actor]; const inst = [p.active, ...p.bench].find((c) => c?.iid === act.iid);
        const c = inst ? pool.get(String(inst.cardId)) : null;
        const l = { label: '特性｜' + (c ? `${c.name}｜${c.abilities?.[act.abilityIndex]?.name ?? '?'}` : '?'), kind: 'optional' };
        lastMain[actor] = l; return l;
      }
      case 'ATTACK': {
        const a = prev.players[actor].active;
        const eff = a ? mod.getEffectiveAttacks(prev, a, pool) : [];
        const l = { label: `招式｜${a ? nm(a.cardId) : '?'}｜${eff?.[act.attackIndex]?.atk?.name ?? '?'}`, kind: 'forced' };
        lastMain[actor] = l; return l;
      }
      case 'ATTACH_ENERGY': {
        const h = prev.players[actor].hand.find((c) => c.iid === act.energyIid);
        const l = { label: '特殊能量｜' + (h ? nm(h.cardId) : '?'), kind: 'optional' }; lastMain[actor] = l; return l;
      }
      case 'RESOLVE_SELECTION': {
        const ps = prev.pendingSelection;
        if (ps?.params?.cardName && ps?.params?.abilityName) return { label: `特性提示｜${ps.params.cardName}｜${ps.params.abilityName}`, kind: 'optional' };
        const base = lastMain[actor];
        return base ? { label: base.label, kind: base.kind } : { label: '選擇視窗｜' + (ps?.effectKey ?? ps?.type ?? '?'), kind: 'optional' };
      }
      case 'EVOLVE': case 'PLAY_BASIC': case 'RETREAT': { const l = { label: '其他｜' + act.type, kind: 'optional' }; lastMain[actor] = l; return l; }
      default: return { label: '其他｜' + act.type, kind: 'setup' };
    }
  };
}

const newAcc = () => ({ n: 0, ownTurns: 0, cons: new Map(), late: { optional: new Map(), search: new Map(), forced: new Map() },
  prizesLeft: 0, attacks: 0, turns: 0, avail: 0, availN: 0 });
const bump = (m, k, v = 1) => m.set(k, (m.get(k) ?? 0) + v);
const agg = new Map();
const t0 = Date.now();
for (const row of DECKS) {
  const A = { games: 0, deckout: newAcc(), win: newAcc(), other: 0 };
  agg.set(row.name, A);
  for (let c = 0; c <= DECKS.length; c++) {
    const isRandom = c === DECKS.length;
    const oppDeck = isRandom ? row.deck : DECKS[c].deck;
    for (let s = 0; s < SEEDS; s++) {
      const seed = 99173 + s * 104729 + c * 13;
      for (const seat of [0, 1]) {
        const opp = isRandom ? makeRandomAgent(mod, pool) : ai;
        const agents = seat === 0 ? [ai, opp] : [opp, ai];
        const decks = seat === 0 ? [row.deck, oppDeck] : [oppDeck, row.deck];
        const cons = new Map();
        const late = { optional: new Map(), search: new Map(), forced: new Map() };
        const sourceOf = makeSourcer();
        let finalSt = null;
        const r = playGame({ mod, pool, decks, agents, seed, firstPlayer: firstPlayerOf(seed),
          onStep: (prev, act, next, actor) => {
            finalSt = next;
            const src = sourceOf(prev, act, actor, seat);   // 每一步都要呼叫（讓「上一個主動作」保持正確）
            const d = prev.players[seat].deck.length - next.players[seat].deck.length;
            if (d <= 0) return;
            bump(cons, src.label, d);
            if (actor !== seat || prev.players[seat].deck.length > LOW || src.kind === 'turn-draw' || src.kind === 'setup') return;
            // 見底後自己主動消耗：招式＝強制；選擇視窗單步只 −1 ＝搜尋拿牌；其餘＝可選抽牌
            const bucket = src.kind === 'forced' ? 'forced' : (act.type === 'RESOLVE_SELECTION' && d === 1 ? 'search' : 'optional');
            bump(late[bucket], src.label, d);
          } });
        A.games++;
        const lostDeckout = r.outcome === 'ended' && r.winner != null && r.winner !== seat && r.reasonClass === 'deck-out';
        const won = r.outcome === 'ended' && r.winner === seat;
        const acc = lostDeckout ? A.deckout : (won ? A.win : null);
        if (!acc) { A.other++; continue; }
        acc.n++;
        const ownTurns = r.sides[seat].ownTurns.length;
        acc.ownTurns += ownTurns;
        for (const [k, v] of cons) bump(acc.cons, k, v);
        for (const b of ['optional', 'search', 'forced']) for (const [k, v] of late[b]) bump(acc.late[b], k, v);
        acc.prizesLeft += finalSt ? finalSt.players[seat].prizes.length : 0;
        acc.attacks += r.sides[seat].attacksSent;
        acc.turns += r.turns;
        const sm = sideSummary(r.sides[seat]);
        if (sm.availRate != null) { acc.avail += sm.availRate; acc.availN++; }
      }
    }
  }
  process.stderr.write(`  ${row.name} 完成（${((Date.now() - t0) / 1000).toFixed(0)} 秒）\n`);
}

const out = [];
const P = (x = '') => out.push(x);
const sum = (m) => [...m.values()].reduce((a, b) => a + b, 0);
P('# 診斷：「牌組耗盡」敗局的牌庫消耗來源');
P('');
P(`對手池 5 副預組，每副牌對 5 副 AI 對手＋「主階段隨機」對手，各 ${SEEDS} 個 seed × 鏡像 2 場。只統計**該副牌那一側**。`);
P(`見底＝牌庫 ≤ ${LOW} 張（量測口徑）。「見底後主動消耗」分三桶：可選抽牌（決策可介入）／搜尋拿牌（選擇視窗單步 −1）／強制（招式）。`);
P('⚠ 這份資料只能說明「可以介入多少張」，**不能**說明不抽就會贏（耗盡時多半還剩好幾張獎賞）；出貨與否一律交給對手池 --compare 否決。');
P('');
P('| 牌組 | 局數 | 牌組耗盡敗 | 勝 | 耗盡敗局：剩餘獎賞／攻擊次數／自己回合數／攻擊可用率 | 勝局：攻擊次數／自己回合數／攻擊可用率 | 耗盡敗局每局「見底後」張數：可選抽牌／搜尋／強制 |');
P('|---|---|---|---|---|---|---|');
for (const [name, A] of agg) {
  const L = A.deckout, W = A.win, n = L.n || 1, w = W.n || 1;
  P(`| ${name} | ${A.games} | ${L.n}（${pct(L.n / A.games)}） | ${W.n} | ${(L.prizesLeft / n).toFixed(1)}／${(L.attacks / n).toFixed(1)}／${(L.ownTurns / n).toFixed(1)}／${L.availN ? pct(L.avail / L.availN) : '—'} | ${(W.attacks / w).toFixed(1)}／${(W.ownTurns / w).toFixed(1)}／${W.availN ? pct(W.avail / W.availN) : '—'} | ${(sum(L.late.optional) / n).toFixed(1)}／${(sum(L.late.search) / n).toFixed(1)}／${(sum(L.late.forced) / n).toFixed(1)} |`);
}
P('');
for (const [name, A] of agg) {
  const L = A.deckout, W = A.win;
  if (!L.n) continue;
  P(`## ${name}`);
  P('');
  P('每個「自己的回合」平均消耗牌庫張數（已按回合數正規化）——耗盡敗局 vs 勝局，前 12 名來源：');
  P('');
  P('| 來源 | 耗盡敗局 | 勝局 |');
  P('|---|---|---|');
  const keys = [...L.cons.keys()].sort((a, b) => (L.cons.get(b) ?? 0) - (L.cons.get(a) ?? 0)).slice(0, 12);
  for (const k of keys) P(`| ${k} | ${((L.cons.get(k) ?? 0) / L.ownTurns).toFixed(2)} | ${W.ownTurns ? ((W.cons.get(k) ?? 0) / W.ownTurns).toFixed(2) : '—'} |`);
  P('');
  const top = (m) => [...m].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${v}`).join('、') || '無';
  P(`見底後可選抽牌（耗盡敗局合計張數）：${top(L.late.optional)}`);
  P('');
  P(`見底後搜尋拿牌：${top(L.late.search)}`);
  P('');
  P(`見底後強制（招式）：${top(L.late.forced)}`);
  P('');
}
const text = out.join('\n');
console.log(text);
if (OUT) writeFileSync(OUT, text);
