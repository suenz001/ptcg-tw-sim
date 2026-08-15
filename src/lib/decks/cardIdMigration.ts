/**
 * v5.300 M5 台版上線 — 玩家 (v5.299 之前用 M5 日版 ID 50220~50300) 牌組無痛遷移
 * 載入 deck 時對每個 cardId 透過此 table 查台版 ID (官網編碼).
 * 若 jp_id 不在 table, 原樣回傳 (其他 set 不受影響).
 *
 * 對應依 collectorNumber match (M5 卡序號 jp/tw 完全一致).
 * 81 卡完整對應.
 */
// v6.194：下架卡清單的**唯一**來源（葉子模組，零 runtime 相依，不會造成循環 import）。
import { HIDDEN_FROM_PLAYERS } from '$lib/cards/visibility';

export const M5_JP_TO_TW_ID: Record<string, string> = {

  "50220": "19145",
  "50221": "19146",
  "50222": "19147",
  "50223": "19148",
  "50224": "19149",
  "50225": "19150",
  "50226": "19151",
  "50227": "19152",
  "50228": "19153",
  "50229": "19154",
  "50230": "19155",
  "50231": "19156",
  "50232": "19157",
  "50233": "19158",
  "50234": "19159",
  "50235": "19160",
  "50236": "19161",
  "50237": "19162",
  "50238": "19163",
  "50239": "19164",
  "50240": "19165",
  "50241": "19166",
  "50242": "19167",
  "50243": "19168",
  "50244": "19169",
  "50245": "19170",
  "50246": "19171",
  "50247": "19172",
  "50248": "19173",
  "50249": "19174",
  "50250": "19175",
  "50251": "19176",
  "50252": "19177",
  "50253": "19178",
  "50254": "19179",
  "50255": "19180",
  "50256": "19181",
  "50257": "19182",
  "50258": "19183",
  "50259": "19184",
  "50260": "19185",
  "50261": "19186",
  "50262": "19187",
  "50263": "19188",
  "50264": "19189",
  "50265": "19190",
  "50266": "19191",
  "50267": "19192",
  "50268": "19193",
  "50269": "19194",
  "50270": "19195",
  "50271": "19196",
  "50272": "19197",
  "50273": "19198",
  "50274": "19199",
  "50275": "19200",
  "50276": "19201",
  "50277": "19202",
  "50278": "19203",
  "50279": "19204",
  "50280": "19205",
  "50281": "19206",
  "50282": "19207",
  "50283": "19208",
  "50284": "19209",
  "50285": "19210",
  "50286": "19211",
  "50287": "19212",
  "50288": "19213",
  "50289": "19214",
  "50290": "19215",
  "50291": "19216",
  "50292": "19217",
  "50293": "19218",
  "50294": "19219",
  "50295": "19220",
  "50296": "19221",
  "50297": "19222",
  "50298": "19223",
  "50299": "19224",
  "50300": "19225"
};

/**
 * **港版重複卡下架 → 對照回台版**。
 *
 * v6.193 的做法是把那兩張從 `static/cards/M-P-J.json` **刪掉**；
 * v6.194 依站長 2026-08-15 的第二次裁定改為「資料留著、只是玩家選不到」，
 * 清單因此收斂到 `$lib/cards/visibility` 的 `HIDDEN_FROM_PLAYERS`
 * ——**全站只有那一份**排除清單，這裡只是推導出「id → 保留版 id」的對照。
 *
 * ⚠ 為什麼即使卡片已經回到卡池、這張對照表仍然要留著：
 *   它讓「舊牌組裡的港版 id」在載入時就換成台版那張，玩家牌組張數不變、
 *   對戰照打，而且下次存檔之後就再也不帶著下架 id ——
 *   等於把 v6.193 那條「不可再新增」的規則也套用到既有牌組上。
 *   （即使把這張表拿掉也不會崩潰，因為卡片本身已經回到卡池了。）
 */
export const RETIRED_DUP_TO_TW_ID: Record<string, string> = Object.fromEntries(
  Object.entries(HIDDEN_FROM_PLAYERS).map(([id, info]) => [id, info.replacementId]),
);

/** 對單一 cardId 查 migration (jp→tw / 已下架重複卡→保留版); 不在 table 原樣回傳 */
export function migrateCardId(cardId: string): string {
  return M5_JP_TO_TW_ID[cardId] ?? RETIRED_DUP_TO_TW_ID[cardId] ?? cardId;
}


/** v5.301: 統一 migrateDeck helper (storage.ts + cloud.ts 共用) — load deck 時自動 map jp→tw cardId */
import type { Deck, DeckEntry } from './types';
export function migrateDeck(d: Deck): Deck {
  const mapped = mergeDuplicateEntries(d.entries.map(e => ({ ...e, cardId: migrateCardId(e.cardId) })));
  return splitTwoCardStadiumEntries({ ...d, entries: mapped });
}

