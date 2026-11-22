/**
 * M-P 特典卡 — 補漏收錄 批次 2（v6.670）
 *
 * 玩家回報「超級席多藍恩ex 沒有收錄」。refresh-official-set-manifest 現查：官方 M-P 比站上多 15 張
 * （謝米×2、勝利之證×3、火焰鳥、急凍鳥、閃電鳥、泥偶小人、鐵掌力士、鬼斯、超級席多藍恩ex、能量回收器、春紫、沐淨），
 * 逐張看卡圖核對標記（I×4、J×11，與官網欄位一致）後併入 M-P-I／M-P-J。
 * scripts/new-set/audit-new-set.mjs：其中 12 張與站上既有卡同卡面（效果以卡名／特性名為 key，自動生效；守衛 test-v6670 實跑
 *   高密度盔甲、花之帷幔，其餘檢查主動特性／招式／訓練家都已以卡名註冊），
 * 只有下面兩項要寫程式。卡面文字逐字取自 static/cards/M-P-J.json（台灣官方中文）。
 *
 * ⭐ 招式的印刷傷害由引擎讀卡資料，這裡只註冊 regPost（同 mp_j_wave1.ts 的檔頭紀律）。
 */

import { reg, regG, regPost, addLog, updatePlayer } from '../_shared';
import { setSelfDamageBonusPendingPost, flipCoinsWithLog } from '../../effects';

// ── 超級席多藍恩ex｜巨重壓 140：「在下個自己的回合，這隻寶可夢「巨重壓」的傷害「+140」點。」
//   與 路卡利歐ex｜龍捲風猛攻、巨金怪｜彗星拳、桃歹郎｜糬猛攻、美洛耶塔ex｜回聲 同一句型（只差數字）
//   ⇒ 走同一個中央寫入點 setSelfDamageBonusPendingPost（招式限定：第三參數＝「巨重壓」）。
regPost('超級席多藍恩ex|巨重壓', setSelfDamageBonusPendingPost(140, '巨重壓', '巨重壓'));

// ── 春紫（支援者）：「擲1次硬幣。若為正面，則將自己的戰鬥寶可夢恢復「150」HP，若為反面，則將自己的戰鬥寶可夢恢復「30」HP。」
//   使用條件比照 西餐廚師（戰鬥寶可夢恢復 HP 的支援者）：戰鬥寶可夢沒有傷害 ⇒ 效果完全無法執行 ⇒ 不能使用（判準①）。
//   「禁止恢復 HP」的特性由 engine 的 markHealsByDamageDecrease 在 applyAction 結尾統一處理，這裡不另判。
regG('春紫', (st, idx) => !!st.players[idx].active && st.players[idx].active!.damage > 0);
reg('春紫', (st, idx) => {
  const r = flipCoinsWithLog(st, 1, '春紫', idx);
  const amount = r.heads > 0 ? 150 : 30;
  let s = r.state;
  const before = s.players[idx].active?.damage ?? 0;
  const healed = Math.min(before, amount);
  s = addLog(s, `春紫：${r.heads > 0 ? '正面' : '反面'}，戰鬥寶可夢恢復 ${healed} HP`, idx);
  return updatePlayer(s, idx, p => {
    if (!p.active) return p;
    return { ...p, active: { ...p.active, damage: Math.max(0, p.active.damage - amount) } };
  });
});
