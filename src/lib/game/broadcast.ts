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

/** 讀取廣播設定（每次呼叫都讀最新；任何錯誤回空設定，不影響對戰）。 */
export async function getBroadcastConfig(): Promise<BroadcastConfig> {
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
