// ⭐v6.581 出牌／抽牌「放到畫面中間翻開」的事件判準（站長 2026-10-17 裁定「先做這項」，參考 PTCGCodex）
//
// 只拿「前後兩份盤面」算，完全不看 log、不碰引擎、不讀任何隱藏區：
//   對手（觀戰時雙方）：某張卡**這一步才第一次變成公開**（之前不在場上、附加卡、進化堆、棄牌區、場地），
//     就是他剛打出來的牌 —— 卡片本身已經是公開資訊，拿來展示不會洩漏任何東西。
//     ⚠ 錦標賽盤面遮蔽時，對手手牌連 iid 都是不透明編號，所以不能用「從手牌消失」判斷；「第一次變成公開」兩種情況都成立。
//   我方抽牌：我的手牌多了 1～2 張、而且不是從獎賞卡拿的（取獎賞有自己的大動畫）、也不是從公開區撿回來的 ⇒ 給我看抽到什麼。
//     只給玩家本人；觀戰不展示任何人的抽牌（手牌不是觀戰者該看的公開資訊）。
//
// 不展示：開局（setup）與開局結束那一步（會一次翻開整個場面）、不同局、被效果丟進棄牌區的寶可夢／能量
//   （那多半是效果造成的，不是「出牌」）、對手在**我的回合**進棄牌區的訓練家（多半是我的效果讓他丟的）。
// 一次最多回傳 3 張（大量搜尋／一次放很多隻時只展示前 3 張，避免洗畫面）。

export type RevealKind = 'bench' | 'active' | 'evolve' | 'energy' | 'tool' | 'stadium' | 'supporter' | 'item' | 'trainer' | 'draw';

export interface RevealEvent {
  side: 0 | 1;
  kind: RevealKind;
  cardId: string;
  iid: string;
}

type Inst = { iid?: string; cardId?: string; energyAttached?: Inst[]; toolAttached?: Inst; extraTools?: Inst[]; evolvedFromStack?: Inst[] } | null | undefined;
type CardLike = { supertype?: string; subtype?: string } | null | undefined;

export const REVEAL_MAX_PER_STEP = 3;

/** 某一側的所有公開 iid（場上、附加卡、進化堆、棄牌區、放逐區、他擁有的場地） */
export function publicIidsOf(g: any, side: 0 | 1): Set<string> {
  const out = new Set<string>();
  const p = g?.players?.[side];
  if (!p) return out;
  const addInst = (x: Inst) => {
    if (!x) return;
    if (x.iid) out.add(x.iid);
    for (const e of x.energyAttached ?? []) if (e?.iid) out.add(e.iid);
    if (x.toolAttached?.iid) out.add(x.toolAttached.iid);
    for (const t of x.extraTools ?? []) if (t?.iid) out.add(t.iid);
    for (const s of x.evolvedFromStack ?? []) if (s?.iid) out.add(s.iid);
  };
  addInst(p.active);
  for (const b of p.bench ?? []) addInst(b);
  for (const d of p.discard ?? []) if (d?.iid) out.add(d.iid);
  for (const d of p.lostZone ?? []) if (d?.iid) out.add(d.iid);
  if (g.activeStadium && g.activeStadiumOwnerIdx === side) {
    if (g.activeStadium.iid) out.add(g.activeStadium.iid);
    if (g.activeStadiumPartner?.iid) out.add(g.activeStadiumPartner.iid);   // 「兩張合一」場地的第二張（審查 P3-3）
  }
  return out;
}

function trainerKind(c: CardLike): RevealKind {
  if (c?.subtype === 'Supporter') return 'supporter';
  if (c?.subtype === 'Item') return 'item';
  return 'trainer';
}

export interface RevealOpts {
  /** 看畫面的人是誰：玩家傳自己的座位；觀戰／回放傳 -1 */
  viewerSeat: number;
  getCard: (cardId: string) => CardLike;
}

