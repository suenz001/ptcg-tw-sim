// v5.478：系統管理員廣播設定（Firestore config/broadcast，admin 後台設定）。
//   beta(Firebase) + 正式站(Oracle 後端但前端仍有 Firebase db) 兩站都用同一份 Firestore doc 讀取。
//   v5.481：改「每場戰鬥開始讀 1 次最新」（移除整個 session 永久快取）→ admin 改設定後玩家
//     開始新的一場(或再來一局)即更新，不必 F5。讀取量＝每場 1 次，遠低於免費額度 5 萬/日。
import { doc, getDoc } from 'firebase/firestore';
import { db } from '$lib/firebase';

export interface BroadcastConfig {
  enabled: boolean;
  text: string;
  turns: number[]; // 指定要顯示廣播的回合（engine turn；先攻+後攻=turn+1）
}

const EMPTY: BroadcastConfig = { enabled: false, text: '', turns: [] };

// v6.273：10 分鐘記憶體快取 —— 同一分頁連續開多場不必每場都讀 Firestore（重整即失效，
//   行為回到 v5.481「每場 1 讀」）。admin 改廣播後：新開/重整的分頁立即生效，
//   已開著的分頁最慢 10 分鐘後的下一場生效。讀取「失敗」不快取（容錯語意不變，下一場再試）；
//   「文件不存在」是有效結果、照樣快取。時鐘倒退（at 在未來）視為過期。
const BROADCAST_TTL_MS = 10 * 60 * 1000;
let _bcCache: { at: number; cfg: BroadcastConfig } | null = null;

/** 讀取廣播設定（10 分鐘內共用同一次讀取；任何錯誤回空設定，不影響對戰）。 */
export async function getBroadcastConfig(): Promise<BroadcastConfig> {
  const now = Date.now();
  if (_bcCache && now >= _bcCache.at && now - _bcCache.at < BROADCAST_TTL_MS) return _bcCache.cfg;
  try {
    const snap = await getDoc(doc(db, 'config', 'broadcast'));
    if (!snap.exists()) {
      _bcCache = { at: now, cfg: EMPTY };
      return EMPTY;
    }
    const d = snap.data() as Record<string, unknown>;
    const turns = Array.isArray(d.turns)
      ? (d.turns as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n >= 1)
      : [];
    const cfg: BroadcastConfig = {
      enabled: !!d.enabled,
      text: typeof d.text === 'string' ? d.text : '',
      turns,
    };
    _bcCache = { at: now, cfg };
    return cfg;
  } catch {
    return EMPTY;
  }
}
