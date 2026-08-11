/**
 * v6.173 錦標賽同步：盤面「結構共享」合併（純函式，無副作用）。
 *
 * ## 問題（有數字）
 * 錦標賽的每一次輪詢都走 `tAdopt(state)`，而 `tAdopt` 是
 *   `game = state`
 * ——**整棵樹換成剛 `JSON.parse` 出來的全新物件**。`game` 是 Svelte 5 的深層 `$state`
 * proxy，換掉根物件等於把每一個子物件都換成新的 proxy ⇒ 模板裡每一個
 * `{@const b = myPlayer.bench[i]}`、`{@const bc = getCard(b.cardId)}`、`energyPips(b)`…
 * 全部拿到不同的物件 identity ⇒ **每 400~800ms 一次全量重繪**。
 *
 * 本機／休閒對戰不會這麼痛，因為引擎是 immutable 更新：沒被動到的子樹會沿用同一個物件。
 * 錦標賽這條路徑獨缺這個性質（盤面是伺服器送來的 JSON，物件 identity 必然全新）。
 *
 * ## 做法
 * `shareStateIdentity(prev, next)` 回傳一份**與 `next` 深度相等**的值，
 * 但凡是「內容和 `prev` 對應位置完全一樣」的子樹，一律沿用 `prev` 那一份物件
 * （也就是沿用**既有的 Svelte proxy**）⇒ 下游 derived 比較出 `===` 相等就直接跳過重算。
 *
 * ## ⚠ 為什麼可以放心（等價性由「構造」保證，不是靠測試碰運氣）
 * 這個函式只有兩種回傳：
 *   ① `next` 本身（或 `next` 的原始子值）；
 *   ② `prev` 的子樹 —— **只有在逐鍵、逐序、遞迴確認過與 `next` 完全一致時**才回傳；
 *   ③ 一個**用 `next` 的鍵、依 `next` 的鍵順序**新建的物件／依 `next` 長度新建的陣列，
 *      每個值都是遞迴後的結果。
 * ⇒ `JSON.stringify(shareStateIdentity(prev, next)) === JSON.stringify(next)` 恆成立
 *   （鍵順序也一致，所以是逐位元組等價，不只是深度相等）。
 *
 * ⚠ 陣列比對會先試「同 iid」：`bench`／`hand`／`discard` 這些陣列一旦有元素被插入或移除，
 *   後面全部位移，純靠索引比對會一個都共享不到。同一個 `iid` 的 prev 元素**最多只會被取用一次**
 *   （取用後就從候選 map 移除），避免任何 alias（兩個位置指到同一個物件）。
 *
 * ⚠ 這個函式**不可以**改成「就地修改 prev」。prev 是還掛在畫面上的 state，
 *   就地改會繞過 Svelte 的寫入通知，畫面就不會更新。
 */

/** 只沿用「plain object / array」；其他型別（函式、Date、Map…）一律直接回 next。 */
function isPlainContainer(v: unknown): v is Record<string, unknown> | unknown[] {
  if (v === null || typeof v !== 'object') return false;
  if (Array.isArray(v)) return true;
  const proto = Object.getPrototypeOf(v);
  // ⚠ Svelte 的 $state proxy 對 getPrototypeOf 是透明的（會回 Object.prototype / Array.prototype），
  //   所以 proxy 也會通過這一關 —— 這正是我們要的（要沿用的就是 proxy）。
  return proto === Object.prototype || proto === null;
}

/**
 * 回傳一份與 `next` 逐位元組等價、但盡量沿用 `prev` 物件 identity 的值。
 *
 * @param prev 上一份盤面（通常是 Svelte `$state` proxy）
 * @param next 伺服器剛送來的全新 JSON
 */
export function shareStateIdentity<T>(prev: unknown, next: T): T {
  if ((prev as unknown) === (next as unknown)) return next;
  if (!isPlainContainer(prev) || !isPlainContainer(next)) return next;

  const prevIsArr = Array.isArray(prev);
  const nextIsArr = Array.isArray(next);
  if (prevIsArr !== nextIsArr) return next;

  if (nextIsArr) {
    const pArr = prev as unknown[];
    const nArr = next as unknown[];
    // 同 iid 的候選（每個 iid 只留第一筆；取用後即移除 ⇒ 不會產生 alias）
    let byIid: Map<string, number> | null = null;
    for (let i = 0; i < pArr.length; i++) {
      const el = pArr[i] as Record<string, unknown> | null;
      if (el && typeof el === 'object' && !Array.isArray(el) && typeof el.iid === 'string') {
        (byIid ??= new Map());
        if (!byIid.has(el.iid)) byIid.set(el.iid, i);
      }
    }
    const out = new Array(nArr.length);
    let same = pArr.length === nArr.length;
    for (let i = 0; i < nArr.length; i++) {
      const n = nArr[i] as Record<string, unknown> | null;
      let p: unknown = i < pArr.length ? pArr[i] : undefined;
      if (byIid && n && typeof n === 'object' && !Array.isArray(n) && typeof n.iid === 'string') {
        const hit = byIid.get(n.iid);
        if (hit !== undefined) { p = pArr[hit]; byIid.delete(n.iid); }
      }
      const v = shareStateIdentity(p, nArr[i]);
      out[i] = v;
      if (same && v !== pArr[i]) same = false;
    }
    return (same ? (pArr as unknown) : (out as unknown)) as T;
  }

  const pObj = prev as Record<string, unknown>;
  const nObj = next as unknown as Record<string, unknown>;
  const pKeys = Object.keys(pObj);
  const nKeys = Object.keys(nObj);
  const out: Record<string, unknown> = {};
  // ⚠ 鍵順序也要一樣才敢沿用 prev（否則 JSON.stringify 會不同 → 就不是「逐位元組等價」了）
  let same = pKeys.length === nKeys.length;
  for (let i = 0; i < nKeys.length; i++) {
    const k = nKeys[i];
    const v = shareStateIdentity(pObj[k], nObj[k]);
    out[k] = v;
    if (same && (pKeys[i] !== k || v !== pObj[k])) same = false;
  }
  return (same ? (pObj as unknown) : (out as unknown)) as T;
}

/**
 * 診斷／守衛用：走遍 `merged` 的每一個容器節點，數出有幾個是「沿用自 `prev` 的同一個物件」。
 * ⚠ 只給守衛與離線診斷用，正式路徑不呼叫（多走一趟樹是白花成本）。
 */
export function countSharedNodes(prev: unknown, merged: unknown): { shared: number; total: number } {
  const prevNodes = new Set<unknown>();
  const collect = (v: unknown): void => {
    if (!isPlainContainer(v) || prevNodes.has(v)) return;
    prevNodes.add(v);
    const vals = Array.isArray(v) ? v : Object.values(v as Record<string, unknown>);
    for (const c of vals) collect(c);
  };
  collect(prev);

  let shared = 0;
  let total = 0;
  const walk = (v: unknown): void => {
    if (!isPlainContainer(v)) return;
    total++;
    if (prevNodes.has(v)) shared++;
    const vals = Array.isArray(v) ? v : Object.values(v as Record<string, unknown>);
    for (const c of vals) walk(c);
  };
  walk(merged);
  return { shared, total };
}
