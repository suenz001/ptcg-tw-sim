/**
 * v6.657：匿名訪客純本機牌組與會員安全差異同步規劃。
 *
 *   ・純匿名／未登入訪客：僅讀寫瀏覽器 localStorage，對 Firestore 發 0 次讀寫。
 *   ・正式會員（Email / Google）：按本機歸屬與 updatedAt 執行「僅上傳真正需要同步的差異」，
 *     絕不以較舊本機覆蓋較新雲端，也絕不在跨帳號切換時把前一位帳號的快取誤傳到新帳號。
 */
import type { Deck } from './types';
import { loadDecks, saveDecksChecked, sortDecks, type LocalSaveResult } from './storage';
import { saveFavoritesChecked } from './favorites';

export const DECKS_OWNER_LS_KEY = 'ptcg-tw-sim:decks-owner-v1';
export const FAVS_OWNER_LS_KEY = 'ptcg-tw-sim:favs-owner-v1';

export interface LocalDeckOwnership {
  kind: 'anon' | 'member';
  memberUid: string | null;
  knownCloudIds: string[];
  pendingUpsertIds: string[];
  pendingDeleteIds: string[];
  /** 僅記錄在匿名／本機狀態下新建或未歸屬任何會員的牌組 id，供後續升級或登入時安全遷移。 */
  anonIds: string[];
  pendingFavorites?: boolean;
}

export function emptyOwnership(): LocalDeckOwnership {
  return {
    kind: 'anon',
    memberUid: null,
    knownCloudIds: [],
    pendingUpsertIds: [],
    pendingDeleteIds: [],
    anonIds: [],
    pendingFavorites: false,
  };
}

function uniqIds(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of arr) {
    if (typeof v === 'string' && v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

export function normalizeOwnership(raw: unknown): LocalDeckOwnership {
  if (!raw || typeof raw !== 'object') return emptyOwnership();
  const o = raw as Record<string, unknown>;
  const memberUid = typeof o.memberUid === 'string' && o.memberUid ? o.memberUid : null;
  const kind = o.kind === 'member' && memberUid ? 'member' : 'anon';
  return {
    kind,
    memberUid,
    knownCloudIds: uniqIds(o.knownCloudIds),
    pendingUpsertIds: uniqIds(o.pendingUpsertIds),
    pendingDeleteIds: uniqIds(o.pendingDeleteIds),
    anonIds: uniqIds(o.anonIds),
    pendingFavorites: o.pendingFavorites === true,
  };
}

export function hasDeckOwnershipRecord(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(DECKS_OWNER_LS_KEY) !== null;
  } catch {
    return false;
  }
}

export function readDeckOwnership(): LocalDeckOwnership {
  if (typeof localStorage === 'undefined') return emptyOwnership();
  try {
    const raw = localStorage.getItem(DECKS_OWNER_LS_KEY);
    if (!raw) return emptyOwnership();
    return normalizeOwnership(JSON.parse(raw));
  } catch {
    return emptyOwnership();
  }
}

export function writeDeckOwnership(next: LocalDeckOwnership): LocalSaveResult {
  if (typeof localStorage === 'undefined') return { ok: true };
  try {
    localStorage.setItem(DECKS_OWNER_LS_KEY, JSON.stringify(normalizeOwnership(next)));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e || '本機歸屬紀錄寫入失敗') };
  }
}

export function readFavOwner(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const v = localStorage.getItem(FAVS_OWNER_LS_KEY);
    return typeof v === 'string' && v ? v : null;
  } catch {
    return null;
  }
}

export function writeFavOwner(owner: string | null): LocalSaveResult {
  if (typeof localStorage === 'undefined') return { ok: true };
  try {
    if (owner) localStorage.setItem(FAVS_OWNER_LS_KEY, owner);
    else localStorage.removeItem(FAVS_OWNER_LS_KEY);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e || '本機常用歸屬寫入失敗') };
  }
}

