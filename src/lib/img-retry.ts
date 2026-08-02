/**
 * v6.101：卡圖載入失敗自動重試（Svelte action，全站單一來源）
 *
 * 玩家回報：手機版手牌常常有幾張圖片不顯示，做了別的動作或過幾回合才突然出現。
 *
 * 成因（實測）：卡圖來自**官網 CDN**（asia.pokemon-card.com/tw/card-img/…）——
 *   ・單張是 ~880KB 的 PNG
 *   ・回應**沒有 cache-control**（只有 ETag/Last-Modified）→ 瀏覽器只能啟發式快取
 *   ・**沒有 CORS**（Service Worker 只能 opaque 快取，因此 SW 刻意跳過跨域）
 *   手機弱網下大圖很容易逾時失敗，而 `<img>` 失敗後瀏覽器**永遠不會自己重試** →
 *   要等別的操作讓畫面重建、重新請求，才會「突然出現」。
 *
 * 重試策略（四次，換路徑而不是傻等）：
 *   ① 原圖             —— 瀏覽器不會負面快取失敗的圖，直接重指派同一個 URL 就會重新請求
 *   ②③ 圖片代理縮圖    —— ~30–50KB、帶 CORS 與長效快取，弱網命中率高得多。
 *      該代理本站 v4.911 匯出牌組圖片時就已在用，不是新依賴。
 *   ④ 原圖 ＋ cache-buster —— **刻意退回原圖**：這樣代理本身掛掉時仍有一條活路
 *      （雙路備援）；cache-buster 只在最後一次加，前幾次加會打穿 CDN edge 快取反而更慢。
 *
 * 另外監聽 `online` 與 `visibilitychange` —— 手機切出去再回來、或訊號恢復時補一次。
 *   ⚠ 只在「切回前景」時補，切到背景不補：背景常被瀏覽器掐斷網路，
 *     在那裡重試只會快速失敗、白白燒掉額度。
 *   ⚠ `online` 事件同時把次數歸零：訊號恢復本來就該給完整額度，
 *     否則在背景/斷網期間用完 4 次的圖會永遠停在空白。
 *
 * ⭐ **一定要傳入目前的圖片網址**（`use:retryImg={c.imageUrl}`）。
 *   Svelte 的 keyed `{#each}` 會**重用 DOM 節點只換 src**（備戰以 iid 為 key，進化不換 iid；
 *   戰鬥位撤退／KO 換上場、zoom 視窗左右切卡也都是就地換 src），此時 action **不會重跑**。
 *   若只在掛載時記住網址，之後重試會把 src 設回**上一張卡**的圖 —— 那張多半已在快取、會載入成功，
 *   結果畫面顯示錯的卡且毫無異狀，比原本的空白更糟。
 *   因此改成參數化 action：`update()` 收到新網址時重設狀態，永遠只重試「現在該顯示的那張」。
 *
 * 失敗期間會在該 <img> 上掛 `data-img-retrying`，樣式在 `+layout.svelte`（:global）。
 * ⚠ 這裡**不換成卡背圖**：卡背代表「未揭曉的牌」，用在載入失敗會誤導玩家判讀盤面。
 */

const MAX_RETRY = 4;
const BACKOFF_MS = [1000, 3000, 8000, 20000];
/** 一般盤面／手牌小圖的代理寬度；放大檢視要更清晰，由呼叫端傳 width 覆寫。 */
const DEFAULT_PROXY_WIDTH = 420;

export type RetryImgParam = string | null | undefined | { url?: string | null; width?: number };

function paramUrl(p: RetryImgParam): string {
  if (typeof p === 'string') return p;
  return p?.url ?? '';
}
function paramWidth(p: RetryImgParam): number {
  return (typeof p === 'object' && p?.width) || DEFAULT_PROXY_WIDTH;
}

/** 官網 CDN → 圖片代理縮圖（帶 CORS、長效快取、體積小很多） */
function proxied(url: string, width: number): string {
  // ⚠ 只代理絕對 http(s) 網址。站內相對路徑（/covers/…、data:、blob:）交給代理會直接壞掉，
  //   而且本站自己的檔案由 Service Worker 快取，本來就不需要代理。
  if (!/^https?:\/\//i.test(url)) return url;
  const bare = url.replace(/^https?:\/\//i, '');
  return `https://images.weserv.nl/?url=${encodeURIComponent(bare)}&w=${width}&output=webp`;
}

export function retryImg(node: HTMLImageElement, param?: RetryImgParam) {
  let original = paramUrl(param) || node.currentSrc || node.src;
  let width = paramWidth(param);
  let tries = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const clear = () => { if (timer !== null) { clearTimeout(timer); timer = null; } };

  const attempt = (): void => {
    if (disposed || tries >= MAX_RETRY || !original) return;
    const n = tries++;
    let next = original;
    if (n === 1 || n === 2) next = proxied(original, width);          // 中間兩次走代理縮圖
    if (n === MAX_RETRY - 1) next += (next.includes('?') ? '&' : '?') + `_r=${Date.now()}`;
    node.src = next;
  };

  const onError = () => {
    if (disposed) return;
    node.setAttribute('data-img-retrying', '1');
    clear();
    timer = setTimeout(attempt, BACKOFF_MS[Math.min(tries, BACKOFF_MS.length - 1)]);
  };
  const onLoad = () => {
    node.removeAttribute('data-img-retrying');
    tries = 0;                                                        // 成功即歸零，之後再壞還有完整額度
    clear();
  };
  /** 訊號恢復／切回前景時，若還在失敗狀態就立刻補一次（不等退避）。 */
  const kick = (resetTries: boolean) => {
    if (disposed || !node.hasAttribute('data-img-retrying')) return;
    // 切到背景時不重試：那裡網路常被掐斷，只會快速失敗並燒掉額度。
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (resetTries) tries = 0;
    clear();
    attempt();
  };
  const onOnline = () => kick(true);      // 斷線期間耗掉的次數不算數
  const onVisible = () => kick(false);

  node.addEventListener('error', onError);
  node.addEventListener('load', onLoad);
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);

  // 掛上時就已經是失敗狀態（例如前一次渲染就壞了）→ 立刻排一次重試
  if (node.complete && node.naturalWidth === 0 && (node.currentSrc || node.src)) onError();

  return {
    /**
     * 綁定的網址變了（節點被重用來顯示另一張卡）→ 整組狀態重設。
     * 少了這段，重試會把畫面換成上一張卡的圖。
     */
    update(next?: RetryImgParam) {
      const url = paramUrl(next);
      width = paramWidth(next);
      if (!url || url === original) return;
      original = url;
      tries = 0;
      clear();
      node.removeAttribute('data-img-retrying');
    },
    destroy() {
      disposed = true;
      clear();
      node.removeEventListener('error', onError);
      node.removeEventListener('load', onLoad);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    },
  };
}
