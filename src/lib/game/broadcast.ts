// v5.478：系統管理員廣播設定（Firestore config/broadcast，admin 後台設定、開戰讀取）。
//   beta(Firebase) + 正式站(Oracle 後端但前端仍有 Firebase db) 兩站都用同一份 Firestore doc 讀取。
//   ★ 讀取量優化：module-level 快取——每個玩家「整個分頁 session 只讀 1 次」(不是每場)，
//     遠低於 Firestore 免費額度 5 萬次/日。admin 改設定後玩家重整頁面即更新。
import { doc, getDoc } from 'firebase/firestore';
import { db } from '$lib/firebase';

export interface BroadcastConfig {
  enabled: boolean;
  text: string;
  turns: number[]; // 指定要顯示廣播的回合（engine turn；先攻+後攻=turn+1）
}

const EMPTY: BroadcastConfig = { enabled: false, text: '', turns: [] };

let _cache: Promise<BroadcastConfig> | null = null;

async function _fetch(): Promise<BroadcastConfig> {
  try {
    const snap = await getDoc(doc(db, 'config', 'broadcast'));
    if (!snap.exists()) return EMPTY;
    const d = snap.data() as Record<string, unknown>;
    const turns = Array.isArray(d.turns)
      ? (d.turns as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n >= 1)
      : [];
    return {
      enabled: !!d.enabled,
      text: typeof d.text === 'string' ? d.text : '',
      turns,
    };
  } catch {
    return EMPTY;
  }
}

/** 讀取廣播設定（整個 session 只實際讀 1 次，後續回快取；任何錯誤回空設定，不影響對戰）。 */
export function getBroadcastConfig(): Promise<BroadcastConfig> {
  if (!_cache) _cache = _fetch();
  return _cache;
}
