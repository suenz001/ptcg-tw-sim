/**
 * ⭐⭐⭐ v6.340 《卡牌政策》的玩家端載入器。
 *
 * 政策（哪些標可打、哪些卡包暫不開放）存在 **Firebase Firestore `config/cardPolicy`**，
 * 走的是站上既有的「後台↔前端共享設定」管道（同 `config/broadcast`、`config/homeChangelog`），
 * 兩站共用、不必動 Oracle API、沒有 CORS 問題。
 *
 * ⚠⚠ 這是**合法性判定**的來源，所以三件事一定要守住：
 *   ① **fail-closed**：讀不到／格式壞掉／離線 ⇒ 一律保留 `DEFAULT_CARD_POLICY`
 *      （程式內建的 H/I/J ＋ M6a 鎖住），**絕不可以**變成「全部放行」。
 *   ② **只讀一次**：`config/*` 的 getDoc 會吃 Firestore 讀取額度（v6.272 的教訓），
 *      所以同一個分頁只發一次，並用 localStorage 做短 TTL 快取。
 *      ⚠⚠ **連「沒有設定」也要寫負快取** —— 站長還沒按過儲存時 `snap.exists()` 永遠是 false，
 *        不寫負快取的話每次進站都會多一次 getDoc，那個 10 分鐘 TTL 等於不存在
 *        （Opus 5 對抗性審查抓到）。離線／格式不合格同理。
 *   ③ **永不 throw**：任何一步失敗都只是靜靜地維持預設值，不能讓頁面掛掉。
 *
 * ⚠ 錦標賽伺服器跑的是**同一支** `validateDeck`，它自己也會讀同一份 `config/cardPolicy`
 *   （後台那支 server_admin_patch.js，用 firebase-admin）。兩端讀同一個文件 ⇒
 *   不會出現「前端說不合法、伺服器說合法」的分裂。
 */
import { setCardPolicy, DEFAULT_CARD_POLICY, type CardPolicy } from './regulation';

/** localStorage 快取的 key；⚠ 改政策的欄位語意時要換 key，免得吃到舊格式。 */
const CACHE_KEY = 'ptcg_card_policy_v1';
/** 快取有效期。站長在後台改設定後，最慢這麼久全站生效。 */
const TTL_MS = 10 * 60 * 1000;
/** 「上一份成功讀到的政策」；**不帶 TTL**，只在網路暫時不通時當備援。 */
const LAST_GOOD_KEY = 'ptcg_card_policy_last_good_v1';

/** `policy: null` ＝「後台沒有設定／設定不合格」，用程式內建值（這就是負快取）。 */
type CacheEntry = { at: number; policy: CardPolicy | null };

let _once: Promise<void> | null = null;

function readCache(): { hit: boolean; policy: CardPolicy | null } {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return { hit: false, policy: null };
    const o = JSON.parse(raw) as CacheEntry;
    if (!o || typeof o.at !== 'number' || Date.now() - o.at > TTL_MS) return { hit: false, policy: null };
    return { hit: true, policy: o.policy ?? null };
  } catch {
    return { hit: false, policy: null };   // 無痕視窗／被封鎖／格式壞掉 ⇒ 當作沒有快取
  }
}

function writeCache(policy: CardPolicy | null): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), policy } satisfies CacheEntry));
    // ⭐ 「上一份成功讀到的政策」另外存一份、**不帶 TTL** —— 網路暫時不通時要沿用它，
    //   而不是退回程式內建值（那個方向在賽季輪替後是放寬）。
    if (policy) localStorage.setItem(LAST_GOOD_KEY, JSON.stringify(policy));
  } catch {
    /* 寫不進去就算了（無痕／配額滿），下次再讀一次 Firestore */
  }
}

/** 上一份成功讀到的政策（無 TTL）；沒有就回 null。 */
function readLastGood(): CardPolicy | null {
  try {
    const raw = localStorage.getItem(LAST_GOOD_KEY);
    return raw ? (JSON.parse(raw) as CardPolicy) : null;
  } catch {
    return null;
  }
}

/**
 * 載入並套用後台政策。**同一個分頁只會真的做一次**，重複呼叫拿到同一個 Promise。
 * 回傳的 Promise **永遠 resolve**（不會 reject）——失敗就是維持預設值。
 */
export function loadCardPolicyOnce(): Promise<void> {
  if (_once) return _once;
  _once = (async () => {
    // SSR／prerender：沒有 window，也沒有後台設定可讀 ⇒ 用程式內建預設值
    // （卡片頁預渲染與 sitemap 本來就該按「出版當下」的政策產生）。
    if (typeof window === 'undefined') return;

    const cached = readCache();
    if (cached.hit) {
      // 命中負快取（policy=null）⇒ 什麼都不做，維持程式內建值。
      if (cached.policy && setCardPolicy(cached.policy)) return;
      if (!cached.policy) return;
      // 快取裡的內容居然不合格（手動改過 localStorage？）⇒ 當作沒命中，去 Firestore 重讀
    }

    try {
      const [{ db }, { doc, getDoc }] = await Promise.all([
        import('$lib/firebase'),
        import('firebase/firestore'),
      ]);
      const snap = await getDoc(doc(db, 'config', 'cardPolicy'));
      if (!snap.exists()) { writeCache(null); return; }   // ⭐ 負快取：沒有設定也記下來（這是「查到了，就是沒有」）
      const data = snap.data() as Partial<CardPolicy> | undefined;
      const policy: CardPolicy = {
        allowedMarks: Array.isArray(data?.allowedMarks) ? data!.allowedMarks : DEFAULT_CARD_POLICY.allowedMarks,
        lockedSets: Array.isArray(data?.lockedSets) ? data!.lockedSets : DEFAULT_CARD_POLICY.lockedSets,
      };
      // ⚠ setCardPolicy 自己會整包驗證；不合格會回 false 且維持現值（fail-closed）。
      if (setCardPolicy(policy)) writeCache(policy);
      else writeCache(null);                              // ⭐ 負快取：查到了但內容不合格 ⇒ 用內建值
    } catch {
      // ⚠⚠ **不要**在這裡寫負快取：離線／Firestore 抖動是「沒查到」，不是「沒有設定」。
      //   寫下去的話，明年後台是 I/J/K 時，一次暫時性失敗就等於「H 標放行 10 分鐘」——
      //   比伺服器端（維持現值）寬鬆，兩端行為不對稱（Fable 5.1 對抗性審查抓到）。
      //   ⇒ 沿用上一份成功讀到的政策（快取還在就還在），下次再試。
      const last = readLastGood();
      if (last) setCardPolicy(last);
      /* 沒有 lastGood ⇒ 維持 DEFAULT_CARD_POLICY */
    }
  })();
  return _once;
}

/** 測試用：把「只做一次」的狀態清掉。⚠ 正式流程不要呼叫。 */
export function _resetCardPolicyLoaderForTest(): void {
  _once = null;
}
