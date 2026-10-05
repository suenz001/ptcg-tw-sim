// ⭐v6.484 牌組公布欄：每篇投稿有自己的網址（/deck-posts?post=<id>）（站長同意的建議 #2）。
//   玩家在 LINE 群分享牌組／奪冠牌組時，貼網址就能直接打開那一篇，不用再說「去公布欄找」。
//   ⚠ 公布欄頁沒有伺服器端渲染（ssr=false），所以貼到 LINE 只會是純連結，沒有預覽縮圖。

/** 投稿 id 的格式白名單（伺服器產生的 id 只有英數、底線、連字號）；不合法就當作沒有。 */
const POST_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** 從網址參數取出要打開的投稿 id；沒有或不合法回 null。 */
export function postIdFromSearch(search: string): string | null {
  try {
    const v = new URLSearchParams(search).get('post');
    return v && POST_ID_RE.test(v) ? v : null;
  } catch { return null; }
}

/** 設定／移除 post 參數（其他參數原封保留）；回傳新的 search 字串（含 ?；沒有參數時回 ''）。 */
export function withPostParam(search: string, id: string | null): string {
  let sp: URLSearchParams;
  try { sp = new URLSearchParams(search); } catch { sp = new URLSearchParams(); }
  if (id && POST_ID_RE.test(id)) sp.set('post', id); else sp.delete('post');
  const s = sp.toString();
  return s ? '?' + s : '';
}

/** 分享用的完整網址；originWithBase 例如 https://www.ptcg-tw-sim.com（測試站則含 /ptcg-tw-sim）。 */
export function postShareUrl(originWithBase: string, id: string): string {
  return `${originWithBase}/deck-posts?post=${encodeURIComponent(id)}`;
}