/**
 * v6.193：migrate 之後**同一個 cardId 可能出現兩筆**（例如牌組同時放了台版 18560 與
 * 港版 18965，後者被對照成前者）。必須合併，否則牌組編輯器的
 * `{#each … (card.id)}` 會因為重複 key 直接 runtime error（整頁打不開）。
 * ⚠ 冪等：沒有重複時原樣回傳同樣的內容。
 */
export function mergeDuplicateEntries(entries: DeckEntry[]): DeckEntry[] {
  const out: DeckEntry[] = [];
  const at = new Map<string, number>();
  for (const e of entries) {
    const i = at.get(e.cardId);
    if (i === undefined) { at.set(e.cardId, out.length); out.push({ ...e }); }
    else out[i] = { ...out[i], count: out[i].count + e.count };
  }
  return out;
}

/**
 * v6.093「傳說」競技場拆成左右兩張獨立卡片後的舊牌組自動轉換（Wilson 裁定：玩家無感）。
 *
 * 拆卡之前，牌組裡存的是**左半那個 cardId**（19621/19622/19623），一筆 N 張。
 * 拆卡之後左右各是一張卡 → 把那 N 張攤成「左 ⌈N/2⌉ 張 ＋ 右 ⌊N/2⌋ 張」。
 *   例：舊的 4 張 → 左 2 ＋ 右 2（＝2 套，與拆卡前完全等價）。
 * ⚠ 奇數張（例如舊資料壞掉留下 3 張）→ 左 2 ＋ 右 1，牌組驗證會提示左右張數不等，
 *   讓玩家自己修，**不要**在這裡靜默改成偶數（會無聲動到玩家的牌組）。
 * ⚠ 冪等：已經有右半 entry 的牌組（＝已轉換過）原樣回傳，不會愈轉愈多。
 */
const TWO_CARD_STADIUM_SPLIT: Readonly<Record<string, string>> = {
  '19621': '19624',   // 傳說的海溝   071/076 → 072/076
  '19622': '19625',   // 傳說的山頂   073/076 → 074/076
  '19623': '19626',   // 傳說的熔岩洞 075/076 → 076/076
};
/**
 * v6.101：`splitTwoCardStadiumEntries` 的**反向**操作 —— 把右半併回官方那張卡的 id。
 *
 * ⚠ 為什麼需要：右半的 id（19624/19625/19626）是本站 v6.093 拆卡時**自己造的**，
 *   官方卡表根本沒有這幾個 id（它們的 sourceUrl／imageUrl 都指回左半）。
 *   把它們送去台灣官網牌組構築工具 → 官網**連 id 存不存在都不驗**，
 *   不會報錯，而是**靜默發行一副含幽靈 id 的牌組**（代碼打開後右半那幾張會壞掉）。
 *   ⇒ 任何「把 cardId 送到站外」的出口都必須先跑這個合併。
 *
 * count 語義：官網 deckData 的 count 單位是**實體張數**（與本站一致，1 套＝2 張），
 *   所以左 2 ＋ 右 2 → 送 `{cardId:'19622', count:4}`。
 */
export function mergeTwoCardStadiumEntries(entries: DeckEntry[]): DeckEntry[] {
  const rightToLeft: Record<string, string> = {};
  for (const [left, right] of Object.entries(TWO_CARD_STADIUM_SPLIT)) rightToLeft[right] = left;
  const out: DeckEntry[] = [];
  const idx = new Map<string, number>();
  for (const e of entries) {
    const id = rightToLeft[e.cardId] ?? e.cardId;
    const at = idx.get(id);
    if (at === undefined) { idx.set(id, out.length); out.push({ ...e, cardId: id }); }
    else out[at] = { ...out[at], count: out[at].count + e.count };
  }
  return out;
}

export function splitTwoCardStadiumEntries(d: Deck): Deck {
  const rightIds = new Set(Object.values(TWO_CARD_STADIUM_SPLIT));
  const entries: Deck['entries'] = [];
  for (const e of d.entries) {
    const rightId = TWO_CARD_STADIUM_SPLIT[e.cardId];
    // 已經含有對應右半 → 這副牌組轉換過了，原樣保留（冪等）
    if (!rightId || d.entries.some(x => x.cardId === rightId) || rightIds.has(e.cardId) || e.count <= 0) {
      entries.push(e);
      continue;
    }
    const left = Math.ceil(e.count / 2);
    const right = e.count - left;
    entries.push({ ...e, count: left });
    if (right > 0) entries.push({ ...e, cardId: rightId, count: right });
  }
  return { ...d, entries };
}