/** 唯一判準：prev → next 這一步要展示哪些牌（Rule 38：畫面只呼叫這一支） */
export function computeRevealEvents(prev: any, next: any, o: RevealOpts): RevealEvent[] {
  if (!prev || !next) return [];
  if (prev.id !== next.id) return [];
  if (next.phase !== 'playing' || prev.phase !== 'playing') return [];
  const events: RevealEvent[] = [];
  const spectator = o.viewerSeat !== 0 && o.viewerSeat !== 1;
  for (const side of [0, 1] as const) {
    const before = publicIidsOf(prev, side);
    const pp = prev.players?.[side], np = next.players?.[side];
    if (!pp || !np) continue;
    const isOpp = spectator || side !== o.viewerSeat;
    if (isOpp) {
      const sideTurn = next.activePlayerIndex === side;
      // 場上：新出現的寶可夢（放備戰／派上戰鬥場）、進化（同一個 iid 換了卡）、新附加的能量／道具
      const prevField = new Map<string, Inst>();
      if (pp.active?.iid) prevField.set(pp.active.iid, pp.active);
      for (const b of pp.bench ?? []) if (b?.iid) prevField.set(b.iid, b);
      const field: Array<[Inst, 'active' | 'bench']> = [];
      if (np.active) field.push([np.active, 'active']);
      for (const b of np.bench ?? []) field.push([b, 'bench']);
      for (const [x, where] of field) {
        if (!x?.iid || !x.cardId) continue;
        const was = prevField.get(x.iid);
        if (!was && !before.has(x.iid)) events.push({ side, kind: where, cardId: x.cardId, iid: x.iid });
        else if (was && was.cardId !== x.cardId && (x.evolvedFromStack?.length ?? 0) > (was.evolvedFromStack?.length ?? 0)) {
          events.push({ side, kind: 'evolve', cardId: x.cardId, iid: x.iid + ':' + x.cardId });
        }
        for (const e of x.energyAttached ?? []) if (e?.iid && e.cardId && !before.has(e.iid)) events.push({ side, kind: 'energy', cardId: e.cardId, iid: e.iid });
        for (const t of [x.toolAttached, ...(x.extraTools ?? [])]) if (t?.iid && t.cardId && !before.has(t.iid)) events.push({ side, kind: 'tool', cardId: t.cardId, iid: t.iid });
      }
      // 場地
      const st = next.activeStadium;
      if (st?.iid && st.cardId && next.activeStadiumOwnerIdx === side && prev.activeStadium?.iid !== st.iid && !before.has(st.iid)) {
        events.push({ side, kind: 'stadium', cardId: st.cardId, iid: st.iid });
      }
      // 棄牌區：只算「他自己的回合」新進棄牌區、而且這一步引擎真的記了「從手牌打出」的訓練家（物品／支援者）
      //   ⚠ 審查 P2-1：高級球、艾莉絲的鬥志等「丟手牌當代價」也會讓訓練家進棄牌區 —— 那不是「使用」。
      //     引擎每打出一張手牌就在 currentTurnActions 記一筆 play_hand（engine.ts recordTurnAction）⇒ 只認這一步新增的那幾筆，每筆只配一張。
      if (sideTurn) {
        const prevRec = (pp.currentTurnActions ?? []).length;
        const recs = (np.currentTurnActions ?? []);
        const played: string[] = recs.length >= prevRec ? recs.slice(prevRec).filter((r: any) => r?.type === 'play_hand').map((r: any) => String(r.cardId)) : [];
        for (const d of np.discard ?? []) {
          if (!d?.iid || !d.cardId || before.has(d.iid)) continue;
          const c = o.getCard(d.cardId);
          if (c?.supertype !== 'Trainer') continue;
          if (c.subtype === 'Stadium' || c.subtype === 'PokemonTool') continue;   // 場地／道具被換掉才進棄牌區，不是「使用」（卡庫的道具 subtype 只有 'PokemonTool'，test-v6211）
          const k = played.indexOf(String(d.cardId));
          if (k < 0) continue;   // 這一步沒有從手牌打出這張 ⇒ 是被丟的，不展示
          played.splice(k, 1);
          events.push({ side, kind: trainerKind(c), cardId: d.cardId, iid: d.iid });
        }
      }
    } else {
      // 我方抽牌：手牌新多出來的 1～2 張，不是獎賞卡、不是從公開區撿回來的
      const prevHand = new Set<string>((pp.hand ?? []).map((c: Inst) => c?.iid).filter(Boolean) as string[]);
      const prevPrizes = new Set<string>((pp.prizes ?? []).map((c: Inst) => c?.iid).filter(Boolean) as string[]);
      const fresh = (np.hand ?? []).filter((c: Inst) => c?.iid && c.cardId && !prevHand.has(c.iid) && !prevPrizes.has(c.iid) && !before.has(c.iid));
      const deckShrank = (np.deck?.length ?? 0) < (pp.deck?.length ?? 0);
      // ⚠ 審查 P2-2：這一步是在回答選擇視窗（從牌庫搜尋加入手牌等）⇒ 是自己挑的牌，不是「抽到」，不展示
      const answeringPicker = !!prev.pendingSelection;
      if (deckShrank && !answeringPicker && fresh.length >= 1 && fresh.length <= 2) {
        for (const c of fresh) events.push({ side, kind: 'draw', cardId: c.cardId as string, iid: c.iid as string });
      }
    }
  }
  return events.slice(0, REVEAL_MAX_PER_STEP);
}

/** 畫面上的標籤（誰＋做了什麼）。who＝「對手」或玩家名稱（觀戰時） */
export function revealLabel(ev: RevealEvent, who: string): string {
  switch (ev.kind) {
    case 'bench': return `${who}放到備戰區`;
    case 'active': return `${who}派上戰鬥場`;
    case 'evolve': return `${who}進化`;
    case 'energy': return `${who}附加能量`;
    case 'tool': return `${who}附加道具`;
    case 'stadium': return `${who}打出競技場`;
    case 'supporter': return `${who}使用支援者`;
    case 'item': return `${who}使用物品`;
    case 'trainer': return `${who}使用訓練家`;
    case 'draw': return '抽到';
  }
}