export function markAnonLocalEdit(deckIds: string[]): LocalSaveResult {
  const cur = readDeckOwnership();
  const knownSet = new Set(cur.knownCloudIds);
  const anonSet = new Set(cur.anonIds);
  const pendSet = new Set(cur.pendingUpsertIds);
  for (const id of deckIds) {
    if (!id) continue;
    // 若該牌組是先前已登入會員的雲端快取，不得歸類成匿名自建牌組，防跨帳號誤傳。
    if (!knownSet.has(id)) {
      anonSet.add(id);
      pendSet.add(id);
    }
  }
  return writeDeckOwnership({
    ...cur,
    anonIds: [...anonSet],
    pendingUpsertIds: [...pendSet],
  });
}

export function markAnonLocalDelete(deckId: string): LocalSaveResult {
  if (!deckId) return { ok: true };
  const cur = readDeckOwnership();
  return writeDeckOwnership({
    ...cur,
    anonIds: cur.anonIds.filter((id) => id !== deckId),
    pendingUpsertIds: cur.pendingUpsertIds.filter((id) => id !== deckId),
  });
}

export function markMemberLocalEdit(memberUid: string, deckIds: string[]): LocalSaveResult {
  if (!memberUid) return { ok: true };
  const cur = readDeckOwnership();
  const sameMember = cur.kind === 'member' && cur.memberUid === memberUid;
  const pendSet = new Set(sameMember ? cur.pendingUpsertIds : []);
  const delSet = new Set(sameMember ? cur.pendingDeleteIds : []);
  for (const id of deckIds) {
    if (!id) continue;
    pendSet.add(id);
    delSet.delete(id);
  }
  return writeDeckOwnership({
    kind: 'member',
    memberUid,
    knownCloudIds: sameMember ? cur.knownCloudIds : [],
    pendingUpsertIds: [...pendSet],
    pendingDeleteIds: [...delSet],
    anonIds: cur.anonIds,
    pendingFavorites: sameMember ? cur.pendingFavorites : false,
  });
}

export function markMemberCloudDeleteResult(memberUid: string, deckId: string, succeeded: boolean): LocalSaveResult {
  if (!memberUid || !deckId) return { ok: true };
  const cur = readDeckOwnership();
  const sameMember = cur.kind === 'member' && cur.memberUid === memberUid;
  const known = new Set(sameMember ? cur.knownCloudIds : []);
  const pendUp = new Set(sameMember ? cur.pendingUpsertIds : []);
  const pendDel = new Set(sameMember ? cur.pendingDeleteIds : []);
  pendUp.delete(deckId);
  if (succeeded) {
    known.delete(deckId);
    pendDel.delete(deckId);
  } else if (known.has(deckId)) {
    pendDel.add(deckId);
  }
  return writeDeckOwnership({
    kind: 'member',
    memberUid,
    knownCloudIds: [...known],
    pendingUpsertIds: [...pendUp],
    pendingDeleteIds: [...pendDel],
    anonIds: cur.anonIds.filter((id) => id !== deckId),
    pendingFavorites: sameMember ? cur.pendingFavorites : false,
  });
}

export function markFavoritesLocalChange(isAnon: boolean, memberUid: string | null): LocalSaveResult {
  const cur = readDeckOwnership();
  const r1 = writeFavOwner(isAnon ? 'anon' : memberUid);
  const r2 = writeDeckOwnership({ ...cur, pendingFavorites: true });
  return combineLocalSaveResults(r1, r2);
}

/** 判斷是否為系統自動建立、玩家未動過的空白預設牌組 stub。 */
export function isUntouchedStarterStub(deck: Deck, ownership: LocalDeckOwnership): boolean {
  if (deck.name !== '我的第一個牌組') return false;
  if (deck.entries.length > 0) return false;
  if (deck.notes && deck.notes.trim().length > 0) return false;
  if (deck.coinPref) return false;
  if (ownership.pendingUpsertIds.includes(deck.id)) return false;
  if (ownership.anonIds.includes(deck.id)) return false;
  return true;
}

