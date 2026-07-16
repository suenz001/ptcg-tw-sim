// v5.955 log 卡名點擊 → 解析到「本場對戰的實體卡」(正確印刷/卡圖/版本)。
//   共用純函式:+page.svelte(桌機) 與 MobilePortraitBattle.svelte(手機) 共用同一 resolver,
//   避免雙份漂移(手機版原本缺 v5.396 evolvedFromStack 追溯、也沒搜 deck/prizes/巢狀)。
//   只影響「點卡名要顯示哪張卡」的 UI 顯示,不改任何引擎行為 / log 文字。
import type { GameState, CardInstance, PlayerState } from './types';
import type { Card } from '../cards/types';

/**
 * 把一位玩家的所有實體卡「扁平化」成【固定順序】清單(順序即消歧義優先序,保證決定性)。
 * 公開區(戰鬥位→備戰→場地→棄牌)在前,蓋牌區(手牌→獎賞→牌庫)在後——確保公開區有同名時
 * 絕不動用蓋牌區資訊。每隻寶可夢先放本體,再放其巢狀(進化來源堆疊/附加能量/附加道具),
 * 讓「還附著在寶可夢身上的能量/道具 iid」也能被 iid 命中(marker 才真正兌現)。
 * 注意:只用來「依名字/iid 找出被 log 指涉的實體卡」,絕不揭露牌庫順序(永遠取 index 最先者)。
 */
function collectPlayerInstances(p: PlayerState, ownedStadium: CardInstance | null): CardInstance[] {
  const out: CardInstance[] = [];
  const pushWithNested = (inst: CardInstance | null | undefined): void => {
    if (!inst) return;
    out.push(inst);
    for (const s of inst.evolvedFromStack ?? []) out.push(s);
    for (const e of inst.energyAttached ?? []) out.push(e);
    if (inst.toolAttached) out.push(inst.toolAttached);
    for (const t of inst.extraTools ?? []) out.push(t);
  };
  // ① 公開區:戰鬥位 → 備戰
  pushWithNested(p.active);
  for (const b of p.bench) pushWithNested(b);
  // ② 場地卡(該玩家擁有的)
  pushWithNested(ownedStadium);
  // ③ 棄牌區(公開)
  for (const d of p.discard) pushWithNested(d);
  // ④⑤⑥ 蓋牌區:手牌 → 獎賞 → 牌庫(排最後,公開區優先)
  for (const h of p.hand) pushWithNested(h);
  for (const z of p.prizes) pushWithNested(z);
  for (const k of p.deck) pushWithNested(k);
  return out;
}

export interface ResolvedLogCard {
  cardId: string;
  inst: CardInstance | null;
}

/**
 * 解析 log 卡名 → 本場實體卡。決定性:同一 state 下重複點同一 token,結果必相同。
 * @param hintIid       token 帶的 marker iid(最精準),或該 log 的 sourceIid(actor 戰鬥位)。
 * @param hintPlayerIdx 該 log 的 playerIndex(actor 側),用來決定同名時 actor 先 / opp 先。
 * @returns null = 本場雙方【所有區】都沒有這個名字 → 呼叫端自行 fallback 全域 pool 第一同名
 *          (log 可能提到本場不存在的卡名,如宣言型效果 / 系統訊息)。
 */
export function resolveLogCard(
  game: GameState | null,
  pool: Map<string, Card>,
  cardName: string,
  hintIid?: string,
  hintPlayerIdx?: 0 | 1 | null,
): ResolvedLogCard | null {
  if (!game) return null;
  const stadiumOf = (idx: 0 | 1): CardInstance | null =>
    (game.activeStadium && game.activeStadiumOwnerIdx === idx) ? game.activeStadium : null;
  const order: (0 | 1)[] = hintPlayerIdx === 1 ? [1, 0] : [0, 1];

  // ── 第一層:iid 精準命中(含巢狀) ──
  //   命中但名字不符(常見:進化後 log 仍連 base 卡名,iid 指向進化後那隻)→ 從該實體的巢狀
  //   (進化來源 / 附加能量 / 附加道具)找符合 cardName 的那張,帶正確版本 cardId。
  if (hintIid) {
    for (const pIdx of order) {
      const insts = collectPlayerInstances(game.players[pIdx], stadiumOf(pIdx));
      const hit = insts.find((i) => i.iid === hintIid);
      if (hit) {
        const c = pool.get(hit.cardId);
        if (c && c.name === cardName) return { cardId: hit.cardId, inst: hit };
        const nested = [
          ...(hit.evolvedFromStack ?? []),
          ...(hit.energyAttached ?? []),
          ...(hit.toolAttached ? [hit.toolAttached] : []),
          ...(hit.extraTools ?? []),
        ].find((x) => pool.get(x.cardId)?.name === cardName);
        if (nested) return { cardId: nested.cardId, inst: nested };
        break; // iid 全場唯一,只會在一位玩家命中 → 落第二層名字掃描
      }
    }
  }

  // ── 第二層:名字掃描(決定性:玩家順序 × zone 順序 × array index 順序) ──
  for (const pIdx of order) {
    const insts = collectPlayerInstances(game.players[pIdx], stadiumOf(pIdx));
    const hit = insts.find((i) => pool.get(i.cardId)?.name === cardName);
    if (hit) return { cardId: hit.cardId, inst: hit };
  }

  // ── 第三層:本場所有區都找不到 → null(呼叫端 fallback 全域 pool 第一同名) ──
  return null;
}
