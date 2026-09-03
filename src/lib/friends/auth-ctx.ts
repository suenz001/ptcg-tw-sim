/**
 * ⭐ v6.296 好友功能的「取身分」中央出口。
 *
 * 為什麼要抽出來：好友名單（FriendsPanel.svelte）與私聊 session（/friends 頁）各自都需要
 * 「現在這個玩家是誰＋一顆可用的 idToken」。v6.295 以前兩個地方各寫一份，抽出共用元件之後
 * 就會變成兩份會漂移的複製品 —— 尤其**匿名閘**（守衛 test-v6286 7-7 的閘②）不可以只有一邊有。
 *
 * ⚠⚠ 匿名一律回 null：friends-api 收到 null ctx 會直接回 `auth`，**一發請求都不會發出去**。
 * ⚠ 拿不到 token 不丟例外（回 token: null），讓 friends-api 用同一條錯誤路徑處理。
 */
import { auth } from '$lib/firebase';
import type { FriendsCtx } from './friends-api';

export async function friendsCtxFromAuth(): Promise<FriendsCtx | null> {
  const u = auth.currentUser;
  if (!u || u.isAnonymous) return null;
  let token: string | null = null;
  try { token = await u.getIdToken(); } catch { token = null; }
  return { uid: u.uid, token };
}