function canonicalDeckJson(d: Deck): string {
  return JSON.stringify({
    id: d.id,
    name: d.name ?? '',
    entries: (d.entries ?? []).map((e) => ({
      cardId: String(e.cardId),
      count: Number(e.count),
      ...(e.role ? { role: e.role } : {}),
    })),
    createdAt: d.createdAt ?? '',
    updatedAt: d.updatedAt ?? '',
    notes: d.notes ?? '',
    order: d.order ?? null,
    coinPref: d.coinPref ?? null,
  });
}

export function deckPayloadEqual(a: Deck, b: Deck): boolean {
  return canonicalDeckJson(a) === canonicalDeckJson(b);
}

function parseIsoMs(iso: unknown): number {
  if (typeof iso !== 'string' || !iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

export interface PlanMemberSyncInput {
  uid: string;
  localDecks: Deck[];
  cloudDecks: Deck[];
  ownership: LocalDeckOwnership;
  hasOwnershipRecord: boolean;
  legacyCloudRevUid?: string | null;
}

export interface PlanMemberSyncOutput {
  mergedDecks: Deck[];
  toUpload: Deck[];
  toDeleteFromCloud: string[];
  droppedCrossAccountCount: number;
  isCrossAccount: boolean;
}

/**
 * 純函式規劃「本機 ↔ 雲端」安全差異同步：
 *   1. 跨帳號切換時絕不把前一位會員的快取牌組上傳到新帳號，僅保留匿名期間新建的自有牌組。
 *   2. 同 id 衝突時，僅當「本機確實較新且非等價內容」才上傳，絕不覆蓋雲端較新或同時間資料。
 *   3. 未曾編輯過的空白系統預設牌組（我的第一個牌組）不浪費雲端寫入也不污染既有會員帳號。
 *   4. 雲端上已被其他裝置刪除（在 knownCloudIds 中但不在 cloudDecks 且無本機待傳修改）者自動自本機移除。
 */
export function planMemberDeckSync(input: PlanMemberSyncInput): PlanMemberSyncOutput {
  const { uid, localDecks, cloudDecks, ownership, hasOwnershipRecord, legacyCloudRevUid = null } = input;

  const isCrossAccount = isCrossAccountOwnership(uid, ownership, hasOwnershipRecord, legacyCloudRevUid);

  const sameMember = ownership.kind === 'member' && ownership.memberUid === uid;
  const knownCloudSet = new Set(sameMember ? ownership.knownCloudIds : []);
  const pendingUpsertSet = new Set(sameMember ? ownership.pendingUpsertIds : []);
  const pendingDeleteSet = new Set(sameMember ? ownership.pendingDeleteIds : []);
  const anonIdSet = new Set(ownership.anonIds);

  const cloudMap = new Map<string, Deck>();
  for (const c of cloudDecks) {
    if (c && c.id) cloudMap.set(c.id, c);
  }

  const toDeleteFromCloud: string[] = [];
  if (sameMember) {
    for (const delId of pendingDeleteSet) {
      if (cloudMap.has(delId)) {
        toDeleteFromCloud.push(delId);
        cloudMap.delete(delId);
      }
    }
  }

  const eligibleLocalMap = new Map<string, Deck>();
  let droppedCrossAccountCount = 0;

  for (const d of localDecks) {
    if (!d || !d.id) continue;
    if (isCrossAccount) {
      // 跨帳號切換：只有匿名期間確實新增的自有牌組可帶入新帳號；前帳號快取全部丟棄
      if (anonIdSet.has(d.id) && !isUntouchedStarterStub(d, ownership)) {
        eligibleLocalMap.set(d.id, d);
      } else {
        droppedCrossAccountCount++;
      }
      continue;
    }
    if (sameMember && pendingDeleteSet.has(d.id)) {
      continue;
    }
    if (sameMember && knownCloudSet.has(d.id) && !cloudMap.has(d.id) && !pendingUpsertSet.has(d.id)) {
      // 已於其他裝置從雲端刪除且本機無未同步修改 → 跟隨雲端刪除，不再復活上傳
      continue;
    }
    if ((ownership.kind === 'anon' || !sameMember) && isUntouchedStarterStub(d, ownership)) {
      continue;
    }
    eligibleLocalMap.set(d.id, d);
  }

  const merged: Deck[] = [];
  const toUpload: Deck[] = [];
  const allIds = new Set<string>([...cloudMap.keys(), ...eligibleLocalMap.keys()]);

  for (const id of allIds) {
    const cloudDeck = cloudMap.get(id);
    const localDeck = eligibleLocalMap.get(id);

    if (cloudDeck && !localDeck) {
      merged.push(cloudDeck);
    } else if (localDeck && !cloudDeck) {
      merged.push(localDeck);
      toUpload.push(localDeck);
    } else if (cloudDeck && localDeck) {
      if (deckPayloadEqual(localDeck, cloudDeck)) {
        merged.push(cloudDeck);
      } else {
        const localMs = parseIsoMs(localDeck.updatedAt);
        const cloudMs = parseIsoMs(cloudDeck.updatedAt);
        if (localMs > cloudMs) {
          merged.push(localDeck);
          toUpload.push(localDeck);
        } else {
          // 雲端較新或時間一致 → 絕不覆蓋雲端
          merged.push(cloudDeck);
        }
      }
    }
  }

  return {
    mergedDecks: sortDecks(merged),
    toUpload,
    toDeleteFromCloud,
    droppedCrossAccountCount,
    isCrossAccount,
  };
}

export function finalizeOwnershipAfterSync(params: {
  uid: string;
  cloudIdsBefore: string[];
  uploadedIds: string[];
  failedUploadIds: string[];
  deletedIds: string[];
  failedDeleteIds: string[];
  pendingFavoritesRemaining: boolean;
}): LocalDeckOwnership {
  const known = new Set(params.cloudIdsBefore);
  for (const id of params.uploadedIds) known.add(id);
  for (const id of params.deletedIds) known.delete(id);
  return {
    kind: 'member',
    memberUid: params.uid,
    knownCloudIds: [...known],
    pendingUpsertIds: uniqIds(params.failedUploadIds),
    pendingDeleteIds: uniqIds(params.failedDeleteIds),
    anonIds: [],
    pendingFavorites: params.pendingFavoritesRemaining,
  };
}

export function combineLocalSaveResults(...results: (LocalSaveResult | null | undefined)[]): LocalSaveResult {
  const errs: string[] = [];
  for (const r of results) {
    if (r && !r.ok && r.error) errs.push(r.error);
  }
  return errs.length > 0 ? { ok: false, error: errs.join('；') } : { ok: true };
}

export function isCrossAccountOwnership(
  uid: string,
  ownership: LocalDeckOwnership,
  hasOwnershipRecord: boolean,
  legacyCloudRevUid: string | null = null,
): boolean {
  return (ownership.kind === 'member' && !!ownership.memberUid && ownership.memberUid !== uid)
    || (!hasOwnershipRecord && !!legacyCloudRevUid && legacyCloudRevUid !== uid);
}

/**
 * 登出或跨帳號切換時立即淨化 localStorage 與歸屬紀錄：
 *   ・登出（nextUid === null）且本機目前歸屬某會員時：僅保留匿名自建 anonIds 與匿名常用清單，
 *     移除前帳號快取，避免共用瀏覽器殘留或後續登入他帳號時誤傳。
 *   ・登入會員 B 且偵測到本機殘留會員 A（isCrossAccount）時：在雲端讀取前即刻從 localStorage 移除 A 的快取，
 *     確保即使初始讀取失敗並在離線下編輯，後續重試也絕不會把 A 的牌組或常用卡牌上傳給 B。
 */
export function isolateCrossAccountLocalStorage(
  nextUid: string | null,
  legacyCloudRevUid: string | null = null,
): { isolatedDecks: Deck[]; clearedFavorites: boolean; ownership: LocalDeckOwnership; save: LocalSaveResult } {
  const cur = readDeckOwnership();
  const hasRec = hasDeckOwnershipRecord();
  const curFavOwner = readFavOwner();
  const allLocal = loadDecks();

  const shouldIsolateDecks = nextUid === null
    ? cur.kind === 'member'
    : isCrossAccountOwnership(nextUid, cur, hasRec, legacyCloudRevUid);

  const shouldClearFavs =
    (shouldIsolateDecks && curFavOwner !== 'anon')
    || (!!curFavOwner && curFavOwner !== 'anon' && curFavOwner !== nextUid);

  let nextDecks = allLocal;
  let nextOwnership = cur;
  let rDecks: LocalSaveResult = { ok: true };
  let rOwn: LocalSaveResult = { ok: true };
  let rFav: LocalSaveResult = { ok: true };
  let rFavOwn: LocalSaveResult = { ok: true };

  if (shouldIsolateDecks) {
    const anonSet = new Set(cur.anonIds);
    nextDecks = allLocal.filter((d) => anonSet.has(d.id));
    const keptAnonIds = nextDecks.map((d) => d.id);
    nextOwnership = {
      kind: 'anon',
      memberUid: null,
      knownCloudIds: [],
      pendingUpsertIds: keptAnonIds,
      pendingDeleteIds: [],
      anonIds: keptAnonIds,
      pendingFavorites: curFavOwner === 'anon' ? !!cur.pendingFavorites : false,
    };
    rDecks = saveDecksChecked(nextDecks);
    rOwn = writeDeckOwnership(nextOwnership);
  }

  if (shouldClearFavs) {
    rFav = saveFavoritesChecked(new Set());
    rFavOwn = writeFavOwner('anon');
  }

  return {
    isolatedDecks: sortDecks(nextDecks),
    clearedFavorites: shouldClearFavs,
    ownership: nextOwnership,
    save: combineLocalSaveResults(rDecks, rOwn, rFav, rFavOwn),
  };
}

/** 對戰／大廳匿名檢視：僅顯示 anonIds 或尚未屬於任何會員的本機牌組，不露出前帳號快取。 */
export function filterDecksForAnonView(allLocal: Deck[]): Deck[] {
  const cur = readDeckOwnership();
  if (cur.kind !== 'member') return allLocal;
  const anonSet = new Set(cur.anonIds);
  return allLocal.filter((d) => anonSet.has(d.id));
}

/** 會員單筆雲端寫入成功後（如 deck-posts 匯入後立即 syncDeckToCloud），收錄 knownCloudIds 並清掉該筆待傳標記。 */
export function markMemberCloudPushSucceeded(memberUid: string, deckIds: string[]): LocalSaveResult {
  if (!memberUid || deckIds.length === 0) return { ok: true };
  const cur = readDeckOwnership();
  // 若期間已登出回匿名模式或已切換帳號，絕不回頭寫回已登出／他帳號之會員歸屬
  if (cur.kind !== 'member' || cur.memberUid !== memberUid) return { ok: true };
  const known = new Set(cur.kind === 'member' ? cur.knownCloudIds : []);
  const idSet = new Set(deckIds);
  for (const id of deckIds) known.add(id);
  return writeDeckOwnership({
    kind: 'member',
    memberUid,
    knownCloudIds: [...known],
    pendingUpsertIds: cur.pendingUpsertIds.filter((id) => !idSet.has(id)),
    pendingDeleteIds: cur.pendingDeleteIds.filter((id) => !idSet.has(id)),
    anonIds: cur.anonIds.filter((id) => !idSet.has(id)),
    pendingFavorites: cur.pendingFavorites,
  });
}

export function planFavoritesMigration(params: {
  uid: string;
  localFavorites: Set<string>;
  cloudFavorites: Set<string>;
  favOwner: string | null;
  isCrossAccount: boolean;
}): { merged: Set<string>; needsCloudUpload: boolean } {
  const { uid, localFavorites, cloudFavorites, favOwner, isCrossAccount } = params;
  const foreignOwner = (!!favOwner && favOwner !== 'anon' && favOwner !== uid) || (isCrossAccount && favOwner !== 'anon');
  if (foreignOwner) {
    return { merged: new Set(cloudFavorites), needsCloudUpload: false };
  }
  const merged = new Set<string>(cloudFavorites);
  let needsCloudUpload = false;
  for (const id of localFavorites) {
    if (!merged.has(id)) {
      merged.add(id);
      needsCloudUpload = true;
    }
  }
  return { merged, needsCloudUpload };
}
